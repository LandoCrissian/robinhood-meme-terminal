import type { ExternalOhlcvCandle } from "../external-ohlcv";

export function chartAxisPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return "$" + value.toLocaleString("en-US", {
    maximumSignificantDigits: 4,
    ...(value < .000001 || value >= 100_000_000 ? { notation: "scientific" as const } : {}),
  });
}

/** Screen-space composition only. Observations and timestamps are unchanged. */
export function chartComposition(candles: readonly ExternalOhlcvCandle[], width: number, height: number) {
  const left = 10, top = 14;
  const priceBottom = height * .72, volumeTop = height * .81, volumeBottom = height - 10;
  const low = candles.length ? Math.min(...candles.map(c => c.low)) : 0;
  const high = candles.length ? Math.max(...candles.map(c => c.high)) : 1;
  const padding = (high - low || Math.abs(high) * .02 || 1) * .08;
  const minimum = Math.max(0, low - padding), maximum = high + padding;
  // Reserve a readable axis gutter; long fractional prices must not cover candles.
  const right = Math.min(width * .4, Math.max(width < 520 ? 73 : 92,
    ...[minimum, maximum].map(value => chartAxisPrice(value).length * 7.5 + 14)));
  const usableWidth = Math.max(1, width - left - right);
  const priceRange = maximum - minimum || 1;
  const step = usableWidth / Math.max(candles.length, 1);
  const x = (index: number) => left + step * (index + .5);
  const y = (value: number) => top + (maximum - value) / priceRange * (priceBottom - top);
  const points = candles.map((c, i) => ({ x: x(i), y: y(c.close) }));
  const line = points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  return { width, height, left, right, top, priceBottom, volumeTop, volumeBottom, usableWidth, minimum, maximum,
    maxVolume: Math.max(1, ...candles.map(c => c.volume)), x, y, points, line,
    area: points.length > 1 ? `${line} L${points.at(-1)?.x} ${priceBottom} L${points[0].x} ${priceBottom} Z` : "" };
}
