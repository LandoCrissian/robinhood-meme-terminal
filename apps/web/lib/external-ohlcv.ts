import { isAddress } from "viem";

export const EXTERNAL_CHART_RANGES = ["1H", "6H", "24H", "7D"] as const;

export type ExternalChartRange = typeof EXTERNAL_CHART_RANGES[number];

export type ExternalOhlcvCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ExternalOhlcvPayload = {
  token: string;
  pair: string;
  range: ExternalChartRange;
  candles: ExternalOhlcvCandle[];
  source: "GeckoTerminal";
  updatedAt: string;
};

const RANGE_CONFIG: Record<ExternalChartRange, {
  timeframe: "minute" | "hour";
  aggregate: number;
  limit: number;
  revalidate: number;
}> = {
  "1H": { timeframe: "minute", aggregate: 1, limit: 60, revalidate: 30 },
  "6H": { timeframe: "minute", aggregate: 5, limit: 72, revalidate: 60 },
  "24H": { timeframe: "minute", aggregate: 15, limit: 96, revalidate: 90 },
  "7D": { timeframe: "hour", aggregate: 2, limit: 84, revalidate: 180 }
};

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function isExternalChartRange(value: string): value is ExternalChartRange {
  return EXTERNAL_CHART_RANGES.includes(value as ExternalChartRange);
}

export function externalOhlcvRequestUrl(
  pair: string,
  range: ExternalChartRange,
  tokenSide: "base" | "quote"
) {
  if (!isAddress(pair)) throw new Error("Invalid pool address.");
  const config = RANGE_CONFIG[range];
  const url = new URL(
    `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${pair}/ohlcv/${config.timeframe}`
  );
  url.searchParams.set("aggregate", String(config.aggregate));
  url.searchParams.set("limit", String(config.limit));
  url.searchParams.set("currency", "usd");
  url.searchParams.set("token", tokenSide);
  return { url: url.toString(), revalidate: config.revalidate };
}

export function parseExternalOhlcvList(value: unknown) {
  if (!Array.isArray(value)) throw new Error("OHLCV response is malformed.");
  const candles = value.flatMap((item) => {
    if (!Array.isArray(item) || item.length < 6) return [];
    const timestamp = finiteNumber(item[0]);
    const open = finiteNumber(item[1]);
    const high = finiteNumber(item[2]);
    const low = finiteNumber(item[3]);
    const close = finiteNumber(item[4]);
    const volume = finiteNumber(item[5]);
    if (
      !Number.isSafeInteger(timestamp)
      || timestamp <= 0
      || open <= 0
      || high <= 0
      || low <= 0
      || close <= 0
      || volume < 0
      || high < Math.max(open, close, low)
      || low > Math.min(open, close, high)
    ) return [];
    return [{ timestamp, open, high, low, close, volume }];
  });

  const unique = new Map(candles.map((candle) => [candle.timestamp, candle]));
  return [...unique.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-120);
}
