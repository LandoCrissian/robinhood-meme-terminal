import type { PredictionRecord } from "./schema.ts";

export function calculateTimeDecayedBrier(predictions: PredictionRecord[]): number {
  const resolved = predictions
    .filter((prediction) => prediction.resolvedOutcome !== undefined && prediction.resolvedAt !== undefined)
    .sort((a, b) => (a.resolvedAt! - b.resolvedAt!) || a.predictionId.localeCompare(b.predictionId));

  if (resolved.length === 0) return 0.5;

  let weightedError = 0;
  let totalWeight = 0;
  const n = resolved.length;

  resolved.forEach((prediction, index) => {
    const weight = (index + 1) / n;
    const error = prediction.forecastProbability - prediction.resolvedOutcome!;
    weightedError += weight * error * error;
    totalWeight += weight;
  });

  return weightedError / totalWeight;
}

export function calculateSimpleReturnBps(startAtomic: string, endAtomic: string): bigint {
  const start = BigInt(startAtomic);
  const end = BigInt(endAtomic);
  if (start <= 0n) throw new Error("start NAV must be greater than zero");
  return ((end - start) * 10_000n) / start;
}

export function calculateMaxDrawdownBps(navSeries: string[]): bigint {
  if (navSeries.length === 0) return 0n;

  let peak = BigInt(navSeries[0]!);
  if (peak <= 0n) throw new Error("NAV values must be greater than zero");
  let maximumDrawdown = 0n;

  for (const rawNav of navSeries) {
    const nav = BigInt(rawNav);
    if (nav <= 0n) throw new Error("NAV values must be greater than zero");
    if (nav > peak) peak = nav;
    const drawdown = ((peak - nav) * 10_000n) / peak;
    if (drawdown > maximumDrawdown) maximumDrawdown = drawdown;
  }

  return maximumDrawdown;
}
