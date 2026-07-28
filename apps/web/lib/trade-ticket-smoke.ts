import assert from "node:assert/strict";
import {
  fractionalTradeAmount,
  priceImpactTone,
  quoteSecondsRemaining,
  spendableTradeBalance
} from "./trade-ticket";

assert.equal(spendableTradeBalance(100n, 20n), 80n);
assert.equal(spendableTradeBalance(20n, 20n), 0n);
assert.equal(spendableTradeBalance(10n, 20n), 0n);
assert.equal(fractionalTradeAmount(1_000n, 2_500n), 250n);
assert.equal(fractionalTradeAmount(1_000n, 5_000n), 500n);
assert.equal(fractionalTradeAmount(1_000n, 10_000n), 1_000n);
assert.throws(() => fractionalTradeAmount(1_000n, 10_001n), /basis points/);
assert.equal(quoteSecondsRemaining("130", 100), 30);
assert.equal(quoteSecondsRemaining("90", 100), 0);
assert.equal(quoteSecondsRemaining("not-a-deadline", 100), 0);
assert.equal(priceImpactTone(0.005), "calm");
assert.equal(priceImpactTone(0.02), "caution");
assert.equal(priceImpactTone(0.08), "danger");

console.log("Trade ticket sizing, freshness, and impact classifications passed.");
