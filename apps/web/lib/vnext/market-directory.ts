import { getAddress, isAddress, zeroAddress } from "viem";
import {
  buildAssetMarketRecord,
  type ExternalMarket,
  type ExternalMarketResponse,
  type UniversalMarketResolution
} from "../external-market";
import { canonicalExternalAssetId } from "../external-market-identity";
import type {
  ExternalMarketRiskFlag,
  ExternalMarketSignal
} from "../external-market-ranking";
import type { AssetMetadata } from "./execution-domain";
import { evmAsset } from "./execution-domain";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_WETH,
  ROBINHOOD_WETH_ADDRESS
} from "./robinhood-assets";
import { safeTokenArtworkUrl } from "./token-artwork";
import type {
  VNextUniversalMarketSearchPool,
  VNextUniversalMarketSearchResultItem,
  VNextUniversalMarketSearchStatus
} from "./universal-market-search-contract";
import { parseVNextUniversalMarketSearchPool } from "./universal-market-search-contract";

type VNextDirectoryMetric = number | null;

export type VNextDirectoryMarket = Omit<Pick<ExternalMarket,
  | "address"
  | "name"
  | "symbol"
  | "priceUsd"
  | "liquidityUsd"
  | "marketCapUsd"
  | "volume24h"
  | "priceChange24h"
  | "ageMinutes"
  | "signal"
  | "imageUri"
  | "resolution"
  | "assetId"
  | "primaryMarket"
  | "verifiedMarkets"
>, "priceUsd" | "liquidityUsd" | "marketCapUsd" | "volume24h" | "priceChange24h" | "signal"> & {
  priceUsd: VNextDirectoryMetric;
  liquidityUsd: VNextDirectoryMetric;
  marketCapUsd: VNextDirectoryMetric;
  volume5m: VNextDirectoryMetric;
  volume1h: VNextDirectoryMetric;
  volume24h: VNextDirectoryMetric;
  priceChange5m: VNextDirectoryMetric;
  priceChange1h: VNextDirectoryMetric;
  priceChange24h: VNextDirectoryMetric;
  buys5m: VNextDirectoryMetric;
  sells5m: VNextDirectoryMetric;
  buys1h: VNextDirectoryMetric;
  sells1h: VNextDirectoryMetric;
  buys24h: VNextDirectoryMetric;
  sells24h: VNextDirectoryMetric;
  pairCreatedAt: VNextDirectoryMetric;
  momentumScore: VNextDirectoryMetric;
  buyPressureBps: VNextDirectoryMetric;
  riskFlags: ExternalMarketRiskFlag[] | null;
  signal: ExternalMarketSignal | null;
  pairAddress?: string;
  dexId?: string;
  url?: string;
  rwaRelationship?: VNextRwaRelationship;
  canonicalMarkets?: VNextUniversalMarketSearchPool[];
  verifiedIdentity?: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
};

export type VNextMarketState = {
  asset: "verified" | "observed";
  market: "canonical" | "observed" | "none";
  metrics: "complete" | "partial" | "unavailable";
  chart: "available" | "unavailable";
  execution: "not-evaluated";
};

export type VNextRwaRelationship = "canonical-stock-token" | "paired-market-asset";

export type VNextSelectedMarketExecutionState = "normal" | "stock-token-view-only";

export function vNextSelectedMarketExecutionState(
  market: Pick<VNextDirectoryMarket, "rwaRelationship"> | undefined
): VNextSelectedMarketExecutionState {
  return market?.rwaRelationship === "canonical-stock-token"
    ? "stock-token-view-only"
    : "normal";
}

export type VNextMarketDirectoryView = "trending" | "new" | "active" | "rwa" | "held" | "all";

export const VNEXT_MARKET_DIRECTORY_MAX_MARKETS = 144;
export const VNEXT_MARKET_DIRECTORY_PAGE_SIZE = 24;
export const VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT = 100;

export const VNEXT_MARKET_DIRECTORY_VIEWS: ReadonlyArray<{ id: VNextMarketDirectoryView; label: string }> = [
  { id: "active", label: "Active" },
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "rwa", label: "RWA" },
  { id: "held", label: "Held" },
  { id: "all", label: "All" }
];

export type VNextDirectoryResponse = {
  markets?: VNextDirectoryMarket[];
  updatedAt?: string;
  stale?: boolean;
  error?: string;
};

export type VNextCanonicalDirectoryResponse = VNextDirectoryResponse & {
  canonical: true;
  coverage: "partial" | "complete";
  nextCursor: string | null;
};

