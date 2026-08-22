import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, type Hex } from "viem";
import type { ExternalMarketResponse, UniversalMarketResolution } from "../external-market";
import { buildAssetMarketRecord } from "../external-market";
import { normalizeProviderPairForAsset } from "../external-market-identity";
import { readVNextCanonicalMarketDirectoryPage } from "../server/vnext-canonical-market-directory";
import { readVNextLegacyMarketDirectoryPage } from "../server/vnext-legacy-market-directory";
import {
  readVNextMarketDirectoryRequest,
  vNextCanonicalBrowseEnabled
} from "../server/vnext-market-directory-route";
import type {
  VNextCanonicalMarketInventoryCoverage,
  VNextCanonicalMarketInventoryPool,
  VNextCanonicalMarketInventoryResult
} from "../server/vnext-market-indexer";
import {
  MAX_DIRECT_V6_ORIGIN_RECORDS,
  validateCompleteV6OriginRecords
} from "../server/launch-feed";
import { assetKey } from "./execution-domain";
import {
  VNEXT_MARKET_DIRECTORY_MAX_MARKETS,
  VNEXT_MARKET_DIRECTORY_PAGE_SIZE,
  VNEXT_MARKET_DIRECTORY_VIEWS,
  deriveVNextMarketState,
  directoryMarketFromExactLookup,
  directoryMarketFromVerifiedIdentity,
  isVNextDirectoryMarketSelectable,
  mergeVNextCanonicalBrowseMarkets,
  mergeVNextDirectoryAndSearchMarkets,
  normalizeDirectoryMarkets,
  parseVNextCanonicalDirectoryResponse,
  resolutionFromLookup,
  selectVNextChartPool,
  selectVNextMarketDirectoryView,
  visibleVNextMarketDirectoryMarkets,
  verifiedDirectoryAsset,
  shouldRequestVNextExternalWorkspaceMarket,
  vNextRwaClassificationLabel,
  vNextMarketDirectoryViewCounts
} from "./market-directory";
import { ROBINHOOD_RMT, ROBINHOOD_RMT_ADDRESS, ROBINHOOD_WETH_ADDRESS } from "./robinhood-assets";

const otherAddress = "0x2222222222222222222222222222222222222222";
const payload = {
  markets: [
    {
      address: ROBINHOOD_RMT_ADDRESS,
      name: "Robinhood Meme Terminal",
      symbol: "RMT",
      priceUsd: 0.004,
      liquidityUsd: 100_000,
      marketCapUsd: 1_000_000,
      volume24h: 20_000,
      priceChange24h: 4.2,
      ageMinutes: 100,
      signal: "moving"
    },
    {
      address: otherAddress,
      name: "Other",
      symbol: "OTH",
      priceUsd: Number.NaN,
      liquidityUsd: -10,
      marketCapUsd: 0,
      volume24h: 0,
      priceChange24h: Number.POSITIVE_INFINITY,
      ageMinutes: null,
      signal: "active"
    },
    { address: otherAddress.toUpperCase(), name: "Duplicate", symbol: "DUP" },
    { address: "not-an-address", name: "Invalid", symbol: "BAD" }
  ]
} as unknown as ExternalMarketResponse;

const markets = normalizeDirectoryMarkets(payload);
assert.equal(markets.length, 2);
assert.equal(markets[1].priceUsd, null);
assert.equal(markets[1].liquidityUsd, null);
assert.equal(markets[1].priceChange24h, null);
assert.equal(assetKey(verifiedDirectoryAsset(markets[0])!.id), assetKey(ROBINHOOD_RMT.id));
assert.equal(verifiedDirectoryAsset(markets[1]), null);

