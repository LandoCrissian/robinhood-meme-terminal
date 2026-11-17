import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../../../scripts/production-readiness/mobile-sender.mjs";
import { directoryReviewCandidate, probeDirectoryConstructor } from "./constructor-readiness.mjs";

const require = createRequire(new URL("../../../apps/launch-website/package.json", import.meta.url));
const { encodeAbiParameters, encodeFunctionResult, getContractAddress, keccak256, parseAbi, toHex } = require("viem");
const evidence = (name) => JSON.parse(readFileSync(new URL("../../../docs/evidence/" + name, import.meta.url)));
const profile = evidence("fixed-supply-security/4663-profile.json");
const owners = evidence("rmt-task045/operations-safe-policy.json").operations.owners;
const fork = JSON.parse(gunzipSync(readFileSync(new URL("../../../docs/evidence/fixed-supply-release/fork-4663.json.gz", import.meta.url))));
const runtimePins = JSON.parse(gunzipSync(readFileSync(new URL("../../../docs/evidence/mobile-signing/safe-runtime-4663.json.gz", import.meta.url))));
const delegateCode = runtimePins.delegateCode ?? (runtimePins.contracts ?? runtimePins.pins).find(({ role }) => role === "delegate").code;
const creationBytes = profile.templates.RMTLaunchCurveDirectoryV2.creationBytes;
const creation = fork.unsignedConstructors[0].data.slice(0, 2 + creationBytes * 2);
const runtime = "0x6000"; // Synthetic RPC result only; live tests use actual CREATE return bytes.
const now = Date.parse("2026-11-17T18:52:00Z");
const block = { number: "0x64", hash: "0x" + "aa".repeat(32), timestamp: toHex(BigInt(now / 1_000)), gasLimit: "0x1c9c380" };
const nitroAbi = parseAbi(["function gasEstimateComponents(address,bool,bytes) payable returns(uint64,uint64,uint256,uint256)"]);

function packet() {
  const initcode = creation + encodeAbiParameters(owners.map(() => ({ type: "address" })), owners).slice(2);
  const nonce = "478";
  const unsigned = { type: "0x2", chainId: "0x1237", from: MOBILE_DEPLOYMENT_PAYER,
    nonce: "0x1de", value: "0x0", data: initcode };
  return { plan: { chainId: 4663, scope: "UNSIGNED_4663_PROTOCOL_CONTINUATION_AFTER_BOTH_SAFE_RECEIPTS",
    broadcastAuthorized: false, signingAuthorized: false, compiler: { inputSha256: profile.inputSha256 },
    sender: MOBILE_DEPLOYMENT_PAYER, tokenCreation: null, constructors: [{ id: "directory", contract: "RMTLaunchCurveDirectoryV2", nonce,
      address: getContractAddress({ from: MOBILE_DEPLOYMENT_PAYER, nonce: 478n }), initcode,
      initcodeHash: keccak256(initcode), runtimeHash: keccak256(runtime), unsigned }] } };
}

function harness(mutate) {
  const calls = [];
  const candidate = packet().plan.constructors[0];
  const readers = Object.fromEntries(["official", "pocket"].map((provider) => [provider, async (method, params = []) => {
    calls.push({ provider, method, params });
    const custom = mutate?.({ provider, method, params, calls });
    if (custom !== undefined) return custom;
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") return block;
    if (method === "eth_getTransactionCount") return params[0].toLowerCase() === MOBILE_DEPLOYMENT_PAYER.toLowerCase() ? "0x1de" : "0x0";
    if (method === "eth_getCode") {
      if (params[0].toLowerCase() === MOBILE_DEPLOYMENT_PAYER.toLowerCase()) return MOBILE_DELEGATE_POLICY.designator;
      if (params[0].toLowerCase() === MOBILE_DELEGATE_POLICY.address.toLowerCase()) return delegateCode;
      assert.equal(params[0], candidate.address); return "0x";
    }
    if (method === "eth_getBalance") return "0xde0b6b3a7640000";
    if (method === "eth_call") return params[0].to ? encodeFunctionResult({ abi: nitroAbi, functionName: "gasEstimateComponents",
      result: [2_396_085n, 0n, 20_000_000n, 0n] }) : runtime;
    if (method === "eth_estimateGas") return toHex(2_396_085n);
    if (method === "eth_gasPrice") return toHex(20_000_000n);
    if (method === "eth_maxPriorityFeePerGas") return "0x0";
    throw new Error("Unexpected method " + method);
  }]));
  return { readers, calls };
}

