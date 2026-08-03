import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MARKET_PROTECTION_PRESETS,
  marketProtectionAlertInput
} from "./market-protection";

const token = "0x1111111111111111111111111111111111111111";

assert.equal(MARKET_PROTECTION_PRESETS.length, 4);
assert.deepEqual(marketProtectionAlertInput("large-sell", token), {
  address: token,
  metric: "largeSellLiquidityBps",
  direction: "above",
  threshold: 100
});
assert.equal(marketProtectionAlertInput("net-sell-flow", token)?.threshold, 300);
assert.equal(marketProtectionAlertInput("liquidity-drop", token)?.threshold, 1_000);
assert.equal(marketProtectionAlertInput("runner-pace", token)?.threshold, 1.5);

const marketDeskSource = readFileSync(new URL("../app/market-protection-desk.tsx", import.meta.url), "utf8");
const watchlistPanelSource = readFileSync(new URL("../app/watchlist-panel.tsx", import.meta.url), "utf8");
const tradeTapeSource = readFileSync(new URL("../app/external-market-live.tsx", import.meta.url), "utf8");
assert.match(marketDeskSource, /useWatchlistAlertSync\(\)/);
assert.match(watchlistPanelSource, /useWatchlistAlertSync\(\)/);
assert.doesNotMatch(tradeTapeSource, /new Notification\(/);
assert.match(marketDeskSource, /new Notification\(/);

console.log("Market protection presets remain user-controlled and deterministic.");
