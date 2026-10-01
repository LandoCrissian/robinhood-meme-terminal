import { FIXTURE_EPOCH_MS, FIXTURE_NOW, VISIBLE_TOKEN_MARKETS, TOKEN_MARKETS, canonicalDirectoryMarkets } from "./legion-fixtures.mjs";
const token = TOKEN_MARKETS[1].address, pair = TOKEN_MARKETS[1].pairAddress;
// Controlled external responses for real public components. Never used by production.
const trades = Array.from({ length: 10 }, (_, index) => ({
  id: `fixture-${index}`, transactionHash: `0x${String(index + 4).repeat(64).slice(0, 64)}`,
  trader: `0x${(0x5000 + index).toString(16).padStart(40, "0")}`, side: index % 3 === 0 ? "sell" : "buy",
  tokenAmount: 120000 + index * 18000, quoteAmount: 0.11 + index * 0.018,
  priceUsd: 0.000092 + index * 0.000001, volumeUsd: 480 + index * 235,
  timestamp: new Date(FIXTURE_EPOCH_MS - index * 27_000).toISOString(),
}));

function candles(range, referencePrice = 0.000092) {
  const count = range === "7D" ? 84 : range === "24H" ? 72 : 42;
  const step = range === "7D" ? 7200 : range === "24H" ? 1200 : 60;
  const start = Math.floor(FIXTURE_EPOCH_MS / 1000) - count * step;
  return Array.from({ length: count }, (_, index) => {
    const close = referencePrice * (0.94 + index * 0.0012 + Math.sin(index / 3.2) * 0.004);
    const open = close - referencePrice * Math.cos(index / 2.8) * 0.002;
    return { timestamp: start + index * step, open, high: Math.max(open, close) + referencePrice * 0.003, low: Math.min(open, close) - referencePrice * 0.0025, close, volume: 3200 + Math.abs(Math.sin(index / 2)) * 9600 };
  });
}