const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAXIMUM_CURSOR_LENGTH = 1_024;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function canonicalMarketIdentity(market: VNextUniversalMarketSearchPool) {
  return `${market.sourceId}:${market.poolKey}`.toLowerCase();
}

export function directoryMarketsFromCanonicalPools(
  pools: VNextUniversalMarketSearchPool[]
): VNextDirectoryMarket[] {
  const byAddress = new Map<string, Map<string, VNextUniversalMarketSearchPool>>();
  for (const pool of pools) {
    for (const address of [pool.token0, pool.token1]) {
      const key = address.toLowerCase();
      if (key === zeroAddress) continue;
      const evidence = byAddress.get(key) ?? new Map<string, VNextUniversalMarketSearchPool>();
      evidence.set(canonicalMarketIdentity(pool), pool);
      byAddress.set(key, evidence);
    }
  }

  return [...byAddress.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([rawAddress, evidence]) => {
      const address = getAddress(rawAddress);
      const label = `${address.slice(0, 6)}…${address.slice(-4)}`;
      return {
        address,
        assetId: canonicalExternalAssetId(4_663, address) ?? undefined,
        name: label,
        symbol: label,
        priceUsd: null,
        liquidityUsd: null,
        marketCapUsd: null,
        volume5m: null,
        volume1h: null,
        volume24h: null,
        priceChange5m: null,
        priceChange1h: null,
        priceChange24h: null,
        buys5m: null,
        sells5m: null,
        buys1h: null,
        sells1h: null,
        buys24h: null,
        sells24h: null,
        pairCreatedAt: null,
        ageMinutes: null,
        momentumScore: null,
        buyPressureBps: null,
        riskFlags: null,
        signal: null,
        canonicalMarkets: [...evidence.values()].sort((left, right) =>
          canonicalMarketIdentity(left).localeCompare(canonicalMarketIdentity(right)))
      };
    });
}

export function parseVNextCanonicalDirectoryResponse(value: unknown): VNextCanonicalDirectoryResponse | null {
  const candidate = record(value);
  if (
    !candidate ||
    candidate.canonical !== true ||
    (candidate.coverage !== "partial" && candidate.coverage !== "complete") ||
    typeof candidate.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.updatedAt)) ||
    (candidate.nextCursor !== null && (
      typeof candidate.nextCursor !== "string" ||
      candidate.nextCursor.length < 1 ||
      candidate.nextCursor.length > MAXIMUM_CURSOR_LENGTH ||
      !OPAQUE_CURSOR_PATTERN.test(candidate.nextCursor)
    )) ||
    !Array.isArray(candidate.markets) ||
    candidate.markets.length > VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT * 2
  ) return null;

  const markets = candidate.markets.flatMap((value): VNextDirectoryMarket[] => {
    const market = record(value);
    if (!market || !isAddress(String(market.address ?? ""), { strict: false })) return [];
    if (
      market.priceUsd !== null ||
      market.liquidityUsd !== null ||
      market.marketCapUsd !== null ||
      market.volume5m !== null ||
      market.volume1h !== null ||
      market.volume24h !== null ||
      market.priceChange5m !== null ||
      market.priceChange1h !== null ||
      market.priceChange24h !== null ||
      market.buys5m !== null ||
      market.sells5m !== null ||
      market.buys1h !== null ||
      market.sells1h !== null ||
      market.buys24h !== null ||
      market.sells24h !== null ||
      market.pairCreatedAt !== null ||
      market.ageMinutes !== null ||
      market.momentumScore !== null ||
      market.buyPressureBps !== null ||
      market.riskFlags !== null ||
      market.signal !== null
    ) return [];
    if (!Array.isArray(market.canonicalMarkets) || market.canonicalMarkets.length < 1 || market.canonicalMarkets.length > VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT) return [];
    const canonicalMarkets = market.canonicalMarkets.map(parseVNextUniversalMarketSearchPool);
    if (canonicalMarkets.some((entry) => entry === null)) return [];
    const address = getAddress(String(market.address));
    if (address.toLowerCase() === zeroAddress) return [];
    const identities = new Set<string>();
    for (const evidence of canonicalMarkets as VNextUniversalMarketSearchPool[]) {
      if (evidence.token0 !== address.toLowerCase() && evidence.token1 !== address.toLowerCase()) return [];
      const identity = canonicalMarketIdentity(evidence);
      if (identities.has(identity)) return [];
      identities.add(identity);
    }
    const name = text(market.name, 80);
    const symbol = text(market.symbol, 16);
    if (!name || !symbol) return [];
    return [{
      address,
      assetId: canonicalExternalAssetId(4_663, address) ?? undefined,
      name,
      symbol,
      priceUsd: null,
      liquidityUsd: null,
      marketCapUsd: null,
      volume5m: null,
      volume1h: null,
      volume24h: null,
      priceChange5m: null,
      priceChange1h: null,
      priceChange24h: null,
      buys5m: null,
      sells5m: null,
      buys1h: null,
      sells1h: null,
      buys24h: null,
      sells24h: null,
      pairCreatedAt: null,
      ageMinutes: null,
      momentumScore: null,
      buyPressureBps: null,
      riskFlags: null,
      signal: null,
      canonicalMarkets: canonicalMarkets as VNextUniversalMarketSearchPool[]
    }];
  });
  if (
    markets.length !== candidate.markets.length ||
    new Set(markets.map((market) => market.address.toLowerCase())).size !== markets.length
  ) return null;
  return {
    canonical: true,
    coverage: candidate.coverage,
    nextCursor: candidate.nextCursor as string | null,
    updatedAt: candidate.updatedAt,
    markets
  };
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown) {
  const normalized = finite(value);
  return normalized !== null && normalized >= 0 ? normalized : null;
}

