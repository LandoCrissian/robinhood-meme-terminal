import { NextResponse } from "next/server";
import type { OriginCoverage } from "@rmt/shared/market-origin";
import {
  selectPreferredLifecycleMarket,
  type ExternalMarket,
  type ExternalMarketResponse
} from "../../../../lib/external-market";
import {
  canonicalExternalMarketLookupAddress,
  isNonzeroEvmAddress,
  selectExternalPairBaseTokenWithAssetQuotes
} from "../../../../lib/external-market-identity";
import {
  RUNNER_THRESHOLDS,
  compareExternalMarketRank,
  rankExternalMarket
} from "../../../../lib/external-market-ranking";
import { safeDexImageUri } from "../../../../lib/server/external-market-media";
import { externalMarketSocialsFromPairInfo } from "../../../../lib/external-market-socials";
import {
  fetchSushiLaunchSnapshot,
  type SushiLaunchSnapshot
} from "../../../../lib/server/sushi-launch-feed";
import {
  fetchGeckoNewPoolSnapshot,
  type GeckoNewPoolPair
} from "../../../../lib/server/gecko-new-pool-feed";
import {
  parseDexDiscoveryMetadata,
  type PublicDiscoverySnapshot
} from "../../../../lib/server/dex-discovery-metadata";
import {
  fetchRobinhoodStockRegistry,
  stockAssetRelationshipsForPair
} from "../../../../lib/server/robinhood-stock-token-registry";
import {
  marketFromUniversalResolution,
  resolveUniversalMarketAddress
} from "../../../../lib/server/universal-market-resolver";

const CHAIN_SLUG = "robinhood";
const DEXSCREENER_TOKEN_PAIRS_API = "https://api.dexscreener.com/token-pairs/v1";
const DEXSCREENER_TOKENS_API = "https://api.dexscreener.com/tokens/v1";
const DEXSCREENER_PAIR_API = "https://api.dexscreener.com/latest/dex/pairs";
const DEXSCREENER_PROFILES_API = "https://api.dexscreener.com/token-profiles/latest/v1";
const DEXSCREENER_LATEST_BOOSTS_API = "https://api.dexscreener.com/token-boosts/latest/v1";
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
    websites?: unknown;
    socials?: unknown;
  };
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
  stockAssetCoverage: "complete" | "unavailable";
  thresholds: typeof RUNNER_THRESHOLDS;
};

let lastSuccessfulSnapshot: SuccessfulMarketSnapshot | undefined;

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

function tokenFromPair(pair: RawPair, stockTokenAddresses: ReadonlySet<string>) {
  return selectExternalPairBaseTokenWithAssetQuotes(
    pair.baseToken,
    pair.quoteToken,
    EXCLUDED_TOKENS,
    stockTokenAddresses
  );
}

async function fetchPublicDiscoveryTokens() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEX_TIMEOUT_MS);
  try {
    const payloads = await Promise.all(
      [DEXSCREENER_PROFILES_API, DEXSCREENER_LATEST_BOOSTS_API, DEXSCREENER_BOOSTS_API].map(async (url) => {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          next: { revalidate: 60 },
          signal: controller.signal
        });
        if (!response.ok) return [];
        const payload: unknown = await response.json();
        return Array.isArray(payload) ? payload : [];
      })
    );
    return parseDexDiscoveryMetadata(payloads);
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

