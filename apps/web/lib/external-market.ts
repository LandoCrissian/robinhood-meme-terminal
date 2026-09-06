import type { MarketVenue, OriginCoverage, TokenOrigin } from "@rmt/shared/market-origin";
import type { ExternalMarketRiskFlag, ExternalMarketSignal } from "./external-market-ranking";

export type ExternalMarketVenue = Extract<MarketVenue, { kind: "dex" | "external-launchpad" }>;

export type ExternalMarketAssetSide = "BASE" | "QUOTE";

export type ExternalPoolIdentity =
  | { kind: "evm-address"; value: string }
  | { kind: "bytes32"; value: string };

export type AssetMarketEvidence = {
  chainId: 4663;
  assetId: string;
  token: { address: string; name: string; symbol: string };
  venue: string;
  protocolVersion: 2 | 3 | 4 | null;
  pool: ExternalPoolIdentity;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  assetSide: ExternalMarketAssetSide;
  displayEligibility: "eligible" | "invalid-token-perspective" | "unsupported-quote" | "missing-price";
  chartEligibility: "eligible" | "unavailable";
  executionEligibility: "view-only";
  provenance: "dexscreener-token-pairs" | "dexscreener-token-batch" | "geckoterminal-pool-feed";
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  fdvUsd: number | null;
  volume24h: number | null;
  priceChange24h: number | null;
  pairCreatedAt: number | null;
};

export type AssetMarketRecord = {
  assetId: string;
  token: AssetMarketEvidence["token"];
  primaryMarket: AssetMarketEvidence | null;
  verifiedMarkets: AssetMarketEvidence[];
};

export type ExternalSocialLinks = {
  x: string | null;
  telegram: string | null;
  discord: string | null;
  website: string | null;
  farcaster: string | null;
};

export type ExternalMarketSocials = ExternalSocialLinks & {
  provenance: "dex-pair-metadata";
};

export type UniversalMarketPool = {
  venue: "uniswap-v2" | "uniswap-v3" | "sushi-v2" | "sushi-v3";
  protocolVersion: 2 | 3;
  poolAddress: string;
  token0: string;
  token1: string;
  quoteToken: string;
  fee: number | null;
  canonical: true;
  execution: "route-check-required" | "view-only";
};

export type UniversalMarketResolution = {
  chainId: 4663;
  requestedAddress: string;
  requestedKind: "token" | "pool";
  status: "pool-found" | "token-only";
  token: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: string;
  };
  pools: UniversalMarketPool[];
  marketData: "live-provider" | "identity-only";
  execution: "route-check-required" | "view-only";
  provenance: "robinhood-chain-contract-reads";
  resolvedAt: string;
};

export type RobinhoodStockAssetRelationship = {
  relationship: "canonical-stock-token" | "paired-market-asset";
  assetId: string;
  tokenSymbol: string;
  tokenName: string;
  contractAddress: string;
  currentMultiplier: string;
  status: "active" | "inactive";
  logoUrl: string | null;
  provenance: "robinhood-live-asset-registry";
};

export type ExternalProjectMetadata = {
  sourceId: "pons" | "pons-v2" | "lemon" | "noxa" | "circus" | "sushi" | "stonkbrokers-safe-launch";
  sourceName: "Pons" | "Pons V2" | "Lemon" | "Lemon.fun" | "Noxa" | "Circus" | "Sushi Launch" | "StonkBrokers Smart/Safe Launch";
  provenance:
    | "factory-and-token-cross-checked"
    | "launchpad-and-token-cross-checked"
    | "public-api-and-dex-pool-cross-checked";
  creator: string;
  launchPool: string;
  name: string;
  symbol: string;
  description: string;
  imageUri: string | null;
  socials: ExternalSocialLinks;
};

