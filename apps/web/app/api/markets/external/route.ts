import { NextResponse } from "next/server";
import { createPublicClient, getAddress, http } from "viem";
import type { OriginCoverage } from "@rmt/shared/market-origin";
import { robinhoodChain } from "@rmt/shared/chains";
import {
  buildAssetMarketRecord,
  type AssetMarketRecord,
  type AssetMarketEvidence,
  type ExternalMarket,
  type ExternalMarketResponse
} from "../../../../lib/external-market";
import {
  canonicalExternalMarketLookupAddress,
  isNonzeroEvmAddress,
  normalizeProviderPairForAsset,
  selectExternalPairBaseTokenWithAssetQuotes
} from "../../../../lib/external-market-identity";
import {
  RUNNER_THRESHOLDS,
  compareExternalMarketRank,
  rankExternalMarket
} from "../../../../lib/external-market-ranking";
import { safeDexImageUri } from "../../../../lib/server/external-market-media";
import { externalMarketSocialsFromPairInfo } from "../../../../lib/external-market-socials";
import type { SushiLaunchSnapshot } from "../../../../lib/server/sushi-launch-feed";
import { fetchCurrentLaunchpadSnapshot, type CurrentLaunchpadSnapshot } from "../../../../lib/server/current-launchpad-feed";
import { mergeLaunchpadEvidenceOntoMarket } from "../../../../lib/launchpad-lifecycle";
import {
  fetchGeckoPoolSnapshot,
  type GeckoPoolFeedId,
  type GeckoPoolPair
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
import { readCompleteV6OriginTokensFromChain } from "../../../../lib/server/launch-feed";
import { VNEXT_MARKET_DIRECTORY_MAX_MARKETS } from "../../../../lib/vnext/market-directory";
import type { VNextDirectoryMarket } from "../../../../lib/vnext/market-directory";
import { applyProjectIdentityDirectoryAdmission } from "../../../../lib/server/project-identity-admission";
import {
  BoundedInFlightCoalescer,
  EXTERNAL_BROAD_CACHE_CONTROL,
  EXTERNAL_BROAD_MAX_IN_FLIGHT,
  EXTERNAL_BROAD_REFRESH_KEY,
  EXTERNAL_CONTRACT_CACHE_CONTROL,
  EXTERNAL_CONTRACT_RESOLVER_CACHE_CONTROL
} from "../../../../lib/server/external-market-refresh-policy";

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
const EXCLUDED_TOKENS = new Set(CANONICAL_MARKET_TOKENS.map((address) => address.toLowerCase()));
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
  discoveryFeeds?: unknown;
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

type ProviderDirectoryMarket = VNextDirectoryMarket & Pick<ExternalMarket, "origin" | "venue" | "launchpadEvidence"> & {
  pairAddress: string;
  fdvUsd: number | null;
  stockAssetRelationships?: ExternalMarket["stockAssetRelationships"];
  project?: ExternalMarket["project"];
  socials?: ExternalMarket["socials"];
};

type SuccessfulMarketSnapshot = {
  markets: Array<ProviderDirectoryMarket | ExternalMarket>;
  source: string;
  rankingVersion: string;
  updatedAt: string;
  assetRecords: AssetMarketRecord[];
  directoryAdmission: "admitted";
  originCoverage: OriginCoverage;
  rmtOriginCoverage: OriginCoverage;
  stockAssetCoverage: "complete" | "stale" | "unavailable";
  thresholds: typeof RUNNER_THRESHOLDS;
};

let lastSuccessfulSnapshot: SuccessfulMarketSnapshot | undefined;
const broadExternalRefreshes = new BoundedInFlightCoalescer<Response>(EXTERNAL_BROAD_MAX_IN_FLIGHT);

const robinhoodClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(process.env.RMT_RPC_URL ?? process.env.NEXT_PUBLIC_RMT_RPC_URL ?? robinhoodChain.rpcUrls.default.http[0])
});

