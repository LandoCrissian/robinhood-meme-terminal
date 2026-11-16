import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const requireWebsite = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeAbiParameters, encodeAbiParameters, keccak256, toEventSelector, toFunctionSelector } = requireWebsite("viem");
const evidence = (name) => JSON.parse(readFileSync(new URL("../../docs/evidence/" + name, import.meta.url)));
const { externalRuntimePins: pins } = evidence("fixed-supply-security/4663-profile.json");
const { fork: archive } = evidence("fixed-supply-release/release-manifest.json");
const knownBatch = evidence("fixed-supply-release/l1-batches.json");
const safeInitializers = evidence("rmt-task046/treasury-safe-initializers.json");
const snapshot = JSON.parse(readFileSync(new URL("../../apps/launch-website/data/historical-launches-4663.json", import.meta.url)));
const historical = snapshot.launches.find(({ version, launchId }) => version === 6 && launchId === "0");
const historicalSignature = toEventSelector("TokenLaunchedV6(uint256,address,address,address,address,bytes32,bytes32,uint32,uint16,uint16,uint16,uint16,bool,uint64,uint64,uint16,uint16,uint256,bool,string,string,string)");
const sequencerInbox = knownBatch.l1.inbox.toLowerCase();
const batchSignature = toEventSelector(knownBatch.l1.signature);
const nodeInterface = knownBatch.l2.nodeInterface;
const safeFactory = safeInitializers.observation.runtimePins[1].address.toLowerCase();
const safeSingleton = safeInitializers.observation.runtimePins[0].address.toLowerCase();
const safeProposalSelector = toFunctionSelector("createProxyWithNonce(address,bytes,uint256)");
export const MOBILE_DEPLOYMENT_PAYER = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
const safeGasPayer = evidence("rmt-task044/governance-wallets.json").wallets[0].address.toLowerCase();
const abiTypes = (...types) => types.map((type) => ({ type }));

export const ROBINHOOD_SOURCES = Object.freeze({
  official: "https://rpc.mainnet.chain.robinhood.com",
  pocket: "https://robinhood.api.pocket.network",
  pinax: "https://robinhood.rpc.pinax.network",
});
const ETHEREUM_SOURCES = Object.freeze({
  publicnode: "https://ethereum-rpc.publicnode.com",
  flashbots: "https://rpc.flashbots.net",
});
const endpointUrls = new Set([...Object.values(ROBINHOOD_SOURCES), ...Object.values(ETHEREUM_SOURCES)]);
const readMethods = new Set([
  "eth_chainId", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode", "eth_getBalance",
  "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getTransactionCount", "eth_getLogs",
  "eth_call", "eth_estimateGas", "eth_gasPrice", "debug_traceTransaction",
]);
const limits = Object.freeze({ timeoutMs: 8_000, attempts: 2, responseBytes: 192 * 1024, logBlockCount: 384 });
const hashPattern = /^0x[0-9a-f]{64}$/i;
const addressPattern = /^0x[0-9a-f]{40}$/i;
const bytesPattern = /^0x(?:[0-9a-f]{2})*$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const quantity = (value) => "0x" + BigInt(value).toString(16);
const word = (value) => "0x" + BigInt(value).toString(16).padStart(64, "0");
const now = () => new Date().toISOString();

function checked(value, predicate) {
  if (!predicate(value)) throw new Error("Invalid RPC observation");
  return value;
}
const canonicalHash = (value) => checked(value, (input) => typeof input === "string" && hashPattern.test(input)).toLowerCase();
const canonicalAddress = (value) => checked(value, (input) => typeof input === "string" && addressPattern.test(input)).toLowerCase();
const canonicalBytes = (value) => checked(value, (input) => typeof input === "string" && bytesPattern.test(input)).toLowerCase();
const readQuantity = (value) => BigInt(checked(value, (input) => typeof input === "string" && quantityPattern.test(input)));
const decimal = (value) => readQuantity(value).toString();