export type LaunchpadLifecycleEvidence = {
  sourceId: "stonkbrokers-safe-launch" | "sushi-launch" | "pons-v1" | "pons-v2" | "lemon-fun" | "circus";
  sourceName: "StonkBrokers Smart/Safe Launch" | "Sushi Launch" | "Pons V1" | "Pons V2" | "Lemon.fun" | "Circus";
  version: "v1" | "v2" | "current";
  factory: string;
  creator: string;
  launchId: string | null;
  launchBlock: string | null;
  launchTransactionHash: string | null;
  state: "created" | "curve-live" | "armed" | "swept" | "graduated" | "aborted";
  current: boolean;
  metricsState: "observed" | "unavailable";
  venue: {
    kind: "bonding-curve" | "source-market" | "canonical-pool" | "launch-pending" | "unavailable";
    address: string | null;
    poolId: string | null;
  };
  activity: {
    buys1h: number | null;
    sells1h: number | null;
    buys24h: number | null;
    sells24h: number | null;
    volumeQuote24h: number | null;
    lastActivityAt: string | null;
  };
  provenance:
    | "verified-contract-state-and-events"
    | "verified-factory-and-token-state"
    | "verified-public-feed-and-contract-state";
};

export function externalProjectProvenanceLabel(project: ExternalProjectMetadata) {
  if (project.provenance === "public-api-and-dex-pool-cross-checked") {
    return project.sourceName + " · API + DEX pool matched";
  }
  if (project.provenance === "launchpad-and-token-cross-checked") {
    return project.sourceName + " · Launchpad + token matched";
  }
  return project.sourceName + " · Factory + token matched";
}

export function externalProjectProvenanceDescription(project: ExternalProjectMetadata) {
  if (project.provenance === "public-api-and-dex-pool-cross-checked") {
    return project.sourceName
      + " project identity comes from its documented public API and is attached only after the token and launch pool match the live DEX pair.";
  }
  if (project.provenance === "launchpad-and-token-cross-checked") {
    return project.sourceName
      + " project identity is attached only after its launchpad and token records agree.";
  }
  return project.sourceName
    + " project metadata is read onchain and attached only after its factory and token records agree.";
}

export type ExternalMarket = {
  assetId?: string;
  address: string;
  name: string;
  symbol: string;
  imageUri?: string;
  pairAddress: string;
  url: string;
  dexId: string;
  stockAssetRelationships?: RobinhoodStockAssetRelationship[];
  project?: ExternalProjectMetadata;
  launchpadEvidence?: LaunchpadLifecycleEvidence[];
  socials?: ExternalMarketSocials;
  resolution?: UniversalMarketResolution;
  origin: TokenOrigin;
  venue: ExternalMarketVenue;
  curve?: {
    sourceId: "circus";
    state: "curve-live";
    progressBps: number;
    ethRaised: number;
    tokensSold: string;
    curveSupply: string;
    volumeQuoteEth: number;
    uniqueTraders: number;
    tradeDiversity: number;
    graduated: false;
    migrated: false;
    dataSource: "circus-public-feed-cross-checked-onchain";
  };
  priceUsd: number;
  liquidityUsd: number;
  marketCapUsd: number;
  fdvUsd: number;
  volume5m: number;
  volume1h: number;
  volume24h: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange24h: number;
  buys5m: number;
  sells5m: number;
  buys1h: number;
  sells1h: number;
  buys24h: number;
  sells24h: number;
  pairCreatedAt: number | null;
  ageMinutes: number | null;
  momentumScore: number;
  buyPressureBps: number;
  signal: ExternalMarketSignal;
  riskFlags: ExternalMarketRiskFlag[];
  primaryMarket?: AssetMarketEvidence;
  verifiedMarkets?: AssetMarketEvidence[];
};

export type ExternalMarketResponse = {
  discoveryCoverage?: import("./vnext/bounded-discovery").BoundedDiscoveryCoverage;
  quarantinedAddresses?: string[];
  markets?: ExternalMarket[];
  assetRecords?: AssetMarketRecord[];
  directoryAdmission?: "admitted" | "not_admitted";
  listingAdmission?: "not_listed" | "not_found";
  resolution?: UniversalMarketResolution;
  source?: string;
  rankingVersion?: string;
  thresholds?: Record<string, number>;
  originCoverage?: OriginCoverage;
  rmtOriginCoverage?: OriginCoverage;
  stockAssetCoverage?: "complete" | "stale" | "unavailable";
  delayedSources?: string[];
  updatedAt?: string;
  stale?: boolean;
  error?: string;
};

