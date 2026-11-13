import { isAddress, isHash, keccak256, toFunctionSelector, toHex, type Hex } from "viem";
import { normalizeNativeTrace } from "../lib/vnext/normalized-native-trace";
import pins from "../../../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json";

const anchor = { number: 113412054, hash: "0x17252a232b68a4e9fc494caf0660cff722ac2da966ee5c62b40e20dbcfd32ea2",
  stateRoot: "0x40bd233c2ec47cdd834b5df1bd12252d85987ca6256d87ed1340c0e6f47dc494" };
const sample = "0xed20008784b2087a543cdc046622046e9713fdfc7feac8381e5416874d153af2";
const router = "0x204faca1764b154221e35c0d20abb3c525710498";
const routerRuntimeHash = "0x76b92a5bba2dd32019a64eb421f1750e78c6ba044dbfa6840b722eb5ac63d296";
const sampleBlockHash = "0x10947c708428d448ae9a68d604f953e67a82dfbc752b2589d8434ce08d65037b";
const samplePayout = 12_061_233_538_253_827n;
const rollup = "0x23a19d23e89166adedbdcb432518ab01e4272d94";
const inbox = "0xbd0d173eeb87d57a09521c24388a12789f33ba96";
const bridge = "0xdf8755334ce7a73ccf6b581c02ea649ae3e864b3";
const batchTopic = "0x7394f4a19a13c7b92b5bb71033245305946ef78452f7b4986ac1390b5df4ebd7";
const l2 = [
  ["Robinhood public", "https://rpc.mainnet.chain.robinhood.com/"],
  ["Pocket public", "https://robinhood.api.pocket.network/"],
  ["dRPC public", "https://robinhood.drpc.org/"],
  ["Pinax public", "https://robinhood.rpc.pinax.network/"],
] as const;
const l1 = [
  ["PublicNode Ethereum", "https://ethereum-rpc.publicnode.com/"],
  ["1RPC Ethereum", "https://1rpc.io/eth"],
  ["dRPC Ethereum", "https://eth.drpc.org/"],
] as const;
type Provider = readonly [string, string];
type Obj = Record<string, unknown>;
type Check = { status: "observed"; value: unknown } | { status: "unavailable"; reason: string };
const asObject = (value: unknown): Obj => value && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const hex = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-f]+$/i.test(value);
const equal = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const word = (value: string) => "0x" + value.slice(2).toLowerCase().padStart(64, "0");
const bytes = (value: unknown): value is Hex => typeof value === "string" && /^0x(?:[0-9a-f]{2})+$/i.test(value);
function need(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}

let requestId = 0;
const methods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_call",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_getLogs", "debug_traceTransaction"]);
async function rpc([, endpoint]: Provider, method: string, params: unknown[] = []) {
  need(methods.has(method), "non_read_method");
  const id = ++requestId;
  const response = await fetch(endpoint, {
    method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    headers: { "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(12_000),
  }).catch(() => { throw new Error("transport_error"); });
  need(response.ok, `http_${response.status}`);
  const stream = response.body?.getReader();
  need(stream, "missing_body");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await stream.read();
      if (next.done) break;
      size += next.value.length;
      need(size <= 1024 * 1024, "body_limit");
      parts.push(next.value);
    }
  } catch (error) {
    await stream.cancel().catch(() => {});
    if (error instanceof Error && error.message === "body_limit") throw error;
    throw new Error("transport_error");
  } finally { stream.releaseLock(); }
  let body: Obj;
  try { body = asObject(JSON.parse(Buffer.concat(parts).toString("utf8"))); }
  catch { throw new Error("invalid_json"); }
  const error = asObject(body.error);
  if (typeof error.code === "number" && Number.isSafeInteger(error.code)) {
    const suffix = typeof error.message === "string" && /historical state|missing trie|unknown state|state unavailable/i.test(error.message)
      ? "_historical_state" : "";
    throw new Error(`rpc_${error.code}${suffix}`);
  }
  need(body.id === id && body.jsonrpc === "2.0" && "result" in body, "rpc_envelope");
  return body.result;
}

