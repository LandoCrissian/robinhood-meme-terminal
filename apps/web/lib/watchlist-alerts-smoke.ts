import assert from "node:assert/strict";
import {
  MAXIMUM_WATCHLIST_ALERTS,
  normalizeWatchlistAlert,
  normalizeWatchlistAlerts,
  watchlistAlertMatches,
  watchlistAlertMetricLabel
} from "./watchlist-alerts";

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

const duplicate = normalizeWatchlistAlerts([alert, alert]);
assert.equal(duplicate.length, 1);
const bounded = normalizeWatchlistAlerts(Array.from({ length: MAXIMUM_WATCHLIST_ALERTS + 10 }, (_, index) => ({
  ...alert,
  id: `alert_${index}`,
  createdAt: index + 1
})));
assert.equal(bounded.length, MAXIMUM_WATCHLIST_ALERTS);
assert.equal(bounded[0]?.createdAt, MAXIMUM_WATCHLIST_ALERTS + 10);

console.log("watchlist alert smoke checks passed");
