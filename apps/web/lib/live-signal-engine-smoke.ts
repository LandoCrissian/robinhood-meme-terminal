import assert from "node:assert/strict";
import type { ExternalMarket } from "./external-market";
import { deriveLiveMarketSignal, deriveLiveMarketSignals } from "./live-signal-engine";

const address = (character: string) => `0x${character.repeat(40)}`;
const market = (overrides: Partial<ExternalMarket> = {}): ExternalMarket => ({
  address: address("1"),
  name: "Runner",
  symbol: "RUN",
  pairAddress: address("2"),
  url: "https://dexscreener.com/robinhood/runner",
  dexId: "uniswap",
  origin: { kind: "external", state: "unknown", coverage: "partial" },
  venue: {
    kind: "dex",
    dexId: "uniswap",
    pairAddress: address("2"),
    url: "https://dexscreener.com/robinhood/runner",
    execution: "read-only"
  },
  priceUsd: 0.01,
  liquidityUsd: 20_000,
  marketCapUsd: 100_000,
  fdvUsd: 100_000,
  volume5m: 2_000,
  volume1h: 8_000,
  volume24h: 50_000,
  priceChange5m: 8,
  priceChange1h: 15,
  priceChange24h: 20,
  buys5m: 8,
  sells5m: 2,
  buys1h: 20,
  sells1h: 10,
  buys24h: 100,
  sells24h: 60,
  pairCreatedAt: Date.now() - 60 * 60_000,
  ageMinutes: 60,
  momentumScore: 72,
  buyPressureBps: 6_667,
  signal: "moving",
  riskFlags: [],
  ...overrides
});

const acceleration = deriveLiveMarketSignal(market(), undefined, Date.now());
assert.equal(acceleration?.kind, "runner-acceleration");
assert.match(acceleration?.evidence ?? "", /recent pace/);

const sellPressure = deriveLiveMarketSignal(market({
  signal: "active",
  buys5m: 1,
  sells5m: 9,
  priceChange5m: -16,
  volume5m: 1_000
}));
assert.equal(sellPressure?.kind, "sell-side-pressure");
assert.equal(sellPressure?.severity, "urgent");

const previous = market({ liquidityUsd: 20_000, momentumScore: 30, signal: "active" });
const contraction = deriveLiveMarketSignal(market({
  liquidityUsd: 13_000,
  momentumScore: 30,
  signal: "active",
  buys5m: 1,
  sells5m: 1,
  volume5m: 20,
  priceChange5m: 0
}), previous);
assert.equal(contraction?.kind, "liquidity-contraction");
assert.equal(contraction?.severity, "urgent");

const inactive = market({
  signal: "active",
  liquidityUsd: 4_000,
  volume5m: 0,
  volume1h: 100,
  buys5m: 0,
  sells5m: 0,
  buys1h: 1,
  sells1h: 1,
  momentumScore: 5,
  ageMinutes: 1_000
});
assert.equal(deriveLiveMarketSignal(inactive), null);

const ordered = deriveLiveMarketSignals([
  market({ address: address("3"), pairAddress: address("4") }),
  market({ address: address("5"), pairAddress: address("6"), signal: "active", buys5m: 1, sells5m: 9, priceChange5m: -16 })
]);
assert.equal(ordered[0]?.severity, "urgent");
assert.notEqual(ordered[0]?.token.toLowerCase(), ordered[1]?.token.toLowerCase());

console.log("RMT live signals remain deterministic, evidence-labeled, and non-executing.");