test("Directory probe admits only frozen creation bytecode, exact owner arguments and zero-value CREATE", () => {
  const candidate = directoryReviewCandidate(packet());
  assert.equal(candidate.nonce, "478");
  assert.ok(!Object.hasOwn(candidate.request, "to"));
  for (const mutate of [
    (p) => { p.plan.chainId = 31337; }, (p) => { p.plan.broadcastAuthorized = true; },
    (p) => { p.plan.tokenCreation = {}; }, (p) => { p.plan.constructors[0].id = "bootstrap"; },
    (p) => { p.plan.constructors[0].unsigned.to = candidate.address; },
    (p) => { p.plan.constructors[0].unsigned.value = "0x1"; },
    (p) => { p.plan.constructors[0].unsigned.nonce = "0x1df"; },
    (p) => { p.plan.constructors[0].initcode = "0x6000" + candidate.initcode.slice(6); },
    (p) => { p.plan.constructors[0].initcode = candidate.initcode.slice(0, -2) + "00"; },
    (p) => { p.plan.constructors[0].runtimeHash = "0x0"; },
  ]) { const input = packet(); mutate(input); assert.throws(() => directoryReviewCandidate(input)); }
});

test("bounded two-provider CREATE probe keeps runtime and costs separate from signing authority", async () => {
  const { readers, calls } = harness();
  const result = await probeDirectoryConstructor(packet(), { readers, now: () => now });
  assert.equal(result.review.status, "CORROBORATED_RUNTIME_SIMULATION");
  assert.equal(result.review.cost.proposedGasLimit, "2995107");
  assert.equal(result.review.cost.proposedMaximumEth, "0.00011980428");
  assert.equal(result.review.broadcastAuthorized, false);
  assert.equal(result.review.finality, "L1_UNVERIFIED");
  assert.equal(result.runtime.runtimeCode, runtime);
  assert.ok(calls.every(({ method }) => !/send|sign|wallet_/i.test(method)));
  for (const { method, params } of calls.filter(({ method, params }) => method === "eth_call" && !params[0].to)) {
    assert.equal(method, "eth_call"); assert.deepEqual(params[0], packet().plan.constructors[0].unsigned);
  }
});

test("nonce drift, occupied destinations and changed wallet delegation fail closed", async () => {
  for (const mutate of [
    ({ method, params }) => method === "eth_getTransactionCount" && params[0] === MOBILE_DEPLOYMENT_PAYER && params[1] === "pending" ? "0x1df" : undefined,
    ({ method, params }) => method === "eth_getCode" && params[0] === packet().plan.constructors[0].address ? "0x6000" : undefined,
    ({ method, params }) => method === "eth_getCode" && params[0] === MOBILE_DEPLOYMENT_PAYER ? "0x" : undefined,
    ({ method, params }) => method === "eth_getCode" && params[0] === MOBILE_DELEGATE_POLICY.address ? "0x6000" : undefined,
  ]) { await assert.rejects(probeDirectoryConstructor(packet(), { ...harness(mutate), now: () => now })); }
});

test("unavailable, stale, conflicting or incorrect-runtime observations never become readiness", async () => {
  for (const mutate of [
    ({ provider, method }) => method === "eth_getBlockByNumber" && provider === "pocket" ? { ...block, hash: "0x" + "bb".repeat(32) } : undefined,
    ({ method }) => method === "eth_getBlockByNumber" ? { ...block, timestamp: "0x1" } : undefined,
    ({ method }) => method === "eth_chainId" ? "0x1" : undefined,
    ({ method, params }) => method === "eth_call" && !params[0].to ? "0x6001" : undefined,
    ({ method }) => { if (method === "eth_call") throw new Error("Synthetic provider unavailable"); },
  ]) { await assert.rejects(probeDirectoryConstructor(packet(), { ...harness(mutate), now: () => now })); }
});

test("inconsistent fee components and insufficient funds cannot produce a cost proposal", async () => {
  for (const mutate of [
    ({ method, params }) => method === "eth_call" && params[0].to ? encodeFunctionResult({ abi: nitroAbi,
      functionName: "gasEstimateComponents", result: [1n, 2n, 20_000_000n, 0n] }) : undefined,
    ({ method }) => method === "eth_getBalance" ? "0x0" : undefined,
    ({ method }) => method === "eth_gasPrice" ? "bad" : undefined,
  ]) { await assert.rejects(probeDirectoryConstructor(packet(), { ...harness(mutate), now: () => now })); }
});

test("default transport uses only pinned RPCs and rejects HTTP, envelope and oversized failures", async () => {
  const { readers } = harness();
  const requests = [];
  const fetcher = async (url, options) => {
    assert.ok(["https://rpc.mainnet.chain.robinhood.com", "https://robinhood.api.pocket.network"].includes(url));
    const body = JSON.parse(options.body); requests.push(body);
    const result = await readers[url.includes("pocket") ? "pocket" : "official"](body.method, body.params);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { status: 200 });
  };
  await probeDirectoryConstructor(packet(), { fetcher, now: () => now });
  assert.ok(requests.every(({ method }) => !/send|sign|wallet_/i.test(method)));
  for (const failed of [
    async () => new Response("unavailable", { status: 429 }),
    async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 999, result: block })),
    async () => new Response(" ".repeat(256_001)),
  ]) { await assert.rejects(probeDirectoryConstructor(packet(), { fetcher: failed, now: () => now })); }
});
