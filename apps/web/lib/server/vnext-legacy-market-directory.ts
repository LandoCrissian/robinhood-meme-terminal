import { getAddress, isAddress, zeroAddress } from "viem";
import type { ExternalMarketSignal } from "../external-market-ranking";
import { buildAssetMarketRecord, type AssetMarketEvidence } from "../external-market";
import { normalizeProviderPairForAsset } from "../external-market-identity";
import {
  VNEXT_MARKET_DIRECTORY_MAX_MARKETS,
  type VNextDirectoryMarket,
  type VNextDirectoryResponse
} from "../vnext/market-directory";
import {
  ROBINHOOD_RMT_ADDRESS,
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../vnext/robinhood-assets";
import { RMT_TOKEN_ARTWORK, safeTokenArtworkUrl } from "../vnext/token-artwork";

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

export type VNextLegacyMarketDirectoryPage = {
  status: 200 | 503;
  body: VNextDirectoryResponse;
  headers: Readonly<Record<string, string>>;
};

type Fetcher = typeof fetch;

let lastSnapshot: VNextDirectoryResponse | undefined;

function text(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nonNegativeNumber(value: unknown) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
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

function signalFor(pair: RawPair): ExternalMarketSignal | null {
  const rawChange = finiteNumber(pair.priceChange?.h24);
  const rawVolume = finiteNumber(pair.volume?.h24);
  if (rawChange === null || rawVolume === null || rawVolume < 0) return null;
  const change = Math.abs(rawChange);
  if (change >= 10 && rawVolume >= 10_000) return "moving";
  if (change >= 4 || rawVolume >= 25_000) return "active";
  return "early";
}

function marketFromPair(pair: RawPair, evidence: AssetMarketEvidence): VNextDirectoryMarket | null {
  if (pair.chainId !== CHAIN_SLUG) return null;
  if ((evidence.displayEligibility !== "eligible" && evidence.displayEligibility !== "missing-price")
    || evidence.assetSide !== "BASE") return null;
  const address = evidence.token.address;
  if (!isAddress(address, { strict: false }) || address.toLowerCase() === zeroAddress) return null;
  const canonicalAddress = getAddress(address);
  const pairAddress = evidence.pool.kind === "evm-address" ? getAddress(evidence.pool.value) : undefined;
  const symbol = text(evidence.token.symbol, 16) || `${canonicalAddress.slice(0, 6)}…${canonicalAddress.slice(-4)}`;
  const name = text(evidence.token.name, 80) || symbol;
  const pairCreatedAt = finiteNumber(pair.pairCreatedAt);
  const priceUsd = finiteNumber(pair.priceUsd);
  return {
    assetId: evidence.assetId,
    address: canonicalAddress,
    name,
    symbol,
    priceUsd: priceUsd !== null && priceUsd > 0 ? priceUsd : null,
    liquidityUsd: nonNegativeNumber(pair.liquidity?.usd),
    marketCapUsd: nonNegativeNumber(pair.marketCap) ?? nonNegativeNumber(pair.fdv),
    volume24h: nonNegativeNumber(pair.volume?.h24),
    priceChange24h: finiteNumber(pair.priceChange?.h24),
    ageMinutes: pairCreatedAt !== null && pairCreatedAt > 0 ? Math.max(0, (Date.now() - pairCreatedAt) / 60_000) : null,
    signal: signalFor(pair),
    imageUri: canonicalAddress.toLowerCase() === ROBINHOOD_RMT_ADDRESS.toLowerCase()
      ? RMT_TOKEN_ARTWORK
      : safeTokenArtworkUrl(pair.info?.imageUrl) ?? undefined,
    pairAddress,
    dexId: text(pair.dexId, 30) || "DEX",
    url: text(pair.url, 300) || undefined
  };
}

async function fetchPairs(address: string, signal: AbortSignal, fetcher: Fetcher) {
  const response = await fetcher(`${PAIRS_API}/${CHAIN_SLUG}/${address}`, {
    headers: { Accept: "application/json" },
    next: { revalidate: 20 },
    signal
  });
  if (!response.ok) throw new Error(`Market directory upstream returned ${response.status}.`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Market directory upstream was malformed.");
  return payload as RawPair[];
}

export async function readVNextLegacyMarketDirectoryPage(
  fetcher: Fetcher = fetch
): Promise<VNextLegacyMarketDirectoryPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const batches = await Promise.all(DIRECTORY_TOKENS.map((address) =>
      fetchPairs(address, controller.signal, fetcher).catch(() => [])));
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
      evidenceByAsset.set(evidence.assetId, [...(evidenceByAsset.get(evidence.assetId) ?? []), evidence]);
      const market = marketFromPair(pair, evidence);
      if (market) candidatesByPool.set(`${evidence.assetId}:${evidence.pool.value.toLowerCase()}`, market);
    }
    const markets = [...evidenceByAsset.values()].flatMap((evidenceList): VNextDirectoryMarket[] => {
      const record = buildAssetMarketRecord(evidenceList);
      if (!record) return [];
      const candidate = record.primaryMarket
        ? candidatesByPool.get(`${record.assetId}:${record.primaryMarket.pool.value.toLowerCase()}`)
        : record.verifiedMarkets
            .map((evidence) => candidatesByPool.get(`${record.assetId}:${evidence.pool.value.toLowerCase()}`))
            .find(Boolean);
      if (!candidate) return [];
      const imageUri = candidate.imageUri ?? evidenceList
        .map((evidence) => candidatesByPool.get(`${record.assetId}:${evidence.pool.value.toLowerCase()}`)?.imageUri)
        .find(Boolean);
      return [{
        ...candidate,
        imageUri,
        primaryMarket: record.primaryMarket ?? undefined,
        verifiedMarkets: record.verifiedMarkets
      }];
    })
      .sort((left, right) => (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1)
        || (right.volume24h ?? -1) - (left.volume24h ?? -1))
      .slice(0, VNEXT_MARKET_DIRECTORY_MAX_MARKETS);
    if (markets.length === 0) throw new Error("Market directory returned no usable assets.");
    lastSnapshot = { markets, updatedAt: new Date().toISOString() };
    return {
      status: 200,
      body: lastSnapshot,
      headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" }
    };
  } catch {
    if (lastSnapshot) {
      return {
        status: 200,
        body: { ...lastSnapshot, stale: true, error: "Market directory refresh is delayed." },
        headers: { "Cache-Control": "no-store" }
      };
    }
    return {
      status: 503,
      body: { error: "Market directory is temporarily unavailable." },
      headers: { "Cache-Control": "no-store" }
    };
  } finally {
    clearTimeout(timeout);
  }
}
