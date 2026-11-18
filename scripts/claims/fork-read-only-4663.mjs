import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as socket } from "node:net";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { register } = require("tsx/cjs/api");
const unregister = register({ tsconfig: fileURLToPath(new URL("../../apps/launch-website/tsconfig.test.json", import.meta.url)) });
const { createPublicClient, http, keccak256, parseAbi, toHex } = require("viem");
const { values: args } = parseArgs({ options: { anvil: { type: "string" }, output: { type: "string" } } });
assert.ok(args.anvil && args.output && !existsSync(args.output), "Supply Anvil and a fresh --output file");
const publication = JSON.parse(readFileSync(new URL("../../docs/evidence/mobile-signing/factory-publication-scheduled.json", import.meta.url)));
const { curveProductionPins: pins, curveProductionDeployment: deployment } = require(fileURLToPath(new URL("../../apps/launch-website/lib/server/curve-production.ts", import.meta.url)));
const { productionEarningsContext, readFactoryCreationFees } = require(fileURLToPath(new URL("../../apps/launch-website/lib/server/earnings-contracts.ts", import.meta.url)));
const { prepareClaimExecutionReview, claimDelegatePin } = require(fileURLToPath(new URL("../../apps/launch-website/lib/server/claim-profiles.ts", import.meta.url)));
const allowed = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getCode", "eth_getStorageAt", "eth_getBalance",
  "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_call", "eth_getLogs", "eth_getProof", "net_version"]);
const upstream = "https://robinhood.api.pocket.network";
const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";
const sender = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
const safes = [deployment.operating, deployment.reserve];
const safeAbi = parseAbi(["function VERSION() view returns(string)", "function masterCopy() view returns(address)", "function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)", "function nonce() view returns(uint256)",
  "function getModulesPaginated(address start,uint256 size) view returns(address[] array,address next)"]);
const factoryAbi = parseAbi(["function creationFeesAccrued() view returns(uint256)", "function tokenSupply() view returns(uint256)", "function engineVersion() view returns(uint32)"]);
const directoryAbi = parseAbi(["function latestVersion() view returns(uint32)", "function nonce() view returns(uint64)", "function signerSetEpoch() view returns(uint64)", "function pending() view returns(bytes32,uint48,uint48)"]);
const report = { schemaVersion: 1, task: 75, scope: "READ_ONLY_LOCAL_4663_FORK_OF_DEPLOYED_INFRASTRUCTURE", observedAt: new Date().toISOString(),
  productionExecution: false, localTransactions: 0, localStateMutation: false, signaturesRequested: 0, upstream,
  requestedAnchor: { blockNumber: publication.receiptBlock, blockHash: publication.blockHash },
  anvil: { version: execFileSync(args.anvil, ["--version"], { encoding: "utf8" }).trim(), sha256: createHash("sha256").update(readFileSync(args.anvil)).digest("hex") },
  attempts: [], finality: { ethereumL1: "unverified", productionPolicyAccepted: false } };