function nonNegativeInteger(value: unknown) {
  const normalized = nonNegative(value);
  return normalized !== null && Number.isSafeInteger(normalized) ? normalized : null;
}

const RISK_FLAGS = new Set<ExternalMarketRiskFlag>([
  "thin-liquidity",
  "extreme-price-spike",
  "high-volume-low-trades",
  "very-new-low-activity",
  "one-sided-activity"
]);

function riskFlags(value: unknown): ExternalMarketRiskFlag[] | null {
  if (!Array.isArray(value)) return null;
  const flags = value.filter((flag): flag is ExternalMarketRiskFlag => (
    typeof flag === "string" && RISK_FLAGS.has(flag as ExternalMarketRiskFlag)
  ));
  return flags.length === value.length ? flags : null;
}

function text(value: unknown, maximumLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
}

function rwaRelationship(market: ExternalMarket | VNextDirectoryMarket) {
  if (!Array.isArray((market as ExternalMarket).stockAssetRelationships)) return undefined;
  const relationships = (market as ExternalMarket).stockAssetRelationships ?? [];
  if (relationships.some((relationship) => (
    relationship.relationship === "canonical-stock-token"
    && relationship.provenance === "robinhood-live-asset-registry"
  ))) return "canonical-stock-token" as const;
  if (relationships.some((relationship) => (
    relationship.relationship === "paired-market-asset"
    && relationship.provenance === "robinhood-live-asset-registry"
  ))) return "paired-market-asset" as const;
  return undefined;
}

