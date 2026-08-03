import type { ExternalPoolTrade, ExternalSellPressure } from "../external-trades";
import {
  externalTradesRequestUrl,
  parseExternalPoolTrades,
  summarizeExternalSellPressure
} from "../external-trades";
import type { WatchlistAlertSnapshot } from "../watchlist-alerts";
import { rankExternalMarket } from "../external-market-ranking";
import { fetchWithTimeout, readBoundedJsonResponse } from "./media-request-guard";

const DEXSCREENER_TOKEN_BATCH_API = "https://api.dexscreener.com/tokens/v1/robinhood";
const MAX_DIRECT_MARKETS_PER_RUN = 90;
const DEXSCREENER_BATCH_SIZE = 30;

export type SmsAlertMarket = Readonly<{
  address: string;
  pairAddress: string;
  symbol: string;
  signal: "moving" | "early" | "active";
  priceUsd: number;
  liquidityUsd: number;
  volume5m: number;
  volume1h: number;
  volume24h: number;
  buys5m: number;
  sells5m: number;
  buys1h: number;
  sells1h: number;
}>;

export type SmsAlertPreviousMarket = Readonly<{
  pairAddress: string;
  liquidityUsd: number;
}>;

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonnegative(value: unknown) {
  const parsed = finite(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function normalizeSmsAlertMarket(value: unknown): SmsAlertMarket | null {
  if (!value || typeof value !== "object") return null;
  const market = value as Record<string, unknown>;
  const address = typeof market.address === "string" ? market.address.toLowerCase() : "";
  const pairAddress = typeof market.pairAddress === "string" ? market.pairAddress.toLowerCase() : "";
  const symbol = typeof market.symbol === "string" ? market.symbol.trim().slice(0, 20) : "";
  const signal = market.signal;
  const numbers = {
    priceUsd: nonnegative(market.priceUsd),
    liquidityUsd: nonnegative(market.liquidityUsd),
    volume5m: nonnegative(market.volume5m),
    volume1h: nonnegative(market.volume1h),
    volume24h: nonnegative(market.volume24h),
    buys5m: nonnegative(market.buys5m),
    sells5m: nonnegative(market.sells5m),
    buys1h: nonnegative(market.buys1h),
    sells1h: nonnegative(market.sells1h)
  };
  if (
    !/^0x[0-9a-f]{40}$/.test(address)
    || !/^0x[0-9a-f]{40}$/.test(pairAddress)
    || !symbol
    || (signal !== "moving" && signal !== "early" && signal !== "active")
    || Object.values(numbers).some((number) => number === null)
    || numbers.priceUsd === 0
  ) return null;
  return { address, pairAddress, symbol, signal, ...(numbers as Record<keyof typeof numbers, number>) };
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rawNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function rawTransactions(value: unknown) {
  const fields = record(value);
  return {
    buys: Math.max(0, Math.trunc(rawNumber(fields.buys))),
    sells: Math.max(0, Math.trunc(rawNumber(fields.sells)))
  };
}

function normalizeDirectMarket(value: unknown, requested: ReadonlySet<string>): SmsAlertMarket | null {
  const pair = record(value);
  if (pair.chainId !== "robinhood") return null;
  const base = record(pair.baseToken);
  const address = typeof base.address === "string" ? base.address.toLowerCase() : "";
  const pairAddress = typeof pair.pairAddress === "string" ? pair.pairAddress.toLowerCase() : "";
  const symbol = typeof base.symbol === "string" ? base.symbol.trim().slice(0, 20) : "";
  if (!requested.has(address) || !/^0x[0-9a-f]{40}$/.test(pairAddress) || !symbol) return null;
  const volume = record(pair.volume);
  const priceChange = record(pair.priceChange);
  const transactions5m = rawTransactions(record(pair.txns).m5);
  const transactions1h = rawTransactions(record(pair.txns).h1);
  const liquidityUsd = Math.max(0, rawNumber(record(pair.liquidity).usd));
  const volume5m = Math.max(0, rawNumber(volume.m5));
  const volume1h = Math.max(0, rawNumber(volume.h1));
  const volume24h = Math.max(0, rawNumber(volume.h24));
  const ranking = rankExternalMarket({
    liquidityUsd,
    marketCapUsd: Math.max(0, rawNumber(pair.marketCap)),
    volume5m,
    volume1h,
    volume24h,
    priceChange5m: rawNumber(priceChange.m5),
    priceChange1h: rawNumber(priceChange.h1),
    buys5m: transactions5m.buys,
    sells5m: transactions5m.sells,
    buys1h: transactions1h.buys,
    sells1h: transactions1h.sells,
    pairCreatedAt: rawNumber(pair.pairCreatedAt) || null
  });
  const priceUsd = Math.max(0, rawNumber(pair.priceUsd));
  if (priceUsd === 0) return null;
  return {
    address,
    pairAddress,
    symbol,
    signal: ranking.signal,
    priceUsd,
    liquidityUsd,
    volume5m,
    volume1h,
    volume24h,
    buys5m: transactions5m.buys,
    sells5m: transactions5m.sells,
    buys1h: transactions1h.buys,
    sells1h: transactions1h.sells
  };
}

async function fetchMissingSmsAlertMarkets(
  addresses: string[],
  request: typeof fetch
) {
  const requested = new Set(addresses.slice(0, MAX_DIRECT_MARKETS_PER_RUN));
  const batches = Array.from(
    { length: Math.ceil(requested.size / DEXSCREENER_BATCH_SIZE) },
    (_, index) => [...requested].slice(index * DEXSCREENER_BATCH_SIZE, (index + 1) * DEXSCREENER_BATCH_SIZE)
  );
  const payloads = await Promise.all(batches.map(async (batch) => {
    const result = await fetchWithTimeout(`${DEXSCREENER_TOKEN_BATCH_API}/${batch.join(",")}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    }, 8_000, request);
    if (!result.ok || !result.response.ok) return [] as unknown[];
    const payload = await readBoundedJsonResponse(result.response, 2 * 1024 * 1024);
    return Array.isArray(payload) ? payload : [];
  }));
  const markets = new Map<string, SmsAlertMarket>();
  for (const value of payloads.flat()) {
    const market = normalizeDirectMarket(value, requested);
    if (!market) continue;
    const existing = markets.get(market.address);
    if (!existing || market.liquidityUsd > existing.liquidityUsd) markets.set(market.address, market);
  }
  return markets;
}

export async function fetchSmsAlertMarkets(
  publicOrigin: string,
  alertAddresses: string[],
  request: typeof fetch = fetch
) {
  const result = await fetchWithTimeout(`${publicOrigin}/api/markets/external`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  }, 12_000, request);
  const payload = result.ok && result.response.ok
    ? await readBoundedJsonResponse(result.response, 4 * 1024 * 1024)
    : null;
  const markets = payload && typeof payload === "object" && Array.isArray((payload as { markets?: unknown }).markets)
    ? (payload as { markets: unknown[] }).markets
    : [];
  const resolved = new Map(markets.flatMap((value) => {
    const market = normalizeSmsAlertMarket(value);
    return market ? [[market.address, market] as const] : [];
  }));
  const missing = [...new Set(alertAddresses.map((address) => address.toLowerCase()))]
    .filter((address) => /^0x[0-9a-f]{40}$/.test(address) && !resolved.has(address));
  const direct = await fetchMissingSmsAlertMarkets(missing, request);
  for (const [address, market] of direct) resolved.set(address, market);
  return resolved;
}

export function smsAlertMarketSnapshot(
  market: SmsAlertMarket,
  previous?: SmsAlertPreviousMarket,
  sellPressure?: ExternalSellPressure
): WatchlistAlertSnapshot {
  const trades5m = market.buys5m + market.sells5m;
  const trades1h = market.buys1h + market.sells1h;
  const volumePace = market.volume1h > 0
    ? 12 * Math.min(market.volume5m, market.volume1h) / market.volume1h
    : 0;
  const runnerPace = market.signal === "moving"
    && market.liquidityUsd >= 5_000
    && trades5m >= 3
    && trades1h >= 10
      ? volumePace
      : undefined;
  const liquidityDropBps = previous
    && previous.pairAddress === market.pairAddress
    && previous.liquidityUsd > 0
    && market.liquidityUsd > 0
      ? Math.max(0, Math.round((previous.liquidityUsd - market.liquidityUsd) / previous.liquidityUsd * 10_000))
      : undefined;
  return {
    priceUsd: market.priceUsd,
    liquidityUsd: market.liquidityUsd,
    volume24h: market.volume24h,
    ...(runnerPace === undefined ? {} : { runnerPace }),
    ...(liquidityDropBps === undefined ? {} : { liquidityDropBps }),
    ...(sellPressure ? {
      largeSellLiquidityBps: sellPressure.largestSellLiquidityBps,
      netSellLiquidityBps: sellPressure.netSellLiquidityBps
    } : {})
  };
}

export async function fetchSmsAlertSellPressure(
  market: SmsAlertMarket,
  request: typeof fetch = fetch,
  now = Date.now()
) {
  const result = await fetchWithTimeout(externalTradesRequestUrl(market.pairAddress, market.address), {
    cache: "no-store",
    headers: { Accept: "application/json" }
  }, 8_000, request);
  if (!result.ok || !result.response.ok) return null;
  const payload = await readBoundedJsonResponse(result.response, 512 * 1024);
  let trades: ExternalPoolTrade[];
  try {
    trades = parseExternalPoolTrades(payload, market.address, 20);
  } catch {
    return null;
  }
  return summarizeExternalSellPressure(trades, market.liquidityUsd, now);
}
