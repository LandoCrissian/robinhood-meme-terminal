import assert from "node:assert/strict";
import {
  MAXIMUM_WATCHLIST_ALERTS,
  marketWatchlistAlertSnapshot,
  normalizeWatchlistAlert,
  normalizeWatchlistAlertListSnapshot,
  normalizeWatchlistAlerts,
  resolveWatchlistAlertSnapshot,
  watchlistAlertMatches,
  watchlistAlertMetricLabel,
  watchlistAlertStoredValue,
  watchlistAlertThresholdLabel
} from "./watchlist-alerts";
import type { ExternalMarket } from "./external-market";

const alert = normalizeWatchlistAlert({
  id: "alert_1",
  address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  metric: "liquidityUsd",
  direction: "below",
  threshold: 10_000,
  enabled: true,
  createdAt: 1_000
});

assert.deepEqual(alert, {
  id: "alert_1",
  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  metric: "liquidityUsd",
  direction: "below",
  threshold: 10_000,
  enabled: true,
  createdAt: 1_000
});
assert.equal(normalizeWatchlistAlert({ ...alert, address: "invalid" }), null);
assert.equal(normalizeWatchlistAlert({ ...alert, metric: "marketCapUsd" }), null);
assert.equal(normalizeWatchlistAlert({ ...alert, threshold: Number.NaN }), null);
assert.equal(normalizeWatchlistAlert({ ...alert, threshold: -1 }), null);
assert.equal(watchlistAlertMatches(alert!, { priceUsd: 1, liquidityUsd: 9_999, volume24h: 5 }), true);
assert.equal(watchlistAlertMatches(alert!, { priceUsd: 1, liquidityUsd: 10_001, volume24h: 5 }), false);
assert.equal(watchlistAlertMatches({ ...alert!, enabled: false }, { priceUsd: 1, liquidityUsd: 1, volume24h: 5 }), false);
assert.equal(watchlistAlertMetricLabel("volume24h"), "24h volume");
assert.equal(watchlistAlertStoredValue("largeSellLiquidityBps", 1.5), 150);
assert.equal(watchlistAlertThresholdLabel({ metric: "largeSellLiquidityBps", threshold: 150 }), "1.5%");

const baseMarket: ExternalMarket = {
  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  name: "Runner One",
  symbol: "RUN",
  pairAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  url: "https://dexscreener.com/robinhood/runner",
  dexId: "uniswap",
  origin: { kind: "external", state: "unknown", coverage: "partial" },
  venue: { kind: "dex", dexId: "uniswap", pairAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", url: "https://dexscreener.com/robinhood/runner", execution: "read-only" },
  priceUsd: 1,
  liquidityUsd: 18_000,
  marketCapUsd: 100_000,
  fdvUsd: 100_000,
  volume5m: 3_000,
  volume1h: 12_000,
  volume24h: 50_000,
  priceChange5m: 4,
  priceChange1h: 8,
  priceChange24h: 12,
  buys5m: 8,
  sells5m: 2,
  buys1h: 20,
  sells1h: 10,
  buys24h: 100,
  sells24h: 60,
  pairCreatedAt: Date.now() - 60_000,
  ageMinutes: 1,
  momentumScore: 70,
  buyPressureBps: 6_667,
  signal: "moving",
  riskFlags: []
};
const smartSnapshot = marketWatchlistAlertSnapshot(
  baseMarket,
  { ...baseMarket, liquidityUsd: 20_000 },
  {
    level: "watch",
    largestSell: null,
    largestSellLiquidityBps: 125,
    sellVolume5mUsd: 1_000,
    buyVolume5mUsd: 200,
    netSellVolume5mUsd: 800,
    netSellLiquidityBps: 444
  }
);
assert.equal(smartSnapshot.runnerPace, 3);
assert.equal(smartSnapshot.liquidityDropBps, 1_000);
assert.equal(smartSnapshot.largeSellLiquidityBps, 125);
assert.equal(watchlistAlertMatches({ ...alert!, metric: "netSellLiquidityBps", direction: "above", threshold: 300 }, smartSnapshot), true);

const duplicate = normalizeWatchlistAlerts([alert, alert]);
assert.equal(duplicate.length, 1);
const bounded = normalizeWatchlistAlerts(Array.from({ length: MAXIMUM_WATCHLIST_ALERTS + 10 }, (_, index) => ({
  ...alert,
  id: `alert_${index}`,
  createdAt: index + 1
})));
assert.equal(bounded.length, MAXIMUM_WATCHLIST_ALERTS);
assert.equal(bounded[0]?.createdAt, MAXIMUM_WATCHLIST_ALERTS + 10);

const remote = normalizeWatchlistAlertListSnapshot({ alerts: [alert], updatedAt: 500 });
assert.ok(remote);
assert.deepEqual(resolveWatchlistAlertSnapshot({ alerts: [], updatedAt: 400 }, remote), remote);
assert.deepEqual(resolveWatchlistAlertSnapshot({ alerts: [alert!], updatedAt: 600 }, remote), { alerts: [alert], updatedAt: 600 });

console.log("watchlist alert smoke checks passed");