export function normalizeDirectoryMarkets(payload: Pick<ExternalMarketResponse, "markets"> | VNextDirectoryResponse) {
  if (!Array.isArray(payload.markets)) return [];
  const normalized = payload.markets.flatMap((market): VNextDirectoryMarket[] => {
    if (!isAddress(market.address, { strict: false })) return [];
    const address = getAddress(market.address);
    const symbol = text(market.symbol, 16) || `${address.slice(0, 6)}…${address.slice(-4)}`;
    const name = text(market.name, 80) || symbol;
    const directoryMarket = market as VNextDirectoryMarket;
    return [{
      address,
      assetId: market.assetId,
      name,
      symbol,
      priceUsd: nonNegative(market.priceUsd),
      liquidityUsd: nonNegative(market.liquidityUsd),
      marketCapUsd: nonNegative(market.marketCapUsd),
      volume5m: nonNegative(directoryMarket.volume5m),
      volume1h: nonNegative(directoryMarket.volume1h),
      volume24h: nonNegative(market.volume24h),
      priceChange5m: finite(directoryMarket.priceChange5m),
      priceChange1h: finite(directoryMarket.priceChange1h),
      priceChange24h: finite(market.priceChange24h),
      buys5m: nonNegativeInteger(directoryMarket.buys5m),
      sells5m: nonNegativeInteger(directoryMarket.sells5m),
      buys1h: nonNegativeInteger(directoryMarket.buys1h),
      sells1h: nonNegativeInteger(directoryMarket.sells1h),
      buys24h: nonNegativeInteger(directoryMarket.buys24h),
      sells24h: nonNegativeInteger(directoryMarket.sells24h),
      pairCreatedAt: nonNegative(directoryMarket.pairCreatedAt),
      ageMinutes: market.ageMinutes === null ? null : nonNegative(market.ageMinutes),
      momentumScore: nonNegative(directoryMarket.momentumScore),
      buyPressureBps: nonNegative(directoryMarket.buyPressureBps),
      riskFlags: riskFlags(directoryMarket.riskFlags),
      signal: market.signal === "moving" || market.signal === "early" || market.signal === "active"
        ? market.signal
        : null,
      imageUri: safeTokenArtworkUrl(market.imageUri) ?? undefined,
      resolution: market.resolution,
      pairAddress: typeof market.pairAddress === "string" && isAddress(market.pairAddress, { strict: false })
        ? getAddress(market.pairAddress)
        : undefined,
      dexId: text(market.dexId, 30) || undefined,
      url: typeof market.url === "string" && market.url.startsWith("https://") ? market.url.slice(0, 300) : undefined,
      rwaRelationship: rwaRelationship(market),
      primaryMarket: market.primaryMarket,
      verifiedMarkets: market.verifiedMarkets,
      canonicalMarkets: directoryMarket.canonicalMarkets,
      verifiedIdentity: directoryMarket.verifiedIdentity
    }];
  });
  const byAsset = new Map<string, VNextDirectoryMarket[]>();
  for (const market of normalized) {
    const key = market.address.toLowerCase();
    byAsset.set(key, [...(byAsset.get(key) ?? []), market]);
  }
  return [...byAsset.values()].map((candidates) => {
    const evidence = candidates.flatMap((candidate) => candidate.verifiedMarkets ?? []);
    const record = buildAssetMarketRecord(evidence);
    const chosen = record?.primaryMarket
      ? candidates.find((candidate) => (
          candidate.pairAddress?.toLowerCase() === record.primaryMarket?.pool.value.toLowerCase()
          || candidate.verifiedMarkets?.some((market) => (
            market.pool.kind === record.primaryMarket?.pool.kind
            && market.pool.value.toLowerCase() === record.primaryMarket.pool.value.toLowerCase()
          ))
        ))
      : [...candidates].sort((left, right) => (
          `${left.pairAddress ?? "~"}:${left.dexId ?? "~"}`.toLowerCase()
            .localeCompare(`${right.pairAddress ?? "~"}:${right.dexId ?? "~"}`.toLowerCase())
        ))[0];
    return record && chosen ? {
      ...chosen,
      assetId: record.assetId,
      primaryMarket: record.primaryMarket ?? undefined,
      verifiedMarkets: record.verifiedMarkets
    } : chosen;
  }).filter((market): market is VNextDirectoryMarket => Boolean(market));
}

function compareVolume(left: VNextDirectoryMarket, right: VNextDirectoryMarket) {
  return (right.volume24h ?? -1) - (left.volume24h ?? -1) || (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1);
}

function oneHourTradeCount(market: VNextDirectoryMarket) {
  return market.buys1h !== null && market.sells1h !== null
    ? market.buys1h + market.sells1h
    : null;
}

function deterministicMarketIdentity(market: VNextDirectoryMarket) {
  const canonicalPool = market.canonicalMarkets
    ?.map((evidence) => `${evidence.sourceId}:${evidence.poolKey}`)
    .sort()[0];
  return `${market.address.toLowerCase()}:${market.pairAddress?.toLowerCase() ?? canonicalPool ?? "~"}`;
}

export function hasVNextObservedRecentActivity(market: VNextDirectoryMarket) {
  const trades1h = oneHourTradeCount(market);
  return (market.volume1h !== null && market.volume1h > 0)
    || (trades1h !== null && trades1h > 0);
}

function compareActiveActivity(left: VNextDirectoryMarket, right: VNextDirectoryMarket) {
  return (oneHourTradeCount(right) ?? -1) - (oneHourTradeCount(left) ?? -1)
    || (right.volume1h ?? -1) - (left.volume1h ?? -1)
    || (right.volume5m ?? -1) - (left.volume5m ?? -1)
    || (right.momentumScore ?? -1) - (left.momentumScore ?? -1)
    || (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1)
    || deterministicMarketIdentity(left).localeCompare(deterministicMarketIdentity(right));
}

function compareTrendingMomentum(left: VNextDirectoryMarket, right: VNextDirectoryMarket) {
  return (right.momentumScore ?? -1) - (left.momentumScore ?? -1)
    || (right.volume5m ?? -1) - (left.volume5m ?? -1)
    || (right.volume1h ?? -1) - (left.volume1h ?? -1)
    || (oneHourTradeCount(right) ?? -1) - (oneHourTradeCount(left) ?? -1)
    || (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1)
    || deterministicMarketIdentity(left).localeCompare(deterministicMarketIdentity(right));
}

