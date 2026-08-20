import { NextResponse } from "next/server";
import { getAddress, isAddress, zeroAddress } from "viem";
import type { ExternalMarketSignal } from "../../../../lib/external-market-ranking";
import { buildAssetMarketRecord, type AssetMarketEvidence } from "../../../../lib/external-market";
import { normalizeProviderPairForAsset } from "../../../../lib/external-market-identity";
import {
  VNEXT_MARKET_DIRECTORY_MAX_MARKETS,
  type VNextDirectoryMarket,
  type VNextDirectoryResponse
} from "../../../../lib/vnext/market-directory";
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

type RawToken = { address?: unknown; name?: unknown; symbol?: unknown };
type RawPair = {
  chainId?: unknown;
  pairAddress?: unknown;
  dexId?: unknown;
  url?: unknown;
  baseToken?: RawToken;
  quoteToken?: RawToken;
  priceUsd?: unknown;
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

function selectedToken(pair: RawPair) {
  const base = text(pair.baseToken?.address, 42).toLowerCase();
  const quote = text(pair.quoteToken?.address, 42).toLowerCase();
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

function marketFromPair(pair: RawPair, evidence: AssetMarketEvidence): VNextDirectoryMarket | null {
  if (pair.chainId !== CHAIN_SLUG) return null;
  if (evidence.displayEligibility !== "eligible" || evidence.assetSide !== "BASE") return null;
  const token = evidence.token;
  const address = token.address;
  if (!isAddress(address, { strict: false }) || address.toLowerCase() === zeroAddress) return null;
  const canonicalAddress = getAddress(address);
  if (evidence.pool.kind !== "evm-address") return null;
  const pairAddress = evidence.pool.value;
  const symbol = text(token?.symbol, 16) || `${canonicalAddress.slice(0, 6)}…${canonicalAddress.slice(-4)}`;
  const name = text(token?.name, 80) || symbol;
  const pairCreatedAt = number(pair.pairCreatedAt);
  return {
    assetId: evidence.assetId,
    address: canonicalAddress,
    name,
    symbol,
    priceUsd: evidence.priceUsd ?? 0,
    liquidityUsd: evidence.liquidityUsd ?? 0,
    marketCapUsd: evidence.marketCapUsd ?? evidence.fdvUsd ?? 0,
    volume24h: evidence.volume24h ?? 0,
    priceChange24h: evidence.priceChange24h ?? 0,
    ageMinutes: pairCreatedAt > 0 ? Math.max(0, (Date.now() - pairCreatedAt) / 60_000) : null,
    signal: signalFor(pair),
    imageUri: canonicalAddress.toLowerCase() === ROBINHOOD_RMT_ADDRESS.toLowerCase()
      ? RMT_TOKEN_ARTWORK
      : safeTokenArtworkUrl(pair.info?.imageUrl) ?? undefined,
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
    const batches = await Promise.all(DIRECTORY_TOKENS.map((address) => fetchPairs(address, controller.signal).catch(() => [])));
    const evidenceByAsset = new Map<string, AssetMarketEvidence[]>();
    const candidatesByPool = new Map<string, VNextDirectoryMarket>();
    for (const pair of batches.flat()) {
      const token = selectedToken(pair);
      const tokenAddress = text(token?.address, 42);
      if (!isAddress(tokenAddress, { strict: false }) || tokenAddress.toLowerCase() === zeroAddress) continue;
      const evidence = normalizeProviderPairForAsset(pair, tokenAddress, {
        chainId: 4_663,
        chainSlug: CHAIN_SLUG,
        canonicalQuoteAddresses: QUOTE_ASSETS,
        provenance: "dexscreener-token-pairs"
      });
      if (!evidence) continue;
      const evidenceList = evidenceByAsset.get(evidence.assetId) ?? [];
      evidenceList.push(evidence);
      evidenceByAsset.set(evidence.assetId, evidenceList);
      const market = marketFromPair(pair, evidence);
      if (market) candidatesByPool.set(`${evidence.assetId}:${evidence.pool.value.toLowerCase()}`, market);
    }
    const markets = [...evidenceByAsset.values()].flatMap((evidenceList): VNextDirectoryMarket[] => {
      const record = buildAssetMarketRecord(evidenceList, { requireChart: true });
      if (!record?.primaryMarket) return [];
      const candidate = candidatesByPool.get(`${record.assetId}:${record.primaryMarket.pool.value.toLowerCase()}`);
      if (!candidate) return [];
      const imageUri = candidate.imageUri ?? evidenceList
        .map((evidence) => candidatesByPool.get(`${record.assetId}:${evidence.pool.value.toLowerCase()}`)?.imageUri)
        .find(Boolean);
      return [{
        ...candidate,
        imageUri,
        primaryMarket: record.primaryMarket,
        verifiedMarkets: record.verifiedMarkets
      }];
    })
      .sort((left, right) => right.liquidityUsd - left.liquidityUsd || right.volume24h - left.volume24h)
      .slice(0, VNEXT_MARKET_DIRECTORY_MAX_MARKETS);
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
