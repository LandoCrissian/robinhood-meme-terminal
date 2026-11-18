import assert from "node:assert/strict";
import test from "node:test";
import { observeOriginalReceipt } from "./receipt-observation.mjs";

const hash = "0x" + "11".repeat(32), blockHash = "0x" + "22".repeat(32), otherHash = "0x" + "33".repeat(32);
const receipt = { transactionHash: hash, blockHash, blockNumber: "0x10", transactionIndex: "0x0", gasUsed: "0x5208", status: "0x1", logs: [] };
const block = { hash: blockHash, number: "0x10", transactions: [hash] };
const fixture = (responses = [receipt], canonicalBlock = block) => {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "eth_getTransactionReceipt") return responses.shift();
    assert.equal(method, "eth_getBlockByNumber");
    return canonicalBlock;
  };
  let time = 0;
  return { rpc, calls, options: { timeoutMs: 10, intervalMs: 1, now: () => time, sleep: async ms => { time += ms; } } };
};

test("a returned hash can precede receipt publication without another signature or broadcast", async () => {
  const f = fixture([null, null, receipt]), observed = [];
  const result = await observeOriginalReceipt(f.rpc, hash, { ...f.options, onPending: count => observed.push(count) });
  assert.deepEqual(result, { receipt, pendingObservations: 2, attempts: 3 });
  assert.deepEqual(observed, [1, 2]);
  assert.deepEqual(f.calls.slice(0, 3), Array.from({ length: 3 }, () => ({ method: "eth_getTransactionReceipt", params: [hash] })));
  assert.deepEqual(f.calls[3], { method: "eth_getBlockByNumber", params: ["0x10", false] });
});

test("malformed, conflicting and reverted receipts fail immediately instead of polling them away", async () => {
  for (const bad of [undefined, {}, [], { ...receipt, transactionHash: otherHash }, { ...receipt, blockHash: "0x" },
    { ...receipt, blockNumber: null }, { ...receipt, gasUsed: "0x0" }, { ...receipt, logs: null }, { ...receipt, status: "0x0" }]) {
    const f = fixture([bad, receipt]);
    await assert.rejects(observeOriginalReceipt(f.rpc, hash, f.options));
    assert.equal(f.calls.length, 1);
  }
});

test("receipt inclusion requires the exact canonical hash, block number and transaction index", async () => {
  for (const bad of [null, { ...block, hash: otherHash }, { ...block, number: "0x11" },
    { ...block, transactions: [] }, { ...block, transactions: [otherHash] }]) {
    const f = fixture([receipt], bad);
    await assert.rejects(observeOriginalReceipt(f.rpc, hash, f.options));
    assert.equal(f.calls.length, 2);
  }
});

test("pending observations have a finite attempt and time budget", async () => {
  const f = fixture([null, null, null]);
  await assert.rejects(observeOriginalReceipt(f.rpc, hash, { ...f.options, maxAttempts: 2 }), /timed out/);
  assert.equal(f.calls.length, 2);
  const g = fixture([null, null, receipt]);
  await assert.rejects(observeOriginalReceipt(g.rpc, hash, { ...g.options, timeoutMs: 1 }), /timed out/);
  assert.equal(g.calls.length, 1);
});

test("provider failures and unresolved reads fail without resubmission or silent retry", async () => {
  let calls = 0;
  await assert.rejects(observeOriginalReceipt(async () => { calls++; throw new Error("provider unavailable"); }, hash), /provider unavailable/);
  assert.equal(calls, 1);
  await assert.rejects(observeOriginalReceipt(async () => { calls++; return new Promise(() => {}); }, hash, { timeoutMs: 10 }), /timed out/);
  assert.equal(calls, 2);
});