function compareLiquidity(left: VNextDirectoryMarket, right: VNextDirectoryMarket) {
  return (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1) || (right.volume24h ?? -1) - (left.volume24h ?? -1);
}

function compareRwaClassification(left: VNextDirectoryMarket, right: VNextDirectoryMarket) {
  const leftRank = left.rwaRelationship === "canonical-stock-token" ? 0 : 1;
  const rightRank = right.rwaRelationship === "canonical-stock-token" ? 0 : 1;
  return leftRank - rightRank || compareLiquidity(left, right);
}

export function vNextRwaClassificationLabel(relationship: VNextRwaRelationship | undefined) {
  if (relationship === "canonical-stock-token") return "Stock Token";
  if (relationship === "paired-market-asset") return "RWA Pair";
  return null;
}

export function selectVNextMarketDirectoryView(
  markets: VNextDirectoryMarket[],
  view: VNextMarketDirectoryView,
  heldAddresses: ReadonlySet<string> = new Set()
) {
  if (view === "trending") {
    return markets.filter((market) => market.signal === "moving" || market.signal === "early").sort(compareTrendingMomentum);
  }
  if (view === "new") {
    return markets
      .filter((market) => market.ageMinutes !== null && market.ageMinutes <= 24 * 60)
      .sort((left, right) => (left.ageMinutes ?? Number.MAX_SAFE_INTEGER) - (right.ageMinutes ?? Number.MAX_SAFE_INTEGER) || compareVolume(left, right));
  }
  if (view === "active") {
    return markets.filter(hasVNextObservedRecentActivity).sort(compareActiveActivity);
  }
  if (view === "rwa") {
    return markets.filter((market) => Boolean(market.rwaRelationship)).sort(compareRwaClassification);
  }
  if (view === "held") {
    return markets.filter((market) => heldAddresses.has(market.address.toLowerCase())).sort(compareLiquidity);
  }
  return [...markets].sort(compareLiquidity);
}

export function vNextMarketDirectoryViewCounts(
  markets: VNextDirectoryMarket[],
  heldAddresses: ReadonlySet<string> = new Set()
): Record<VNextMarketDirectoryView, number> {
  return {
    trending: selectVNextMarketDirectoryView(markets, "trending", heldAddresses).length,
    new: selectVNextMarketDirectoryView(markets, "new", heldAddresses).length,
    active: selectVNextMarketDirectoryView(markets, "active", heldAddresses).length,
    rwa: selectVNextMarketDirectoryView(markets, "rwa", heldAddresses).length,
    held: selectVNextMarketDirectoryView(markets, "held", heldAddresses).length,
    all: markets.length
  };
}

export function visibleVNextMarketDirectoryMarkets(
  markets: VNextDirectoryMarket[],
  visibleCount = VNEXT_MARKET_DIRECTORY_PAGE_SIZE
) {
  const boundedCount = Number.isFinite(visibleCount)
    ? Math.max(0, Math.floor(visibleCount))
    : VNEXT_MARKET_DIRECTORY_PAGE_SIZE;
  return markets.slice(0, boundedCount);
}

function resolutionToken(resolution: UniversalMarketResolution | undefined, expectedAddress: string) {
  if (!resolution || resolution.chainId !== ROBINHOOD_MAINNET_CHAIN_ID) return null;
  if (!isAddress(resolution.token.address, { strict: false })) return null;
  if (getAddress(resolution.token.address) !== getAddress(expectedAddress)) return null;
  if (!Number.isSafeInteger(resolution.token.decimals) || resolution.token.decimals < 0 || resolution.token.decimals > 255) return null;
  return resolution.token;
}

export function verifiedDirectoryAsset(market: VNextDirectoryMarket, resolution = market.resolution): AssetMetadata | null {
  if (getAddress(market.address) === ROBINHOOD_WETH_ADDRESS) return ROBINHOOD_WETH;
  if (market.verifiedIdentity
    && getAddress(market.verifiedIdentity.address) === getAddress(market.address)
    && Number.isSafeInteger(market.verifiedIdentity.decimals)
    && market.verifiedIdentity.decimals >= 0
    && market.verifiedIdentity.decimals <= 255) {
    return {
      id: evmAsset(ROBINHOOD_MAINNET_CHAIN_ID, market.verifiedIdentity.address),
      symbol: text(market.verifiedIdentity.symbol, 16) || market.symbol,
      name: text(market.verifiedIdentity.name, 80) || market.name,
      decimals: market.verifiedIdentity.decimals,
      metadataState: "verified"
    };
  }
  const token = resolutionToken(resolution, market.address);
  if (!token) return null;
  return {
    id: evmAsset(ROBINHOOD_MAINNET_CHAIN_ID, token.address),
    symbol: token.symbol.trim().slice(0, 16) || market.symbol,
    name: token.name.trim().slice(0, 80) || market.name,
    decimals: token.decimals,
    metadataState: "verified"
  };
}

