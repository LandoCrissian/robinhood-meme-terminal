import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./server/sushi-launch-feed-smoke";
import "./server/gecko-new-pool-feed-smoke";
import "./server/dex-discovery-metadata-smoke";
import {
  externalProjectProvenanceDescription,
  externalProjectProvenanceLabel,
  buildAssetMarketRecord,
  selectPrimaryAssetMarket,
  selectPreferredLifecycleMarket
} from "./external-market";
import {
  canonicalExternalAssetId,
  canonicalExternalPoolIdentity,
  canonicalExternalMarketLookupAddress,
  isNonzeroEvmAddress,
  normalizeProviderPairForAsset,
  selectExternalPairBaseToken,
  selectExternalPairBaseTokenWithAssetQuotes
} from "./external-market-identity";
import {
  externalMarketSocialsFromPairInfo,
  mergeExternalSocialLinks
} from "./external-market-socials";
import {
  marketDistributionPassport,
  UNISWAP_LAUNCHES_ANNOUNCEMENT_URL,
  UNISWAP_LAUNCHPAD_DEPLOYMENTS_URL
} from "./launch-distribution";

const syntheticAddress = (character: string) => ("0x" + character.repeat(40)) as `0x${string}`;
const zero = { address: "0x0000000000000000000000000000000000000000", name: "Ether" };
const wrappedNative = { address: syntheticAddress("a"), name: "Wrapped Ether" };
const external = { address: syntheticAddress("b"), name: "External token" };
const excluded = new Set([wrappedNative.address.toLowerCase()]);
const stockToken = { address: syntheticAddress("c"), name: "Canonical Stock Token" };
const stockTokens = new Set([stockToken.address.toLowerCase()]);
const otherExternal = { address: syntheticAddress("d"), name: external.name, symbol: "SAME" };
const poolA = syntheticAddress("1");
const poolB = syntheticAddress("2");
const bytes32Pool = `0x${"3".repeat(64)}`;

function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: "robinhood",
    pairAddress: poolA,
    dexId: "uniswap-v3",
    baseToken: { ...external, symbol: "SAME" },
    quoteToken: { ...wrappedNative, symbol: "WETH" },
    priceUsd: "0.014",
    liquidity: { usd: 20_000 },
    marketCap: 1_000_000,
    fdv: 1_100_000,
    volume: { h24: 8_000 },
    priceChange: { h24: 2 },
    pairCreatedAt: 1_700_000_000_000,
    ...overrides
  };
}

const evidenceOptions = {
  chainId: 4_663 as const,
  chainSlug: "robinhood",
  canonicalQuoteAddresses: excluded,
  provenance: "dexscreener-token-pairs" as const
};

const baseEvidence = normalizeProviderPairForAsset(pair(), external.address, evidenceOptions)!;
assert.equal(baseEvidence.assetSide, "BASE");
assert.equal(baseEvidence.displayEligibility, "eligible");
assert.equal(baseEvidence.priceUsd, 0.014);
assert.equal(baseEvidence.pool.kind, "evm-address");
assert.equal(baseEvidence.executionEligibility, "view-only");
assert.equal(baseEvidence.assetId, canonicalExternalAssetId(4_663, external.address));

const quoteEvidence = normalizeProviderPairForAsset(pair({
  baseToken: { ...wrappedNative, symbol: "WETH" },
  quoteToken: { ...external, symbol: "SAME" },
  priceUsd: "500",
  liquidity: { usd: 999_999_999 },
  marketCap: 9_999_999_999,
  fdv: 9_999_999_999,
  priceChange: { h24: 500 }
}), external.address, evidenceOptions)!;
assert.equal(quoteEvidence.assetSide, "QUOTE");
assert.equal(quoteEvidence.displayEligibility, "invalid-token-perspective");
assert.equal(quoteEvidence.priceUsd, null, "Base-token price must never be assigned to the requested quote token");
assert.equal(quoteEvidence.marketCapUsd, null);
assert.equal(quoteEvidence.fdvUsd, null);
assert.equal(quoteEvidence.priceChange24h, null);
assert.equal(quoteEvidence.liquidityUsd, 999_999_999, "Pair-level liquidity remains market evidence, not asset valuation");
assert.equal(selectPrimaryAssetMarket([quoteEvidence, baseEvidence], { requireChart: true }), baseEvidence, "Malformed quote-side magnitude cannot hijack primary selection");

