import assert from "node:assert/strict";
import {
  externalMarketViewCounts,
  selectExternalMarketView
} from "./external-market-discovery";

const base = {
  ageMinutes: 60,
  buys1h: 8,
  fdvUsd: 10_000,
  liquidityUsd: 5_000,
  marketCapUsd: 10_000,
  momentumScore: 50,
  pairCreatedAt: Date.now() - 60 * 60_000,
  sells1h: 5,
  signal: "moving" as const,
  volume1h: 2_000
};

const markets = [
  { ...base, id: "qualified" },
  {
    ...base,
    id: "old-active",
    ageMinutes: 10 * 24 * 60,
    pairCreatedAt: Date.now() - 10 * 24 * 60 * 60_000,
    signal: "active" as const,
    volume1h: 100
  },
  {
    ...base,
    id: "stagnant",
    ageMinutes: 30,
    pairCreatedAt: Date.now() - 30 * 60_000,
    signal: "active" as const,
    volume1h: 0
  }
];

assert.deepEqual(
  selectExternalMarketView(markets, "trending").map((market) => market.id),
  ["qualified"],
  "Signals must not silently fall back to ordinary markets"
);
assert.deepEqual(
  selectExternalMarketView(markets, "new").map((market) => market.id),
  ["stagnant", "qualified"],
  "New must contain only markets no older than 24 hours"
);
assert.deepEqual(
  selectExternalMarketView(markets, "top").map((market) => market.id),
  ["qualified", "old-active"],
  "Active markets must rank by current one-hour activity"
);
assert.deepEqual(externalMarketViewCounts(markets), {
  trending: 1,
  new: 2,
  top: 2,
  explore: 3
});

console.info("External market discovery semantics passed");