async function capture(read: () => Promise<unknown>): Promise<Check> {
  try { return { status: "observed", value: await read() }; }
  catch (error) { return { status: "unavailable", reason: error instanceof Error && /^[a-z0-9_-]+$/i.test(error.message) ? error.message : "read_failed" }; }
}

async function block(provider: Provider, number: string) {
  const result = asObject(await rpc(provider, "eth_getBlockByNumber", [number, false]));
  need(hex(result.number) && typeof result.hash === "string" && isHash(result.hash)
    && hex(result.timestamp), "invalid_block");
  return { number: result.number, hash: result.hash, timestamp: result.timestamp, stateRoot: result.stateRoot,
    parentHeight: result.l1BlockNumber };
}

async function chain(provider: Provider, expected: number) {
  const result = await rpc(provider, "eth_chainId");
  need(hex(result) && BigInt(result) === BigInt(expected), "wrong_chain");
}

async function inspectL2(provider: Provider) {
  await chain(provider, 4663);
  const anchored = await block(provider, toHex(anchor.number));
  need(equal(anchored.hash, anchor.hash) && equal(anchored.stateRoot, anchor.stateRoot)
    && BigInt(anchored.number) === BigInt(anchor.number), "anchor_mismatch");
  const historic = { blockHash: anchor.hash, requireCanonical: true };
  const call = { to: router, data: toFunctionSelector("poolManager()") };
  const archiveCode = async (reference: string | typeof historic) => {
    const code = await rpc(provider, "eth_getCode", [router, reference]);
    need(bytes(code) && keccak256(code) === routerRuntimeHash, "router_pin_mismatch");
    return keccak256(code);
  };
  const observations = {
    finalizedTag: await capture(async () => {
      const tag = await block(provider, "finalized");
      return { number: tag.number, hash: tag.hash };
    }),
    historicalCodeByHeight: await capture(() => archiveCode(anchored.number)),
    canonicalCodeByHash: await capture(() => archiveCode(historic)),
    canonicalCallByHash: await capture(async () => {
      const value = await rpc(provider, "eth_call", [call, historic]);
      need(equal(value, word(pins.robinhoodMainnet.poolManager.address)), "manager_binding_mismatch");
      return value;
    }),
    unknownHashRejected: await capture(async () => {
      try { await rpc(provider, "eth_call", [call, { ...historic, blockHash: toHex(1n, { size: 32 }) }]); }
      catch (error) {
        need(error instanceof Error && /^rpc_-\d+/.test(error.message), "no_rpc_rejection");
        return error.message;
      }
      throw new Error("unexpected_result");
    }),
    batchHint: await capture(async () => {
      const value = await rpc(provider, "eth_call", [{ to: "0x00000000000000000000000000000000000000c8",
        data: toFunctionSelector("findBatchContainingBlock(uint64)") + word(toHex(anchor.number)).slice(2) }, "latest"]);
      need(hex(value) && value.length === 66, "invalid_batch_hint");
      return BigInt(value).toString();
    }),
    receiptAndLogs: await capture(async () => {
      const receipt = asObject(await rpc(provider, "eth_getTransactionReceipt", [sample]));
      const tx = asObject(await rpc(provider, "eth_getTransactionByHash", [sample]));
      need(equal(receipt.transactionHash, sample) && equal(tx.hash, sample) && equal(receipt.to, router)
        && equal(tx.to, router) && equal(tx.from, String(receipt.from)) && isAddress(String(tx.from)) && receipt.status === "0x1"
        && hex(receipt.blockNumber) && equal(tx.blockHash, String(receipt.blockHash)) && tx.blockNumber === receipt.blockNumber, "invalid_sample_receipt");
      const canonical = await block(provider, receipt.blockNumber);
      need(canonical.number === receipt.blockNumber && equal(receipt.blockHash, canonical.hash)
        && canonical.hash === sampleBlockHash, "sample_branch_changed");
      const swapTopic = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";
      const manager = pins.robinhoodMainnet.poolManager.address;
      const response = await rpc(provider, "eth_getLogs", [{ address: manager, fromBlock: canonical.number, toBlock: canonical.number, topics: [swapTopic] }]);
      const logs = Array.isArray(response) ? response.map(asObject) : [];
      need(logs.some((log) => equal(log.transactionHash, sample) && equal(log.blockHash, canonical.hash) && equal(log.address, manager)
        && Array.isArray(log.topics) && equal(log.topics[0], swapTopic) && equal(log.topics[2], word(router))
        && bytes(log.data) && log.data.length === 386 && BigInt("0x" + log.data.slice(2, 66)) === samplePayout
        && !log.removed && Array.isArray(receipt.logs) && receipt.logs.map(asObject).some((entry) => entry.logIndex === log.logIndex
          && equal(entry.address, manager) && entry.data === log.data && JSON.stringify(entry.topics) === JSON.stringify(log.topics))), "sample_swap_log_missing");
      return { number: canonical.number, hash: canonical.hash, swapLogObserved: true };
    }),
    nativeTrace: await capture(async () => {
      const trace = normalizeNativeTrace(await rpc(provider, "debug_traceTransaction", [sample, { tracer: "callTracer", timeout: "8s" }]));
      const tx = asObject(await rpc(provider, "eth_getTransactionByHash", [sample]));
      need(equal(tx.hash, sample) && tx.blockHash === sampleBlockHash && hex(tx.blockNumber) && bytes(tx.input)
        && tx.value === "0x0" && trace.inputHash === keccak256(tx.input)
        && trace.to === router && equal(trace.from, String(tx.from)) && BigInt(trace.value ?? "-1") === BigInt(tx.value), "trace_root_mismatch");
      function paid(frame: typeof trace): bigint {
        if (frame.error) return 0n;
        const amount = frame.type === "CALL" && equal(frame.from, pins.robinhoodMainnet.poolManager.address)
          && equal(frame.to, String(tx.from)) ? BigInt(frame.value ?? "0") : 0n;
        return frame.calls.reduce((sum, child) => sum + paid(child), amount);
      }
      const amount = paid(trace);
      need(amount === samplePayout && (await block(provider, tx.blockNumber)).hash === sampleBlockHash, "native_payout_unproven");
      return { nativePayoutWei: amount.toString() };
    }),
  };
  return { anchor: anchored, ...observations };
}

