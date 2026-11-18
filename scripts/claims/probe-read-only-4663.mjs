import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

// This module has no signing or submission method and accepts no arbitrary RPC
// endpoint, account, contract or transaction from its caller.
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toHex } = require("viem");
const { values: args } = parseArgs({ options: { output: { type: "string" }, "runtime-archive": { type: "string" } } });
assert.ok(args.output, "Supply a new --output JSON path");
assert.ok(!existsSync(args.output), "Preserve earlier provider evidence; select a fresh output path");
if (args["runtime-archive"]) assert.ok(!existsSync(args["runtime-archive"]), "Preserve earlier runtime evidence");
const sources = { official: "https://rpc.mainnet.chain.robinhood.com", pocket: "https://robinhood.api.pocket.network" };
const sender = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
const delegate = { address: "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B", runtimeHash: "0xa06befcb6f1d7b6c566a607d9d5d932f9b267f3470e55940225c6ee9c4c5e6b0" };
const safes = ["0xAF9F10258b091719618c19D057F9cDAB72eFFd8b", "0x8D44078642ce938Fd799b23087BcdD6114A302e5"];
const safeProxyHash = "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c";
const oldAnchor = { blockNumber: 114549452n, blockHash: "0xf9a8ca5d8e26ebb426ebd2e663ad82afc878c16d8bba5f5542f6341890cf7710" };
const sample = { transactionHash: "0x7306d15f2ffcab498bd2063615ddaa862b6ff956415e39e4d278f75de84cdad6", kind: "Operations Safe creation, not a fee claim" };
const safeAbi = parseAbi(["function VERSION() view returns(string)", "function masterCopy() view returns(address)",
  "function getOwners() view returns(address[])", "function getThreshold() view returns(uint256)", "function nonce() view returns(uint256)"]);
const methods = new Set(["eth_chainId", "eth_getBlockByNumber", "eth_getCode", "eth_getTransactionCount", "eth_getTransactionReceipt", "eth_call", "debug_traceTransaction"]);
const hashes = /^0x[0-9a-f]{64}$/i, codePattern = /^0x(?:[0-9a-f]{2})*$/i;
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const json = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";
const report = { schemaVersion: 1, task: 75, scope: "READ_ONLY_PUBLIC_4663_PROVIDER_OBSERVATIONS", observedAt: new Date().toISOString(),
  financialExecution: false, signing: false, chainId: 4663, sample, forkAnchor: { ...oldAnchor, blockNumber: oldAnchor.blockNumber.toString() },
  finality: { l2Observation: "provider-correlated", ethereumL1: "unverified", acceptedPolicy: null }, providers: [] };
let nextId = 1;
async function rpc(name, method, params) {
  assert.ok(methods.has(method), "Read-only RPC method required");
  assert.ok(JSON.stringify(params).length < 2048, "Bounded fixed probe parameters required");
  const id = nextId++;
  const response = await fetch(sources[name], { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }), redirect: "error", signal: AbortSignal.timeout(8_000) });
  assert.ok(response.ok && response.body, "Provider HTTP unavailable");
  const reader = response.body.getReader(); let bytes = 0, chunks = [];
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; assert.ok(bytes <= 512 * 1024, "Provider response exceeds probe bound"); chunks.push(value); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.equal(body.id, id); assert.equal(body.jsonrpc, "2.0");
  if (body.error) throw Error(`RPC ${body.error.code}: ${String(body.error.message).slice(0, 200)}`);
  return body.result;
}
async function attempt(probe) { try { return { status: "observed", value: await probe() }; } catch (e) { return { status: "unavailable", reason: e instanceof Error ? e.message : "read failed" }; } }
function blockPoint(block) { assert.ok(block && hashes.test(block.hash)); return { blockNumber: BigInt(block.number).toString(), blockHash: block.hash,
  timestamp: new Date(Number(BigInt(block.timestamp)) * 1000).toISOString() }; }
