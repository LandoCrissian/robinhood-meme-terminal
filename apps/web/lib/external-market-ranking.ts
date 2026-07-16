export type ExternalMarketSignal = "moving" | "early" | "active";

export type ExternalMarketRiskFlag =
  | "thin-liquidity"
  | "extreme-price-spike"
  | "high-volume-low-trades"
  | "very-new-low-activity";

export type ExternalMarketRankingInput = {
  liquidityUsd: number;
  marketCapUsd: number;
  volume5m: number;
  volume1h: number;
  volume24h: number;
  priceChange5m: number;
  priceChange1h: number;
  buys5m: number;
  sells5m: number;
  buys1h: number;
  sells1h: number;
  pairCreatedAt: number | null;
};

export type ExternalMarketRanking = {
  signal: ExternalMarketSignal;
  momentumScore: number;
  buyPressureBps: number;
  ageMinutes: number | null;
  riskFlags: ExternalMarketRiskFlag[];
};

export const RUNNER_THRESHOLDS = {
  minimumLiquidityUsd: 1_000,
  movingMarketCapUsd: 5_000,
  minimumMovingScore: 22,
  minimumEarlyScore: 18
} as const;

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function normalizedCreatedAt(value: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

export function rankExternalMarket(input: ExternalMarketRankingInput, now = Date.now()): ExternalMarketRanking {
  const liquidityUsd = Math.max(0, finite(input.liquidityUsd));
  const marketCapUsd = Math.max(0, finite(input.marketCapUsd));
  const volume5m = Math.max(0, finite(input.volume5m));
  const volume1h = Math.max(0, finite(input.volume1h));
  const buys5m = Math.max(0, Math.trunc(finite(input.buys5m)));
  const sells5m = Math.max(0, Math.trunc(finite(input.sells5m)));
  const buys1h = Math.max(0, Math.trunc(finite(input.buys1h)));
  const sells1h = Math.max(0, Math.trunc(finite(input.sells1h)));
  const trades5m = buys5m + sells5m;
  const trades1h = buys1h + sells1h;
  const buyShare = trades1h > 0 ? buys1h / trades1h : 0;
  const buyPressureBps = trades1h > 0 ? Math.round(clamp(buyShare, 0, 1) * 10_000) : 0;
  const createdAt = normalizedCreatedAt(input.pairCreatedAt);
  const ageMinutes = createdAt === null ? null : Math.max(0, Math.floor((now - createdAt) / 60_000));

  const turnover5m = liquidityUsd > 0 ? volume5m / liquidityUsd : 0;
  const turnover1h = liquidityUsd > 0 ? volume1h / liquidityUsd : 0;
  const acceleration = volume1h > 0
    ? clamp(volume5m * 12 / Math.max(volume1h, volume5m), 0, 3)
    : volume5m > 0 ? 3 : 0;

  const liquidityScore = clamp(Math.log10(liquidityUsd / RUNNER_THRESHOLDS.minimumLiquidityUsd + 1) * 8, 0, 16);
  const turnover5mScore = clamp(Math.sqrt(turnover5m) * 55, 0, 22);
  const turnover1hScore = clamp(Math.sqrt(turnover1h) * 25, 0, 18);
  const accelerationScore = clamp(acceleration * 6, 0, 18);
  const tradeScore = clamp(Math.log2(trades5m + 1) * 3.5, 0, 14);
  const buyPressureScore = trades1h > 0 ? clamp((buyShare - 0.5) * 20, -10, 10) : 0;
  const priceScore =
    clamp(input.priceChange5m, -20, 35) * 0.25
    + clamp(input.priceChange1h, -30, 80) * 0.1;

  const riskFlags: ExternalMarketRiskFlag[] = [];
  let riskPenalty = 0;
  if (marketCapUsd > 0) {
    const liquidityRatio = liquidityUsd / marketCapUsd;
    if (liquidityRatio < 0.015) {
      riskFlags.push("thin-liquidity");
      riskPenalty += 12;
    } else if (liquidityRatio < 0.03) {
      riskFlags.push("thin-liquidity");
      riskPenalty += 6;
    }
  }
  if (input.priceChange1h > 300 && liquidityUsd < 25_000) {
    riskFlags.push("extreme-price-spike");
    riskPenalty += 12;
  }
  if (volume1h > liquidityUsd * 2 && trades1h < 10) {
    riskFlags.push("high-volume-low-trades");
    riskPenalty += 15;
  }
  if (ageMinutes !== null && ageMinutes < 10 && trades1h < 5) {
    riskFlags.push("very-new-low-activity");
    riskPenalty += 8;
  }

  const momentumScore = Math.round(clamp(
    liquidityScore
      + turnover5mScore
      + turnover1hScore
      + accelerationScore
      + tradeScore
      + buyPressureScore
      + priceScore
      - riskPenalty,
    0,
    100
  ));

  const movingActivity =
    volume5m >= Math.max(100, liquidityUsd * 0.005)
    || volume1h >= Math.max(500, liquidityUsd * 0.03);
  const earlyActivity =
    volume5m >= Math.max(50, liquidityUsd * 0.003)
    || volume1h >= Math.max(250, liquidityUsd * 0.05);
  const supportedBuyPressure = trades1h >= 3 && buyShare >= 0.42;

  let signal: ExternalMarketSignal = "active";
  if (
    marketCapUsd >= RUNNER_THRESHOLDS.movingMarketCapUsd
      && momentumScore >= RUNNER_THRESHOLDS.minimumMovingScore
      && movingActivity
      && supportedBuyPressure
      && input.priceChange1h > -10
  ) {
    signal = "moving";
  } else if (
    marketCapUsd > 0
      && marketCapUsd < RUNNER_THRESHOLDS.movingMarketCapUsd
      && momentumScore >= RUNNER_THRESHOLDS.minimumEarlyScore
      && earlyActivity
      && buys1h >= 3
  ) {
    signal = "early";
  }

  return { signal, momentumScore, buyPressureBps, ageMinutes, riskFlags };
}

const SIGNAL_PRIORITY: Record<ExternalMarketSignal, number> = {
  moving: 0,
  early: 1,
  active: 2
};

export function compareExternalMarketRank(
  a: ExternalMarketRankingInput & ExternalMarketRanking,
  b: ExternalMarketRankingInput & ExternalMarketRanking
) {
  return SIGNAL_PRIORITY[a.signal] - SIGNAL_PRIORITY[b.signal]
    || b.momentumScore - a.momentumScore
    || b.volume5m - a.volume5m
    || b.volume1h - a.volume1h
    || b.liquidityUsd - a.liquidityUsd;
}
