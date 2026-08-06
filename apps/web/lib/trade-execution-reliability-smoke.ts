import assert from "node:assert/strict";
import type { Address, Hash } from "viem";
import {
  classifyTradeExecutionError,
  findRecoverableTrade,
  markTradeExecutionConfirmed,
  markTradeExecutionFailed,
  normalizeTradeExecutionJournal,
  readTradeExecutionJournal,
  recordSubmittedTrade,
  TRADE_EXECUTION_STORAGE_KEY,
  type TradeExecutionStorage
} from "./trade-execution-reliability";

class MemoryStorage implements TradeExecutionStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const wallet = "0x0000000000000000000000000000000000001001" as Address;
const token = "0x0000000000000000000000000000000000002001" as Address;
const txHash = `0x${"ab".repeat(32)}` as Hash;
const now = Date.now();
const storage = new MemoryStorage();

const submitted = recordSubmittedTrade({
  wallet,
  token,
  pair: "0x0000000000000000000000000000000000003001",
  venue: "uniswap-v3",
  side: "buy",
  amountIn: "100000000000000",
  txHash
}, storage, now);
assert.ok(submitted);
assert.equal(submitted.state, "submitted");
assert.equal(readTradeExecutionJournal(storage, now).length, 1);

const recovered = findRecoverableTrade({ wallet, token, venue: "uniswap-v3", side: "buy" }, storage, now + 1_000);
assert.ok(recovered);
assert.equal(recovered.txHash, txHash);
assert.equal(recovered.state, "submitted");
assert.ok(recovered.recoveredAt);
assert.equal(findRecoverableTrade({ wallet, token, venue: "uniswap-v3", side: "sell" }, storage, now + 1_000), null);
assert.equal(findRecoverableTrade({ wallet, token, venue: "sushi", side: "buy" }, storage, now + 1_000), null);

const confirmed = markTradeExecutionConfirmed(submitted.id, storage, now + 2_000);
assert.equal(confirmed?.state, "confirmed");
assert.equal(findRecoverableTrade({ wallet, token, venue: "uniswap-v3", side: "buy" }, storage, now + 3_000), null);

const secondHash = `0x${"cd".repeat(32)}` as Hash;
const second = recordSubmittedTrade({
  wallet,
  token,
  pair: "0x0000000000000000000000000000000000003001",
  venue: "uniswap-v3",
  side: "buy",
  amountIn: "200000000000000",
  txHash: secondHash
}, storage, now + 4_000);
assert.ok(second);
const failed = markTradeExecutionFailed(second.id, "slippage", storage, now + 5_000);
assert.equal(failed?.state, "failed");
assert.equal(failed?.failureCode, "slippage");

assert.equal(classifyTradeExecutionError({ code: 4001, message: "User rejected the request" }).code, "user-rejected");
assert.equal(classifyTradeExecutionError("insufficient funds for gas").code, "insufficient-funds");
assert.equal(classifyTradeExecutionError("Too little received: amountOutMinimum").code, "slippage");
assert.equal(classifyTradeExecutionError("transfer amount exceeds allowance").code, "allowance");
assert.equal(classifyTradeExecutionError("no available route because liquidity removed").code, "route-unavailable");
assert.equal(classifyTradeExecutionError("estimateGas simulation failed").code, "simulation-failed");
assert.equal(classifyTradeExecutionError("RPC timeout while fetching receipt").code, "network");
assert.equal(classifyTradeExecutionError("nonce too low: transaction already known").code, "nonce-or-duplicate");
assert.equal(classifyTradeExecutionError("execution reverted").code, "reverted");
assert.equal(classifyTradeExecutionError("something unclassified").retryable, false);

const expired = normalizeTradeExecutionJournal([{
  ...submitted,
  createdAt: now - 8 * 24 * 60 * 60 * 1_000,
  updatedAt: now - 8 * 24 * 60 * 60 * 1_000
}], now);
assert.deepEqual(expired, []);
assert.match(storage.getItem(TRADE_EXECUTION_STORAGE_KEY) ?? "", /uniswap-v3/);

console.info("Trade execution reliability smoke test passed");
