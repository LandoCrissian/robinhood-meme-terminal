export type VNextUpVenue = "up-v2" | "up-cl";

export type VNextUpGaugeState = "none" | "live" | "inactive" | "unavailable";

export type VNextUpMarketIntelligence = Readonly<{
  venue: VNextUpVenue;
  poolAddress: string;
  token0: string;
  token1: string;
  quoteToken: string;
  stable: boolean | null;
  tickSpacing: number | null;
  liveFee: number;
  feeDenominator: 10_000 | 1_000_000;
  gaugeState: VNextUpGaugeState;
  gaugeAddress: string | null;
  gaugeWeight: string | null;
  gaugeClaimable: string | null;
  feesAddress: string | null;
  bribeAddress: string | null;
}>;

export type VNextEcosystemIntelligence = Readonly<{
  chainId: 4_663;
  token: string;
  status: "ready" | "partial" | "unavailable";
  authoritative: boolean;
  observedBlock: string | null;
  observedBlockHash: string | null;
  observedAt: string;
  upMarkets: readonly VNextUpMarketIntelligence[];
  stonkBrokers: Readonly<{
    sourceId: "stonkbrokers";
    sourceName: "StonkBrokers";
    attributionState: "production-source-unverified";
    tokenCreated: false;
    sourceListed: false;
    authoritative: false;
  }>;
}>;

export function unavailableVNextEcosystemIntelligence(
  token: string,
  observedAt = new Date().toISOString()
): VNextEcosystemIntelligence {
  return Object.freeze({
    chainId: 4_663,
    token,
    status: "unavailable",
    authoritative: false,
    observedBlock: null,
    observedBlockHash: null,
    observedAt,
    upMarkets: Object.freeze([]),
    stonkBrokers: Object.freeze({
      sourceId: "stonkbrokers",
      sourceName: "StonkBrokers",
      attributionState: "production-source-unverified",
      tokenCreated: false,
      sourceListed: false,
      authoritative: false
    })
  });
}
