import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";
import { deriveVNextVerifiedUsdgOutcome } from "./verified-cost-outcome";

const now = 1_786_000_000_000;
const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
const tradeAsset = "0xe934e36A439C94017B64a3FecE66AF12099aBF50";
const evidence = {
  inputAsset: usdg,
  outputAsset: tradeAsset,
  inputAmountAtomic: "100000000",
  protectedOutputAtomic: "500000000000000000000",
  estimatedNetworkCostUsdgAtomic: "12500",
  networkCostValuationExpiresAtMs: now + 30_000
} as VNextPreSignEvidence;

assert.deepEqual(deriveVNextVerifiedUsdgOutcome(evidence, now), {
  kind: "buy_cost_ceiling",
  tradeAmountUsdgAtomic: "100000000",
  networkCostUsdgAtomic: "12500",
  totalCostUsdgAtomic: "100012500"
});
assert.deepEqual(deriveVNextVerifiedUsdgOutcome({
  ...evidence,
  inputAsset: tradeAsset,
  outputAsset: usdg,
  protectedOutputAtomic: "99900000"
}, now), {
  kind: "sell_proceeds_after_gas",
  protectedProceedsUsdgAtomic: "99900000",
  networkCostUsdgAtomic: "12500",
  proceedsAfterGasUsdgAtomic: "99887500",
  gasExceedsProtectedProceeds: false
});
assert.deepEqual(deriveVNextVerifiedUsdgOutcome({
  ...evidence,
  inputAsset: tradeAsset,
  outputAsset: usdg,
  protectedOutputAtomic: "100"
}, now), {
  kind: "sell_proceeds_after_gas",
  protectedProceedsUsdgAtomic: "100",
  networkCostUsdgAtomic: "12500",
  proceedsAfterGasUsdgAtomic: "0",
  gasExceedsProtectedProceeds: true
});
assert.equal(deriveVNextVerifiedUsdgOutcome({ ...evidence, networkCostValuationExpiresAtMs: now }, now), null);
assert.equal(deriveVNextVerifiedUsdgOutcome({ ...evidence, estimatedNetworkCostUsdgAtomic: null }, now), null);
assert.equal(deriveVNextVerifiedUsdgOutcome({ ...evidence, inputAsset: tradeAsset }, now), null);

const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.match(composer, /deriveVNextVerifiedUsdgOutcome/);
assert.match(composer, /Trade \+ gas ceiling/);
assert.match(composer, /Protected after gas/);
assert.match(composer, /networkCostValuationExpiresAtMs > costValuationClockMs/);

console.log("RMT VNext verified USDG cost outcome smoke checks passed.");