function marketEvidenceKey(market: AssetMarketEvidence) {
  return `${market.venue.toLowerCase()}:${market.pool.kind}:${market.pool.value.toLowerCase()}`;
}

function comparePrimaryEvidence(left: AssetMarketEvidence, right: AssetMarketEvidence) {
  const eligibilityRank = (market: AssetMarketEvidence) => market.displayEligibility === "eligible" && market.assetSide === "BASE" ? 0 : 1;
  const eligibilityDifference = eligibilityRank(left) - eligibilityRank(right);
  if (eligibilityDifference !== 0) return eligibilityDifference;
  const leftLiquidity = left.liquidityUsd ?? -1;
  const rightLiquidity = right.liquidityUsd ?? -1;
  if (leftLiquidity !== rightLiquidity) return rightLiquidity - leftLiquidity;
  const leftVolume = left.volume24h ?? -1;
  const rightVolume = right.volume24h ?? -1;
  if (leftVolume !== rightVolume) return rightVolume - leftVolume;
  return marketEvidenceKey(left).localeCompare(marketEvidenceKey(right));
}

export function selectPrimaryAssetMarket(
  markets: readonly AssetMarketEvidence[],
  options: { requireChart?: boolean } = {}
) {
  const assetIds = new Set(markets.map((market) => market.assetId.toLowerCase()));
  if (assetIds.size > 1) return null;
  const eligible = markets.filter((market) => (
    market.displayEligibility === "eligible"
    && market.assetSide === "BASE"
    && market.priceUsd !== null
    && market.priceUsd > 0
    && (!options.requireChart || market.chartEligibility === "eligible")
  ));
  return [...eligible].sort(comparePrimaryEvidence)[0] ?? null;
}

export function buildAssetMarketRecord(
  markets: readonly AssetMarketEvidence[],
  options: { requireChart?: boolean } = {}
): AssetMarketRecord | null {
  if (markets.length === 0) return null;
  const assetId = markets[0].assetId;
  if (markets.some((market) => market.assetId.toLowerCase() !== assetId.toLowerCase())) return null;
  const deduplicated = new Map<string, AssetMarketEvidence>();
  for (const market of markets) {
    const key = marketEvidenceKey(market);
    const existing = deduplicated.get(key);
    if (!existing || comparePrimaryEvidence(market, existing) < 0) deduplicated.set(key, market);
  }
  const verifiedMarkets = [...deduplicated.values()].sort((left, right) => marketEvidenceKey(left).localeCompare(marketEvidenceKey(right)));
  return {
    assetId,
    token: markets[0].token,
    primaryMarket: selectPrimaryAssetMarket(verifiedMarkets, options),
    verifiedMarkets
  };
}

type LifecycleComparableMarket = Pick<
  ExternalMarket,
  "venue" | "liquidityUsd" | "momentumScore" | "pairAddress"
>;

export function selectPreferredLifecycleMarket<
  Existing extends LifecycleComparableMarket,
  Candidate extends LifecycleComparableMarket
>(
  existing: Existing | undefined,
  candidate: Candidate
): Existing | Candidate {
  if (!existing) return candidate;
  if (existing.venue.kind !== candidate.venue.kind) {
    return candidate.venue.kind === "dex" ? candidate : existing;
  }
  if (candidate.liquidityUsd !== existing.liquidityUsd) {
    return candidate.liquidityUsd > existing.liquidityUsd ? candidate : existing;
  }
  if (candidate.momentumScore !== existing.momentumScore) {
    return candidate.momentumScore > existing.momentumScore ? candidate : existing;
  }
  return candidate.pairAddress.toLowerCase().localeCompare(existing.pairAddress.toLowerCase()) < 0
    ? candidate
    : existing;
}