const categorized = normalizeDirectoryMarkets({
  markets: [
    ...(payload.markets ?? []),
    {
      address: "0x5555555555555555555555555555555555555555",
      name: "Verified Stock Token",
      symbol: "STOCKX",
      priceUsd: 20,
      liquidityUsd: 40_000,
      marketCapUsd: 2_000_000,
      volume24h: 4_000,
      priceChange24h: 0,
      ageMinutes: 2_000,
      signal: "active",
      stockAssetRelationships: [{
        relationship: "canonical-stock-token",
        assetId: "stock-x",
        tokenSymbol: "STOCKX",
        tokenName: "Verified Stock Token",
        contractAddress: "0x5555555555555555555555555555555555555555",
        currentMultiplier: "1",
        status: "active",
        logoUrl: null,
        provenance: "robinhood-live-asset-registry"
      }]
    },
    {
      address: "0x3333333333333333333333333333333333333333",
      name: "Stock Pair",
      symbol: "STOCK",
      priceUsd: 1,
      liquidityUsd: 50_000,
      marketCapUsd: 100_000,
      volume24h: 5_000,
      priceChange24h: 0,
      ageMinutes: 2_000,
      signal: "active",
      stockAssetRelationships: [{
        relationship: "paired-market-asset",
        assetId: "stock",
        tokenSymbol: "STOCK",
        tokenName: "Stock",
        contractAddress: "0x4444444444444444444444444444444444444444",
        currentMultiplier: "1",
        status: "active",
        logoUrl: null,
        provenance: "robinhood-live-asset-registry"
      }]
    }
  ]
} as unknown as ExternalMarketResponse);
const held = new Set([otherAddress.toLowerCase()]);
const counts = vNextMarketDirectoryViewCounts(categorized, held);
assert.equal(counts.trending, 1);
assert.equal(counts.new, 1);
assert.equal(counts.active, 2);
assert.equal(counts.rwa, 2);
assert.equal(counts.held, 1);
assert.equal(counts.all, 4);
assert.equal(selectVNextMarketDirectoryView(categorized, "trending", held)[0].symbol, "RMT");
assert.equal(selectVNextMarketDirectoryView(categorized, "held", held)[0].symbol, "OTH");
const rwaMarkets = selectVNextMarketDirectoryView(categorized, "rwa", held);
assert.deepEqual(rwaMarkets.map((market) => market.rwaRelationship), ["canonical-stock-token", "paired-market-asset"]);
assert.equal(vNextRwaClassificationLabel(rwaMarkets[0].rwaRelationship), "Stock Token");
assert.equal(vNextRwaClassificationLabel(rwaMarkets[1].rwaRelationship), "RWA Pair");
assert.equal(vNextRwaClassificationLabel(undefined), null);

const pagedMarkets = Array.from({ length: 61 }, (_, index) => ({
  ...categorized[0],
  address: `0x${(index + 1).toString(16).padStart(40, "0")}`
}));
assert.equal(VNEXT_MARKET_DIRECTORY_MAX_MARKETS, 144);
assert.equal(VNEXT_MARKET_DIRECTORY_PAGE_SIZE, 24);
assert.equal(visibleVNextMarketDirectoryMarkets(pagedMarkets).length, 24);
assert.equal(visibleVNextMarketDirectoryMarkets(pagedMarkets, 48).length, 48);
assert.equal(visibleVNextMarketDirectoryMarkets(pagedMarkets, 200).length, 61);
assert.equal(visibleVNextMarketDirectoryMarkets(pagedMarkets, Number.NaN).length, 24);

const resolution: UniversalMarketResolution = {
  chainId: 4_663,
  requestedAddress: otherAddress,
  requestedKind: "token",
  status: "token-only",
  token: { address: otherAddress, name: "Other Token", symbol: "OTH", decimals: 18, totalSupply: "1" },
  pools: [],
  marketData: "identity-only",
  execution: "route-check-required",
  provenance: "robinhood-chain-contract-reads",
  resolvedAt: new Date(0).toISOString()
};
const verified = verifiedDirectoryAsset(markets[1], resolution);
assert.equal(verified?.metadataState, "verified");
assert.equal(verified?.decimals, 18);
assert.equal(resolutionFromLookup({ resolution }, otherAddress), resolution);
assert.equal(verifiedDirectoryAsset(markets[1], { ...resolution, chainId: 4_663, token: { ...resolution.token, address: ROBINHOOD_RMT_ADDRESS } }), null);
const identityOnlyMarket = directoryMarketFromVerifiedIdentity({ resolution }, otherAddress);
assert.equal(identityOnlyMarket?.address, otherAddress);
assert.equal(identityOnlyMarket?.symbol, "OTH");
assert.equal(identityOnlyMarket?.priceUsd, null);
assert.equal(identityOnlyMarket?.liquidityUsd, null);
assert.equal(identityOnlyMarket?.volume24h, null);
assert.equal(identityOnlyMarket?.marketCapUsd, null);
assert.equal(identityOnlyMarket?.resolution, resolution);
assert.deepEqual(deriveVNextMarketState(identityOnlyMarket!), {
  asset: "verified",
  market: "none",
  metrics: "unavailable",
  chart: "unavailable",
  execution: "not-evaluated"
});
assert.equal(isVNextDirectoryMarketSelectable(identityOnlyMarket!), true);
assert.equal(shouldRequestVNextExternalWorkspaceMarket(identityOnlyMarket!), true);
assert.equal(directoryMarketFromVerifiedIdentity({
  resolution: { ...resolution, chainId: 1 }
} as unknown as ExternalMarketResponse, otherAddress), null);
assert.equal(directoryMarketFromVerifiedIdentity({ resolution: { ...resolution, token: { ...resolution.token, address: ROBINHOOD_RMT_ADDRESS } } }, otherAddress), null);
assert.equal(directoryMarketFromVerifiedIdentity({ resolution }, "not-an-address"), null);

