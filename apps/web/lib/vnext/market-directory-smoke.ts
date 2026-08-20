import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getAddress, type Hex } from "viem";
import type { ExternalMarketResponse, UniversalMarketResolution } from "../external-market";
import { buildAssetMarketRecord } from "../external-market";
import { normalizeProviderPairForAsset } from "../external-market-identity";
import {
  MAX_DIRECT_V6_ORIGIN_RECORDS,
  validateCompleteV6OriginRecords
} from "../server/launch-feed";
import { assetKey } from "./execution-domain";
import {
  VNEXT_MARKET_DIRECTORY_MAX_MARKETS,
  VNEXT_MARKET_DIRECTORY_PAGE_SIZE,
  directoryMarketFromExactLookup,
  directoryMarketFromVerifiedIdentity,
  normalizeDirectoryMarkets,
  resolutionFromLookup,
  selectVNextMarketDirectoryView,
  visibleVNextMarketDirectoryMarkets,
  verifiedDirectoryAsset,
  vNextRwaClassificationLabel,
  vNextMarketDirectoryViewCounts
} from "./market-directory";
import { ROBINHOOD_RMT, ROBINHOOD_RMT_ADDRESS } from "./robinhood-assets";

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
assert.equal(markets[1].liquidityUsd, 0);
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
assert.equal(identityOnlyMarket?.marketDataState, "identity-only");
assert.equal(identityOnlyMarket?.priceUsd, null);
assert.equal(identityOnlyMarket?.liquidityUsd, null);
assert.equal(identityOnlyMarket?.volume24h, null);
assert.equal(identityOnlyMarket?.marketCapUsd, null);
assert.equal(identityOnlyMarket?.resolution, resolution);
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
const ecosystemRoute = readFileSync(new URL("../../app/api/markets/external/route.ts", import.meta.url), "utf8");
const identityRoute = readFileSync(new URL("../../app/api/vnext/asset-identity/route.ts", import.meta.url), "utf8");
const shell = readFileSync(new URL("../../app/vnext/vnext-terminal-shell.tsx", import.meta.url), "utf8");
assert.match(hook, /fetch\("\/api\/vnext\/market-directory"/);
assert.match(hook, /fetch\("\/api\/markets\/external"/);
const selectAddressSource = hook.slice(hook.indexOf("const selectAddress"), hook.indexOf("const refresh ="));
assert.match(selectAddressSource, /URLSearchParams\(\{ address \}\)/);
assert.match(selectAddressSource, /URLSearchParams\(\{ contract: address \}\)/);
assert.match(selectAddressSource, /\/api\/vnext\/asset-identity/);
assert.match(selectAddressSource, /directoryMarketFromVerifiedIdentity/);
assert.match(selectAddressSource, /\/api\/markets\/external/);
assert.match(selectAddressSource, /directoryMarketFromExactLookup/);
assert.match(selectAddressSource, /Promise\.allSettled/);
assert.match(hook, /publishMarkets/);
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
assert.match(route, /token-pairs\/v1/);
assert.match(route, /Promise\.all\(DIRECTORY_TOKENS/);
assert.match(route, /buildAssetMarketRecord\(evidenceList, \{ requireChart: true \}\)/);
assert.match(route, /normalizeProviderPairForAsset/);
assert.doesNotMatch(route, /market\.liquidityUsd > existing\.liquidityUsd/);
assert.match(route, /\[ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS, ROBINHOOD_RMT_ADDRESS\] as const/);
assert.match(route, /slice\(0, VNEXT_MARKET_DIRECTORY_MAX_MARKETS\)/);
assert.equal((route.match(/fetchPairs\(/g) ?? []).length, 2);
assert.match(route, /address\.toLowerCase\(\) === zeroAddress/);
assert.match(route, /stale-while-revalidate=60/);
assert.doesNotMatch(route, /resolveRmtOrigins|external-availability|external-sushi-quote|external-uniswap|router|reactor/);
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
assert.match(shell, /current \+ VNEXT_MARKET_DIRECTORY_PAGE_SIZE/);
const localPagination = shell.slice(shell.indexOf("const loadMoreMarkets"), shell.indexOf("const requestTradeSide"));
assert.doesNotMatch(localPagination, /fetch\(|refresh\(|selectAddress\(|quote/i);

console.log("RMT VNext market directory smoke checks passed.");
