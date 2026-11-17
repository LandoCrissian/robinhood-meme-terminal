import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { watchSafeReceipt } from "./watch-safe.mjs";
import { MOBILE_DEPLOYMENT_PAYER } from "./rpc.mjs";

const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { padHex, toEventSelector } = require("viem");
const load = (name) => JSON.parse(readFileSync(new URL("../../docs/evidence/" + name, import.meta.url)));
const plan = load("rmt-task046/treasury-safe-initializers.json").proposals[1];
const { factory, singleton } = load("rmt-task045/operations-safe-policy.json").operations;
const blockHash = padHex("0x1234", { size: 32 }), txHash = padHex("0x2345", { size: 32 });
const log = { address: factory, blockHash, transactionHash: txHash, blockNumber: "0x64", transactionIndex: "0x0",
  logIndex: "0x1", removed: false, topics: [toEventSelector("ProxyCreation(address,address)"), padHex(plan.counterfactualAddress, { size: 32 })],
  data: padHex(singleton, { size: 32 }) };

function harness({ logs = [log], failMethod, peerLogs, overrideLog, reorg = false, verifyUnavailable = false,
  proofOverride = {}, head = 100n } = {}) {
  let time = 1_000, verified = 0;
  const calls = [];
  const readers = Object.fromEntries(["official", "pocket"].map((name) => [name, async (method, params) => {
    calls.push({ name, method, params });
    assert.ok(["eth_chainId", "eth_getBlockByNumber", "eth_getLogs", "eth_getTransactionReceipt"].includes(method), "No signing/broadcast method");
    if (method === failMethod || (method === "eth_getTransactionReceipt" && verifyUnavailable)) return { status: "unavailable" };
    const value = method === "eth_chainId" ? "0x1237" : method === "eth_getLogs"
      ? (name === "pocket" && peerLogs !== undefined ? peerLogs : logs).map((item) => ({ ...item, ...overrideLog }))
      : method === "eth_getTransactionReceipt" ? {} : { number: params[0] === "latest" ? "0x" + head.toString(16) : params[0],
        hash: reorg && calls.filter((row) => row.method === "eth_getBlockByNumber" && row.params[0] !== "latest").length > 2
          ? padHex("0x9999", { size: 32 }) : blockHash };
    return { status: "observed", value };
  }]));
  const verify = async (request) => {
    verified++;
    assert.equal(request.hash, txHash); assert.equal(request.role, "RMT-RESERVE");
    assert.equal(request.approvedPayer, MOBILE_DEPLOYMENT_PAYER);
    await request.reader("eth_getTransactionReceipt", [txHash]);
    assert.equal(calls.at(-1).name, "pocket", "Receipt-block state uses the pinned archive reader");
    await request.corroboratingReader("eth_getTransactionReceipt", [txHash]);
    assert.equal(calls.at(-1).name, "official", "Independent official receipt corroboration remains required");
    if (verifyUnavailable) throw new Error("Missing receipt");
    return { status: "L2_CREATION_VERIFIED", role: request.role, hash: request.hash, safe: plan.counterfactualAddress, ...proofOverride };
  };
  return { options: { fromBlock: 100n, seconds: 2, pollMs: 1_000, readers, verify, now: () => time, sleep: async (ms) => { time += ms; } },
    calls, verified: () => verified };
}

test("Reserve event invokes canonical receipt verification with exact identity and no transaction method", async () => {
  const h = harness(); const result = await watchSafeReceipt(h.options);
  assert.equal(result.status, "L2_CREATION_VERIFIED"); assert.equal(result.finality, "L1_UNVERIFIED");
  assert.equal(result.broadcastAuthorized, false); assert.equal(h.verified(), 1);
  const filter = h.calls.find(({ method }) => method === "eth_getLogs").params[0];
  assert.deepEqual(filter.topics, [log.topics[0], log.topics[1].toLowerCase()]); assert.equal(filter.address, factory);
});

test("deadline leaves absent creation pending without pretending deployment failed", async () => {
  const h = harness({ logs: [] }); const result = await watchSafeReceipt(h.options);
  assert.equal(result.status, "PENDING"); assert.equal(result.reason, "NO_CREATION_OBSERVED"); assert.equal(result.nextBlock, "101");
  assert.equal(result.deadlineReached, true); assert.equal(h.verified(), 0);
});

test("provider failure preserves cursor and pending status", async () => {
  const h = harness({ failMethod: "eth_getLogs" }); const result = await watchSafeReceipt(h.options);
  assert.equal(result.status, "PENDING"); assert.equal(result.reason, "PROVIDER_UNAVAILABLE"); assert.equal(result.nextBlock, "100");
});

test("missing receipt remains pending and is never promoted from an event", async () => {
  const h = harness({ verifyUnavailable: true }); const result = await watchSafeReceipt(h.options);
  assert.equal(result.status, "PENDING"); assert.equal(result.reason, "PROVIDER_UNAVAILABLE"); assert.equal(result.nextBlock, "100");
});

test("transport exceptions leave evidence pending", async () => {
  const h = harness();
  h.options.readers.official = async () => { throw new Error("RPC transport failed"); };
  const result = await watchSafeReceipt(h.options);
  assert.equal(result.status, "PENDING"); assert.equal(result.reason, "PROVIDER_UNAVAILABLE");
});

for (const [name, options, reason] of [
  ["provider log disagreement", { peerLogs: [] }, "PROVIDER_LOG_DISAGREEMENT"],
  ["removed event", { overrideLog: { removed: true } }, "MALFORMED_OR_MISMATCHED_EVIDENCE"],
  ["wrong Safe identity", { overrideLog: { topics: [log.topics[0], padHex("0x01", { size: 32 })] } }, "MALFORMED_OR_MISMATCHED_EVIDENCE"],
  ["duplicate creation", { logs: [log, log] }, "MALFORMED_OR_MISMATCHED_EVIDENCE"],
  ["reorg during scan", { reorg: true }, "REORG_DURING_SCAN"],
  ["wrong verified role", { proofOverride: { role: "RMT-OPERATIONS" } }, "SAFE_PROOF_MISMATCH"],
]) test(name + " fails closed", async () => {
  const h = harness(options); const result = await watchSafeReceipt(h.options);
  assert.equal(result.status, "EVIDENCE_INVALID"); assert.equal(result.reason, reason);
});

test("scan windows and total scanned blocks are bounded with a resumable cursor", async () => {
  const h = harness({ logs: [], head: 1_000n });
  const result = await watchSafeReceipt({ ...h.options, maxBlocks: 500 });
  assert.equal(result.status, "PENDING"); assert.equal(result.reason, "SCAN_LIMIT_REACHED");
  assert.equal(result.scannedBlocks, 500); assert.equal(result.nextBlock, "600");
  for (const { params } of h.calls.filter(({ method }) => method === "eth_getLogs")) {
    assert.ok(BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) < 384n);
  }
});

test("invalid roles, durations and scan limits are rejected before any RPC", async () => {
  for (const change of [{ role: "UNKNOWN" }, { seconds: 301 }, { seconds: 0 }, { maxBlocks: 4_097 }, { fromBlock: -1n }, { pollMs: 0 }]) {
    const h = harness(); await assert.rejects(watchSafeReceipt({ ...h.options, ...change })); assert.equal(h.calls.length, 0);
  }
});
