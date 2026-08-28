import { getAddress, isAddress, zeroAddress } from "viem";
import { rankExternalMarket } from "../external-market-ranking";
import { buildAssetMarketRecord, type AssetMarketEvidence } from "../external-market";
import { normalizeProviderPairForAsset } from "../external-market-identity";
import {
  VNEXT_MARKET_DIRECTORY_MAX_MARKETS,
  type VNextDirectoryMarket,
  type VNextDirectoryResponse
} from "../vnext/market-directory";
import {
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "../vnext/robinhood-assets";
import { safeTokenArtworkUrl } from "../vnext/token-artwork";

const CHAIN_SLUG = "robinhood";
const PAIRS_API = "https://api.dexscreener.com/token-pairs/v1";
const DIRECTORY_TOKENS = [ROBINHOOD_USDG_ADDRESS, ROBINHOOD_WETH_ADDRESS] as const;
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
  volume?: { m5?: unknown; h1?: unknown; h24?: unknown };
  priceChange?: { m5?: unknown; h1?: unknown; h24?: unknown };
  txns?: {
    m5?: { buys?: unknown; sells?: unknown };
    h1?: { buys?: unknown; sells?: unknown };
    h24?: { buys?: unknown; sells?: unknown };
  };
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
  return null;
}

function nonNegativeInteger(value: unknown) {
  const parsed = nonNegativeNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function rankingFor(pair: RawPair) {
  const liquidityUsd = nonNegativeNumber(pair.liquidity?.usd);
  const marketCapUsd = nonNegativeNumber(pair.marketCap) ?? nonNegativeNumber(pair.fdv);
  const volume5m = nonNegativeNumber(pair.volume?.m5);
  const volume1h = nonNegativeNumber(pair.volume?.h1);
  const volume24h = nonNegativeNumber(pair.volume?.h24);
  const priceChange5m = finiteNumber(pair.priceChange?.m5);
  const priceChange1h = finiteNumber(pair.priceChange?.h1);
  const buys5m = nonNegativeInteger(pair.txns?.m5?.buys);
  const sells5m = nonNegativeInteger(pair.txns?.m5?.sells);
  const buys1h = nonNegativeInteger(pair.txns?.h1?.buys);
  const sells1h = nonNegativeInteger(pair.txns?.h1?.sells);
  if ([
    liquidityUsd,
    marketCapUsd,
    volume5m,
    volume1h,
    volume24h,
    priceChange5m,
    priceChange1h,
    buys5m,
    sells5m,
    buys1h,
    sells1h
  ].some((value) => value === null)) return null;
  const pairCreatedAt = nonNegativeNumber(pair.pairCreatedAt);
  return rankExternalMarket({
    liquidityUsd: liquidityUsd!,
    marketCapUsd: marketCapUsd!,
    volume5m: volume5m!,
    volume1h: volume1h!,
    volume24h: volume24h!,
    priceChange5m: priceChange5m!,
    priceChange1h: priceChange1h!,
    buys5m: buys5m!,
    sells5m: sells5m!,
    buys1h: buys1h!,
    sells1h: sells1h!,
    pairCreatedAt
  });
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
  const ranking = rankingFor(pair);
  return {
    assetId: evidence.assetId,
    address: canonicalAddress,
    name,
    symbol,
    priceUsd: priceUsd !== null && priceUsd > 0 ? priceUsd : null,
    liquidityUsd: nonNegativeNumber(pair.liquidity?.usd),
    marketCapUsd: nonNegativeNumber(pair.marketCap),
    fdvUsd: nonNegativeNumber(pair.fdv),
    volume5m: nonNegativeNumber(pair.volume?.m5),
    volume1h: nonNegativeNumber(pair.volume?.h1),
    volume24h: nonNegativeNumber(pair.volume?.h24),
    priceChange5m: finiteNumber(pair.priceChange?.m5),
    priceChange1h: finiteNumber(pair.priceChange?.h1),
    priceChange24h: finiteNumber(pair.priceChange?.h24),
    buys5m: nonNegativeInteger(pair.txns?.m5?.buys),
    sells5m: nonNegativeInteger(pair.txns?.m5?.sells),
    buys1h: nonNegativeInteger(pair.txns?.h1?.buys),
    sells1h: nonNegativeInteger(pair.txns?.h1?.sells),
    buys24h: nonNegativeInteger(pair.txns?.h24?.buys),
    sells24h: nonNegativeInteger(pair.txns?.h24?.sells),
    pairCreatedAt: pairCreatedAt !== null && pairCreatedAt > 0 ? pairCreatedAt : null,
    ageMinutes: pairCreatedAt !== null && pairCreatedAt > 0 ? Math.max(0, (Date.now() - pairCreatedAt) / 60_000) : null,
    momentumScore: ranking?.momentumScore ?? null,
    buyPressureBps: ranking?.buyPressureBps ?? null,
    riskFlags: ranking?.riskFlags ?? null,
    signal: ranking?.signal ?? null,
    imageUri: safeTokenArtworkUrl(pair.info?.imageUrl) ?? undefined,
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
