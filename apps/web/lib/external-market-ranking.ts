export type ExternalMarketSignal = "moving" | "early" | "active";

export type ExternalMarketRiskFlag =
  | "thin-liquidity"
  | "extreme-price-spike"
  | "high-volume-low-trades"
  | "very-new-low-activity"
  | "one-sided-activity";

export type ExternalMarketRankingInput = {
  address?: string;
  pairAddress?: string;
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
  minimumDisplayLiquidityUsd: 1_000,
  minimumSignalLiquidityUsd: 5_000,
  minimumOneHourTrades: 10,
  minimumMovingScore: 40,
  minimumEarlyScore: 30,
  minimumEarlyAgeMinutes: 15,
  maximumEarlyAgeMinutes: 72 * 60
} as const;

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function norm(value: number, unit: number, cap: number) {
  return clamp(Math.log1p(Math.max(0, value) / unit) / Math.log1p(cap / unit));
}

function normalizedCreatedAt(value: number | null) {
  if (!value || !Number.isFinite(value) || value <= 0) return null;
  return value < 1_000_000_000_000 ? value * 1_000 : value;
}

function turnoverFactor(turnover: number) {
  if (turnover <= 3) return 1;
  if (turnover <= 10) return 1 - ((turnover - 3) / 7) * 0.3;
  return 0.3;
}

export function rankExternalMarket(input: ExternalMarketRankingInput, now = Date.now()): ExternalMarketRanking {
  const liquidityUsd = Math.max(0, finite(input.liquidityUsd));
  const volume5m = Math.max(0, finite(input.volume5m));
  const volume1h = Math.max(0, finite(input.volume1h));
  const buys5m = Math.max(0, Math.trunc(finite(input.buys5m)));
  const sells5m = Math.max(0, Math.trunc(finite(input.sells5m)));
  const buys1h = Math.max(0, Math.trunc(finite(input.buys1h)));
  const sells1h = Math.max(0, Math.trunc(finite(input.sells1h)));
  const trades5m = buys5m + sells5m;
  const trades1h = buys1h + sells1h;
  const buyShare = trades1h > 0 ? buys1h / trades1h : 0;
  const buyPressureBps = trades1h > 0 ? Math.round(clamp(buyShare) * 10_000) : 0;
  const createdAt = normalizedCreatedAt(input.pairCreatedAt);
  const ageMinutes = createdAt === null ? null : Math.max(0, Math.floor((now - createdAt) / 60_000));

  const turnover = liquidityUsd > 0 ? volume1h / liquidityUsd : Number.POSITIVE_INFINITY;
  const effectiveVolume1h = Math.min(volume1h, 3 * liquidityUsd);
  const volumeSignal = norm(effectiveVolume1h, 1_000, 250_000);
  const liquiditySignal = norm(liquidityUsd, 1_000, 100_000);
  const activitySignal = Math.log1p(Math.min(trades1h, 200)) / Math.log(201);
  const pace = volume1h > 0 ? clamp(12 * Math.min(volume5m, volume1h) / Math.max(volume1h, 1), 0, 2) : 0;
  const accelerationSignal = trades5m >= 3 && trades1h >= 10
    ? clamp((pace - 0.75) / 1.25)
    : 0;
  const buySignal = clamp((buyShare - 0.4) / 0.3);
  const priceSignal = clamp(Math.max(finite(input.priceChange5m), 0) / 20);
  const raw =
    0.4 * volumeSignal
    + 0.25 * liquiditySignal
    + 0.15 * activitySignal
    + 0.1 * accelerationSignal
    + 0.05 * buySignal
    + 0.05 * priceSignal;

  const confidence = Math.sqrt(
    Math.min(1, trades1h / 20)
      * Math.min(1, liquidityUsd / RUNNER_THRESHOLDS.minimumSignalLiquidityUsd)
  );
  const twoSided = buys1h >= 2 && sells1h >= 2
    ? 1
    : buys1h === 0 || sells1h === 0
      ? 0.5
      : 0.75;
  const spikeFactor = Math.abs(finite(input.priceChange1h)) > 300 ? 0.5 : 1;
  const newbornFactor = ageMinutes !== null && ageMinutes < 15 ? 0.75 : 1;
  const momentumScore = Math.round(100 * clamp(
    raw * confidence * twoSided * turnoverFactor(turnover) * spikeFactor * newbornFactor
  ));

  const riskFlags: ExternalMarketRiskFlag[] = [];
  if (liquidityUsd < RUNNER_THRESHOLDS.minimumSignalLiquidityUsd) riskFlags.push("thin-liquidity");
  if (Math.abs(finite(input.priceChange1h)) > 300) riskFlags.push("extreme-price-spike");
  if (turnover > 10 || (volume1h > liquidityUsd * 2 && trades1h < 10)) riskFlags.push("high-volume-low-trades");
  if (ageMinutes !== null && ageMinutes < 15) riskFlags.push("very-new-low-activity");
  if (buys1h === 0 || sells1h === 0) riskFlags.push("one-sided-activity");

  const structural =
    liquidityUsd >= RUNNER_THRESHOLDS.minimumSignalLiquidityUsd
    && trades1h >= RUNNER_THRESHOLDS.minimumOneHourTrades
    && buys1h >= 2
    && sells1h >= 2
    && volume1h >= Math.max(1_000, 0.05 * liquidityUsd)
    && turnover <= 10
    && Math.abs(finite(input.priceChange1h)) <= 300
    && !(ageMinutes !== null && ageMinutes < 10);
  const moving =
    structural
    && momentumScore >= RUNNER_THRESHOLDS.minimumMovingScore
    && trades5m >= 2
    && volume5m >= Math.max(100, 0.005 * liquidityUsd)
    && pace >= 0.5
    && finite(input.priceChange1h) > -20;
  const early =
    !moving
    && structural
    && momentumScore >= RUNNER_THRESHOLDS.minimumEarlyScore
    && ageMinutes !== null
    && ageMinutes >= RUNNER_THRESHOLDS.minimumEarlyAgeMinutes
    && ageMinutes <= RUNNER_THRESHOLDS.maximumEarlyAgeMinutes;

  return {
    signal: moving ? "moving" : early ? "early" : "active",
    momentumScore,
    buyPressureBps,
    ageMinutes,
    riskFlags
  };
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
    || b.liquidityUsd - a.liquidityUsd
    || (a.address ?? "").toLowerCase().localeCompare((b.address ?? "").toLowerCase())
    || (a.pairAddress ?? "").toLowerCase().localeCompare((b.pairAddress ?? "").toLowerCase());
}