const exactAddress = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const otherExactAddress = "0xdddddddddddddddddddddddddddddddddddddddd";
const poolA = "0x1111111111111111111111111111111111111111";
const poolB = "0x2222222222222222222222222222222222222222";
const quoteAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const pair = (overrides: Record<string, unknown> = {}) => ({
  chainId: "robinhood",
  pairAddress: poolA,
  dexId: "uniswap-v3",
  baseToken: { address: exactAddress, name: "Exact Token", symbol: "SAME" },
  quoteToken: { address: quoteAddress, name: "Wrapped Ether", symbol: "WETH" },
  priceUsd: "0.014",
  liquidity: { usd: 20_000 },
  marketCap: 1_000_000,
  volume: { h24: 8_000 },
  priceChange: { h24: 2 },
  ...overrides
});
const evidenceOptions = {
  chainId: 4_663 as const,
  chainSlug: "robinhood",
  canonicalQuoteAddresses: new Set([quoteAddress]),
  provenance: "dexscreener-token-pairs" as const
};
const firstEvidence = normalizeProviderPairForAsset(pair(), exactAddress, evidenceOptions)!;
const secondEvidence = normalizeProviderPairForAsset(pair({
  pairAddress: poolB,
  liquidity: { usd: 30_000 },
  volume: { h24: 9_000 }
}), exactAddress, evidenceOptions)!;
const malformedQuoteEvidence = normalizeProviderPairForAsset(pair({
  pairAddress: "0x3333333333333333333333333333333333333333",
  baseToken: { address: quoteAddress, name: "Wrapped Ether", symbol: "WETH" },
  quoteToken: { address: exactAddress, name: "Exact Token", symbol: "SAME" },
  priceUsd: "500",
  liquidity: { usd: 999_999_999 }
}), exactAddress, evidenceOptions)!;
const missingMetricsEvidence = normalizeProviderPairForAsset(pair({
  priceUsd: undefined,
  liquidity: { usd: undefined },
  marketCap: undefined,
  fdv: undefined,
  volume: { h24: undefined },
  priceChange: { h24: undefined }
}), exactAddress, evidenceOptions)!;
const observedWithoutMetrics = normalizeDirectoryMarkets({ markets: [{
  address: exactAddress,
  name: "Observed Token",
  symbol: "OBS",
  priceUsd: null,
  liquidityUsd: null,
  marketCapUsd: null,
  volume24h: null,
  priceChange24h: null,
  ageMinutes: null,
  signal: null,
  verifiedMarkets: [missingMetricsEvidence]
}] } as unknown as ExternalMarketResponse)[0];
assert.ok(observedWithoutMetrics, "Provider-observed markets must survive without summary metrics");
assert.deepEqual(deriveVNextMarketState(observedWithoutMetrics), {
  asset: "observed",
  market: "observed",
  metrics: "unavailable",
  chart: "available",
  execution: "not-evaluated"
});
assert.equal(observedWithoutMetrics.priceUsd, null);
assert.equal(observedWithoutMetrics.liquidityUsd, null);
assert.equal(observedWithoutMetrics.signal, null);
assert.equal(isVNextDirectoryMarketSelectable(observedWithoutMetrics), true);

const partialMetrics = { ...observedWithoutMetrics, priceUsd: 0, volume24h: 25 };
assert.equal(deriveVNextMarketState(partialMetrics).metrics, "partial");
assert.equal(partialMetrics.priceUsd, 0, "An observed zero remains a real metric");
const completeMetrics = {
  ...partialMetrics,
  liquidityUsd: 0,
  marketCapUsd: 100,
  priceChange24h: 0
};
assert.equal(deriveVNextMarketState(completeMetrics).metrics, "complete");

const v4PoolId = `0x${"44".repeat(32)}`;
const v4Evidence = normalizeProviderPairForAsset(pair({
  pairAddress: v4PoolId,
  dexId: "uniswap-v4",
  priceUsd: undefined,
  liquidity: { usd: undefined },
  marketCap: undefined,
  fdv: undefined,
  volume: { h24: undefined },
  priceChange: { h24: undefined }
}), exactAddress, evidenceOptions)!;
const v4Observed = normalizeDirectoryMarkets({ markets: [{
  address: exactAddress,
  assetId: v4Evidence.assetId,
  name: "V4 Observed",
  symbol: "V4O",
  priceUsd: null,
  liquidityUsd: null,
  marketCapUsd: null,
  volume24h: null,
  priceChange24h: null,
  ageMinutes: null,
  signal: null,
  pairAddress: undefined,
  verifiedMarkets: [v4Evidence]
}] } as unknown as ExternalMarketResponse)[0];
assert.equal(v4Observed.pairAddress, undefined);
assert.equal(v4Observed.verifiedMarkets?.[0].pool.kind, "bytes32");
assert.equal(v4Observed.verifiedMarkets?.[0].pool.value, v4PoolId);
assert.equal(deriveVNextMarketState(v4Observed).market, "observed");
assert.equal(deriveVNextMarketState(v4Observed).chart, "unavailable");

