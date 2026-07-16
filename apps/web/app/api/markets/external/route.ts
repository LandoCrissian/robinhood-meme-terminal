import { NextResponse } from "next/server";
import {
  RUNNER_THRESHOLDS,
  compareExternalMarketRank,
  rankExternalMarket,
  type ExternalMarketRiskFlag,
  type ExternalMarketSignal
} from "../../../../lib/external-market-ranking";

const CHAIN_SLUG = "robinhood";
const DEXSCREENER_API = "https://api.dexscreener.com/token-pairs/v1";
const DEXSCREENER_PAGE = "https://dexscreener.com/robinhood/";
const CANONICAL_MARKET_TOKENS = [
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
] as const;
const EXCLUDED_TOKENS = new Set(CANONICAL_MARKET_TOKENS.map((address) => address.toLowerCase()));
const MAX_MARKETS = 32;

type RawToken = {
  address?: unknown;
  name?: unknown;
  symbol?: unknown;
};

type RawTransactions = Record<string, { buys?: unknown; sells?: unknown } | undefined>;

type RawPair = {
  chainId?: unknown;
  dexId?: unknown;
  url?: unknown;
  pairAddress?: unknown;
  baseToken?: RawToken;
  quoteToken?: RawToken;
  priceUsd?: unknown;
  txns?: RawTransactions;
  volume?: Record<string, unknown>;
  priceChange?: Record<string, unknown>;
  liquidity?: { usd?: unknown };
  fdv?: unknown;
  marketCap?: unknown;
  pairCreatedAt?: unknown;
};

type ExternalMarket = {
  address: string;
  name: string;
  symbol: string;
  pairAddress: string;
  url: string;
  dexId: string;
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

function asText(value: unknown, maximumLength = 80) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function asNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : 0;
}

function transactionWindow(pair: RawPair, window: string) {
  return {
    buys: Math.max(0, Math.trunc(asNumber(pair.txns?.[window]?.buys))),
    sells: Math.max(0, Math.trunc(asNumber(pair.txns?.[window]?.sells)))
  };
}

function tokenFromPair(pair: RawPair) {
  const baseAddress = asText(pair.baseToken?.address, 42).toLowerCase();
  const quoteAddress = asText(pair.quoteToken?.address, 42).toLowerCase();

  if (!EXCLUDED_TOKENS.has(baseAddress)) return pair.baseToken;
  if (!EXCLUDED_TOKENS.has(quoteAddress)) return pair.quoteToken;
  return undefined;
}

async function fetchTokenPairs(tokenAddress: string) {
  const response = await fetch(DEXSCREENER_API + "/" + CHAIN_SLUG + "/" + tokenAddress, {
    headers: { Accept: "application/json" },
    next: { revalidate: 30 }
  });

  if (!response.ok) throw new Error("DEX market request failed with " + response.status);
  const payload: unknown = await response.json();
  return Array.isArray(payload) ? (payload as RawPair[]) : [];
}

export async function GET() {
  try {
    const results = await Promise.allSettled(CANONICAL_MARKET_TOKENS.map(fetchTokenPairs));
    const pairs = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    if (pairs.length === 0) throw new Error("No external market source responded.");

    const marketsByToken = new Map<string, ExternalMarket>();

    for (const pair of pairs) {
      if (pair.chainId !== CHAIN_SLUG) continue;

      const url = asText(pair.url, 300);
      if (!url.startsWith(DEXSCREENER_PAGE)) continue;

      const token = tokenFromPair(pair);
      const address = asText(token?.address, 42);
      const name = asText(token?.name);
      const symbol = asText(token?.symbol, 20);
      const pairAddress = asText(pair.pairAddress, 66);
      const liquidityUsd = asNumber(pair.liquidity?.usd);
      const marketCapUsd = Math.max(0, asNumber(pair.marketCap));
      const fdvUsd = Math.max(0, asNumber(pair.fdv));
      const volume5m = Math.max(0, asNumber(pair.volume?.m5));
      const volume1h = Math.max(0, asNumber(pair.volume?.h1));
      const volume24h = Math.max(0, asNumber(pair.volume?.h24));
      const priceChange5m = asNumber(pair.priceChange?.m5);
      const priceChange1h = asNumber(pair.priceChange?.h1);
      const priceChange24h = asNumber(pair.priceChange?.h24);
      const transactions5m = transactionWindow(pair, "m5");
      const transactions1h = transactionWindow(pair, "h1");
      const transactions24h = transactionWindow(pair, "h24");
      const pairCreatedAt = asNumber(pair.pairCreatedAt) || null;

      if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !name || !symbol || !pairAddress) continue;
      if (liquidityUsd < RUNNER_THRESHOLDS.minimumLiquidityUsd || volume24h <= 0) continue;

      const ranking = rankExternalMarket({
        liquidityUsd,
        marketCapUsd,
        volume5m,
        volume1h,
        volume24h,
        priceChange5m,
        priceChange1h,
        buys5m: transactions5m.buys,
        sells5m: transactions5m.sells,
        buys1h: transactions1h.buys,
        sells1h: transactions1h.sells,
        pairCreatedAt
      });

      const market: ExternalMarket = {
        address,
        name,
        symbol,
        pairAddress,
        url,
        dexId: asText(pair.dexId, 30) || "DEX",
        priceUsd: asNumber(pair.priceUsd),
        liquidityUsd,
        marketCapUsd,
        fdvUsd,
        volume5m,
        volume1h,
        volume24h,
        priceChange5m,
        priceChange1h,
        priceChange24h,
        buys5m: transactions5m.buys,
        sells5m: transactions5m.sells,
        buys1h: transactions1h.buys,
        sells1h: transactions1h.sells,
        buys24h: transactions24h.buys,
        sells24h: transactions24h.sells,
        pairCreatedAt,
        ...ranking
      };

      const key = address.toLowerCase();
      const existing = marketsByToken.get(key);
      if (
        !existing
        || market.volume24h > existing.volume24h
        || (market.volume24h === existing.volume24h && market.liquidityUsd > existing.liquidityUsd)
      ) {
        marketsByToken.set(key, market);
      }
    }

    const markets = [...marketsByToken.values()]
      .sort(compareExternalMarketRank)
      .slice(0, MAX_MARKETS);

    return NextResponse.json(
      {
        markets,
        source: "DEX Screener",
        rankingVersion: "rmt-runner-v1",
        thresholds: RUNNER_THRESHOLDS,
        updatedAt: new Date().toISOString()
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=90" } }
    );
  } catch {
    return NextResponse.json(
      { error: "External Robinhood Chain markets are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
