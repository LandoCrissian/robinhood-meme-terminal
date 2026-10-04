import assert from "node:assert/strict";
import type { AssetMarketEvidence, ExternalMarket } from "../external-market";
import { normalizeDirectoryMarkets, type VNextDirectoryMarket } from "./market-directory";
import { marketAtSelectedPool, observedMarketPrices, retainSelectedMarket, selectedMarketSnapshot } from "./selected-market-price";
import { createGeckoPresentationReader } from "../server/gecko-presentation-reader";
import { createTokenChartReader } from "../server/token-chart-market";

const token: `0x${string}` = `0x${"11".repeat(20)}`, quote: `0x${string}` = `0x${"22".repeat(20)}`;
const poolA = `0x${"aa".repeat(32)}`, poolB = `0x${"bb".repeat(32)}`;
const evidence = (pool: string, price: number, liquidity: number): AssetMarketEvidence => ({
  chainId: 4663, assetId: `eip155:4663/erc20:${token}`, token: { address: token, name: "Controlled token", symbol: "TEST" },
  venue: "uniswap", protocolVersion: 4, pool: { kind: "bytes32", value: pool },
  baseToken: { address: token, name: "Controlled token", symbol: "TEST" }, quoteToken: { address: quote, name: "Quote", symbol: "USDG" },
  assetSide: "BASE", displayEligibility: "eligible", chartEligibility: "unavailable", executionEligibility: "view-only",
  provenance: "dexscreener-token-pairs", priceUsd: price, liquidityUsd: liquidity, marketCapUsd: null, fdvUsd: null,
  volume24h: 100, priceChange24h: 2, pairCreatedAt: null
});
const a = evidence(poolA, 0.000006882, 100), b = evidence(poolB, 0.00000003612, 1000);
const raw = { address: token, symbol: "TEST", name: "Controlled token", pairAddress: poolA,
  priceUsd: a.priceUsd, liquidityUsd: a.liquidityUsd, primaryMarket: a, verifiedMarkets: [a, b] } as VNextDirectoryMarket;
const selected = { ...normalizeDirectoryMarkets({ markets: [raw] })[0], primaryMarket: a, pairAddress: poolA, priceUsd: a.priceUsd };
const gecko = { state: "READY" as const, observedAt: "2026-10-04T00:00:00Z", provenance: "GECKOTERMINAL_TOKEN_POOLS", data: {
  token, pool: poolB, priceUsd: b.priceUsd, liquidityUsd: 999999, volume24hUsd: 999, createdAt: null, dex: "uniswap", priceChange24h: -99, buys24h: null, sells24h: null
} };
assert.equal(selectedMarketSnapshot(selected, undefined, gecko).priceUsd, a.priceUsd, "Another pool's highest reported liquidity cannot replace the selected price");
assert.equal(selectedMarketSnapshot(selected, undefined, { ...gecko, data: { ...gecko.data, pool: poolA, priceUsd: 12 } }).priceUsd, a.priceUsd,
  "A different provider's same-pool observation is not an interchangeable price authority");
const next = { ...selected, pairAddress: poolB, primaryMarket: b, priceUsd: b.priceUsd, ageMinutes: 12, verifiedMarkets: [{ ...a, priceUsd: 0.000007 }, b] };
const held = retainSelectedMarket(selected, next);
assert.equal(held.primaryMarket?.pool.value, poolA); assert.equal(held.priceUsd, 0.000007, "Selected market refreshes even if another pool becomes top-ranked");
assert.equal(held.volume1h, null, "Activity belonging to the new primary cannot be copied to the selected alternate");
assert.equal(held.ageMinutes, null, "Age belonging to the new primary cannot be copied to the selected alternate");
assert.equal(retainSelectedMarket(selected, { ...next, verifiedMarkets: [b] }).priceUsd, a.priceUsd, "Missing selected observation retains its own last-known snapshot");
assert.equal(selectedMarketSnapshot(selected, next as unknown as ExternalMarket, gecko).priceUsd, a.priceUsd);
assert.equal(marketAtSelectedPool(next, poolA)?.primaryMarket?.pool.value, poolA);
const selectedVenue = (marketAtSelectedPool(next, poolA) as unknown as ExternalMarket).venue;
assert.equal(selectedVenue.kind, "dex");
assert.equal(selectedVenue.kind === "dex" && selectedVenue.pairAddress, poolA, "Selected venue and price share the same pool");
assert.equal(marketAtSelectedPool({ ...selected, primaryMarket: { ...a, token: { ...a.token, address: quote } }, verifiedMarkets: [] }, poolA), undefined,
  "Matching PoolId with a wrong token attachment is not sufficient");
assert.equal(selectedMarketSnapshot(selected, { ...selected, priceUsd: 0.000008 } as unknown as ExternalMarket, gecko).priceUsd, 0.000008);
const gtSelected = { ...selected, primaryMarket: { ...a, provenance: "geckoterminal-pool-feed" as const } };
assert.equal(selectedMarketSnapshot(gtSelected, selected as unknown as ExternalMarket, { ...gecko, data: { ...gecko.data, pool: poolA, priceUsd: 0.000009 } }).priceUsd, 0.000009,
  "A Gecko-observed selection refreshes from Gecko for that same pool");
const invalid = { ...b, displayEligibility: "invalid-token-perspective" as const };
assert.equal(observedMarketPrices({ ...selected, verifiedMarkets: [a, invalid] }).dispersed, false);
assert.equal(observedMarketPrices({ ...selected, verifiedMarkets: [a, { ...b, priceUsd: -1 }] }).dispersed, false, "Non-positive prices are not dispersion evidence");
assert.equal(observedMarketPrices(selected).dispersed, true); assert.equal(observedMarketPrices(selected).observations.length, 2);
assert.equal(normalizeDirectoryMarkets({ markets: [raw] })[0].priceUsd, b.priceUsd, "Scanner price and selected pool are normalized together");
assert.equal(normalizeDirectoryMarkets({ markets: [raw] })[0].pairAddress, poolB, "A V4 PoolId survives the directory boundary");

async function main() {
  const record = (pool: string, exact = token) => ({ id: `robinhood_${pool}`, attributes: { address: pool, base_token_price_usd: "0.000006882", reserve_in_usd: "100" },
    relationships: { base_token: { data: { id: `robinhood_${exact}` } }, quote_token: { data: { id: `robinhood_${quote}` } } } });
  let calls = 0;
  const reader = createTokenChartReader(createGeckoPresentationReader((async () => { calls++; return Response.json({ data: record(poolA) }); }) as typeof fetch));
  const results = await Promise.all([reader.selectedMarket(token, poolA), reader.selectedMarket(token, poolA)]);
  assert.equal(calls, 1, "Exact selected reads coalesce without token-directory fanout");
  assert.equal(results[0].data?.pool, poolA);
  await assert.rejects(reader.selectedMarket(token, poolB), "Provider cannot answer another pool under the requested identity");
  const wrongToken = createTokenChartReader(createGeckoPresentationReader((async () => Response.json({ data: record(poolA, `0x${"33".repeat(20)}`) })) as typeof fetch));
  await assert.rejects(wrongToken.selectedMarket(token, poolA), "Exact pool must independently contain the selected token");
  await assert.rejects(reader.selectedMarket(token, "https://untrusted.invalid"), "Pool hints cannot become arbitrary URLs");
  console.log("Selected market price: exact pool/token/provider binding, stable pool refresh, separate dispersion, unavailable observations and bounded coalescing PASS.");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