const nonChartPrimaryWithChartAlternative = {
  ...v4Observed,
  primaryMarket: v4Evidence,
  verifiedMarkets: [v4Evidence, firstEvidence]
};
assert.equal(deriveVNextMarketState(nonChartPrimaryWithChartAlternative).chart, "available");
assert.equal(selectVNextChartPool(nonChartPrimaryWithChartAlternative), poolA);
const exactRecord = buildAssetMarketRecord([firstEvidence, secondEvidence, malformedQuoteEvidence], { requireChart: true })!;
const exactLookupPayload = {
  markets: [{
    address: exactAddress,
    name: "Exact Token",
    symbol: "SAME",
    priceUsd: exactRecord.primaryMarket?.priceUsd,
    liquidityUsd: exactRecord.primaryMarket?.liquidityUsd,
    marketCapUsd: exactRecord.primaryMarket?.marketCapUsd,
    volume24h: exactRecord.primaryMarket?.volume24h,
    priceChange24h: exactRecord.primaryMarket?.priceChange24h,
    ageMinutes: null,
    signal: "active",
    pairAddress: exactRecord.primaryMarket?.pool.value,
    primaryMarket: exactRecord.primaryMarket,
    verifiedMarkets: exactRecord.verifiedMarkets,
    resolution
  }]
} as unknown as ExternalMarketResponse;
const exactLookup = directoryMarketFromExactLookup(exactLookupPayload, exactAddress);
assert.equal(exactLookup?.address, getAddress(exactAddress));
assert.equal(exactLookup?.primaryMarket?.pool.value, poolB);
assert.equal(exactLookup?.pairAddress, poolB);
assert.equal(exactLookup?.priceUsd, secondEvidence.priceUsd);
assert.equal(exactLookup?.verifiedMarkets?.length, 3, "Exact search must preserve admitted alternate markets");
assert.equal(exactLookup?.primaryMarket?.assetSide, "BASE", "Malformed quote-side evidence must not hijack exact search");
const exactV4Lookup = directoryMarketFromExactLookup({ markets: [{
  address: exactAddress,
  assetId: v4Evidence.assetId,
  name: "V4 Exact",
  symbol: "V4E",
  priceUsd: null,
  liquidityUsd: null,
  marketCapUsd: null,
  volume24h: null,
  priceChange24h: null,
  ageMinutes: null,
  signal: null,
  pairAddress: undefined,
  verifiedMarkets: [v4Evidence]
}] } as unknown as ExternalMarketResponse, exactAddress);
assert.ok(exactV4Lookup, "An exact provider V4 PoolId must survive without a chart address or metrics");
assert.equal(exactV4Lookup?.primaryMarket, undefined);
assert.equal(exactV4Lookup?.verifiedMarkets?.[0].pool.value, v4PoolId);
assert.equal(directoryMarketFromExactLookup(exactLookupPayload, otherExactAddress), null, "A returned market for the wrong contract must fail closed");
const wrongAssetEvidence = normalizeProviderPairForAsset(pair({
  baseToken: { address: otherExactAddress, name: "Imposter", symbol: "SAME" }
}), otherExactAddress, evidenceOptions)!;
assert.equal(directoryMarketFromExactLookup({ markets: [{
  ...(exactLookupPayload.markets?.[0] ?? {}),
  pairAddress: wrongAssetEvidence.pool.value,
  verifiedMarkets: [wrongAssetEvidence]
}] } as unknown as ExternalMarketResponse, exactAddress), null, "Mismatched market evidence must not be attached to the searched contract");
assert.equal(directoryMarketFromExactLookup({ markets: [{ address: "malformed" }] } as unknown as ExternalMarketResponse, exactAddress), null);
const sameSymbolDifferentContract = normalizeDirectoryMarkets({ markets: [
  ...(exactLookupPayload.markets ?? []),
  { ...(exactLookupPayload.markets?.[0] ?? {}), address: otherExactAddress, assetId: undefined, pairAddress: "0x4444444444444444444444444444444444444444", primaryMarket: undefined, verifiedMarkets: undefined }
] } as unknown as ExternalMarketResponse);
assert.equal(sameSymbolDifferentContract.length, 2, "Different contracts sharing a symbol/name must remain separate assets");