export function deriveVNextMarketState(market: VNextDirectoryMarket): VNextMarketState {
  const summaryMetrics = [
    market.priceUsd,
    market.liquidityUsd,
    market.marketCapUsd,
    market.volume24h,
    market.priceChange24h
  ];
  const availableMetricCount = summaryMetrics.filter((value) => typeof value === "number" && Number.isFinite(value)).length;
  const chartAvailable = Boolean(selectVNextChartPool(market));
  return {
    asset: verifiedDirectoryAsset(market) ? "verified" : "observed",
    market: market.canonicalMarkets?.length
      ? "canonical"
      : market.verifiedMarkets?.length
        ? "observed"
        : "none",
    metrics: availableMetricCount === summaryMetrics.length
      ? "complete"
      : availableMetricCount > 0
        ? "partial"
        : "unavailable",
    chart: chartAvailable ? "available" : "unavailable",
    execution: "not-evaluated"
  };
}

export function selectVNextChartPool(market: Pick<VNextDirectoryMarket, "verifiedMarkets">) {
  return market.verifiedMarkets?.find((evidence) => (
    evidence.chartEligibility === "eligible" && evidence.pool.kind === "evm-address"
  ))?.pool.value;
}

export function isVNextDirectoryMarketSelectable(market: VNextDirectoryMarket) {
  const state = deriveVNextMarketState(market);
  return state.asset === "verified" || state.market !== "none";
}

export function shouldRequestVNextExternalWorkspaceMarket(market: VNextDirectoryMarket) {
  return !market.canonicalMarkets?.length || Boolean(market.verifiedMarkets?.length || market.primaryMarket);
}

function normalizedSearchText(value: string) {
  const trimmed = value.trim();
  const withoutLeadingDollar = trimmed.startsWith("$") && !trimmed.slice(1).startsWith("$")
    ? trimmed.slice(1)
    : trimmed;
  return withoutLeadingDollar.toLowerCase().replace(/[\s_-]+/g, "");
}

export function filterVNextLocalDirectoryMarkets(markets: VNextDirectoryMarket[], rawQuery: string) {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  const normalized = normalizedSearchText(trimmed);
  if (!normalized) return [];
  const identity = trimmed.toLowerCase();
  return markets.filter((market) => {
    if (market.address.toLowerCase() === identity) return true;
    if (market.canonicalMarkets?.some((evidence) => evidence.poolKey === identity)) return true;
    return normalizedSearchText(market.symbol).includes(normalized)
      || normalizedSearchText(market.name).includes(normalized);
  });
}

export function exactVNextLocalDirectoryMatches(markets: VNextDirectoryMarket[], rawQuery: string) {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  const exactIdentity = trimmed.toLowerCase();
  const exactText = trimmed.startsWith("$") && !trimmed.slice(1).startsWith("$")
    ? trimmed.slice(1).trim().toLowerCase()
    : trimmed.toLowerCase();
  return markets.filter((market) => (
    market.address.toLowerCase() === exactIdentity
    || market.symbol.trim().toLowerCase() === exactText
    || market.name.trim().toLowerCase() === exactText
  ));
}

export function shouldUseExactAddressDegradedFallback(
  rawQuery: string,
  status: VNextUniversalMarketSearchStatus
) {
  if (status !== "inventory_unavailable" && status !== "unavailable") return false;
  if (!isAddress(rawQuery, { strict: false })) return false;
  return getAddress(rawQuery) !== "0x0000000000000000000000000000000000000000";
}

export function directoryMarketFromUniversalSearchResult(
  result: VNextUniversalMarketSearchResultItem
): VNextDirectoryMarket {
  const address = getAddress(result.address);
  const symbol = text(result.symbol, 16) || `${address.slice(0, 6)}…${address.slice(-4)}`;
  const name = text(result.name, 80) || symbol;
  return {
    address,
    name,
    symbol,
    priceUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    volume5m: null,
    volume1h: null,
    volume24h: null,
    priceChange5m: null,
    priceChange1h: null,
    priceChange24h: null,
    buys5m: null,
    sells5m: null,
    buys1h: null,
    sells1h: null,
    buys24h: null,
    sells24h: null,
    pairCreatedAt: null,
    ageMinutes: null,
    momentumScore: null,
    buyPressureBps: null,
    riskFlags: null,
    signal: null,
    canonicalMarkets: result.markets,
    verifiedIdentity: {
      address,
      name,
      symbol,
      decimals: result.decimals
    }
  };
}

