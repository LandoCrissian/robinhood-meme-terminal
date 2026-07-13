import { NextResponse } from "next/server";

const CHAIN_SLUG = "robinhood";
const DEXSCREENER_API = "https://api.dexscreener.com/token-pairs/v1";
const DEXSCREENER_PAGE = "https://dexscreener.com/robinhood/";
const CANONICAL_MARKET_TOKENS = [
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
] as const;
const EXCLUDED_TOKENS = new Set(CANONICAL_MARKET_TOKENS.map((address) => address.toLowerCase()));
const MINIMUM_LIQUIDITY_USD = 1_000;
const MAX_MARKETS = 8;

type RawToken = {
  address?: unknown;
  name?: unknown;
  symbol?: unknown;
};

type RawPair = {
  chainId?: unknown;
  dexId?: unknown;
  url?: unknown;
  pairAddress?: unknown;
  baseToken?: RawToken;
  quoteToken?: RawToken;
  priceUsd?: unknown;
  txns?: { h24?: { buys?: unknown; sells?: unknown } };
  volume?: { h24?: unknown };
  priceChange?: { h24?: unknown };
  liquidity?: { usd?: unknown };
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
  volume24h: number;
  priceChange24h: number;
  buys24h: number;
  sells24h: number;
  pairCreatedAt: number | null;
};

function asText(value: unknown, maximumLength = 80) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function asNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : 0;
}

function tokenFromPair(pair: RawPair) {
  const baseAddress = asText(pair.baseToken?.address, 42).toLowerCase();
  const quoteAddress = asText(pair.quoteToken?.address, 42).toLowerCase();

  if (!EXCLUDED_TOKENS.has(baseAddress)) return pair.baseToken;
  if (!EXCLUDED_TOKENS.has(quoteAddress)) return pair.quoteToken;
  return undefined;
}

async function fetchTokenPairs(tokenAddress: string) {
  const response = await fetch(`${DEXSCREENER_API}/${CHAIN_SLUG}/${tokenAddress}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60 }
  });

  if (!response.ok) throw new Error(`DEX market request failed with ${response.status}`);
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
      const volume24h = asNumber(pair.volume?.h24);

      if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !name || !symbol || !pairAddress) continue;
      if (liquidityUsd < MINIMUM_LIQUIDITY_USD || volume24h <= 0) continue;

      const market: ExternalMarket = {
        address,
        name,
        symbol,
        pairAddress,
        url,
        dexId: asText(pair.dexId, 30) || "DEX",
        priceUsd: asNumber(pair.priceUsd),
        liquidityUsd,
        volume24h,
        priceChange24h: asNumber(pair.priceChange?.h24),
        buys24h: Math.max(0, Math.trunc(asNumber(pair.txns?.h24?.buys))),
        sells24h: Math.max(0, Math.trunc(asNumber(pair.txns?.h24?.sells))),
        pairCreatedAt: asNumber(pair.pairCreatedAt) || null
      };

      const key = address.toLowerCase();
      const existing = marketsByToken.get(key);
      if (!existing || market.volume24h > existing.volume24h || (market.volume24h === existing.volume24h && market.liquidityUsd > existing.liquidityUsd)) {
        marketsByToken.set(key, market);
      }
    }

    const markets = [...marketsByToken.values()]
      .sort((a, b) => b.volume24h - a.volume24h || b.liquidityUsd - a.liquidityUsd)
      .slice(0, MAX_MARKETS);

    return NextResponse.json(
      { markets, source: "DEX Screener", updatedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180" } }
    );
  } catch {
    return NextResponse.json(
      { error: "External Robinhood Chain markets are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