const secondEvidence = normalizeProviderPairForAsset(pair({ pairAddress: poolB, liquidity: { usd: 30_000 }, volume: { h24: 9_000 } }), external.address, evidenceOptions)!;
assert.equal(selectPrimaryAssetMarket([baseEvidence, secondEvidence], { requireChart: true }), secondEvidence);
const multiPoolRecord = buildAssetMarketRecord([baseEvidence, quoteEvidence, secondEvidence, secondEvidence], { requireChart: true })!;
assert.equal(multiPoolRecord.verifiedMarkets.length, 2, "Duplicate venue/pool evidence must be rejected deterministically");
assert.equal(multiPoolRecord.verifiedMarkets.find((market) => market.pool.value === poolA)?.assetSide, "BASE", "Valid token perspective wins contradictory duplicate provider evidence");
assert.equal(multiPoolRecord.primaryMarket?.pool.value, secondEvidence.pool.value);

const v4Evidence = normalizeProviderPairForAsset(pair({
  pairAddress: bytes32Pool,
  dexId: "uniswap",
  quoteToken: { address: zero.address, name: "Ether", symbol: "ETH" },
  liquidity: { usd: 3_000_000 }
}), external.address, evidenceOptions)!;
assert.equal(v4Evidence.pool.kind, "bytes32");
assert.equal(v4Evidence.protocolVersion, 4);
assert.equal(v4Evidence.chartEligibility, "unavailable");
assert.equal(selectPrimaryAssetMarket([v4Evidence, baseEvidence])?.pool.value, bytes32Pool);
assert.equal(selectPrimaryAssetMarket([v4Evidence, baseEvidence], { requireChart: true }), baseEvidence, "Address-only chart support must not silently receive a bytes32 pool ID");
assert.equal(canonicalExternalPoolIdentity(bytes32Pool)?.kind, "bytes32");
assert.equal(canonicalExternalPoolIdentity("0x1234"), null);
assert.equal(normalizeProviderPairForAsset(pair({ chainId: "ethereum" }), external.address, evidenceOptions), null);
assert.equal(normalizeProviderPairForAsset(pair({ pairAddress: "malformed" }), external.address, evidenceOptions), null);

const missingPrice = normalizeProviderPairForAsset(pair({ priceUsd: undefined }), external.address, evidenceOptions)!;
assert.equal(missingPrice.displayEligibility, "missing-price");
assert.equal(selectPrimaryAssetMarket([missingPrice]), null);
const missingLiquidity = normalizeProviderPairForAsset(pair({ liquidity: {} }), external.address, evidenceOptions)!;
assert.equal(missingLiquidity.liquidityUsd, null);
assert.equal(selectPrimaryAssetMarket([missingLiquidity]), missingLiquidity);

const tiedHigh = normalizeProviderPairForAsset(pair({ pairAddress: poolB }), external.address, evidenceOptions)!;
assert.equal(selectPrimaryAssetMarket([tiedHigh, baseEvidence])?.pool.value, poolA, "Pool identity is the deterministic final tie-break");

const sameSymbolDifferentContract = normalizeProviderPairForAsset(pair({
  pairAddress: syntheticAddress("4"),
  baseToken: otherExternal
}), otherExternal.address, evidenceOptions)!;
assert.notEqual(baseEvidence.assetId, sameSymbolDifferentContract.assetId);
assert.equal(buildAssetMarketRecord([baseEvidence, sameSymbolDifferentContract]), null, "Different contracts sharing a symbol/name must never merge");

const workspaceHook = readFileSync(new URL("../app/vnext/use-vnext-asset-workspace.ts", import.meta.url), "utf8");
const workspaceView = readFileSync(new URL("../app/vnext/vnext-asset-workspace.tsx", import.meta.url), "utf8");
const marketDirectoryDomain = readFileSync(new URL("vnext/market-directory.ts", import.meta.url), "utf8");
const executionDiscovery = readFileSync(new URL("server/external-trade-venues.ts", import.meta.url), "utf8");
assert.match(workspaceHook, /primaryPair\.toLowerCase\(\) === expectedPair\.toLowerCase\(\)/, "Workspace market evidence must match the directory primary pool");
assert.doesNotMatch(workspaceView, /resolution\?\.pools\[0\]\?\.poolAddress/, "Chart selection must not silently fall back to an unrelated resolver pool");
assert.match(workspaceView, /selectVNextChartPool/);
assert.match(marketDirectoryDomain, /chartEligibility === "eligible"/);
assert.match(executionDiscovery, /verifyUniswapV4/);
assert.doesNotMatch(executionDiscovery, /primaryMarket|selectPrimaryAssetMarket/, "Display primary must not grant execution authority");