function checkSafeGasEstimate(params, allowedPayer) {
  const [transaction, block] = params;
  if (params.length < 1 || params.length > 2 || !transaction || transaction.to?.toLowerCase() !== safeFactory ||
      transaction.from?.toLowerCase() !== allowedPayer || (transaction.value !== undefined && transaction.value !== "0x0") ||
      Object.keys(transaction).some((key) => !["from", "to", "data", "value"].includes(key)) ||
      (block !== undefined && block !== "latest" && !quantityPattern.test(block)) ||
      !transaction.data?.startsWith(safeProposalSelector)) throw new Error("Gas estimate outside the reviewed Safe preparation scope");
  const [singleton, initializer, salt] = decodeAbiParameters(abiTypes("address", "bytes", "uint256"), "0x" + transaction.data.slice(10));
  const encoded = safeProposalSelector + encodeAbiParameters(abiTypes("address", "bytes", "uint256"), [singleton, initializer, salt]).slice(2);
  if (encoded.toLowerCase() !== transaction.data.toLowerCase() || singleton.toLowerCase() !== safeSingleton ||
      !safeInitializers.proposals.some((item) => BigInt(item.saltNonce) === salt && item.initializerKeccak256 === keccak256(initializer))) {
    throw new Error("Gas estimate Safe initializer, singleton or salt mismatch");
  }
}

function checkScope(method, params, allowedPayer) {
  if (!readMethods.has(method)) throw new Error("RPC method outside the read-only allowlist");
  if (!Array.isArray(params) || JSON.stringify(params).length > 4096) throw new Error("RPC parameters outside the probe bounds");
  if (method === "debug_traceTransaction" && (params.length !== 2 ||
      params[0] !== historical.receipt.transactionHash ||
      params[1]?.tracer !== "callTracer" || params[1]?.timeout !== "3s" || Object.keys(params[1]).length !== 2)) {
    throw new Error("Trace outside the pinned historical sample");
  }
  if (method === "eth_getLogs") {
    const [filter] = params;
    if (params.length !== 1 || !filter || !quantityPattern.test(filter.fromBlock) || !quantityPattern.test(filter.toBlock) ||
        !addressPattern.test(filter.address) || !Array.isArray(filter.topics) || !hashPattern.test(filter.topics[0]) ||
        BigInt(filter.fromBlock) > BigInt(filter.toBlock) || BigInt(filter.toBlock) - BigInt(filter.fromBlock) >= BigInt(limits.logBlockCount)) {
      throw new Error("Log query outside the bounded address, topic and block range");
    }
  }
  if (method === "eth_estimateGas") checkSafeGasEstimate(params, allowedPayer);
}

function failure(reason, details = {}) {
  return { status: "unavailable", observedAt: now(), reason, ...details };
}

