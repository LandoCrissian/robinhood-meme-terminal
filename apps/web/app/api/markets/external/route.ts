import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import type { OriginCoverage } from "@rmt/shared/market-origin";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  selectPreferredLifecycleMarket,
  type ExternalMarket,
  type ExternalMarketResponse
} from "../../../../lib/external-market";
import { isNonzeroEvmAddress, selectExternalPairBaseToken } from "../../../../lib/external-market-identity";
import {
  RUNNER_THRESHOLDS,
  compareExternalMarketRank,
  rankExternalMarket
} from "../../../../lib/external-market-ranking";
import { enrichExternalProjectMetadata } from "../../../../lib/server/external-project-metadata";
import { safeDexImageUri } from "../../../../lib/server/external-market-media";
import { fetchLemonProjectSnapshot } from "../../../../lib/server/lemon-project-feed";

const CHAIN_SLUG = "robinhood";
const DEXSCREENER_TOKEN_PAIRS_API = "https://api.dexscreener.com/token-pairs/v1";
const DEXSCREENER_TOKENS_API = "https://api.dexscreener.com/tokens/v1";
const DEXSCREENER_PROFILES_API = "https://api.dexscreener.com/token-profiles/latest/v1";
const DEXSCREENER_BOOSTS_API = "https://api.dexscreener.com/token-boosts/top/v1";
const DEXSCREENER_PAGE = "https://dexscreener.com/robinhood/";
const PREVIEW_MARKET_UPSTREAM = "https://www.rmtlaunch.fun/api/markets/external";
const CANONICAL_MARKET_TOKENS = [
  "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
] as const;
const OFFICIAL_RMT_V6_TOKEN = "0xdBa33be56C89CC9fc014c4459028d7e5c7878671";
const EXCLUDED_TOKENS = new Set(CANONICAL_MARKET_TOKENS.map((address) => address.toLowerCase()));
const MAX_MARKETS = 48;
const DEX_BATCH_SIZE = 30;
const DEX_TIMEOUT_MS = 8_000;
const INDEXER_TIMEOUT_MS = (() => {
  const parsed = Number.parseInt(process.env.RMT_INDEXER_TIMEOUT_MS ?? "5000", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 5_000;
})();

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
  info?: {
    imageUrl?: unknown;
  };
};

type RawDiscoveryToken = {
  chainId?: unknown;
  tokenAddress?: unknown;
};

type RmtOriginClaim = {
  token?: unknown;
  state?: unknown;
  claimKind?: unknown;
  protocolVersion?: unknown;
};

type RmtOriginPayload = {
  coverage?: unknown;
  claims?: unknown;
};

type RmtOriginResolution = {
  coverage: OriginCoverage;
  tokens: Set<string>;
};

type SuccessfulMarketSnapshot = Required<Pick<
  ExternalMarketResponse,
  "markets" | "source" | "rankingVersion" | "updatedAt"
>> & {
  originCoverage: OriginCoverage;
  rmtOriginCoverage: OriginCoverage;
  thresholds: typeof RUNNER_THRESHOLDS;
};

let lastSuccessfulSnapshot: SuccessfulMarketSnapshot | undefined;

const projectMetadataClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_MAINNET_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? process.env.NEXT_PUBLIC_RMT_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 1, timeout: 6_000 }
  )
});

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
  return selectExternalPairBaseToken(pair.baseToken, pair.quoteToken, EXCLUDED_TOKENS);
}