assert.equal(isNonzeroEvmAddress(zero.address), false, "The native zero-address sentinel is not an ERC-20 trade target");
assert.equal(isNonzeroEvmAddress(external.address), true);
assert.equal(isNonzeroEvmAddress("0x1234"), false);
assert.equal(isNonzeroEvmAddress("NATIVE"), false);
assert.equal(
  canonicalExternalMarketLookupAddress(`  ${external.address.toUpperCase()}  `),
  external.address.toLowerCase(),
  "A complete contract search must be whitespace- and case-insensitive"
);
assert.equal(canonicalExternalMarketLookupAddress("0x1234"), null);
assert.equal(canonicalExternalMarketLookupAddress(zero.address), null);

const discoveredSocials = externalMarketSocialsFromPairInfo({
  websites: [{ url: "https://runner.example/" }, { url: "javascript:alert(1)" }],
  socials: [
    { type: "twitter", url: "https://x.com/runner" },
    { type: "telegram", url: "https://t.me/runner" },
    { type: "discord", url: "https://evil.example/invite" },
    { type: "warpcast", url: "https://warpcast.com/runner" }
  ]
});
assert.deepEqual(discoveredSocials, {
  website: "https://runner.example/",
  x: "https://x.com/runner",
  telegram: "https://t.me/runner",
  discord: null,
  farcaster: "https://warpcast.com/runner",
  provenance: "dex-pair-metadata"
});
assert.equal(externalMarketSocialsFromPairInfo({
  websites: [{ url: "http://runner.example" }],
  socials: [{ type: "twitter", url: "https://evil.example/runner" }]
}), undefined, "Unsafe or mislabeled social links must fail closed");
assert.deepEqual(mergeExternalSocialLinks({
  website: null,
  x: "https://x.com/verified",
  telegram: null,
  discord: null,
  farcaster: null
}, discoveredSocials), {
  website: "https://runner.example/",
  x: "https://x.com/verified",
  telegram: "https://t.me/runner",
  discord: null,
  farcaster: "https://warpcast.com/runner"
}, "Verified project links must win while provider metadata fills missing channels");

assert.equal(
  selectExternalPairBaseToken(external, wrappedNative, excluded),
  external,
  "An eligible external base quoted against a canonical market asset may be ranked"
);
assert.equal(
  selectExternalPairBaseToken(zero, external, excluded),
  undefined,
  "A zero-address base must not transfer its price and valuation metrics to the quote token"
);
assert.equal(
  selectExternalPairBaseToken(wrappedNative, external, excluded),
  undefined,
  "A canonical base must not transfer its price and valuation metrics to an external quote token"
);
assert.equal(
  selectExternalPairBaseToken({ address: "not-an-address", name: "Malformed" }, wrappedNative, excluded),
  undefined,
  "Malformed base-token metadata must fail closed"
);
assert.equal(
  selectExternalPairBaseToken(external, { address: syntheticAddress("c"), name: "Unknown quote" }, excluded),
  undefined,
  "An unrecognized quote asset must fail closed"
);
assert.equal(
  selectExternalPairBaseTokenWithAssetQuotes(external, stockToken, excluded, stockTokens),
  external,
  "A project token quoted against an official Stock Token may be discovered"
);
assert.equal(
  selectExternalPairBaseTokenWithAssetQuotes(stockToken, wrappedNative, excluded, stockTokens),
  stockToken,
  "An official Stock Token quoted against wrapped native remains independently discoverable"
);
assert.equal(
  selectExternalPairBaseTokenWithAssetQuotes(stockToken, external, excluded, stockTokens),
  undefined,
  "A reversed Stock Token/project pair must not transfer base-token metrics to the quote token"
);

const curveMarket = {
  venue: {
    kind: "external-launchpad",
    sourceId: "circus",
    market: syntheticAddress("b"),
    execution: "read-only"
  } as const,
  liquidityUsd: 50_000,
  momentumScore: 99,
  pairAddress: syntheticAddress("c")
};
const dexMarket = {
  venue: {
    kind: "dex",
    dexId: "uniswap",
    pairAddress: syntheticAddress("d"),
    url: "https://dexscreener.com/robinhood/" + syntheticAddress("d"),
    execution: "read-only"
  } as const,
  liquidityUsd: 5_000,
  momentumScore: 40,
  pairAddress: syntheticAddress("d")
};
assert.equal(
  selectPreferredLifecycleMarket(curveMarket, dexMarket),
  dexMarket,
  "A DEX market must replace a stale curve record after graduation"
);
assert.equal(
  selectPreferredLifecycleMarket(dexMarket, curveMarket),
  dexMarket,
  "A delayed curve snapshot must never replace a discovered DEX market"
);

