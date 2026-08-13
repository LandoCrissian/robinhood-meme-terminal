import { NextResponse } from "next/server";
import { getAddress, isAddress, zeroAddress } from "viem";
import type { ExternalMarketSignal } from "../../../../lib/external-market-ranking";
import type { VNextDirectoryMarket, VNextDirectoryResponse } from "../../../../lib/vnext/market-directory";
import {
  ROBINHOOD_RMT_ADDRESS,
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../../../../lib/vnext/robinhood-assets";
import { RMT_TOKEN_ARTWORK, safeTokenArtworkUrl } from "../../../../lib/vnext/token-artwork";

const CHAIN_SLUG = "robinhood";
const PAIRS_API = "https://api.dexscreener.com/token-pairs/v1";
const DIRECTORY_TOKENS = [ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS, ROBINHOOD_RMT_ADDRESS] as const;
const QUOTE_ASSETS = new Set([ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS].map((address) => address.toLowerCase()));
const TIMEOUT_MS = 6_000;
const MAX_MARKETS = 48;

type RawToken = { address?: unknown; name?: unknown; symbol?: unknown };
type RawPair = {
  chainId?: unknown;
  pairAddress?: unknown;
  dexId?: unknown;
  url?: unknown;
  baseToken?: RawToken;
  quoteToken?: RawToken;
  priceUsd?: unknown;
  priceNative?: unknown;
  liquidity?: { usd?: unknown };
  marketCap?: unknown;
  fdv?: unknown;
  volume?: { h24?: unknown };
  priceChange?: { h24?: unknown };
  pairCreatedAt?: unknown;
  info?: { imageUrl?: unknown };
};

let lastSnapshot: VNextDirectoryResponse | undefined;

function text(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectedToken(pair: RawPair, requestedAddress: string) {
  const base = text(pair.baseToken?.address, 42).toLowerCase();
  const quote = text(pair.quoteToken?.address, 42).toLowerCase();
  if (requestedAddress.toLowerCase() === ROBINHOOD_WETH_ADDRESS.toLowerCase()) {
    if (base === ROBINHOOD_WETH_ADDRESS.toLowerCase()) return pair.baseToken;
    if (quote === ROBINHOOD_WETH_ADDRESS.toLowerCase()) return pair.quoteToken;
    return null;
  }
  if (QUOTE_ASSETS.has(quote) && !QUOTE_ASSETS.has(base)) return pair.baseToken;
  if (QUOTE_ASSETS.has(base) && !QUOTE_ASSETS.has(quote)) return pair.quoteToken;
  if (base === ROBINHOOD_RMT_ADDRESS.toLowerCase()) return pair.baseToken;
  if (quote === ROBINHOOD_RMT_ADDRESS.toLowerCase()) return pair.quoteToken;
  return null;
}

function signalFor(pair: RawPair): ExternalMarketSignal {
  const change = Math.abs(number(pair.priceChange?.h24));
  const volume = Math.max(0, number(pair.volume?.h24));
  if (change >= 10 && volume >= 10_000) return "moving";
  if (change >= 4 || volume >= 25_000) return "active";
  return "early";
}

function marketFromPair(pair: RawPair, requestedAddress: string): VNextDirectoryMarket | null {
  if (pair.chainId !== CHAIN_SLUG) return null;
  const token = selectedToken(pair, requestedAddress);
  const address = text(token?.address, 42);
  if (!isAddress(address, { strict: false }) || address.toLowerCase() === zeroAddress) return null;
  const canonicalAddress = getAddress(address);
  const pairAddress = text(pair.pairAddress, 42);
  if (!isAddress(pairAddress, { strict: false }) || pairAddress.toLowerCase() === zeroAddress) return null;
  const symbol = text(token?.symbol, 16) || `${canonicalAddress.slice(0, 6)}…${canonicalAddress.slice(-4)}`;
  const name = text(token?.name, 80) || symbol;
  const pairCreatedAt = number(pair.pairCreatedAt);
  const baseAddress = text(pair.baseToken?.address, 42).toLowerCase();
  const selectedIsBase = canonicalAddress.toLowerCase() === baseAddress;
  const basePriceUsd = Math.max(0, number(pair.priceUsd));
  const basePriceInQuote = Math.max(0, number(pair.priceNative));
  const selectedPriceUsd = selectedIsBase
    ? basePriceUsd
    : basePriceInQuote > 0
      ? basePriceUsd / basePriceInQuote
      : 0;
  return {
    address: canonicalAddress,
    name,
    symbol,
    priceUsd: selectedPriceUsd,
    liquidityUsd: Math.max(0, number(pair.liquidity?.usd)),
    marketCapUsd: selectedIsBase ? Math.max(0, number(pair.marketCap) || number(pair.fdv)) : 0,
    volume24h: Math.max(0, number(pair.volume?.h24)),
    priceChange24h: selectedIsBase ? number(pair.priceChange?.h24) : 0,
    ageMinutes: pairCreatedAt > 0 ? Math.max(0, (Date.now() - pairCreatedAt) / 60_000) : null,
    signal: signalFor(pair),
    imageUri: canonicalAddress.toLowerCase() === ROBINHOOD_RMT_ADDRESS.toLowerCase()
      ? RMT_TOKEN_ARTWORK
      : selectedIsBase
        ? safeTokenArtworkUrl(pair.info?.imageUrl) ?? undefined
        : undefined,
    pairAddress: getAddress(pairAddress),
    dexId: text(pair.dexId, 30) || "DEX",
    url: text(pair.url, 300) || undefined
  };
}

async function fetchPairs(address: string, signal: AbortSignal) {
  const response = await fetch(`${PAIRS_API}/${CHAIN_SLUG}/${address}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 20 },
    signal
  });
  if (!response.ok) throw new Error(`Market directory upstream returned ${response.status}.`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Market directory upstream was malformed.");
  return payload as RawPair[];
}

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const batches = await Promise.all(DIRECTORY_TOKENS.map(async (address) => ({
      requestedAddress: address,
      pairs: await fetchPairs(address, controller.signal).catch(() => [])
    })));
    const preferred = new Map<string, VNextDirectoryMarket>();
    for (const batch of batches) {
      for (const pair of batch.pairs) {
        const market = marketFromPair(pair, batch.requestedAddress);
        if (!market) continue;
        const key = market.address.toLowerCase();
        const existing = preferred.get(key);
        if (!existing) preferred.set(key, market);
        else if (market.liquidityUsd > existing.liquidityUsd) preferred.set(key, {
          ...market,
          imageUri: market.imageUri ?? existing.imageUri
        });
        else if (!existing.imageUri && market.imageUri) preferred.set(key, {
          ...existing,
          imageUri: market.imageUri
        });
      }
    }
    const markets = [...preferred.values()]
      .sort((left, right) => right.liquidityUsd - left.liquidityUsd || right.volume24h - left.volume24h)
      .slice(0, MAX_MARKETS);
    if (markets.length === 0) throw new Error("Market directory returned no usable assets.");
    lastSnapshot = { markets, updatedAt: new Date().toISOString() };
    return NextResponse.json(lastSnapshot, {
      headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" }
    });
  } catch {
    if (lastSnapshot) {
      return NextResponse.json({ ...lastSnapshot, stale: true, error: "Market directory refresh is delayed." }, {
        headers: { "Cache-Control": "no-store" }
      });
    }
    return NextResponse.json({ error: "Market directory is temporarily unavailable." }, {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    });
  } finally {
    clearTimeout(timeout);
  }
}
