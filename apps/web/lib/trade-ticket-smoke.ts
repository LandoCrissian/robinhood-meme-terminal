import assert from "node:assert/strict";
import {
  conservativeNetworkFeeReserve,
  curvePriceImpact,
  estimatedNetworkFeeUsd,
  estimatedNetworkFeeWei,
  fractionalTradeAmount,
  priceImpactTone,
  quoteSecondsRemaining,
  saferTradeAmount,
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
assert.equal(saferTradeAmount(1_000n, 0.08), 450n);
assert.equal(saferTradeAmount(1_000n, 0.04), 1_000n);
assert.equal(saferTradeAmount(1_000n, 0.02, 0.01), 450n);
assert.equal(saferTradeAmount(1_000n, undefined), 0n);
assert.throws(() => saferTradeAmount(1_000n, 0.08, 0.05), /blocking threshold/);
assert.equal(curvePriceImpact("buy", 1_000n, 1_050n, 1_000_000_000_000_000_000n), 0.05);
assert.equal(curvePriceImpact("sell", 1_000n, 1_000_000_000_000_000_000n, 970n), 0.03);
assert.equal(curvePriceImpact("buy", 1_000n, 0n, 1n), undefined);
assert.equal(curvePriceImpact("sell", 0n, 1n, 1n), undefined);
assert.equal(estimatedNetworkFeeWei(100_000n, 75_000_000n), 7_500_000_000_000n);
assert.equal(estimatedNetworkFeeWei(0n, 75_000_000n), 0n);
assert.equal(conservativeNetworkFeeReserve(8n, 10n), 16n);
assert.equal(conservativeNetworkFeeReserve(4n, 10n), 10n);
assert.equal(conservativeNetworkFeeReserve(undefined, 10n), 10n);
assert.equal(estimatedNetworkFeeUsd(1_000_000_000_000_000n, 3_000), 3);
assert.equal(estimatedNetworkFeeUsd(undefined, 3_000), undefined);
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