const lemonProject = {
  sourceId: "lemon",
  sourceName: "Lemon",
  provenance: "public-api-and-dex-pool-cross-checked",
  creator: syntheticAddress("d"),
  launchPool: syntheticAddress("e"),
  name: "Lemon project",
  symbol: "LEMON",
  description: "",
  imageUri: null,
  socials: { x: null, telegram: null, discord: null, website: null, farcaster: null }
} as const;
assert.equal(
  externalProjectProvenanceLabel(lemonProject),
  "Lemon · API + DEX pool matched",
  "Lemon identity must not be described as factory-derived"
);
assert.match(
  externalProjectProvenanceDescription(lemonProject),
  /documented public API.*token and launch pool match the live DEX pair/,
  "Lemon provenance disclosure must state the actual cross-check boundary"
);

const ponsUniswapMarket = {
  ...dexMarket,
  address: external.address,
  name: "Pons market",
  symbol: "PONS",
  dexId: "uniswap-v3",
  project: {
    ...lemonProject,
    sourceId: "pons",
    sourceName: "Pons",
    provenance: "factory-and-token-cross-checked"
  },
  origin: { kind: "external", state: "unknown", coverage: "unavailable" },
  url: "https://dexscreener.com/robinhood/" + dexMarket.pairAddress
} as unknown as Parameters<typeof marketDistributionPassport>[0];
const ponsPassport = marketDistributionPassport(ponsUniswapMarket);
assert.equal(ponsPassport.venue, "uniswap");
assert.equal(ponsPassport.state, "recognized-source-market");
assert.equal(ponsPassport.isAttributedLaunch, true);
assert.match(ponsPassport.summary, /Verified project provenance/);
assert.equal(ponsPassport.steps[0]?.tone, "verified");
assert.equal(ponsPassport.steps[1]?.tone, "verified");
assert.equal(ponsPassport.steps[2]?.tone, "candidate");
assert.equal(ponsPassport.steps[2]?.evidenceUrl, UNISWAP_LAUNCHES_ANNOUNCEMENT_URL);
assert.match(UNISWAP_LAUNCHPAD_DEPLOYMENTS_URL, /developers\.uniswap\.org/);

const unattributedPassport = marketDistributionPassport({
  ...ponsUniswapMarket,
  project: undefined
});
assert.equal(unattributedPassport.state, "market-live");
assert.equal(unattributedPassport.isAttributedLaunch, false);
assert.match(unattributedPassport.steps[0]?.detail ?? "", /does not prove which platform created the token/);
assert.match(unattributedPassport.steps[2]?.detail ?? "", /does not establish project provenance/);

const sushiPassport = marketDistributionPassport({
  ...ponsUniswapMarket,
  dexId: "sushiswap-v3",
  venue: {
    kind: "dex",
    dexId: "sushiswap-v3",
    pairAddress: ponsUniswapMarket.pairAddress,
    url: ponsUniswapMarket.url,
    execution: "read-only"
  }
});
assert.equal(sushiPassport.venue, "sushi");
assert.equal(sushiPassport.state, "announced-watch");
assert.match(sushiPassport.steps[2]?.detail ?? "", /keeps identity evidence separate/);

const verifiedSushiLaunchPassport = marketDistributionPassport({
  ...ponsUniswapMarket,
  dexId: "sushiswap-v3",
  project: {
    ...lemonProject,
    sourceId: "sushi",
    sourceName: "Sushi Launch"
  },
  venue: {
    kind: "dex",
    dexId: "sushiswap-v3",
    pairAddress: ponsUniswapMarket.pairAddress,
    url: ponsUniswapMarket.url,
    execution: "read-only"
  }
});
assert.equal(verifiedSushiLaunchPassport.state, "recognized-source-market");
assert.equal(verifiedSushiLaunchPassport.shortLabel, "Verified provenance");
assert.equal(verifiedSushiLaunchPassport.steps[2]?.tone, "verified");
assert.match(verifiedSushiLaunchPassport.steps[2]?.detail ?? "", /does not imply a partnership/);

console.info("External market address integrity validation passed");