const hook = readFileSync(new URL("../../app/vnext/use-vnext-market-directory.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/vnext/market-directory/route.ts", import.meta.url), "utf8");
const canonicalDirectoryServer = readFileSync(new URL("../server/vnext-canonical-market-directory.ts", import.meta.url), "utf8");
const legacyDirectoryServer = readFileSync(new URL("../server/vnext-legacy-market-directory.ts", import.meta.url), "utf8");
const directoryRouteServer = readFileSync(new URL("../server/vnext-market-directory-route.ts", import.meta.url), "utf8");
const envExample = readFileSync(new URL("../../.env.example", import.meta.url), "utf8");
const ecosystemRoute = readFileSync(new URL("../../app/api/markets/external/route.ts", import.meta.url), "utf8");
const identityRoute = readFileSync(new URL("../../app/api/vnext/asset-identity/route.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../app/vnext/vnext-terminal-shell.tsx", import.meta.url), "utf8");
assert.match(hook, /fetch\("\/api\/vnext\/market-directory"/);
assert.match(hook, /fetch\(`\/api\/vnext\/market-directory\?\$\{parameters\}`/);
assert.match(hook, /fetch\("\/api\/markets\/external"/);
const selectAddressSource = hook.slice(hook.indexOf("const selectAddress"), hook.indexOf("const refresh ="));
assert.match(selectAddressSource, /URLSearchParams\(\{ address \}\)/);
assert.match(selectAddressSource, /URLSearchParams\(\{ contract: address \}\)/);
assert.match(selectAddressSource, /\/api\/vnext\/asset-identity/);
assert.match(selectAddressSource, /directoryMarketFromVerifiedIdentity/);
assert.match(selectAddressSource, /\/api\/markets\/external/);
assert.match(selectAddressSource, /directoryMarketFromExactLookup/);
assert.match(selectAddressSource, /Promise\.allSettled/);
assert.match(hook, /mergeVNextCanonicalBrowseMarkets/);
assert.match(hook, /DirectoryServingMode = "unknown" \| "legacy" \| "canonical"/);
assert.match(hook, /claimsCanonicalDirectory/);
assert.match(hook, /directoryServingMode\.current === "canonical"/);
assert.match(hook, /directoryServingMode\.current === "legacy"/);
assert.match(hook, /canonicalNextCursor/);
assert.match(hook, /loadNextCanonicalPage/);
assert.match(hook, /URLSearchParams\(\{ address: selected\.address \}\)/);
assert.match(hook, /fetch\(`\/api\/vnext\/asset-identity/);
assert.match(hook, /setIdentityStatus\("checking"\)/);
assert.match(hook, /directorySnapshot/);
assert.match(hook, /identityCache/);
assert.match(hook, /nextSnapshot !== marketSnapshot\.current/);
assert.doesNotMatch(hook, /external-availability|external-sushi-quote|external-uniswap/);
assert.equal((hook.match(/setInterval/g) ?? []).length, 0);
assert.equal((hook.match(/useVisibilityRefresh/g) ?? []).length, 3);
assert.match(hook, /VNEXT_CLIENT_REFRESH_POLICY\.marketDirectoryMs/);
assert.match(hook, /VNEXT_CLIENT_REFRESH_POLICY\.ecosystemDirectoryMs/);
assert.match(route, /readVNextMarketDirectoryRequest/);
assert.match(directoryRouteServer, /RMT_CANONICAL_BROWSE_ENABLED === "true"/);
assert.match(directoryRouteServer, /private, no-store, max-age=0/);
assert.match(envExample, /RMT_CANONICAL_BROWSE_ENABLED=false/);
assert.match(canonicalDirectoryServer, /readVNextCanonicalMarketInventory/);
assert.match(canonicalDirectoryServer, /coverage\.complete/);
assert.match(canonicalDirectoryServer, /VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT/);
assert.match(canonicalDirectoryServer, /cursor/);
assert.doesNotMatch(canonicalDirectoryServer, /dexscreener|DIRECTORY_TOKENS|fetchPairs|ROBINHOOD_USDG_ADDRESS|ROBINHOOD_RMT_ADDRESS/i);
assert.match(legacyDirectoryServer, /DIRECTORY_TOKENS/);
assert.match(legacyDirectoryServer, /dexscreener/);
assert.doesNotMatch(canonicalDirectoryServer, /slice\(0, VNEXT_MARKET_DIRECTORY_MAX_MARKETS\)/);
assert.doesNotMatch(canonicalDirectoryServer, /resolveRmtOrigins|external-availability|external-sushi-quote|external-uniswap|router|reactor/);
assert.deepEqual(VNEXT_MARKET_DIRECTORY_VIEWS.slice(0, 2).map((view) => view.id), ["active", "trending"]);

const canonicalSources = [
  "sushiswap-v2",
  "sushiswap-v3",
  "uniswap-v2",
  "uniswap-v3",
  "uniswap-v4",
  "up-v2",
  "up-cl"
] as const;
const completeCoverage: VNextCanonicalMarketInventoryCoverage = {
  complete: true,
  finalizedHead: "100",
  sources: canonicalSources.map((sourceId) => ({ sourceId, status: "shadow-ready" as const, indexedThrough: "100" }))
};
const addressFor = (value: number) => `0x${value.toString(16).padStart(40, "0")}`;
const hashFor = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;
const v2CanonicalPool = (index: number): VNextCanonicalMarketInventoryPool => ({
  sourceId: "uniswap-v2",
  protocol: "uniswap",
  version: 2,
  poolKey: addressFor(10_000 + index),
  poolAddress: addressFor(10_000 + index),
  token0: addressFor(1 + index * 2),
  token1: addressFor(2 + index * 2),
  stable: null,
  fee: null,
  tickSpacing: null,
  hooks: null,
  transactionHash: hashFor(20_000 + index),
  blockNumber: String(1_000 - index),
  blockHash: hashFor(30_000 + index),
  stateStatus: null,
  liveFee: null,
  feeDenominator: null,
  gaugeAddress: null,
  gaugeAlive: null,
  gaugeWeight: null,
  gaugeClaimable: null,
  feesAddress: null,
  bribeAddress: null,
  stateError: null,
  stateObservedBlock: null,
  stateObservedBlockHash: null
});
const stonkBrokerAddress = "0xe934e36a439c94017b64a3fece66af12099abf50";
const stonkBrokerPoolId = `0x${"ab".repeat(32)}`;
const stonkBrokerV4Pool: VNextCanonicalMarketInventoryPool = {
  ...v2CanonicalPool(200),
  sourceId: "uniswap-v4",
  protocol: "uniswap",
  version: 4,
  poolKey: stonkBrokerPoolId,
  poolAddress: null,
  token0: stonkBrokerAddress,
  token1: ROBINHOOD_WETH_ADDRESS.toLowerCase(),
  fee: 3_000,
  tickSpacing: 60,
  hooks: `0x${"0".repeat(40)}`
};
const firstCanonicalPage = Array.from({ length: 73 }, (_, index) => v2CanonicalPool(index));
const secondCanonicalPage = [firstCanonicalPage[0], v2CanonicalPool(74), stonkBrokerV4Pool];
const canonicalResult = (
  pools: VNextCanonicalMarketInventoryPool[],
  nextCursor: string | null,
  coverage = completeCoverage
): VNextCanonicalMarketInventoryResult => ({
  status: "verified_shadow",
  chainId: 4_663,
  mode: "shadow",
  authoritative: false,
  sourceManifestHash: `0x${"77".repeat(32)}`,
  coverage,
  nextCursor,
  pools
});

assert.equal(vNextCanonicalBrowseEnabled({}), false, "A missing canonical browse gate must default off");
assert.equal(vNextCanonicalBrowseEnabled({ RMT_CANONICAL_BROWSE_ENABLED: "false" }), false);
assert.equal(vNextCanonicalBrowseEnabled({ RMT_CANONICAL_BROWSE_ENABLED: "TRUE" }), false);
assert.equal(vNextCanonicalBrowseEnabled({ RMT_CANONICAL_BROWSE_ENABLED: "true" }), true);

async function verifyCanonicalBrowsePages() {
  const legacyFixture = await readVNextLegacyMarketDirectoryPage((async () => new Response(JSON.stringify([pair({
    quoteToken: { address: ROBINHOOD_WETH_ADDRESS, name: "Wrapped Ether", symbol: "WETH" }
  })]), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  })) as typeof fetch);
  assert.equal(legacyFixture.status, 200);
  assert.ok((legacyFixture.body.markets?.length ?? 0) > 0, "The factored legacy browse must remain usable while the gate is off");

  const calls: Array<string | undefined> = [];
  const readInventory = async (query: { cursor?: string }) => {
    calls.push(query.cursor);
    return query.cursor === "next_page"
      ? canonicalResult(secondCanonicalPage, null)
      : canonicalResult(firstCanonicalPage, "next_page");
  };
  const firstResponse = await readVNextCanonicalMarketDirectoryPage(
    "http://localhost/api/vnext/market-directory",
    readInventory
  );
  assert.equal(firstResponse.status, 200);
  const firstPayload = parseVNextCanonicalDirectoryResponse(firstResponse.body);
  assert.ok(firstPayload);
  assert.ok((firstPayload.markets?.length ?? 0) > VNEXT_MARKET_DIRECTORY_MAX_MARKETS, "Canonical browse must exceed the legacy 144-market cap");
  assert.equal(firstPayload.nextCursor, "next_page");

  const secondResponse = await readVNextCanonicalMarketDirectoryPage(
    "http://localhost/api/vnext/market-directory?cursor=next_page",
    readInventory
  );
  const secondPayload = parseVNextCanonicalDirectoryResponse(secondResponse.body);
  assert.ok(secondPayload);
  assert.equal(secondPayload.nextCursor, null);
  assert.deepEqual(calls, [undefined, "next_page"]);

  const combined = mergeVNextDirectoryAndSearchMarkets(firstPayload.markets ?? [], secondPayload.markets ?? []);
  assert.ok(combined.length > VNEXT_MARKET_DIRECTORY_MAX_MARKETS);
  const firstToken = combined.find((market) => market.address.toLowerCase() === firstCanonicalPage[0].token0);
  assert.equal(firstToken?.canonicalMarkets?.length, 1, "A repeated canonical identity across pages must be deduplicated");
  const stonk = combined.find((market) => market.address.toLowerCase() === stonkBrokerAddress);
  assert.ok(stonk, "STONKBROKER must be representable through canonical inventory semantics");
  assert.equal(stonk?.canonicalMarkets?.[0].poolKey, stonkBrokerPoolId);
  assert.equal(stonk?.canonicalMarkets?.[0].poolAddress, null);
  assert.equal(stonk?.canonicalMarkets?.[0].sourceId, "uniswap-v4");
  assert.equal(stonk?.canonicalMarkets?.[0].protocol, "uniswap");
  assert.equal(stonk?.canonicalMarkets?.[0].version, 4);

  const providerOnly = { ...categorized[0], address: getAddress("0x9999999999999999999999999999999999999999") };
  const omitted = mergeVNextCanonicalBrowseMarkets(combined, []);
  const providerFailure = mergeVNextCanonicalBrowseMarkets(combined, []);
  const enriched = mergeVNextCanonicalBrowseMarkets(combined, [providerOnly]);
  assert.equal(omitted.length, combined.length, "Provider omission must not erase canonical markets");
  assert.deepEqual(providerFailure, omitted, "Provider failure must leave the canonical universe intact");
  assert.equal(enriched.length, combined.length, "Provider-only output must not create canonical existence");
  assert.equal(enriched.some((market) => market.address === providerOnly.address), false);
  const legacySeedOnly = mergeVNextCanonicalBrowseMarkets(combined, [categorized[0]]);
  assert.equal(legacySeedOnly.some((market) => market.address === categorized[0].address), combined.some((market) => market.address === categorized[0].address));

  const incompleteResponse = await readVNextCanonicalMarketDirectoryPage(
    "http://localhost/api/vnext/market-directory",
    async () => canonicalResult([], null, {
      ...completeCoverage,
      complete: false,
      sources: completeCoverage.sources.map((source) => ({ ...source, status: "backfilling" as const }))
    })
  );
  assert.equal(incompleteResponse.status, 503, "Incomplete canonical inventory must fail closed for browse absence");
  assert.deepEqual(incompleteResponse.body, {
    canonical: true,
    error: "Canonical market directory is not ready."
  });

  let legacyCalls = 0;
  let canonicalCalls = 0;
  const gatedDependencies = {
    readLegacy: async () => {
      legacyCalls += 1;
      return legacyFixture;
    },
    readCanonical: async (requestUrl: string) => {
      canonicalCalls += 1;
      return readVNextCanonicalMarketDirectoryPage(requestUrl, async () => canonicalResult(firstCanonicalPage, "next_page"));
    }
  };
  const missingGate = await readVNextMarketDirectoryRequest(
    "http://localhost/api/vnext/market-directory",
    {},
    gatedDependencies
  );
  assert.equal(missingGate.status, 200);
  assert.equal("canonical" in missingGate.body, false, "A missing gate must preserve the legacy response");
  const falseGate = await readVNextMarketDirectoryRequest(
    "http://localhost/api/vnext/market-directory",
    { RMT_CANONICAL_BROWSE_ENABLED: "false" },
    gatedDependencies
  );
  assert.equal(falseGate.status, 200);
  assert.equal("canonical" in falseGate.body, false, "Complete coverage must not auto-activate canonical browse");
  assert.equal(canonicalCalls, 0);
  assert.equal(legacyCalls, 2);

  const enabledGate = await readVNextMarketDirectoryRequest(
    "http://localhost/api/vnext/market-directory",
    { RMT_CANONICAL_BROWSE_ENABLED: "true" },
    gatedDependencies
  );
  assert.equal(enabledGate.status, 200);
  assert.equal("canonical" in enabledGate.body && enabledGate.body.canonical, true);
  assert.equal(canonicalCalls, 1);
  assert.equal(legacyCalls, 2);

  let failClosedLegacyCalls = 0;
  const incompleteGate = await readVNextMarketDirectoryRequest(
    "http://localhost/api/vnext/market-directory",
    { RMT_CANONICAL_BROWSE_ENABLED: "true" },
    {
      readLegacy: async () => {
        failClosedLegacyCalls += 1;
        return legacyFixture;
      },
      readCanonical: async (requestUrl) => readVNextCanonicalMarketDirectoryPage(requestUrl, async () => canonicalResult([], null, {
        ...completeCoverage,
        complete: false,
        sources: completeCoverage.sources.map((source) => ({ ...source, status: "backfilling" as const }))
      }))
    }
  );
  assert.equal(incompleteGate.status, 503);
  assert.equal("canonical" in incompleteGate.body && incompleteGate.body.canonical, true);
  assert.equal(failClosedLegacyCalls, 0, "Enabled incomplete canonical browse must not fall back to legacy authority");

  const unavailableGate = await readVNextMarketDirectoryRequest(
    "http://localhost/api/vnext/market-directory",
    { RMT_CANONICAL_BROWSE_ENABLED: "true" },
    {
      readLegacy: async () => {
        failClosedLegacyCalls += 1;
        return legacyFixture;
      },
      readCanonical: async (requestUrl) => readVNextCanonicalMarketDirectoryPage(requestUrl, async () => ({
        status: "upstream_unavailable",
        reason: "request_failed"
      }))
    }
  );
  assert.equal(unavailableGate.status, 503);
  assert.equal("canonical" in unavailableGate.body && unavailableGate.body.canonical, true);
  assert.equal(failClosedLegacyCalls, 0, "Enabled unavailable canonical browse must not fall back to legacy authority");
}
assert.match(ecosystemRoute, /import \{ VNEXT_MARKET_DIRECTORY_MAX_MARKETS \} from "\.\.\/\.\.\/\.\.\/\.\.\/lib\/vnext\/market-directory"/);
assert.match(ecosystemRoute, /slice\(0, VNEXT_MARKET_DIRECTORY_MAX_MARKETS\)/);
assert.doesNotMatch(ecosystemRoute, /const MAX_MARKETS = 48/);
assert.match(ecosystemRoute, /readCompleteV6OriginTokensFromChain/);
assert.match(ecosystemRoute, /resolveDirectRmtOrigins/);
assert.match(ecosystemRoute, /coverage: "complete", tokens: new Set\(\[\.\.\.known, \.\.\.snapshot\.tokens\]\)/);

const firstV6Token = getAddress("0x1111111111111111111111111111111111111111");
const secondV6Token = getAddress("0x2222222222222222222222222222222222222222");
const minimalProxy = "0x363d3d373d3d3d363d7311111111111111111111111111111111111111115af43d82803e903d91602b57fd5bf3" as Hex;
const completeV6Tokens = validateCompleteV6OriginRecords(
  2n,
  [{ token: firstV6Token }, { token: secondV6Token }],
  [minimalProxy, minimalProxy]
);
assert.deepEqual([...completeV6Tokens], [firstV6Token.toLowerCase(), secondV6Token.toLowerCase()]);
assert.throws(
  () => validateCompleteV6OriginRecords(2n, [{ token: firstV6Token }], [minimalProxy]),
  /incomplete/
);
assert.throws(
  () => validateCompleteV6OriginRecords(2n, [{ token: firstV6Token }, { token: firstV6Token }], [minimalProxy, minimalProxy]),
  /duplicate/
);
assert.throws(
  () => validateCompleteV6OriginRecords(1n, [{ token: firstV6Token }], ["0x6000" as Hex]),
  /unexpected token runtime/
);
assert.throws(
  () => validateCompleteV6OriginRecords(MAX_DIRECT_V6_ORIGIN_RECORDS + 1n, [], []),
  /exceeds the bounded origin fallback/
);
assert.match(identityRoute, /readRobinhoodTokenIdentity/);
assert.doesNotMatch(identityRoute, /discoverPools|fetchRobinhoodStockRegistry|external-availability|quote/);
assert.match(shell, /visibleVNextMarketDirectoryMarkets\(filteredMarkets, visibleMarketLimit\)/);
assert.match(shell, /useState<VNextMarketDirectoryView>\("active"\)/);
assert.match(shell, /current \+ VNEXT_MARKET_DIRECTORY_PAGE_SIZE/);
const localPagination = shell.slice(shell.indexOf("const loadMoreMarkets"), shell.indexOf("const requestTradeSide"));
assert.doesNotMatch(localPagination, /fetch\(|refresh\(|selectAddress\(|quote/i);

void verifyCanonicalBrowsePages().then(() => {
  console.log("RMT VNext market directory smoke checks passed.");
});