function emptyCurrentLaunchpadSnapshot(): CurrentLaunchpadSnapshot {
  return {
    markets: [],
    sushi: { projects: new Map(), lifecycle: new Map(), candidateAddresses: [], delayed: true },
    delayedSources: ["current-launchpad-discovery"],
    coverage: "unavailable"
  };
}

function asText(value: unknown, maximumLength = 80) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function finiteNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value: unknown) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function nonNegativeInteger(value: unknown) {
  const number = nonNegativeNumber(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function transactionWindow(pair: RawPair, window: string) {
  return {
    buys: nonNegativeInteger(pair.txns?.[window]?.buys),
    sells: nonNegativeInteger(pair.txns?.[window]?.sells)
  };
}

function rankingFor(pair: RawPair, evidence: AssetMarketEvidence) {
  const volume5m = nonNegativeNumber(pair.volume?.m5);
  const volume1h = nonNegativeNumber(pair.volume?.h1);
  const priceChange5m = finiteNumber(pair.priceChange?.m5);
  const priceChange1h = finiteNumber(pair.priceChange?.h1);
  const transactions5m = transactionWindow(pair, "m5");
  const transactions1h = transactionWindow(pair, "h1");
  if ([
    evidence.liquidityUsd,
    volume5m,
    volume1h,
    priceChange5m,
    priceChange1h,
    transactions5m.buys,
    transactions5m.sells,
    transactions1h.buys,
    transactions1h.sells
  ].some((value) => value === null)) return null;
  return rankExternalMarket({
    liquidityUsd: evidence.liquidityUsd!,
    marketCapUsd: evidence.marketCapUsd ?? evidence.fdvUsd ?? 0,
    volume5m: volume5m!,
    volume1h: volume1h!,
    volume24h: evidence.volume24h ?? 0,
    priceChange5m: priceChange5m!,
    priceChange1h: priceChange1h!,
    buys5m: transactions5m.buys!,
    sells5m: transactions5m.sells!,
    buys1h: transactions1h.buys!,
    sells1h: transactions1h.sells!,
    pairCreatedAt: evidence.pairCreatedAt
  });
}

function fullyRankedMarket(market: ProviderDirectoryMarket) {
  return market.signal !== null
    && market.momentumScore !== null
    && market.volume5m !== null
    && market.volume1h !== null
    && market.liquidityUsd !== null;
}

function compareProviderDirectoryMarket(left: ProviderDirectoryMarket, right: ProviderDirectoryMarket) {
  if (fullyRankedMarket(left) && fullyRankedMarket(right)) {
    return compareExternalMarketRank(
      left as ExternalMarket,
      right as ExternalMarket
    );
  }
  if (fullyRankedMarket(left) !== fullyRankedMarket(right)) return fullyRankedMarket(left) ? -1 : 1;
  return (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1)
    || (right.volume24h ?? -1) - (left.volume24h ?? -1)
    || left.address.toLowerCase().localeCompare(right.address.toLowerCase())
    || (left.pairAddress ?? "~").toLowerCase().localeCompare((right.pairAddress ?? "~").toLowerCase());
}

function tokenFromPair(pair: RawPair, stockTokenAddresses: ReadonlySet<string>) {
  return selectExternalPairBaseTokenWithAssetQuotes(
    pair.baseToken,
    pair.quoteToken,
    EXCLUDED_TOKENS,
    stockTokenAddresses
  );
}

function requestedTokenFromPair(
  pair: RawPair,
  requestedContract: string | null,
  stockTokenAddresses: ReadonlySet<string>
) {
  if (requestedContract) {
    const baseAddress = asText(pair.baseToken?.address, 42).toLowerCase();
    const quoteAddress = asText(pair.quoteToken?.address, 42).toLowerCase();
    if (baseAddress === requestedContract) return pair.baseToken;
    if (quoteAddress === requestedContract) return pair.quoteToken;
  }
  return tokenFromPair(pair, stockTokenAddresses);
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
  const known = new Set<string>();
  if (addresses.length === 0) return { coverage: "complete", tokens: known };

  const baseUrl = process.env.RMT_INDEXER_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return await resolvePreviewRmtOrigins(addresses, verifiedExternalTokens)
      ?? await resolveDirectRmtOrigins(known);
  }
  const readToken = process.env.RMT_INDEXER_READ_TOKEN?.trim();

  for (let index = 0; index < addresses.length; index += 100) {
    const claims = await fetchRmtOriginBatch(baseUrl, readToken, addresses.slice(index, index + 100));
    if (!claims) {
      return await resolvePreviewRmtOrigins(addresses, verifiedExternalTokens)
        ?? await resolveDirectRmtOrigins(known);
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

async function resolveDirectRmtOrigins(known: Set<string>): Promise<RmtOriginResolution> {
  try {
    const snapshot = await readCompleteV6OriginTokensFromChain();
    return { coverage: "complete", tokens: new Set([...known, ...snapshot.tokens]) };
  } catch {
    return { coverage: "unavailable", tokens: known };
  }
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

function notAdmittedResponse() {
  return NextResponse.json(
    {
      markets: [],
      assetRecords: [],
      directoryAdmission: "not_admitted",
      source: "RMT directory admission",
      updatedAt: new Date().toISOString()
    },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}

function withExternalMarketTiming(response: NextResponse, startedAt: number, cacheState: "fresh" | "last-known" | "error") {
  const totalMs = Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10);
  response.headers.set("Server-Timing", `external_enrichment;dur=${totalMs}`);
  response.headers.set("X-RMT-Enrichment-Freshness", cacheState);
  console.info(JSON.stringify({
    event: "external_market_enrichment_timing",
    totalMs,
    status: response.status,
    cacheState
  }));
  return response;
}

async function readExternalMarketResponse(request: Request, requestedContract: string | null) {
  const startedAt = performance.now();
  try {
    const directResultsPromise = requestedContract
      ? Promise.all([
          fetchPairByAddress(requestedContract).catch(() => []),
          fetchCanonicalTokenPairs(requestedContract).catch(() => [])
        ])
      : null;
    let sushiLaunchSnapshot: SushiLaunchSnapshot;
    let currentLaunchpadSnapshot: CurrentLaunchpadSnapshot;
    let publicDiscoverySnapshot: PublicDiscoverySnapshot;
    let geckoPoolPairs: GeckoPoolPair[];
    let geckoDelayedFeeds: GeckoPoolFeedId[];
    let stockRegistry: Awaited<ReturnType<typeof fetchRobinhoodStockRegistry>>;
    if (requestedContract) {
      [stockRegistry, currentLaunchpadSnapshot] = await Promise.all([
        fetchRobinhoodStockRegistry(),
        fetchCurrentLaunchpadSnapshot(robinhoodClient, { token: getAddress(requestedContract) }).catch(emptyCurrentLaunchpadSnapshot)
      ]);
      sushiLaunchSnapshot = currentLaunchpadSnapshot.sushi;
      publicDiscoverySnapshot = { tokenAddresses: [], metadata: new Map() };
      geckoPoolPairs = [];
      geckoDelayedFeeds = [];
    } else {
      [currentLaunchpadSnapshot, publicDiscoverySnapshot, stockRegistry, { pairs: geckoPoolPairs, delayedFeeds: geckoDelayedFeeds }] = await Promise.all([
        fetchCurrentLaunchpadSnapshot(robinhoodClient).catch(emptyCurrentLaunchpadSnapshot),
        fetchPublicDiscoveryTokens().catch(() => ({ tokenAddresses: [], metadata: new Map() })),
        fetchRobinhoodStockRegistry(),
        fetchGeckoPoolSnapshot()
      ]);
      sushiLaunchSnapshot = currentLaunchpadSnapshot.sushi;
    }
    const stockTokenAddresses = new Set(stockRegistry.assetsByAddress.keys());
    const requestedTokens = [...new Set(
      [
        ...sushiLaunchSnapshot.candidateAddresses.map((address) => address.toLowerCase()),
        ...currentLaunchpadSnapshot.markets.map((market) => market.address.toLowerCase()),
        ...geckoPoolPairs.map((pair) => pair.baseToken.address.toLowerCase()),
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
    const pairs: RawPair[] = [...results.flat(), ...geckoPoolPairs];
    if (pairs.length === 0 && currentLaunchpadSnapshot.markets.length === 0) {
      if (requestedContract) {
        const resolution = await resolveUniversalMarketAddress(requestedContract, stockRegistry);
        const resolvedMarket = resolution
          ? marketFromUniversalResolution(resolution, stockRegistry)
          : null;
        if (resolvedMarket) {
          const admission = await applyProjectIdentityDirectoryAdmission([resolvedMarket]);
          if (admission.admitted.length === 0) return notAdmittedResponse();
        }
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
          { headers: { "Cache-Control": EXTERNAL_CONTRACT_RESOLVER_CACHE_CONTROL } }
        );
      }
      throw new Error("No external market source responded.");
    }

    const candidateAddresses = [...new Set(pairs.flatMap((pair) => {
      const address = asText(requestedTokenFromPair(pair, requestedContract, stockTokenAddresses)?.address, 42);
      return isNonzeroEvmAddress(address) ? [address.toLowerCase()] : [];
    }).concat(currentLaunchpadSnapshot.markets.map((market) => market.address.toLowerCase())))];
    const rmtOrigins = await resolveRmtOrigins(
      candidateAddresses,
      new Set(sushiLaunchSnapshot.projects.keys())
    );
    const evidenceByToken = new Map<string, AssetMarketEvidence[]>();
    const marketCandidatesByToken = new Map<string, ProviderDirectoryMarket[]>();
    const launchpadMarketsByToken = new Map(currentLaunchpadSnapshot.markets.map((market) => [market.address.toLowerCase(), market]));

    for (const pair of pairs) {
      if (pair.chainId !== CHAIN_SLUG) continue;

      const url = asText(pair.url, 300);
      if (!url.startsWith(DEXSCREENER_PAGE)) continue;

      const token = requestedTokenFromPair(pair, requestedContract, stockTokenAddresses);
      const address = asText(token?.address, 42);
      const name = asText(token?.name);
      const symbol = asText(token?.symbol, 20);
      const pairAddress = asText(pair.pairAddress, 66);
      const dexId = asText(pair.dexId, 30) || "DEX";
      const baseTokenAddress = asText(pair.baseToken?.address, 42);
      const quoteTokenAddress = asText(pair.quoteToken?.address, 42);
      if (!isNonzeroEvmAddress(address) || !name || !symbol || !pairAddress) continue;
      if (rmtOrigins.tokens.has(address.toLowerCase())) continue;
      const evidence = normalizeProviderPairForAsset(pair, address, {
        chainId: 4_663,
        chainSlug: CHAIN_SLUG,
        canonicalQuoteAddresses: EXCLUDED_TOKENS,
        assetQuoteAddresses: stockTokenAddresses,
        provenance: requestedContract
          ? "dexscreener-token-pairs"
          : Array.isArray(pair.discoveryFeeds)
            ? "geckoterminal-pool-feed"
            : "dexscreener-token-batch"
      });
      if (!evidence) continue;
      const evidenceList = evidenceByToken.get(address.toLowerCase()) ?? [];
      evidenceList.push(evidence);
      evidenceByToken.set(address.toLowerCase(), evidenceList);
      if ((evidence.displayEligibility !== "eligible" && evidence.displayEligibility !== "missing-price")
        || evidence.assetSide !== "BASE") continue;

      const liquidityUsd = evidence.liquidityUsd;
      const marketCapUsd = evidence.marketCapUsd ?? evidence.fdvUsd;
      const fdvUsd = evidence.fdvUsd;
      const volume5m = nonNegativeNumber(pair.volume?.m5);
      const volume1h = nonNegativeNumber(pair.volume?.h1);
      const volume24h = evidence.volume24h;
      const priceChange5m = finiteNumber(pair.priceChange?.m5);
      const priceChange1h = finiteNumber(pair.priceChange?.h1);
      const priceChange24h = evidence.priceChange24h;
      const transactions5m = transactionWindow(pair, "m5");
      const transactions1h = transactionWindow(pair, "h1");
      const transactions24h = transactionWindow(pair, "h24");
      const pairCreatedAt = nonNegativeNumber(pair.pairCreatedAt);
      const ranking = rankingFor(pair, evidence);

      const discoveryMetadata = publicDiscoverySnapshot.metadata.get(address.toLowerCase());
      const market: ProviderDirectoryMarket = {
        assetId: evidence.assetId,
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
        priceUsd: evidence.priceUsd,
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
        ageMinutes: ranking?.ageMinutes ?? null,
        momentumScore: ranking?.momentumScore ?? null,
        buyPressureBps: ranking?.buyPressureBps ?? null,
        signal: ranking?.signal ?? null,
        riskFlags: ranking?.riskFlags ?? null
      };
      const key = address.toLowerCase();
      const sushiLaunchProject = sushiLaunchSnapshot.projects.get(key);
      const launchpadMarket = launchpadMarketsByToken.get(key);
      const project = launchpadMarket?.project ?? sushiLaunchProject;
      const launchpadEvidence = [
        ...(launchpadMarket?.launchpadEvidence ?? []),
        ...(sushiLaunchSnapshot.lifecycle.get(key) ? [sushiLaunchSnapshot.lifecycle.get(key)!] : [])
      ];
      const attributedMarket = project || launchpadEvidence.length > 0
        ? {
            ...market,
            project,
            launchpadEvidence
          }
        : market;

      marketCandidatesByToken.set(key, [...(marketCandidatesByToken.get(key) ?? []), attributedMarket]);
    }

    const assetRecords = [...evidenceByToken.values()].flatMap((evidence) => {
      const record = buildAssetMarketRecord(evidence);
      return record ? [record] : [];
    });
    const marketsByToken = new Map<string, ProviderDirectoryMarket>();
    for (const record of assetRecords) {
      const key = record.token.address.toLowerCase();
      const candidates = marketCandidatesByToken.get(key) ?? [];
      const primary = record.primaryMarket
        ? candidates.find((candidate) => candidate.pairAddress.toLowerCase() === record.primaryMarket?.pool.value.toLowerCase())
        : record.verifiedMarkets
            .map((evidence) => candidates.find((candidate) => candidate.pairAddress.toLowerCase() === evidence.pool.value.toLowerCase()))
            .find(Boolean);
      if (!primary) continue;
      const stockAssetRelationships = [...new Map(candidates.flatMap((candidate) => candidate.stockAssetRelationships ?? []).map((relationship) => [
        `${relationship.relationship}:${relationship.contractAddress.toLowerCase()}`,
        relationship
      ])).values()];
      marketsByToken.set(key, {
        ...primary,
        imageUri: primary.imageUri ?? candidates.map((candidate) => candidate.imageUri).find(Boolean),
        socials: primary.socials ?? candidates.map((candidate) => candidate.socials).find(Boolean),
        stockAssetRelationships,
        primaryMarket: record.primaryMarket ?? undefined,
        verifiedMarkets: record.verifiedMarkets
      });
    }

    for (const launchpadMarket of currentLaunchpadSnapshot.markets) {
      const key = launchpadMarket.address.toLowerCase();
      const existing = marketsByToken.get(key);
      marketsByToken.set(key, existing
        ? mergeLaunchpadEvidenceOntoMarket(existing, launchpadMarket)
        : launchpadMarket as ProviderDirectoryMarket);
    }

    const directoryAdmission = await applyProjectIdentityDirectoryAdmission([...marketsByToken.values()]);
    const admittedAddresses = new Set(directoryAdmission.admitted.map((market) => market.address.toLowerCase()));
    const admittedAssetRecords = assetRecords.filter((record) => admittedAddresses.has(record.token.address.toLowerCase()));
    const rankedMarkets = requestedContract
      ? directoryAdmission.admitted.filter((market) =>
          market.address.toLowerCase() === requestedContract
          || market.pairAddress.toLowerCase() === requestedContract
        )
      : directoryAdmission.admitted
          .sort(compareProviderDirectoryMarket)
          .slice(0, VNEXT_MARKET_DIRECTORY_MAX_MARKETS);
    let markets: Array<ProviderDirectoryMarket | ExternalMarket> = rankedMarkets;
    let resolution: Awaited<ReturnType<typeof resolveUniversalMarketAddress>> = null;
    if (requestedContract) {
      resolution = await resolveUniversalMarketAddress(requestedContract, stockRegistry);
      if (resolution) {
        const exactResolution = resolution;
        const resolvedMarket = marketFromUniversalResolution(resolution, stockRegistry);
        markets = markets.length > 0
          ? markets.map((market) => market.address.toLowerCase() === exactResolution.token.address.toLowerCase()
              ? { ...market, assetId: resolvedMarket?.assetId, resolution: exactResolution }
              : market)
          : resolvedMarket ? [resolvedMarket] : [];
      }
      const exactAdmission = await applyProjectIdentityDirectoryAdmission(markets);
      if (markets.length > 0 && exactAdmission.admitted.length === 0) return notAdmittedResponse();
      markets = exactAdmission.admitted;
    }
    const snapshot: SuccessfulMarketSnapshot = {
      markets,
      assetRecords: admittedAssetRecords,
      directoryAdmission: "admitted",
      source: "Canonical DEX markets + bounded current launchpad discovery + provider observations + Robinhood Stock Token registry",
      rankingVersion: "rmt-discovery-v7-lifecycle",
      thresholds: RUNNER_THRESHOLDS,
      originCoverage: currentLaunchpadSnapshot.coverage,
      rmtOriginCoverage: rmtOrigins.coverage,
      stockAssetCoverage: stockRegistry.coverage,
      updatedAt: new Date().toISOString()
    };
    if (!requestedContract) lastSuccessfulSnapshot = snapshot;

    const delayedSources = [
      ...(sushiLaunchSnapshot.delayed ? ["sushi-launch-metadata"] : []),
      ...currentLaunchpadSnapshot.delayedSources,
      ...geckoDelayedFeeds.map((feed) => `geckoterminal-${feed}`),
      ...(rmtOrigins.coverage !== "complete" ? ["rmt-origin"] : [])
    ];

    return withExternalMarketTiming(NextResponse.json(
      {
        ...snapshot,
        resolution,
        ...(delayedSources.length > 0 ? { delayedSources } : {})
      },
      {
        headers: {
          "Cache-Control": requestedContract
            ? EXTERNAL_CONTRACT_CACHE_CONTROL
            : EXTERNAL_BROAD_CACHE_CONTROL
        }
      }
    ), startedAt, "fresh");
  } catch (error) {
    console.error(JSON.stringify({
      event: "external_market_refresh_failed",
      error: error instanceof Error ? error.message.slice(0, 1_000) : "unknown"
    }));
    const stale = requestedContract ? null : staleResponse();
    if (stale) return withExternalMarketTiming(stale, startedAt, "last-known");
    return withExternalMarketTiming(NextResponse.json(
      { error: "External Robinhood Chain markets are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    ), startedAt, "error");
  }
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

  if (requestedContract) return readExternalMarketResponse(request, requestedContract);

  // All callers receive a clone; the original response remains the immutable
  // per-process coalescing value and is never consumed by a route response.
  const response = await broadExternalRefreshes.run(
    EXTERNAL_BROAD_REFRESH_KEY,
    () => readExternalMarketResponse(request, null)
  );
  return response.clone();
}