const starts = await Promise.all(Object.keys(sources).map(async name => ({ name, chainId: BigInt(await rpc(name, "eth_chainId", [])), block: await rpc(name, "eth_getBlockByNumber", ["latest", false]) })));
assert.ok(starts.every(s => s.chainId === 4663n));
const height = starts.reduce((a, s) => BigInt(s.block.number) < a ? BigInt(s.block.number) : a, BigInt(starts[0].block.number)) - 5n;
const blockTag = toHex(height), archived = [];
for (const { name } of starts) {
  const checkpoint = blockPoint(await rpc(name, "eth_getBlockByNumber", [blockTag, false]));
  const observation = { name, source: sources[name], checkpoint, account: {}, safes: [], archive: {}, trace: {} };
  const senderCode = await attempt(() => rpc(name, "eth_getCode", [sender, blockTag]));
  const implementation = await attempt(() => rpc(name, "eth_getCode", [delegate.address, blockTag]));
  observation.account = { address: sender, code: senderCode, expectedDelegation: "0xef0100" + delegate.address.slice(2).toLowerCase(),
    nonce: await attempt(() => rpc(name, "eth_getTransactionCount", [sender, blockTag])), pendingNonce: await attempt(() => rpc(name, "eth_getTransactionCount", [sender, "pending"])),
    delegate: { ...delegate, observedHash: implementation.status === "observed" && codePattern.test(implementation.value) && implementation.value !== "0x" ? keccak256(implementation.value) : null,
      status: implementation.status, reason: implementation.reason } };
  if (implementation.status === "observed" && keccak256(implementation.value) === delegate.runtimeHash) archived.push({ name, checkpoint, code: implementation.value });
  for (const address of safes) {
    const code = await attempt(() => rpc(name, "eth_getCode", [address, blockTag]));
    const record = { address, runtimeHash: code.status === "observed" && code.value !== "0x" ? keccak256(code.value) : null,
      runtimeMatches: code.status === "observed" && keccak256(code.value) === safeProxyHash, views: {} };
    for (const functionName of ["VERSION", "masterCopy", "getOwners", "getThreshold", "nonce"]) record.views[functionName] = await attempt(async () => {
      const raw = await rpc(name, "eth_call", [{ to: address, data: encodeFunctionData({ abi: safeAbi, functionName }) }, blockTag]);
      const value = decodeFunctionResult({ abi: safeAbi, functionName, data: raw }); return typeof value === "bigint" ? value.toString() : value;
    });
    observation.safes.push(record);
  }
  observation.archive.header = await attempt(async () => { const p = blockPoint(await rpc(name, "eth_getBlockByNumber", [toHex(oldAnchor.blockNumber), false])); assert.equal(p.blockHash, oldAnchor.blockHash); return p; });
  observation.archive.state = await attempt(async () => {
    const code = await rpc(name, "eth_getCode", [delegate.address, toHex(oldAnchor.blockNumber)]);
    assert.equal(keccak256(code), delegate.runtimeHash); return { runtimeMatches: true };
  });
  observation.trace.receipt = await attempt(async () => {
    const receipt = await rpc(name, "eth_getTransactionReceipt", [sample.transactionHash]); assert.equal(receipt.transactionHash, sample.transactionHash);
    const p = blockPoint(await rpc(name, "eth_getBlockByNumber", [receipt.blockNumber, false])); assert.equal(p.blockHash, receipt.blockHash);
    return { transactionHash: receipt.transactionHash, blockNumber: BigInt(receipt.blockNumber).toString(), blockHash: receipt.blockHash, status: receipt.status, logCount: receipt.logs.length };
  });
  observation.trace.callTracer = await attempt(async () => {
    const trace = await rpc(name, "debug_traceTransaction", [sample.transactionHash, { tracer: "callTracer", timeout: "3s" }]);
    assert.ok(trace && ["CALL", "CREATE"].includes(trace.type)); let count = 0;
    const walk = (call, depth) => { assert.ok(depth <= 64 && ++count <= 4096); for (const child of call.calls ?? []) walk(child, depth + 1); }; walk(trace, 0);
    return { rootType: trace.type, from: trace.from, to: trace.to, nodes: count, rawDigestSha256: digest(trace), settlementOfClaimProven: false };
  });
  observation.checkpointAfter = blockPoint(await rpc(name, "eth_getBlockByNumber", [blockTag, false]));
  assert.equal(observation.checkpointAfter.blockHash, checkpoint.blockHash);
  report.providers.push(observation); writeFileSync(args.output, json(report));
}
assert.equal(report.providers[0].checkpoint.blockHash, report.providers[1].checkpoint.blockHash);
report.rpcRequests = nextId - 1;
report.claimSpecificGas = "unavailable: no issued new-engine claimant/fee transaction; unrelated no-op estimates are not claim evidence";
report.scopeLimits = ["Live reads do not prove wallet control, claim execution or production readiness", "Historical provider capability can differ from current reads",
  "Two L2 RPCs are not independent Ethereum L1 finality evidence", "A historical Safe creation trace is not a new-engine claim settlement"];
if (args["runtime-archive"]) {
  assert.equal(archived.length, 2, "Both providers must corroborate the pinned runtime before archival");
  assert.equal(archived[0].code, archived[1].code); assert.equal(archived[0].checkpoint.blockHash, archived[1].checkpoint.blockHash);
  const archive = { schemaVersion: 1, scope: "PUBLIC_BYTECODE_FIXTURE_NOT_DEPLOYMENT_AUTHORITY", observedAt: report.observedAt,
    chainId: 4663, providers: Object.values(sources), checkpoint: archived[0].checkpoint, delegate: { ...delegate, code: archived[0].code } };
  const bytes = gzipSync(json(archive)); writeFileSync(args["runtime-archive"], bytes, { flag: "wx" });
  report.publicRuntimeArchive = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}
writeFileSync(args.output, json(report));
console.log(json({ status: "read-only-observed", requests: report.rpcRequests, checkpoint: report.providers[0].checkpoint,
  archiveStates: report.providers.map(p => ({ provider: p.name, archive: p.archive.state.status, trace: p.trace.callTracer.status })), financialExecution: false }));
