import type { MarketVenue, OriginCoverage, TokenOrigin } from "@rmt/shared/market-origin";
import type { ExternalMarketRiskFlag, ExternalMarketSignal } from "./external-market-ranking";

export type ExternalDexVenue = Extract<MarketVenue, { kind: "dex" }>;

export type ExternalMarket = {
  address: string;
  name: string;
  symbol: string;
  pairAddress: string;
  url: string;
  dexId: string;
  origin: TokenOrigin;
  venue: ExternalDexVenue;
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
  originCoverage?: OriginCoverage;
  rmtOriginCoverage?: OriginCoverage;
  updatedAt?: string;
  stale?: boolean;
  error?: string;
};
