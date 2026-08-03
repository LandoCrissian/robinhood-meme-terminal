import assert from "node:assert/strict";
import {
  afterBuyProtectionEnabled,
  afterBuyProtectionPreset,
  normalizeAfterBuyProtectionSettings
} from "./after-buy-protection";

assert.equal(afterBuyProtectionEnabled(afterBuyProtectionPreset("off")), false);
assert.equal(afterBuyProtectionPreset("tight").trailingStopBps, 1_000);
assert.equal(afterBuyProtectionPreset("balanced").trailingStopBps, 2_000);
assert.equal(afterBuyProtectionPreset("wide").trailingStopBps, 3_000);
const custom = normalizeAfterBuyProtectionSettings({
  ...afterBuyProtectionPreset("custom"),
  trailingStopBps: 500,
  breakEvenActivationBps: 10_000,
  recoverPrincipal: false
});
assert.equal(custom.preset, "custom");
assert.equal(custom.trailingStopBps, 500);
assert.equal(custom.recoverPrincipal, false);
assert.equal(normalizeAfterBuyProtectionSettings({ ...custom, trailingStopBps: 9_999 }).preset, "off");

console.log("After-buy protection settings smoke checks passed");
