import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAXIMUM_WATCHLIST_ALERT_EVENTS,
  normalizeWatchlistAlertEvent,
  normalizeWatchlistAlertEvents,
  WATCHLIST_ALERT_EVENT_COOLDOWN_MS
} from "./watchlist-alert-events";

const base = {
  id: "alert:priceUsd:above:100:200",
  alertId: "alert:priceUsd:above:100",
  address: "0x1111111111111111111111111111111111111111",
  name: "Runner",
  symbol: "RUN",
  metric: "priceUsd",
  direction: "above",
  threshold: 1,
  observedValue: 1.25,
  triggeredAt: 200
};

assert.deepEqual(normalizeWatchlistAlertEvent(base), base);
assert.equal(normalizeWatchlistAlertEvent({ ...base, observedValue: -1 }), null);
assert.equal(normalizeWatchlistAlertEvent({ ...base, address: "bad" }), null);
assert.equal(WATCHLIST_ALERT_EVENT_COOLDOWN_MS, 300_000);
assert.equal(normalizeWatchlistAlertEvents(Array.from({ length: 120 }, (_, index) => ({
  ...base,
  id: `${base.id}:${index}`,
  triggeredAt: 200 + index
}))).length, MAXIMUM_WATCHLIST_ALERT_EVENTS);

const watchlistSource = readFileSync(new URL("../app/watchlist-panel.tsx", import.meta.url), "utf8");
const historySource = readFileSync(new URL("../app/watchlist-alert-history.tsx", import.meta.url), "utf8");
assert.match(watchlistSource, /recordWatchlistAlertEvent\(/);
assert.match(watchlistSource, /alertMatchStateRef\.current\.get\(evaluation\.alert\.id\) === false/);
assert.match(historySource, /History does not prove execution or investment performance/);

console.log("Watchlist alert history remains bounded and evidence-shaped.");