export function mergeVNextDirectoryAndSearchMarkets(
  directoryMarkets: VNextDirectoryMarket[],
  searchMarkets: VNextDirectoryMarket[]
) {
  const byAddress = new Map<string, VNextDirectoryMarket>();
  for (const market of directoryMarkets) byAddress.set(market.address.toLowerCase(), market);
  for (const market of searchMarkets) {
    const key = market.address.toLowerCase();
    const existing = byAddress.get(key);
    if (!existing) {
      byAddress.set(key, market);
      continue;
    }
    const canonicalMarkets = new Map<string, VNextUniversalMarketSearchPool>();
    for (const evidence of [...(existing.canonicalMarkets ?? []), ...(market.canonicalMarkets ?? [])]) {
      canonicalMarkets.set(canonicalMarketIdentity(evidence), evidence);
    }
    const verifiedMarkets = new Map<string, NonNullable<VNextDirectoryMarket["verifiedMarkets"]>[number]>();
    for (const evidence of [...(existing.verifiedMarkets ?? []), ...(market.verifiedMarkets ?? [])]) {
      verifiedMarkets.set(`${evidence.venue}:${evidence.pool.kind}:${evidence.pool.value}`.toLowerCase(), evidence);
    }
    byAddress.set(key, {
      ...market,
      ...existing,
      priceUsd: existing.priceUsd ?? market.priceUsd,
      liquidityUsd: existing.liquidityUsd ?? market.liquidityUsd,
      marketCapUsd: existing.marketCapUsd ?? market.marketCapUsd,
      volume5m: existing.volume5m ?? market.volume5m,
      volume1h: existing.volume1h ?? market.volume1h,
      volume24h: existing.volume24h ?? market.volume24h,
      priceChange5m: existing.priceChange5m ?? market.priceChange5m,
      priceChange1h: existing.priceChange1h ?? market.priceChange1h,
      priceChange24h: existing.priceChange24h ?? market.priceChange24h,
      buys5m: existing.buys5m ?? market.buys5m,
      sells5m: existing.sells5m ?? market.sells5m,
      buys1h: existing.buys1h ?? market.buys1h,
      sells1h: existing.sells1h ?? market.sells1h,
      buys24h: existing.buys24h ?? market.buys24h,
      sells24h: existing.sells24h ?? market.sells24h,
      pairCreatedAt: existing.pairCreatedAt ?? market.pairCreatedAt,
      ageMinutes: existing.ageMinutes ?? market.ageMinutes,
      momentumScore: existing.momentumScore ?? market.momentumScore,
      buyPressureBps: existing.buyPressureBps ?? market.buyPressureBps,
      riskFlags: existing.riskFlags ?? market.riskFlags,
      signal: existing.signal ?? market.signal,
      primaryMarket: existing.primaryMarket ?? market.primaryMarket,
      verifiedMarkets: verifiedMarkets.size ? [...verifiedMarkets.values()] : undefined,
      canonicalMarkets: canonicalMarkets.size ? [...canonicalMarkets.values()] : undefined,
      verifiedIdentity: market.verifiedIdentity ?? existing.verifiedIdentity,
      resolution: existing.resolution ?? market.resolution
    });
  }
  return [...byAddress.values()];
}

export function mergeVNextExplicitSelectionMarket(input: {
  existing?: VNextDirectoryMarket;
  canonical?: VNextDirectoryMarket | null;
  identity?: VNextDirectoryMarket | null;
  provider?: VNextDirectoryMarket | null;
}) {
  const candidates = [input.existing, input.canonical ?? undefined, input.identity ?? undefined, input.provider ?? undefined]
    .filter((market): market is VNextDirectoryMarket => Boolean(market));
  if (!candidates.length) return null;
  const expectedAddress = candidates[0]!.address.toLowerCase();
  if (candidates.some((market) => market.address.toLowerCase() !== expectedAddress)) return null;

  const providerBase = input.provider ?? input.existing ?? input.canonical ?? input.identity;
  if (!providerBase) return null;
  const merged = mergeVNextDirectoryAndSearchMarkets(
    [providerBase],
    candidates.filter((market) => market !== providerBase)
  )[0]!;
  const directToken = resolutionToken(input.identity?.resolution, merged.address);
  const verifiedIdentity = input.canonical?.verifiedIdentity
    ?? input.existing?.verifiedIdentity
    ?? input.provider?.verifiedIdentity
    ?? merged.verifiedIdentity;
  return {
    ...merged,
    name: directToken?.name.trim().slice(0, 80)
      || verifiedIdentity?.name
      || input.provider?.name
      || input.existing?.name
      || merged.name,
    symbol: directToken?.symbol.trim().slice(0, 16)
      || verifiedIdentity?.symbol
      || input.provider?.symbol
      || input.existing?.symbol
      || merged.symbol,
    verifiedIdentity,
    resolution: input.identity?.resolution
      ?? input.canonical?.resolution
      ?? input.existing?.resolution
      ?? input.provider?.resolution
      ?? merged.resolution
  } satisfies VNextDirectoryMarket;
}