async function inspectL1(provider: Provider, batch: string | undefined, parentHeight: unknown, deliveryHint?: string) {
  await chain(provider, 1);
  const finalized = await block(provider, "finalized");
  const contractBindings = await capture(async () => {
    const reference = { blockHash: finalized.hash, requireCanonical: true };
    const checks = [
      [rollup, "chainId()", word(toHex(4663))], [rollup, "bridge()", word(bridge)],
      [rollup, "sequencerInbox()", word(inbox)], [inbox, "bridge()", word(bridge)], [bridge, "rollup()", word(rollup)],
    ];
    for (const [to, signature, expected] of checks) {
      const observed = await rpc(provider, "eth_call", [{ to, data: toFunctionSelector(signature) }, reference]);
      need(equal(observed, expected), "binding_mismatch");
    }
    return true;
  });
  const batchDelivery = await capture(async () => {
    need(batch !== undefined && hex(parentHeight), "missing_l2_batch_or_parent_hint");
    const start = BigInt(parentHeight);
    const finalizedHeight = BigInt(finalized.number);
    need(start <= finalizedHeight, "parent_not_finalized");
    const batchWord = toHex(BigInt(batch), { size: 32 });
    const end = start + 300n > finalizedHeight ? finalizedHeight : start + 300n;
    const filter = { address: inbox, fromBlock: toHex(start), toBlock: toHex(end), topics: [batchTopic, batchWord] };
    const hintedReceipt = deliveryHint ? asObject(await rpc(provider, "eth_getTransactionReceipt", [deliveryHint])) : undefined;
    const logs = hintedReceipt
      ? (Array.isArray(hintedReceipt.logs) ? hintedReceipt.logs.map(asObject).filter((entry) => equal(entry.address, inbox)
        && Array.isArray(entry.topics) && equal(entry.topics[0], batchTopic) && equal(entry.topics[1], batchWord)) : [])
      : await rpc(provider, "eth_getLogs", [filter]);
    need(Array.isArray(logs) && logs.length === 1, "batch_delivery_not_unique");
    const log = asObject(logs[0]);
    need(equal(log.address, inbox) && !log.removed && hex(log.blockNumber) && BigInt(log.blockNumber) >= start
      && BigInt(log.blockNumber) <= end && typeof log.transactionHash === "string" && isHash(log.transactionHash)
      && Array.isArray(log.topics) && equal(log.topics[0], batchTopic)
      && equal(log.topics[1], toHex(BigInt(batch), { size: 32 })), "malformed_batch_delivery");
    const canonical = await block(provider, log.blockNumber);
    const receipt = hintedReceipt ?? asObject(await rpc(provider, "eth_getTransactionReceipt", [log.transactionHash]));
    const tx = asObject(await rpc(provider, "eth_getTransactionByHash", [log.transactionHash]));
    need(canonical.number === log.blockNumber && equal(log.blockHash, canonical.hash)
      && equal(receipt.blockHash, canonical.hash) && equal(tx.blockHash, canonical.hash)
      && equal(receipt.transactionHash, log.transactionHash) && equal(tx.hash, log.transactionHash)
      && receipt.status === "0x1" && Array.isArray(receipt.logs) && receipt.logs.map(asObject).some((entry) =>
        equal(entry.address, inbox) && entry.logIndex === log.logIndex && entry.data === log.data
        && JSON.stringify(entry.topics) === JSON.stringify(log.topics)), "batch_delivery_receipt_mismatch");
    return { number: canonical.number, hash: canonical.hash, transactionHash: log.transactionHash,
      discovery: hintedReceipt ? "independent_receipt_lookup" : "filtered_log",
      blobCount: Array.isArray(tx.blobVersionedHashes) ? tx.blobVersionedHashes.length : 0 };
  });
  return { finalized: { number: finalized.number, hash: finalized.hash }, contractBindings, batchDelivery };
}