async function readJson(response) {
  if (!response.body) throw new Error("Missing body");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limits.responseBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function makeReadOnlyRpc({ name, url }, { fetcher = fetch, mobileSafePayer = false } = {}) {
  if (typeof name !== "string" || !endpointUrls.has(url)) throw new Error("RPC endpoint outside the pinned public providers");
  const allowedPayer = mobileSafePayer === true ? MOBILE_DEPLOYMENT_PAYER.toLowerCase() : safeGasPayer;
  let requestId = 0;
  async function attempt(method, params, summarize) {
    const id = ++requestId;
    const signal = AbortSignal.timeout(limits.timeoutMs);
    try {
      const response = await fetcher(url, {
        method: "POST", redirect: "error", signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return failure("http", { httpStatus: response.status });
      }
      const body = await readJson(response);
      if (!body) return failure("body-limit-or-null");
      if (body.id !== id || body.jsonrpc !== "2.0" || (Object.hasOwn(body, "result") && Object.hasOwn(body, "error"))) {
        return failure("envelope");
      }
      if (body.error) {
        return Number.isInteger(body.error.code) ? failure("rpc-error", { rpcCode: body.error.code }) : failure("envelope");
      }
      if (body.result === null || body.result === undefined) return failure("missing");
      try {
        return { status: "observed", observedAt: now(), value: summarize(body.result) };
      } catch {
        return failure("invalid-result");
      }
    } catch {
      return failure(signal.aborted ? "timeout" : "transport-or-json");
    }
  }
  return async (method, params = [], summarize = (value) => value) => {
    checkScope(method, params, allowedPayer);
    if (["eth_estimateGas", "debug_traceTransaction"].includes(method) && !Object.values(ROBINHOOD_SOURCES).includes(url)) {
      throw new Error("Method outside the reviewed Robinhood probe scope");
    }
    const result = await attempt(method, params, summarize);
    if (result.status !== "unavailable" || !([429, 500, 502, 503, 504].includes(result.httpStatus) ||
      result.rpcCode === -32005 || ["timeout", "transport-or-json"].includes(result.reason))) return result;
    await delay(150);
    return { ...await attempt(method, params, summarize), previousAttempt: result };
  };
}

export function agreedObservation(observations, identity) {
  const matched = observations.filter(({ observation }) => observation?.status === "observed");
  const providers = [...new Set(matched.map(({ name }) => name))];
  if (!matched.length) return { status: "UNVERIFIED", providers };
  if (matched.some(({ observation }) => identity(observation.value) !== identity(matched[0].observation.value))) {
    return { status: "CONFLICT", providers };
  }
  if (providers.length < 2) return { status: "UNVERIFIED", providers };
  return { status: "CORROBORATED", providers, value: matched[0].observation.value };
}

const blockHeader = (block) => ({
  number: decimal(block.number), hash: canonicalHash(block.hash), parentHash: canonicalHash(block.parentHash),
  stateRoot: canonicalHash(block.stateRoot), timestamp: new Date(Number(readQuantity(block.timestamp)) * 1000).toISOString(),
});
const blockIdentity = ({ number, hash, parentHash, stateRoot, timestamp }) => [number, hash, parentHash, stateRoot, timestamp].join("/");
const sameBlock = (a, b) => a && b && blockIdentity(a) === blockIdentity(b);
const headerAt = (read, tag) => read("eth_getBlockByNumber", [tag, false], (value) => {
  const header = blockHeader(value);
  if (quantityPattern.test(tag) && BigInt(header.number) !== BigInt(tag)) throw new Error("Wrong RPC block");
  return header;
});
const record = (name, observation) => ({ name, observation });
const sameLog = (first, second) => JSON.stringify(first) === JSON.stringify(second);

function liveLog(log) {
  if (log.removed !== false) throw new Error("Removed or unqualified log");
  return { address: canonicalAddress(log.address), blockNumber: decimal(log.blockNumber), blockHash: canonicalHash(log.blockHash),
    transactionHash: canonicalHash(log.transactionHash), logIndex: decimal(log.logIndex), topics: log.topics.map(canonicalHash),
    data: canonicalBytes(log.data) };
}

export function checkL1Receipt(receipt, expectedLog) {
  if (receipt.status !== "0x1" || canonicalHash(receipt.transactionHash) !== expectedLog.transactionHash ||
      canonicalHash(receipt.blockHash) !== expectedLog.blockHash || decimal(receipt.blockNumber) !== expectedLog.blockNumber) {
    throw new Error("L1 receipt does not bind the batch log");
  }
  const hits = receipt.logs.filter((log) => log.logIndex !== undefined && decimal(log.logIndex) === expectedLog.logIndex);
  if (hits.length !== 1 || !sameLog(liveLog(hits[0]), expectedLog)) throw new Error("L1 receipt lacks the exact batch log");
  return { receiptStatus: receipt.status, transactionHash: expectedLog.transactionHash, logIndex: expectedLog.logIndex };
}

function historicalLog(log) {
  const parsed = liveLog(log);
  return parsed.address === historical.factory && parsed.topics[0] === historicalSignature &&
    parsed.blockHash === historical.receipt.blockHash && parsed.blockNumber === historical.receipt.blockNumber &&
    parsed.transactionHash === historical.receipt.transactionHash && parsed.logIndex === String(historical.receipt.logIndex);
}

function historicalTransaction(transaction) {
  if (canonicalHash(transaction.hash) !== historical.receipt.transactionHash ||
      canonicalHash(transaction.blockHash) !== historical.receipt.blockHash ||
      decimal(transaction.blockNumber) !== historical.receipt.blockNumber || canonicalAddress(transaction.to) !== historical.factory ||
      (transaction.chainId !== undefined && readQuantity(transaction.chainId) !== 4663n)) throw new Error("Wrong historical transaction");
  return { from: canonicalAddress(transaction.from), to: historical.factory, input: canonicalBytes(transaction.input),
    value: decimal(transaction.value) };
}

export function checkTraceRoot(trace, tx) {
  const root = { from: canonicalAddress(trace.from), to: canonicalAddress(trace.to), input: canonicalBytes(trace.input),
    value: decimal(trace.value) };
  if (trace.type !== "CALL" || trace.error !== undefined || (trace.calls !== undefined && !Array.isArray(trace.calls)) ||
      root.from !== tx.from || root.to !== tx.to || root.input !== tx.input || root.value !== tx.value) {
    throw new Error("Unbound trace root");
  }
  return { type: trace.type, from: root.from, to: root.to, inputKeccak256: keccak256(root.input), value: root.value };
}

async function inspectTrace(read) {
  const blockTag = quantity(historical.receipt.blockNumber);
  const before = await headerAt(read, blockTag);
  const receipt = await read("eth_getTransactionReceipt", [historical.receipt.transactionHash], (value) => {
    if (canonicalAddress(value.to) !== historical.factory || value.logs.filter(historicalLog).length !== 1 ||
        value.transactionHash !== historical.receipt.transactionHash || value.status !== "0x1" ||
        value.blockHash !== historical.receipt.blockHash || decimal(value.blockNumber) !== historical.receipt.blockNumber) {
      throw new Error("Wrong historical registration receipt");
    }
    return { transactionHash: value.transactionHash, blockHash: value.blockHash, from: canonicalAddress(value.from) };
  });
  const tx = await read("eth_getTransactionByHash", [historical.receipt.transactionHash], historicalTransaction);
  let trace = failure("receipt-transaction-or-header-unbound");
  if (before.value?.hash === historical.receipt.blockHash && tx.value?.from && receipt.value?.from === tx.value.from) {
    trace = await read("debug_traceTransaction", [historical.receipt.transactionHash, { tracer: "callTracer", timeout: "3s" }],
      (raw) => checkTraceRoot(raw, tx.value));
  }
  const after = await headerAt(read, blockTag);
  const canonical = sameBlock(before.value, after.value) && before.value.hash === historical.receipt.blockHash;
  const conflict = [before, after].some(({ value }) => value && value.hash !== historical.receipt.blockHash) ||
    [receipt, tx, trace].some(({ reason }) => reason === "invalid-result");
  const transaction = tx.value ? { ...tx, value: { from: tx.value.from, to: tx.value.to,
    inputKeccak256: keccak256(tx.value.input), value: tx.value.value } } : tx;
  return { canonical, before, after, receipt, transaction, trace, status: conflict ? "conflict" : canonical ? trace.status : "unavailable" };
}

const addressBinding = (value) => decodeAbiParameters(abiTypes("address"), checked(value,
  (input) => typeof input === "string" && hashPattern.test(input)))[0].toLowerCase();
const getterBindings = [
  ...["positionManager", "quoter", "stateView", "universalRouter"].map((name) => [name, "poolManager()", pins.poolManager.address.toLowerCase()]),
  ["positionManager", "permit2()", pins.permit2.address.toLowerCase()],
];

async function inspectDependencies(read, tag, expectedHash, checkBindings) {
  const before = await headerAt(read, tag);
  const runtime = {}, bindings = {};
  if (!before.value || (expectedHash && before.value.hash !== expectedHash)) {
    return { status: before.value ? "conflict" : "unavailable", before, runtime, bindings };
  }
  for (const [name, { address, runtimeHash }] of Object.entries(pins)) {
    runtime[name] = await read("eth_getCode", [address, tag], (value) => {
      const hash = keccak256(canonicalBytes(value));
      return { address, hash, matches: hash === runtimeHash };
    });
    // Space archive reads across the existing shared free provider endpoints.
    await delay(100);
  }
  if (checkBindings) for (const [name, signature, expected] of getterBindings) {
    bindings[name + "." + signature] = await read("eth_call", [{ to: pins[name].address, data: toFunctionSelector(signature) }, tag],
      (value) => ({ address: addressBinding(value), matches: addressBinding(value) === expected }));
  }
  const after = await headerAt(read, tag);
  const observations = [...Object.values(runtime), ...Object.values(bindings)];
  const conflict = (after.value && !sameBlock(before.value, after.value)) || observations.some(({ value }) => value?.matches === false);
  const complete = sameBlock(before.value, after.value) && observations.every(({ value }) => value?.matches === true);
  return { status: conflict ? "conflict" : complete ? "observed" : "unavailable", before, after, runtime, bindings };
}

function checksFromProviders(observations, identify) {
  const result = agreedObservation(observations.map(({ name, probe }) => record(name,
    probe.status === "observed" ? { status: "observed", value: identify(probe) } : undefined)), JSON.stringify);
  if (observations.some(({ probe }) => probe.status === "conflict")) return { status: "CONFLICT", providers: result.providers };
  return result;
}

async function inspectL2Batch(read, target, queryTag) {
  const before = await headerAt(read, quantity(target.number));
  const queryBefore = await headerAt(read, queryTag);
  if (before.value && before.value.hash !== target.hash) return { status: "conflict", before, queryBefore };
  if (!before.value || !queryBefore.value || BigInt(queryBefore.value.number) < BigInt(target.number)) {
    return { status: "unavailable", before, queryBefore };
  }
  const readMapping = (signature) => read("eth_call", [{
    to: nodeInterface,
    data: toFunctionSelector(signature + "(uint64)") + encodeAbiParameters(abiTypes("uint64"), [BigInt(target.number)]).slice(2),
  }, queryTag], (value) => decodeAbiParameters(abiTypes("uint64"), checked(value,
    (input) => typeof input === "string" && hashPattern.test(input)))[0].toString());
  const batch = await readMapping("findBatchContainingBlock");
  const origin = await readMapping("blockL1Num");
  const after = await headerAt(read, quantity(target.number));
  const queryAfter = await headerAt(read, queryTag);
  const conflict = (after.value && !sameBlock(before.value, after.value)) ||
    (queryAfter.value && !sameBlock(queryBefore.value, queryAfter.value));
  const consistent = sameBlock(before.value, after.value) && sameBlock(queryBefore.value, queryAfter.value);
  return { status: conflict ? "conflict" : consistent && batch.value && origin.value ? "observed" : "unavailable",
    before, after, queryBefore, queryAfter, batch, origin };
}

function registrationBatchLog(log, batch, from, through) {
  const decoded = liveLog(log);
  if (decoded.address !== sequencerInbox || decoded.topics.length !== 4 ||
      decoded.topics[0] !== batchSignature || decoded.topics[1] !== word(batch) ||
      BigInt(decoded.blockNumber) < from || BigInt(decoded.blockNumber) > through) {
    throw new Error("Wrong SequencerInbox event");
  }
  return decoded;
}

async function inspectL1Batch(read, context, mapping, knownL1Block) {
  const { finalized, latest } = context;
  const from = BigInt(knownL1Block ?? mapping.origin);
  const highestAllowed = knownL1Block !== undefined ? from : from + BigInt(limits.logBlockCount - 1);
  const head = BigInt(latest.value.number);
  const through = head < highestAllowed ? head : highestAllowed;
  if (through < from) return { status: "unavailable" };
  const log = await read("eth_getLogs", [{
    address: sequencerInbox, topics: [batchSignature, word(mapping.batch)],
    fromBlock: quantity(from), toBlock: quantity(through),
  }], (values) => {
    if (!Array.isArray(values) || values.length !== 1) throw new Error("Expected one exact SequencerInbox log");
    return registrationBatchLog(values[0], mapping.batch, from, through);
  });
  if (!log.value) return { status: "unavailable", log, finalized };
  const before = await headerAt(read, quantity(log.value.blockNumber));
  const receipt = await read("eth_getTransactionReceipt", [log.value.transactionHash], (raw) => checkL1Receipt(raw, log.value));
  const after = await headerAt(read, quantity(log.value.blockNumber));
  const conflict = (after.value && after.value.hash !== log.value.blockHash) ||
    (before.value && before.value.hash !== log.value.blockHash);
  return { status: conflict ? "conflict" : sameBlock(before.value, after.value) && receipt.value ? "observed" : "unavailable",
    log, before, after, receipt, finalized };
}

export function classifyL1Posting(batch, finalized) {
  if (batch.status === "CONFLICT" || finalized.status === "CONFLICT") return "CONFLICT";
  if (batch.status !== "CORROBORATED" || finalized.status !== "CORROBORATED") return "UNVERIFIED";
  return BigInt(batch.value.blockNumber) <= BigInt(finalized.value.number) ? "CORROBORATED_FINALIZED_L1_POSTING" : "CORROBORATED_L1_POSTING_NOT_FINALIZED";
}

async function ethereumContext(read) {
  const chain = await read("eth_chainId", [], decimal);
  if (chain.value !== "1") return { chain };
  const finalized = await headerAt(read, "finalized");
  const latest = await headerAt(read, "latest");
  return { chain, finalized, latest };
}

async function finalizedAgreement(ethereum, contexts) {
  const available = contexts.filter((item) => item.context.finalized?.value && item.context.latest?.value &&
    BigInt(item.context.latest.value.number) >= BigInt(item.context.finalized.value.number));
  if (available.length < 2) return { status: "UNVERIFIED", providers: available.map(({ name }) => name) };
  const commonHeight = available.map(({ context }) => BigInt(context.finalized.value.number))
    .reduce((min, height) => height < min ? height : min);
  const observations = await Promise.all(available.map(async ({ name, context }) => {
    const canonical = await headerAt(ethereum[name], quantity(commonHeight));
    const rechecked = await headerAt(ethereum[name], quantity(context.finalized.value.number));
    if (rechecked.value && !sameBlock(context.finalized.value, rechecked.value)) return record(name, { status: "conflict" });
    return record(name, canonical.value && rechecked.value ? canonical : undefined);
  }));
  if (observations.some(({ observation }) => observation?.status === "conflict")) return { status: "CONFLICT", providers: available.map(({ name }) => name) };
  return agreedObservation(observations, blockIdentity);
}

async function assessFinality({ target, knownL1Block, historicalBatch, l2, queryTag, ethereum, contexts, finalized }) {
  const l2Details = await Promise.all(l2.map(async ({ name, read }) => ({ name, probe: await inspectL2Batch(read, target, queryTag) })));
  const mapping = checksFromProviders(l2Details, ({ batch, origin, queryBefore }) => ({
    batch: batch.value, origin: origin.value, queryHash: queryBefore.value.hash,
  }));
  const l1 = { inbox: sequencerInbox, finalized, observations: [], posting: { status: "UNVERIFIED" } };
  if (mapping.status === "CORROBORATED" && (historicalBatch === undefined || BigInt(historicalBatch) === BigInt(mapping.value.batch))) {
    l1.observations = await Promise.all(contexts.filter(({ context }) => context.latest?.value && context.finalized?.value)
      .map(async ({ name, context }) => ({ name, probe: await inspectL1Batch(ethereum[name], context, mapping.value, knownL1Block) })));
    l1.posting = checksFromProviders(l1.observations, ({ log }) => log.value);
  }
  return { target, status: mapping.status === "CONFLICT" ? "CONFLICT" : classifyL1Posting(l1.posting, finalized),
    l2: { mapping, observations: l2Details }, l1 };
}

async function identifySources(sources, fetcher, expectedChain) {
  return Promise.all(Object.entries(sources).map(async ([name, url]) => {
    const read = makeReadOnlyRpc({ name, url }, { fetcher });
    const chain = await read("eth_chainId", [], decimal);
    return { name, read, chain, eligible: chain.value === expectedChain };
  }));
}

export async function runRpcProbe({ fetcher = fetch, checkpoint } = {}) {
  const observedAt = now();
  const identified = await identifySources(ROBINHOOD_SOURCES, fetcher, "4663");
  const l2 = identified.filter(({ eligible }) => eligible);
  const heads = await Promise.all(l2.map(async ({ name, read }) => record(name, await headerAt(read, "latest"))));
  const available = heads.flatMap(({ observation }) => observation.value ? [BigInt(observation.value.number)] : []);
  const earliest = available.reduce((min, height) => height < min ? height : min, available[0]);
  const queryTag = earliest > 4n ? quantity(earliest - 4n) : undefined;
  const current = [], archives = [], traces = [];
  // Visit in priority order so the evidence identifies the observed fallback.
  for (const { name, read } of l2) {
    if (queryTag) current.push({ name, probe: await inspectDependencies(read, queryTag, undefined, true) });
    archives.push({ name, probe: await inspectDependencies(read, quantity(archive.blockNumber), archive.blockHash, false) });
    traces.push({ name, probe: await inspectTrace(read) });
  }
  const livePins = checksFromProviders(current, ({ before }) => ({ header: before.value, bindingCount: getterBindings.length }));
  const pinnedState = checksFromProviders(archives, ({ before }) => before.value);
  const traceProof = checksFromProviders(traces, ({ trace }) => trace.value);
  const firstProvider = (observations) => observations.find(({ probe }) => probe.status === "observed")?.name ?? null;

  const ethIdentified = await identifySources(ETHEREUM_SOURCES, fetcher, "1");
  const ethereum = Object.fromEntries(ethIdentified.filter(({ eligible }) => eligible).map(({ name, read }) => [name, read]));
  const contexts = await Promise.all(Object.entries(ethereum).map(async ([name, read]) => ({ name, context: await ethereumContext(read) })));
  const finalized = await finalizedAgreement(ethereum, contexts);
  const historicalTarget = knownBatch.l2.finalizedTagSample;
  const batch = knownBatch.l1.batches.l2Finalized;
  const historicalBatch = queryTag ? await assessFinality({ target: historicalTarget, historicalBatch: batch,
    knownL1Block: knownBatch.l1.sources.publicnode.entries[String(batch)].blockNumber, l2, queryTag, ethereum, contexts, finalized }) :
    { target: historicalTarget, status: "UNVERIFIED" };
  let hostedCheckpoint = { status: "UNVERIFIED", reason: "missing-valid-checkpoint" };
  if (queryTag && /^[1-9][0-9]{0,11}$/.test(String(checkpoint?.number)) && hashPattern.test(checkpoint?.hash)) {
    const target = { number: String(checkpoint.number), hash: canonicalHash(checkpoint.hash) };
    hostedCheckpoint = await assessFinality({ target, l2, queryTag, ethereum, contexts, finalized });
  }
  return {
    observedAt, completedAt: now(), scope: "BOUNDED_PUBLIC_READ_ONLY", broadcastAuthorized: false,
    limits, sources: { robinhood: ROBINHOOD_SOURCES, ethereum: ETHEREUM_SOURCES },
    chains: { robinhood: identified.map(({ name, chain }) => ({ name, chain })), ethereum: ethIdentified.map(({ name, chain }) => ({ name, chain })) },
    current: { heads, observations: current, proof: livePins },
    archive: { blockNumber: archive.blockNumber, blockHash: archive.blockHash, observations: archives, proof: pinnedState,
      firstSuccessfulProvider: pinnedState.status === "CORROBORATED" ? firstProvider(archives) : null },
    trace: { historicalOnly: true, blockNumber: historical.receipt.blockNumber, transactionHash: historical.receipt.transactionHash,
      observations: traces, proof: traceProof, firstSuccessfulProvider: traceProof.status === "CORROBORATED" ? firstProvider(traces) : null },
    finality: { trustBoundary: "L2_RPC_BATCH_MEMBERSHIP_AND_TWO_ETHEREUM_RPC_POSTING_READS", historicalBatch, hostedCheckpoint,
      newEngineReceipt: "UNVERIFIED_DEPLOYMENT_DEPENDENT" },
    routing: { dependencies: livePins.status, deployedExactPoolKey: "UNVERIFIED_DEPLOYMENT_DEPENDENT" },
  };
}