export function mergeVNextCanonicalBrowseMarkets(
  canonicalMarkets: VNextDirectoryMarket[],
  enrichmentMarkets: VNextDirectoryMarket[]
) {
  const enrichmentByAddress = new Map(enrichmentMarkets.map((market) => [
    market.address.toLowerCase(),
    { ...market, canonicalMarkets: undefined }
  ]));
  const canonicalAddresses = new Set(canonicalMarkets.map((market) => market.address.toLowerCase()));
  const mergedCanonicalMarkets = canonicalMarkets.map((canonicalMarket) => {
    const enrichment = enrichmentByAddress.get(canonicalMarket.address.toLowerCase());
    if (!enrichment) return canonicalMarket;
    const merged = mergeVNextDirectoryAndSearchMarkets([enrichment], [canonicalMarket])[0]!;
    return canonicalMarket.verifiedIdentity
      ? {
          ...merged,
          name: canonicalMarket.verifiedIdentity.name,
          symbol: canonicalMarket.verifiedIdentity.symbol,
          verifiedIdentity: canonicalMarket.verifiedIdentity
        }
      : merged;
  });
  return [
    ...mergedCanonicalMarkets,
    ...[...enrichmentByAddress.entries()]
      .filter(([address]) => !canonicalAddresses.has(address))
      .map(([, market]) => market)
  ];
}

export function resolutionFromLookup(payload: ExternalMarketResponse, address: string) {
  if (typeof payload.resolution?.token.address === "string" && payload.resolution.token.address.toLowerCase() === address.toLowerCase()) return payload.resolution;
  return payload.markets?.find((market) => typeof market.address === "string" && market.address.toLowerCase() === address.toLowerCase())?.resolution;
}

export function directoryMarketFromVerifiedIdentity(
  payload: ExternalMarketResponse,
  expectedAddress: string
): VNextDirectoryMarket | null {
  if (!isAddress(expectedAddress, { strict: false })) return null;
  const address = getAddress(expectedAddress);
  const resolution = resolutionFromLookup(payload, address);
  const token = resolutionToken(resolution, address);
  if (!token) return null;
  const symbol = text(token.symbol, 16) || `${address.slice(0, 6)}…${address.slice(-4)}`;
  return {
    address,
    name: text(token.name, 80) || symbol,
    symbol,
    priceUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    volume5m: null,
    volume1h: null,
    volume24h: null,
    priceChange5m: null,
    priceChange1h: null,
    priceChange24h: null,
    buys5m: null,
    sells5m: null,
    buys1h: null,
    sells1h: null,
    buys24h: null,
    sells24h: null,
    pairCreatedAt: null,
    ageMinutes: null,
    momentumScore: null,
    buyPressureBps: null,
    riskFlags: null,
    signal: null,
    resolution
  };
}

export function directoryMarketFromExactLookup(
  payload: ExternalMarketResponse,
  expectedAddress: string
): VNextDirectoryMarket | null {
  if (!isAddress(expectedAddress, { strict: false })) return null;
  const address = getAddress(expectedAddress);
  const exactMarkets = (payload.markets ?? []).filter((market) => (
    isAddress(market.address, { strict: false })
    && getAddress(market.address) === address
  ));
  const exact = normalizeDirectoryMarkets({ markets: exactMarkets })
    .find((market) => market.address === address);
  const expectedAssetId = canonicalExternalAssetId(ROBINHOOD_MAINNET_CHAIN_ID, address);
  if (!exact
    || exact.assetId !== expectedAssetId
    || !exact.verifiedMarkets?.length
    || exact.verifiedMarkets.some((market) => market.assetId !== expectedAssetId)) return null;
  return exact;
}
