import type { MarketVenue, OriginCoverage, TokenOrigin } from "@rmt/shared/market-origin";
import type { ExternalMarketRiskFlag, ExternalMarketSignal } from "./external-market-ranking";

export type ExternalMarketVenue = Extract<MarketVenue, { kind: "dex" | "external-launchpad" }>;

export type ExternalProjectMetadata = {
  sourceId: "pons" | "lemon" | "noxa" | "circus";
  sourceName: "Pons" | "Lemon" | "Noxa" | "Circus";
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
  socials: {
    x: string | null;
    telegram: string | null;
    discord: string | null;
    website: string | null;
    farcaster: string | null;
  };
};

export type ExternalMarket = {
  address: string;
  name: string;
  symbol: string;
  pairAddress: string;
  url: string;
  dexId: string;
  project?: ExternalProjectMetadata;
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
};

export type ExternalMarketResponse = {
  markets?: ExternalMarket[];
  source?: string;
  rankingVersion?: string;
  thresholds?: Record<string, number>;
  originCoverage?: OriginCoverage;
  rmtOriginCoverage?: OriginCoverage;
  updatedAt?: string;
  stale?: boolean;
  error?: string;
};

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
