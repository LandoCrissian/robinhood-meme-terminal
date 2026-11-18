import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";

const hashPattern = /^0x[0-9a-f]{64}$/i;
const quantityPattern = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i;
const equalHex = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/** Test-harness observation only: never sign, mine, submit or replace a transaction.
 * A returned hash may precede receipt publication even on local automining.
 * Only an explicit null is pending; malformed evidence/provider errors fail. */
export async function observeOriginalReceipt(rpc, transactionHash, {
  timeoutMs = 15_000, intervalMs = 100, maxAttempts = 128,
  onPending = () => {}, now = Date.now, sleep = pause,
} = {}) {
  assert.match(transactionHash, hashPattern, "Receipt observation requires the original hash");
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30_000);
  assert.ok(Number.isSafeInteger(intervalMs) && intervalMs > 0 && intervalMs <= 1000);
  assert.ok(Number.isSafeInteger(maxAttempts) && maxAttempts > 0 && maxAttempts <= 128);
  const until = now() + timeoutMs;
  const boundedRead = async (method, params) => {
    const remaining = until - now();
    assert.ok(remaining > 0, "Original receipt observation timed out");
    let timer;
    try {
      return await Promise.race([
        rpc(method, params),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Original receipt observation timed out")), remaining); }),
      ]);
    } finally { clearTimeout(timer); }
  };
  let pendingObservations = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const receipt = await boundedRead("eth_getTransactionReceipt", [transactionHash]);
    if (receipt === null) {
      onPending(++pendingObservations);
      const remaining = until - now();
      assert.ok(attempt < maxAttempts && remaining > 0, "Original receipt observation timed out");
      await sleep(Math.min(intervalMs, remaining));
      continue;
    }
    assert.ok(receipt && typeof receipt === "object" && !Array.isArray(receipt), "Malformed original receipt");
    assert.ok(equalHex(receipt.transactionHash, transactionHash), "Receipt conflicts with original hash");
    assert.match(receipt.blockHash, hashPattern, "Receipt block hash is required");
    for (const key of ["blockNumber", "transactionIndex", "gasUsed"]) {
      assert.ok(typeof receipt[key] === "string" && quantityPattern.test(receipt[key]), "Malformed receipt quantity");
    }
    assert.equal(receipt.status, "0x1", "The original transaction must have succeeded");
    assert.ok(BigInt(receipt.gasUsed) > 0n && Array.isArray(receipt.logs) && receipt.logs.length <= 128, "Malformed receipt execution evidence");
    const block = await boundedRead("eth_getBlockByNumber", [receipt.blockNumber, false]);
    assert.ok(block && equalHex(block.hash, receipt.blockHash) && equalHex(block.number, receipt.blockNumber), "Original receipt is not canonical");
    assert.ok(Array.isArray(block.transactions) && block.transactions.length <= 32, "Malformed canonical transaction list");
    const index = BigInt(receipt.transactionIndex);
    assert.ok(index < BigInt(block.transactions.length) && equalHex(block.transactions[Number(index)], transactionHash), "Original receipt is absent from its canonical block");
    return { receipt, pendingObservations, attempts: attempt };
  }
  throw new Error("Original receipt observation timed out");
}
