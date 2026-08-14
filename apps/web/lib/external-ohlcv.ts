import { isAddress } from "viem";
import type { ExternalPoolTrade } from "./external-trades";

export const EXTERNAL_CHART_RANGES = ["LIVE", "5M", "15M", "1H", "6H", "24H", "7D"] as const;

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
  lastTradeAt: string | null;
  refreshMs: number;
};

const RANGE_CONFIG: Record<ExternalChartRange, {
  timeframe: "minute" | "hour";
  aggregate: number;
  limit: number;
  revalidate: number;
}> = {
  "LIVE": { timeframe: "minute", aggregate: 1, limit: 15, revalidate: 3 },
  "5M": { timeframe: "minute", aggregate: 1, limit: 5, revalidate: 5 },
  "15M": { timeframe: "minute", aggregate: 1, limit: 15, revalidate: 10 },
  "1H": { timeframe: "minute", aggregate: 1, limit: 60, revalidate: 30 },
  "6H": { timeframe: "minute", aggregate: 5, limit: 72, revalidate: 60 },
  "24H": { timeframe: "minute", aggregate: 15, limit: 96, revalidate: 90 },
  "7D": { timeframe: "hour", aggregate: 2, limit: 84, revalidate: 180 }
};

const RANGE_REFRESH_MS: Record<ExternalChartRange, number> = {
  LIVE: 60_000,
  "5M": 15_000,
  "15M": 20_000,
  "1H": 30_000,
  "6H": 30_000,
  "24H": 30_000,
  "7D": 60_000
};

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function isExternalChartRange(value: string): value is ExternalChartRange {
  return EXTERNAL_CHART_RANGES.includes(value as ExternalChartRange);
}

export function externalChartRefreshMs(range: ExternalChartRange) {
  return RANGE_REFRESH_MS[range];
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

export function mergeConfirmedTradesIntoOhlcv(
  candles: ExternalOhlcvCandle[],
  trades: ExternalPoolTrade[]
) {
  if (candles.length === 0 || trades.length === 0) return candles;
  const byMinute = new Map(candles.map((candle) => [candle.timestamp, { ...candle }]));
  const earliest = candles[0]?.timestamp ?? 0;
  const latest = candles.at(-1)?.timestamp ?? earliest;
  const orderedTrades = [...trades].sort((left, right) => (
    Date.parse(left.timestamp) - Date.parse(right.timestamp)
  ));
  const visibleVolumeByMinute = new Map<number, number>();
  for (const trade of orderedTrades) {
    const seconds = Math.floor(Date.parse(trade.timestamp) / 1_000);
    if (!Number.isSafeInteger(seconds)) continue;
    const minute = Math.floor(seconds / 60) * 60;
    visibleVolumeByMinute.set(minute, (visibleVolumeByMinute.get(minute) ?? 0) + trade.volumeUsd);
  }

  for (const trade of orderedTrades) {
    const tradeSeconds = Math.floor(Date.parse(trade.timestamp) / 1_000);
    if (!Number.isSafeInteger(tradeSeconds) || tradeSeconds < earliest || tradeSeconds > latest + 120) continue;
    const minute = Math.floor(tradeSeconds / 60) * 60;
    const existing = byMinute.get(minute);
    if (existing) {
      existing.high = Math.max(existing.high, trade.priceUsd);
      existing.low = Math.min(existing.low, trade.priceUsd);
      existing.close = trade.priceUsd;
      existing.volume = Math.max(existing.volume, visibleVolumeByMinute.get(minute) ?? 0);
      continue;
    }
    const previous = [...byMinute.values()]
      .filter((candle) => candle.timestamp < minute)
      .sort((left, right) => right.timestamp - left.timestamp)[0];
    const open = previous?.close ?? trade.priceUsd;
    byMinute.set(minute, {
      timestamp: minute,
      open,
      high: Math.max(open, trade.priceUsd),
      low: Math.min(open, trade.priceUsd),
      close: trade.priceUsd,
      volume: visibleVolumeByMinute.get(minute) ?? trade.volumeUsd
    });
  }

  return [...byMinute.values()]
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-120);
}