export async function installTokenRoutes(page, { riskUnavailable = false } = {}) {
  let chartMode = "ready";
  let riskMode = riskUnavailable ? "unavailable" : "ready";
  let socialLinks = false;
  let contextUnavailable = false;
  await page.route("**/api/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "fixture_route_not_registered" }) }));
  await page.route(/\/api\/vnext\/market-directory(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ canonical: true, coverage: "complete", nextCursor: null, markets: canonicalDirectoryMarkets(), updatedAt: FIXTURE_NOW }) }));
  await page.route(/\/api\/vnext\/asset-workspace(?:\?.*)?$/, (route) => {
    const requestUrl = new URL(route.request().url());
    const selectedToken = requestUrl.searchParams.get("address");
    const upMarkets = Array.from({ length: 5 }, (_, index) => ({
      venue: index % 2 ? "up-cl" : "up-v2",
      poolAddress: `0x${(0x7100 + index).toString(16).padStart(40, "0")}`,
      token0: selectedToken,
      token1: `0x${(0x8100 + index).toString(16).padStart(40, "0")}`,
      quoteToken: `0x${(0x8100 + index).toString(16).padStart(40, "0")}`,
      stable: index % 2 ? null : false,
      tickSpacing: index % 2 ? 200 : null,
      liveFee: index === 0 ? 100 : index === 1 ? 2_500 : 3_000,
      feeDenominator: index === 0 ? 10_000 : 1_000_000,
      gaugeState: index === 0 ? "live" : "none",
      gaugeAddress: null, gaugeWeight: null, gaugeClaimable: null, feesAddress: null, bribeAddress: null
    }));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ecosystem: { chainId: 4663, token: selectedToken, status: "ready", authoritative: false, observedBlock: "50000000", observedBlockHash: `0x${"a".repeat(64)}`, observedAt: FIXTURE_NOW, upMarkets, stonkBrokers: { sourceId: "stonkbrokers", sourceName: "StonkBrokers", attributionState: "production-source-unverified", tokenCreated: false, sourceListed: false, authoritative: false } }, stockAssetRelationships: [], stockAssetCoverage: "complete", updatedAt: FIXTURE_NOW }) });
  });
  await page.route(/\/api\/markets\/external(?:\?.*)?$/, (route) => {
    const contract = new URL(route.request().url()).searchParams.get("contract")?.toLowerCase();
    const selectedMarkets = contract ? VISIBLE_TOKEN_MARKETS.filter((market) => market.address === contract || market.pairAddress === contract) : VISIBLE_TOKEN_MARKETS;
    const markets = socialLinks ? selectedMarkets.map(market => ({ ...market, socials: { website: "https://example.org/controlled-rmt-social-fixture", x: "https://x.com/rmt_fixture", telegram: "https://t.me/rmt_fixture" } })) : selectedMarkets;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ markets, source: "legion-visual-fixture", rankingVersion: "deterministic-v1", thresholds: {}, originCoverage: "complete", rmtOriginCoverage: "complete", stockAssetCoverage: "complete", delayedSources: [], updatedAt: FIXTURE_NOW, stale: false }) });
  });
  await page.route(/\/api\/markets\/ohlcv(?:\?.*)?$/, (route) => {
    const requestUrl = new URL(route.request().url());
    const range = requestUrl.searchParams.get("range") ?? "1H";
    if (chartMode === "unavailable") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture_unavailable" }) });
    const referencePrice = Number(requestUrl.searchParams.get("referencePrice") ?? 0.000092);
    const history = chartMode === "sparse" ? candles(range, referencePrice).slice(-1) : candles(range, referencePrice);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: requestUrl.searchParams.get("token"), pair: requestUrl.searchParams.get("pair"), range, candles: history, source: "GeckoTerminal", updatedAt: FIXTURE_NOW, lastTradeAt: trades[0].timestamp, refreshMs: 60_000, stale: chartMode === "stale" }) });
  });
  await page.route(/\/api\/trade\/external-venues(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, venues: [{ venue: "uniswap-v3", pair, dexId: "uniswap-v3", liquidityUsd: TOKEN_MARKETS[1].liquidityUsd, verification: "dex-and-route" }] }) }));
  await page.route(/\/api\/markets\/external-trades(?:\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token, pair, source: "LEGION_FIXTURE", updatedAt: FIXTURE_NOW, trades }) }));
  await page.route(/\/api\/markets\/external-stream(?:\?.*)?$/, (route) => route.fulfill({ status: 204, body: "" }));
  await page.route(/\/api\/markets\/token-risk(?:\?.*)?$/, (route) => {
    if (riskMode === "unavailable") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "fixture_unavailable" }) });
    const requestUrl = new URL(route.request().url());
    const countOnly = riskMode === "count-only";
    const holderRows = countOnly ? [] : [{ address: `0x${"9".repeat(40)}`, shareBps: 420, isContract: null, isScam: false }, { address: `0x${"8".repeat(40)}`, shareBps: 320, isContract: false, isScam: false }];
    const verifiedPosition = riskMode === "verified-position";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: requestUrl.searchParams.get("token"), pair: requestUrl.searchParams.get("pair"), marketVerified: requestUrl.searchParams.has("pair"), coverage: riskMode === "partial" || countOnly ? "partial" : "complete", freshness: "fresh", domains: { token: "ready", holders: "ready", contract: "ready", abi: "ready", creator: "not-applicable", liquidity: riskMode === "partial" ? "unavailable" : "ready", sell: countOnly ? "unavailable" : "ready" }, contract: { sourcePublished: true, isProxy: false, bytecodeChanged: false, controls: { assessment: "no-common-controls-found", detected: [], customWriteFunctions: [], administrator: null, activeLaunchRestrictions: false, restrictionEndBlock: null, maxTransactionBps: null, maxWalletBps: null } }, liquidity: verifiedPosition ? { controlStatus: "contract-held", evidenceSource: "launchpad-registry", positionManager: `0x${"7".repeat(40)}`, positionId: "393642", owner: `0x${"6".repeat(40)}`, approvedOperator: null, creatorCanTransfer: false, positionLiquidity: "1000" } : { controlStatus: "not-proven", evidenceSource: "none", positionManager: null, positionId: null, owner: null, approvedOperator: null, creatorCanTransfer: null, positionLiquidity: null }, holders: { count: 975, topHolders: holderRows, topHolderShareBps: countOnly ? null : 740, largestHolder: holderRows[0] ? { address: holderRows[0].address, shareBps: holderRows[0].shareBps } : null, poolShareBps: 4200, topNonPoolShareBps: countOnly ? null : 740, topNonPoolHolders: holderRows, largestNonPoolHolder: holderRows[0] ? { address: holderRows[0].address, shareBps: holderRows[0].shareBps } : null, creator: null, creatorShareBps: null }, sellSimulation: countOnly ? { status: "not-run", method: "holder-to-pool-transfer", holder: null, amount: null, returnStyle: null } : { status: "passed", method: "holder-to-pool-transfer", holder: holderRows[1].address, amount: "1", returnStyle: "boolean-true" }, warnings: countOnly ? ["Concentration rows and sell-direction evidence are temporarily unavailable."] : [], checkedAt: FIXTURE_NOW }) });
  });
  await page.route(/\/api\/vnext\/chain-pulse(?:\?.*)?$/, (route) => contextUnavailable ? route.fulfill({status:503,json:{error:"CONTROLLED_CONTEXT_UNAVAILABLE"}}) : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ chainId: 4663, chain: "Robinhood Chain", source: "DEFILLAMA", authoritative: false, status: "ready", tvlUsd: 580000000, dexVolume24hUsd: 640000000, dexVolume7dUsd: 3460000000, dexChange1dPct: 3.4, dexChange7dPct: 8.2, fees24hUsd: null, fees7dUsd: null, revenue24hUsd: null, revenue7dUsd: null, protocolRevenue24hUsd: null, protocolRevenue7dUsd: null }) }));
  await page.route(/\/api\/vnext\/capital-flow(?:\?.*)?$/, (route) => contextUnavailable ? route.fulfill({status:503,json:{error:"CONTROLLED_CONTEXT_UNAVAILABLE"}}) : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ schemaVersion: 1, chainId: 4663, chain: "Robinhood Chain", source: "DEFILLAMA", authoritative: false, status: "ready", asOf: FIXTURE_NOW, stablecoinMarketCapUsd: 148000000, stablecoinChange7dPct: 2.3, usdgMarketCapUsd: 91000000, usdgDominancePct: 61.5 }) }));
  return { setChartMode: (mode) => { chartMode = mode; }, setRiskMode: (mode) => { riskMode = mode; }, setSocialLinks: (value) => { socialLinks = value; }, setContextUnavailable: (value) => { contextUnavailable = value; } };
}