async function main() {
  const startedAt = new Date().toISOString();
  const l2Checks = await Promise.all(l2.map(async (provider) => ({ provider: provider[0], ...(await capture(() => inspectL2(provider))) })));
  const observations = l2Checks.flatMap((result) => result.status === "observed" ? [result.value as Awaited<ReturnType<typeof inspectL2>>] : []);
  const hints = [...new Set(observations.flatMap(({ batchHint }) => batchHint.status === "observed" ? [String(batchHint.value)] : []))];
  const parent = [...new Set(observations.flatMap(({ anchor }) => hex(anchor.parentHeight) ? [anchor.parentHeight] : []))];
  const batch = hints.length === 1 ? hints[0] : undefined;
  const parentHeight = parent.length === 1 ? parent[0] : undefined;
  const [primary, ...witnesses] = l1;
  const primaryL1 = await capture(() => inspectL1(primary, batch, parentHeight));
  const primaryDelivery = asObject(asObject(primaryL1.status === "observed" ? primaryL1.value : null).batchDelivery);
  const deliveryHint = asObject(primaryDelivery.value).transactionHash;
  const witnessL1 = await Promise.all(witnesses.map(async (provider) => ({ provider: provider[0],
    ...(await capture(() => inspectL1(provider, batch, parentHeight,
      typeof deliveryHint === "string" && isHash(deliveryHint) ? deliveryHint : undefined))) })));
  const l1Checks = [{ provider: primary[0], ...primaryL1 }, ...witnessL1];
  console.log(JSON.stringify({ startedAt, anchor, sample, l2: l2Checks, l1: l1Checks,
    l1Finality: "unverified", hostedRouting: "unknown", hostedIndexing: "unknown" }, null, 2));
}

void main().catch(() => { console.error("Read-only probe failed."); process.exitCode = 1; });
