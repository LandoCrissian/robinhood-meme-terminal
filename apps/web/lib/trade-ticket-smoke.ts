import assert from "node:assert/strict";
import {
  fractionalTradeAmount,
  priceImpactTone,
  quoteSecondsRemaining,
  spendableTradeBalance
} from "./trade-ticket";
import {
  DEFAULT_TRADE_PREFERENCES,
  normalizeBuyPreset,
  normalizeTradePreferences
} from "./trade-preferences";

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
assert.equal(normalizeBuyPreset("0.0100"), "0.01");
assert.equal(normalizeBuyPreset("999.123"), "999.123");
assert.equal(normalizeBuyPreset("1000"), null);
assert.equal(normalizeBuyPreset("0"), null);
assert.equal(normalizeBuyPreset("1e-3"), null);
assert.deepEqual(normalizeTradePreferences({ buyAmounts: ["0.0002", "0.002", "0.02"] }), {
  buyAmounts: ["0.0002", "0.002", "0.02"]
});
assert.deepEqual(normalizeTradePreferences({ buyAmounts: ["0.01", "0.01", "0.02"] }), DEFAULT_TRADE_PREFERENCES);
assert.deepEqual(normalizeTradePreferences({ buyAmounts: ["bad"] }), DEFAULT_TRADE_PREFERENCES);

console.log("Trade ticket sizing, freshness, and impact classifications passed.");