async function fetchPublicDiscoveryTokens() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEX_TIMEOUT_MS);
  try {
    const payloads = await Promise.all(
      [DEXSCREENER_PROFILES_API, DEXSCREENER_BOOSTS_API].map(async (url) => {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          next: { revalidate: 60 },
          signal: controller.signal
        });
        if (!response.ok) return [];
        const payload: unknown = await response.json();
        return Array.isArray(payload) ? payload as RawDiscoveryToken[] : [];
      })
    );
    return [...new Set(payloads.flat().flatMap((item) => {
      const address = asText(item.tokenAddress, 42);
      return item.chainId === CHAIN_SLUG && isNonzeroEvmAddress(address)
        ? [address.toLowerCase()]
        : [];
    }))];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTokenBatch(tokenAddresses: string[]) {
  if (tokenAddresses.length === 0 || tokenAddresses.length > DEX_BATCH_SIZE) {
    throw new Error("DEX market batch size is invalid.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEX_TIMEOUT_MS);
  try {
    const response = await fetch(DEXSCREENER_TOKENS_API + "/" + CHAIN_SLUG + "/" + tokenAddresses.join(","), {
      headers: { Accept: "application/json" },
      next: { revalidate: 30 },
      signal: controller.signal
    });

    if (!response.ok) throw new Error("DEX market request failed with " + response.status);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("DEX market response was malformed.");
    return payload as RawPair[];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCanonicalTokenPairs(tokenAddress: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEX_TIMEOUT_MS);
  try {
    const response = await fetch(DEXSCREENER_TOKEN_PAIRS_API + "/" + CHAIN_SLUG + "/" + tokenAddress, {
      headers: { Accept: "application/json" },
      next: { revalidate: 30 },
      signal: controller.signal
    });
    if (!response.ok) throw new Error("DEX canonical market request failed with " + response.status);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("DEX canonical market response was malformed.");
    return payload as RawPair[];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRmtOriginBatch(baseUrl: string, readToken: string | undefined, addresses: string[]) {
  const url = new URL(baseUrl + "/origins");
  url.searchParams.set("tokens", addresses.join(","));
  const headers: Record<string, string> = { Accept: "application/json" };
  if (readToken) headers.Authorization = "Bearer " + readToken;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers,
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as RmtOriginPayload;
    return payload.coverage === "complete" && Array.isArray(payload.claims)
      ? payload.claims as RmtOriginClaim[]
      : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePreviewRmtOrigins(addresses: string[]): Promise<RmtOriginResolution | null> {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXER_TIMEOUT_MS);
  try {
    const response = await fetch(PREVIEW_MARKET_UPSTREAM, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as ExternalMarketResponse;
    if (payload.rmtOriginCoverage !== "complete" || !Array.isArray(payload.markets)) return null;

    const allowedExternalTokens = new Set(payload.markets.flatMap((market) =>
      isNonzeroEvmAddress(market.address) ? [market.address.toLowerCase()] : []
    ));
    if (allowedExternalTokens.size === 0) return null;

    return {
      coverage: "complete",
      tokens: new Set([
        OFFICIAL_RMT_V6_TOKEN.toLowerCase(),
        ...addresses
          .map((address) => address.toLowerCase())
          .filter((address) => !allowedExternalTokens.has(address))
      ])
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRmtOrigins(addresses: string[]): Promise<RmtOriginResolution> {
  const known = new Set([OFFICIAL_RMT_V6_TOKEN.toLowerCase()]);
  if (addresses.length === 0) return { coverage: "complete", tokens: known };

  const baseUrl = process.env.RMT_INDEXER_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return await resolvePreviewRmtOrigins(addresses)
      ?? { coverage: "unavailable", tokens: known };
  }
  const readToken = process.env.RMT_INDEXER_READ_TOKEN?.trim();

  for (let index = 0; index < addresses.length; index += 100) {
    const claims = await fetchRmtOriginBatch(baseUrl, readToken, addresses.slice(index, index + 100));
    if (!claims) {
      return await resolvePreviewRmtOrigins(addresses)
        ?? { coverage: "unavailable", tokens: known };
    }
    for (const claim of claims) {
      const token = asText(claim.token, 42);
      if (
        isNonzeroEvmAddress(token)
        && claim.state === "rmt-verified"
        && claim.claimKind === "token-created"
        && claim.protocolVersion === 6
      ) {
        known.add(token.toLowerCase());
      }
    }
  }
  return { coverage: "complete", tokens: known };
}

function staleResponse() {
  if (!lastSuccessfulSnapshot) return null;
  return NextResponse.json(
    {
      ...lastSuccessfulSnapshot,
      stale: true,
      error: "Live external market refresh is delayed. Showing the last verified RMT-deduplicated snapshot."
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function GET() {
  try {
    const [lemonSnapshot, publicDiscoveryTokens] = await Promise.all([
      fetchLemonProjectSnapshot(),
      fetchPublicDiscoveryTokens().catch(() => [])
    ]);
    const requestedTokens = [...new Set(
      [
        ...lemonSnapshot.candidateAddresses.map((address) => address.toLowerCase()),
        ...publicDiscoveryTokens
      ]
    )];
    const tokenBatches = Array.from(
      { length: Math.ceil(requestedTokens.length / DEX_BATCH_SIZE) },
      (_, index) => requestedTokens.slice(index * DEX_BATCH_SIZE, (index + 1) * DEX_BATCH_SIZE)
    );
    const results = await Promise.all(
      [
        ...CANONICAL_MARKET_TOKENS.map((address) => fetchCanonicalTokenPairs(address).catch(() => [])),
        ...tokenBatches.map((addresses) => fetchTokenBatch(addresses).catch(() => []))
      ]
    );
    const pairs = results.flat();
    if (pairs.length === 0) {
      throw new Error("No external market source responded.");
    }

    const candidateAddresses = [...new Set(pairs.flatMap((pair) => {
      const address = asText(tokenFromPair(pair)?.address, 42);
      return isNonzeroEvmAddress(address) ? [address.toLowerCase()] : [];
    }))];
    const rmtOrigins = await resolveRmtOrigins(candidateAddresses);
    if (rmtOrigins.coverage !== "complete") {
      const stale = staleResponse();
      if (stale) return stale;
      throw new Error("Exact RMT V6 origin coverage is unavailable.");
    }

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
      const dexId = asText(pair.dexId, 30) || "DEX";
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

      if (!isNonzeroEvmAddress(address) || !name || !symbol || !pairAddress) continue;
      if (rmtOrigins.tokens.has(address.toLowerCase())) continue;
      if (liquidityUsd < RUNNER_THRESHOLDS.minimumDisplayLiquidityUsd || volume24h <= 0) continue;

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
        imageUri: safeDexImageUri(pair.info?.imageUrl),
        pairAddress,
        url,
        dexId,
        origin: {
          kind: "external",
          state: "unknown",
          coverage: "unavailable"
        },
        venue: {
          kind: "dex",
          dexId,
          pairAddress,
          url,
          execution: "read-only"
        },
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
      const lemonProject = lemonSnapshot.projects.get(address.toLowerCase());
      const attributedMarket = lemonProject
        && lemonProject.launchPool.toLowerCase() === pairAddress.toLowerCase()
        ? {
            ...market,
            name: lemonProject.name,
            symbol: lemonProject.symbol,
            project: lemonProject
          }
        : market;

      const key = address.toLowerCase();
      const existing = marketsByToken.get(key);
      marketsByToken.set(key, selectPreferredLifecycleMarket(existing, attributedMarket));
    }

    const rankedMarkets = [...marketsByToken.values()]
      .sort(compareExternalMarketRank)
      .slice(0, MAX_MARKETS);
    const markets = await enrichExternalProjectMetadata(projectMetadataClient, rankedMarkets)
      .catch(() => rankedMarkets);
    const snapshot: SuccessfulMarketSnapshot = {
      markets,
      source: lemonSnapshot.projects.size > 0
        ? "DEX Screener markets + public discovery + Lemon metadata"
        : "DEX Screener markets + public discovery",
      rankingVersion: "rmt-discovery-v4",
      thresholds: RUNNER_THRESHOLDS,
      originCoverage: "unavailable",
      rmtOriginCoverage: "complete",
      updatedAt: new Date().toISOString()
    };
    lastSuccessfulSnapshot = snapshot;

    return NextResponse.json(
      lemonSnapshot.delayed
        ? {
            ...snapshot,
            stale: true,
            error: "Lemon metadata refresh is delayed. DEX markets and cached project identity remain available."
          }
        : snapshot,
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=90" } }
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "external_market_refresh_failed",
      error: error instanceof Error ? error.message.slice(0, 1_000) : "unknown"
    }));
    const stale = staleResponse();
    if (stale) return stale;
    return NextResponse.json(
      { error: "External Robinhood Chain markets are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