const save = () => writeFileSync(args.output, json(report)); save();
async function port() { const s = socket(); await new Promise(resolve => s.listen(0, "127.0.0.1", resolve)); const p = s.address().port; await new Promise(resolve => s.close(resolve)); return p; }
let upstreamReads = 0, denied = 0, rateLimited = false;
let serial = Promise.resolve(), lastRead = 0;
async function upstreamRead(method, params, id = 1) {
  assert.ok(allowed.has(method)); assert.ok(upstreamReads < 256, "Bounded fork upstream request budget");
  assert.ok(!rateLimited, "Pocket rate limit already observed; no further upstream request is permitted in this run");
  const prior = serial; let release;
  serial = new Promise(resolve => { release = resolve; });
  await prior;
  try {
  assert.ok(!rateLimited, "Pocket rate limit already observed; queued read cancelled");
  const pause = 1000 - (Date.now() - lastRead); if (pause > 0) await new Promise(resolve => setTimeout(resolve, pause));
  lastRead = Date.now();
  assert.ok(++upstreamReads <= 256, "Bounded fork upstream request budget");
  const response = await fetch(upstream, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), redirect: "error", signal: AbortSignal.timeout(8_000) });
  if (response.status === 429) { rateLimited = true; report.rateLimit = { status: 429, retryAfter: response.headers.get("retry-after"), action: "Stopped upstream reads; no purchase, alternate credential or bypass" }; }
  assert.ok(response.ok && response.body, "Pocket HTTP unavailable: " + response.status);
  const reader = response.body.getReader(); let size = 0, chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; assert.ok(size <= 512 * 1024); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(result.id, id); assert.equal(result.jsonrpc, "2.0"); return result;
  } catch (e) {
    (report.upstreamFailures ??= []).push({ method, reason: e instanceof Error ? e.message : "read unavailable" });
    throw e;
  } finally { release(); }
}
const proxy = createServer(async (request, response) => {
  const answer = data => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(data)); };
  try {
    assert.equal(request.method, "POST"); const bytes = Buffer.concat(await Array.fromAsync(request)); assert.ok(bytes.length <= 16 * 1024);
    const requests = JSON.parse(bytes.toString("utf8"));
    const one = async value => {
      if (!allowed.has(value.method)) { denied++; return { jsonrpc: "2.0", id: value.id, error: { code: -32601, message: "Read-only fork proxy denies all mutation and broadcast methods" } }; }
      assert.ok(Array.isArray(value.params) && JSON.stringify(value.params).length < 4096);
      return upstreamRead(value.method, value.params, value.id);
    };
    answer(Array.isArray(requests) ? await Promise.all(requests.map(one)) : await one(requests));
  } catch { answer({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "Bounded read-only fork source unavailable" } }); }
});
await new Promise(resolve => proxy.listen(0, "127.0.0.1", resolve));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}/`;
let child;
try {
  const deniedProbe = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 12345, method: "eth_sendRawTransaction", params: ["0x"] }) }).then(r => r.json());
  assert.equal(deniedProbe.error.code, -32601); assert.equal(upstreamReads, 0); report.upstreamBroadcastDenyVerified = true;
  const requested = { number: BigInt(publication.receiptBlock), hash: publication.blockHash };
  let selected = requested;
  const header = await upstreamRead("eth_getBlockByNumber", [toHex(requested.number), false]);
  assert.equal(header.result?.hash, requested.hash, "Recorded governance anchor changed");
  const archivedCode = await upstreamRead("eth_getCode", [pins.factory[0], toHex(requested.number)]);
  if (archivedCode.error || !archivedCode.result || keccak256(archivedCode.result) !== pins.factory[1]) {
    report.requestedAnchorState = { status: "unavailable", reason: archivedCode.error ?? "runtime mismatch" };
    const latest = await upstreamRead("eth_getBlockByNumber", ["latest", false]); assert.ok(latest.result?.hash);
    selected = { number: BigInt(latest.result.number) - 5n };
    const fresh = await upstreamRead("eth_getBlockByNumber", [toHex(selected.number), false]); selected.hash = fresh.result.hash;
    report.fallback = "Fresh canonical fork read only; not evidence of requested archive-state support";
  } else report.requestedAnchorState = { status: "observed", factoryRuntimeMatched: true };
  report.selectedAnchor = { blockNumber: selected.number.toString(), blockHash: selected.hash }; save();
  const rpcUrl = `http://127.0.0.1:${await port()}/`;
  child = spawn(args.anvil, ["--host", "127.0.0.1", "--port", new URL(rpcUrl).port, "--chain-id", "4663", "--accounts", "0",
    "--hardfork", "prague", "--fork-url", proxyUrl, "--fork-block-number", selected.number.toString(), "--silent"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = ""; child.stderr.on("data", data => { stderr += data; }); child.stdout.resume();
  const rpc = createPublicClient({ transport: http(rpcUrl, { timeout: 12_000, retryCount: 0 }), cacheTime: 0 });
  let started = false;
  for (let i = 0; i < 60 && !started; i++) { if (child.exitCode !== null) throw Error("Read-only Anvil fork exited: " + stderr.slice(0, 1500));
    try { started = await rpc.getChainId() === 4663; } catch { await new Promise(resolve => setTimeout(resolve, 250)); } }
  assert.ok(started, "Read-only local fork startup unavailable");
  const block = await rpc.getBlock({ blockNumber: selected.number }); assert.equal(block.hash, selected.hash);
  const point = { blockNumber: block.number.toString(), blockHash: block.hash, timestamp: new Date(Number(block.timestamp) * 1000).toISOString() };
  const pinsObserved = [];
  for (const name of ["factory", "registry", "engine", "guard", "poolManager", "positionManager", "permit2", "router212", "quoter", "stateView"]) {
    const [address, expected] = pins[name]; const code = await rpc.getCode({ address, blockNumber: selected.number });
    assert.ok(code && keccak256(code) === expected, "Fork runtime differs: " + name); pinsObserved.push({ name, address, expected, observed: keccak256(code) });
  }
  report.runtimePins = pinsObserved;
  const senderCode = await rpc.getCode({ address: sender, blockNumber: selected.number });
  const delegateCode = await rpc.getCode({ address: claimDelegatePin.address, blockNumber: selected.number });
  assert.equal(senderCode, claimDelegatePin.designator); assert.equal(keccak256(delegateCode), claimDelegatePin.runtimeHash);
  report.delegatedAccount = { address: sender, designator: senderCode, delegateRuntimeHash: keccak256(delegateCode), nonce: await rpc.getTransactionCount({ address: sender, blockNumber: selected.number }), controlVerified: false };
  const readFactory = functionName => rpc.readContract({ address: pins.factory[0], abi: factoryAbi, functionName, blockNumber: selected.number });
  const accrued = await readFactory("creationFeesAccrued");
  assert.equal(await readFactory("tokenSupply"), 1_000_000_000n * 10n ** 18n); assert.equal(await readFactory("engineVersion"), 1);
  report.factory = { address: pins.factory[0], creationFeesAccruedWei: accrued.toString(), noProjectIssuedByThisProbe: true };
  const readDirectory = functionName => rpc.readContract({ address: pins.directory[0], abi: directoryAbi, functionName, blockNumber: selected.number });
  report.directory = { latestVersion: await readDirectory("latestVersion"), nonce: await readDirectory("nonce"), signerSetEpoch: await readDirectory("signerSetEpoch"), pending: await readDirectory("pending") };
  const context = productionEarningsContext(rpc, point);
  report.historicalFactoryRead = await readFactoryCreationFees({ ...context, historicalReceipt: true }, deployment.operating);
  report.unsignedPreparation = await prepareClaimExecutionReview({ context, operation: "creation-fees", account: sender, beneficiary: deployment.operating, kind: "metamask-7702" });
  assert.equal(report.unsignedPreparation.executionEnabled, false);
  assert.equal(report.unsignedPreparation.status, "unavailable", "An old checkpoint or zero fee cannot become a broadcastable live claim");
  save();
  report.safes = [];
  for (const address of safes) {
    const read = functionName => rpc.readContract({ address, abi: safeAbi, functionName, blockNumber: selected.number });
    const code = await rpc.getCode({ address, blockNumber: selected.number });
    assert.equal(keccak256(code), "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c");
    const [version, master, owners, threshold, nonce] = await Promise.all([read("VERSION"), read("masterCopy"), read("getOwners"), read("getThreshold"), read("nonce")]);
    assert.equal(version, "1.4.1"); assert.equal(threshold, 2n); assert.equal(owners.length, 3);
    assert.equal(master, "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762");
    const expectedOwners = [publication.currentDirectory[0].state.signerA, publication.currentDirectory[0].state.signerB, publication.currentDirectory[0].state.signerC];
    assert.deepEqual(owners.map(a => a.toLowerCase()).sort(), expectedOwners.map(a => a.toLowerCase()).sort());
    report.safes.push({ address, version, singleton: master, runtimeHash: keccak256(code), owners, threshold, nonce }); save();
  }
  report.noPositiveClaim = "No eligible project/fee claim was supplied; publication and source data were not modified to manufacture one";
  report.status = "read-only-fork-verified-production-claim-refused";
  report.checkpoint = point;
} catch (e) { report.status = "unavailable"; report.failure = e instanceof Error ? e.message : "fork unavailable"; }
finally {
  if (child && child.exitCode === null) { child.kill(); await new Promise(resolve => child.once("exit", resolve)); }
  await new Promise(resolve => proxy.close(resolve));
  report.upstreamRequests = upstreamReads; report.deniedUpstreamMethods = denied; report.upstreamFinancialCalls = 0; save();
  unregister();
}
console.log(json({ status: report.status, selectedAnchor: report.selectedAnchor, upstreamRequests: report.upstreamRequests, failure: report.failure,
  financialExecution: false, claimPreparation: report.unsignedPreparation?.status }));
if (report.status === "unavailable") process.exitCode = 2;