async function fetchPairByAddress(pairAddress: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEX_TIMEOUT_MS);
  try {
    const response = await fetch(DEXSCREENER_PAIR_API + "/" + CHAIN_SLUG + "/" + pairAddress, {
      headers: { Accept: "application/json" },
      next: { revalidate: 30 },
      signal: controller.signal
    });
    if (!response.ok) throw new Error("DEX pair lookup failed with " + response.status);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return [];
    const pairs = (payload as { pairs?: unknown }).pairs;
    return Array.isArray(pairs) ? pairs as RawPair[] : [];
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

async function resolvePreviewRmtOrigins(
  addresses: string[],
  verifiedExternalTokens: Set<string>
): Promise<RmtOriginResolution | null> {
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
          .filter((address) => !allowedExternalTokens.has(address) && !verifiedExternalTokens.has(address))
      ])
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRmtOrigins(
  addresses: string[],
  verifiedExternalTokens = new Set<string>()
): Promise<RmtOriginResolution> {
  const known = new Set([OFFICIAL_RMT_V6_TOKEN.toLowerCase()]);
  if (addresses.length === 0) return { coverage: "complete", tokens: known };

  const baseUrl = process.env.RMT_INDEXER_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return await resolvePreviewRmtOrigins(addresses, verifiedExternalTokens)
      ?? { coverage: "unavailable", tokens: known };
  }
  const readToken = process.env.RMT_INDEXER_READ_TOKEN?.trim();

  for (let index = 0; index < addresses.length; index += 100) {
    const claims = await fetchRmtOriginBatch(baseUrl, readToken, addresses.slice(index, index + 100));
    if (!claims) {
      return await resolvePreviewRmtOrigins(addresses, verifiedExternalTokens)
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

export async function GET(request: Request) {
  const lookupParameter = new URL(request.url).searchParams.get("contract");
  const requestedContract = canonicalExternalMarketLookupAddress(lookupParameter);
  if (lookupParameter !== null && !requestedContract) {
    return NextResponse.json(
      { error: "A complete nonzero EVM contract address is required." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const directResultsPromise = requestedContract
      ? Promise.all([
          fetchPairByAddress(requestedContract).catch(() => []),
          fetchCanonicalTokenPairs(requestedContract).catch(() => [])
        ])
      : null;
    let sushiLaunchSnapshot: SushiLaunchSnapshot;
    let publicDiscoverySnapshot: PublicDiscoverySnapshot;
    let geckoNewPoolPairs: GeckoNewPoolPair[];
    let geckoNewPoolsDelayed: boolean;
    let stockRegistry: Awaited<ReturnType<typeof fetchRobinhoodStockRegistry>>;
    if (requestedContract) {
      sushiLaunchSnapshot = { projects: new Map(), candidateAddresses: [], delayed: false };
      publicDiscoverySnapshot = { tokenAddresses: [], metadata: new Map() };
      geckoNewPoolPairs = [];
      geckoNewPoolsDelayed = false;
      stockRegistry = await fetchRobinhoodStockRegistry();
    } else {
      [sushiLaunchSnapshot, publicDiscoverySnapshot, stockRegistry, { pairs: geckoNewPoolPairs, delayed: geckoNewPoolsDelayed }] = await Promise.all([
        fetchSushiLaunchSnapshot(),
        fetchPublicDiscoveryTokens().catch(() => ({ tokenAddresses: [], metadata: new Map() })),
        fetchRobinhoodStockRegistry(),
        fetchGeckoNewPoolSnapshot()
      ]);
    }
    const stockTokenAddresses = new Set(stockRegistry.assetsByAddress.keys());
    const requestedTokens = [...new Set(
      [
        ...sushiLaunchSnapshot.candidateAddresses.map((address) => address.toLowerCase()),
        ...geckoNewPoolPairs.map((pair) => pair.baseToken.address.toLowerCase()),
        ...publicDiscoverySnapshot.tokenAddresses,
        ...(requestedContract ? [requestedContract] : [])
      ]
    )];
    const tokenBatches = Array.from(
      { length: Math.ceil(requestedTokens.length / DEX_BATCH_SIZE) },
      (_, index) => requestedTokens.slice(index * DEX_BATCH_SIZE, (index + 1) * DEX_BATCH_SIZE)
    );
    const results = directResultsPromise
      ? await directResultsPromise
      : await Promise.all([
          ...CANONICAL_MARKET_TOKENS.map((address) => fetchCanonicalTokenPairs(address).catch(() => [])),
          ...tokenBatches.map((addresses) => fetchTokenBatch(addresses).catch(() => []))
        ]);
    const pairs: RawPair[] = [...results.flat(), ...geckoNewPoolPairs];
    if (pairs.length === 0) {
      if (requestedContract) {
        const resolution = await resolveUniversalMarketAddress(requestedContract, stockRegistry);
        const resolvedMarket = resolution
          ? marketFromUniversalResolution(resolution, stockRegistry)
          : null;
        return NextResponse.json(
          {
            markets: resolvedMarket ? [resolvedMarket] : [],
            resolution: resolution ?? undefined,
            source: resolution
              ? "RMT Universal Market Resolver · verified Robinhood Chain contract reads"
              : "RMT Universal Market Resolver",
            rankingVersion: "rmt-universal-resolver-v1",
            thresholds: RUNNER_THRESHOLDS,
            originCoverage: "unavailable",
            rmtOriginCoverage: "unavailable",
            stockAssetCoverage: stockRegistry.coverage,
            updatedAt: new Date().toISOString()
          },
          { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" } }
        );
      }
      throw new Error("No external market source responded.");
    }

    const candidateAddresses = [...new Set(pairs.flatMap((pair) => {
      const address = asText(tokenFromPair(pair, stockTokenAddresses)?.address, 42);
      return isNonzeroEvmAddress(address) ? [address.toLowerCase()] : [];
    }))];
    const rmtOrigins = await resolveRmtOrigins(
      candidateAddresses,
      new Set(sushiLaunchSnapshot.projects.keys())
    );
    if (rmtOrigins.coverage !== "complete") {
      const stale = requestedContract ? null : staleResponse();
      if (stale) return stale;
      if (!requestedContract) {
        throw new Error("Exact RMT V6 origin coverage is unavailable.");
      }
    }

    const marketsByToken = new Map<string, ExternalMarket>();

    for (const pair of pairs) {
      if (pair.chainId !== CHAIN_SLUG) continue;

      const url = asText(pair.url, 300);
      if (!url.startsWith(DEXSCREENER_PAGE)) continue;

      const token = tokenFromPair(pair, stockTokenAddresses);
      const address = asText(token?.address, 42);
      const name = asText(token?.name);
      const symbol = asText(token?.symbol, 20);
      const pairAddress = asText(pair.pairAddress, 66);
      const dexId = asText(pair.dexId, 30) || "DEX";
      const baseTokenAddress = asText(pair.baseToken?.address, 42);
      const quoteTokenAddress = asText(pair.quoteToken?.address, 42);
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
      const exactContractLookup = requestedContract === address.toLowerCase()
        || requestedContract === pairAddress.toLowerCase();
      if (
        !exactContractLookup
        && (liquidityUsd < RUNNER_THRESHOLDS.minimumDisplayLiquidityUsd || volume24h <= 0)
      ) continue;

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

      const discoveryMetadata = publicDiscoverySnapshot.metadata.get(address.toLowerCase());
      const market: ExternalMarket = {
        address,
        name,
        symbol,
        imageUri: safeDexImageUri(pair.info?.imageUrl) ?? discoveryMetadata?.imageUri,
        socials: externalMarketSocialsFromPairInfo(pair.info) ?? discoveryMetadata?.socials,
        pairAddress,
        url,
        dexId,
        stockAssetRelationships:
          isNonzeroEvmAddress(baseTokenAddress) && isNonzeroEvmAddress(quoteTokenAddress)
            ? stockAssetRelationshipsForPair(
                address,
                baseTokenAddress,
                quoteTokenAddress,
                stockRegistry.assetsByAddress
              )
            : [],
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
      const sushiLaunchProject = sushiLaunchSnapshot.projects.get(address.toLowerCase());
      const matchingProject = sushiLaunchProject?.launchPool.toLowerCase() === pairAddress.toLowerCase()
        ? sushiLaunchProject
        : undefined;
      const attributedMarket = matchingProject
        ? {
            ...market,
            name: matchingProject.name,
            symbol: matchingProject.symbol,
            project: matchingProject
          }
        : market;

      const key = address.toLowerCase();
      const existing = marketsByToken.get(key);
      const preferred = selectPreferredLifecycleMarket(existing, attributedMarket);
      const stockAssetRelationships = [...new Map([
        ...(existing?.stockAssetRelationships ?? []),
        ...(attributedMarket.stockAssetRelationships ?? [])
      ].map((relationship) => [
        `${relationship.relationship}:${relationship.contractAddress.toLowerCase()}`,
        relationship
      ])).values()];
      marketsByToken.set(key, {
        ...preferred,
        imageUri: preferred.imageUri ?? existing?.imageUri ?? attributedMarket.imageUri,
        socials: preferred.socials ?? existing?.socials ?? attributedMarket.socials,
        stockAssetRelationships
      });
    }

    const rankedMarkets = requestedContract
      ? [...marketsByToken.values()].filter((market) =>
          market.address.toLowerCase() === requestedContract
          || market.pairAddress.toLowerCase() === requestedContract
        )
      : [...marketsByToken.values()]
          .sort(compareExternalMarketRank)
          .slice(0, MAX_MARKETS);
    let markets = rankedMarkets;
    let resolution;
    if (requestedContract && markets.length === 0) {
      resolution = await resolveUniversalMarketAddress(requestedContract, stockRegistry);
      const resolvedMarket = resolution
        ? marketFromUniversalResolution(resolution, stockRegistry)
        : null;
      if (resolvedMarket) markets = [resolvedMarket];
    }
    const snapshot: SuccessfulMarketSnapshot = {
      markets,
      source: "DEX Screener markets + GeckoTerminal newest pools + public discovery + verified Sushi Launch metadata + Robinhood Stock Token registry",
      rankingVersion: "rmt-discovery-v6",
      thresholds: RUNNER_THRESHOLDS,
      originCoverage: "unavailable",
      rmtOriginCoverage: rmtOrigins.coverage,
      stockAssetCoverage: stockRegistry.coverage,
      updatedAt: new Date().toISOString()
    };
    if (!requestedContract) lastSuccessfulSnapshot = snapshot;

    const delayedSources = [
      ...(sushiLaunchSnapshot.delayed ? ["sushi-launch-metadata"] : []),
      ...(geckoNewPoolsDelayed ? ["geckoterminal-new-pools"] : [])
    ];

    return NextResponse.json(
      {
        ...snapshot,
        resolution,
        ...(delayedSources.length > 0 ? { delayedSources } : {})
      },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=90" } }
    );
  } catch (error) {
    console.error(JSON.stringify({
      event: "external_market_refresh_failed",
      error: error instanceof Error ? error.message.slice(0, 1_000) : "unknown"
    }));
    const stale = requestedContract ? null : staleResponse();
    if (stale) return stale;
    return NextResponse.json(
      { error: "External Robinhood Chain markets are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
