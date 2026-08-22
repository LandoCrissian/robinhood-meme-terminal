import { getAddress, isAddress } from "viem";
import {
  buildAssetMarketRecord,
  type ExternalMarket,
  type ExternalMarketResponse,
  type UniversalMarketResolution
} from "../external-market";
import { canonicalExternalAssetId } from "../external-market-identity";
import type { ExternalMarketSignal } from "../external-market-ranking";
import type { AssetMetadata } from "./execution-domain";
import { evmAsset } from "./execution-domain";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  ROBINHOOD_RMT,
  ROBINHOOD_RMT_ADDRESS,
  ROBINHOOD_WETH,
  ROBINHOOD_WETH_ADDRESS
} from "./robinhood-assets";
import { safeTokenArtworkUrl } from "./token-artwork";
import type {
  VNextUniversalMarketSearchPool,
  VNextUniversalMarketSearchResultItem
} from "./universal-market-search-contract";

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
  volume24h: VNextDirectoryMetric;
  priceChange24h: VNextDirectoryMetric;
  signal: ExternalMarketSignal | null;
  marketDataState?: "live" | "identity-only" | "canonical-only";
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

export type VNextRwaRelationship = "canonical-stock-token" | "paired-market-asset";

export type VNextMarketDirectoryView = "trending" | "new" | "active" | "rwa" | "held" | "all";

export const VNEXT_MARKET_DIRECTORY_MAX_MARKETS = 144;
export const VNEXT_MARKET_DIRECTORY_PAGE_SIZE = 24;

export const VNEXT_MARKET_DIRECTORY_VIEWS: ReadonlyArray<{ id: VNextMarketDirectoryView; label: string }> = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "active", label: "Active" },
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

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown) {
  const normalized = finite(value);
  return normalized === null ? null : Math.max(0, normalized);
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
    return [{
      address,
      assetId: market.assetId,
      name,
      symbol,
      priceUsd: nonNegative(market.priceUsd),
      liquidityUsd: nonNegative(market.liquidityUsd),
      marketCapUsd: nonNegative(market.marketCapUsd),
      volume24h: nonNegative(market.volume24h),
      priceChange24h: finite(market.priceChange24h),
      ageMinutes: market.ageMinutes === null ? null : nonNegative(market.ageMinutes),
      signal: market.signal,
      marketDataState: "live",
      imageUri: safeTokenArtworkUrl(market.imageUri) ?? undefined,
      resolution: market.resolution,
      pairAddress: typeof market.pairAddress === "string" && isAddress(market.pairAddress, { strict: false })
        ? getAddress(market.pairAddress)
        : undefined,
      dexId: text(market.dexId, 30) || undefined,
      url: typeof market.url === "string" && market.url.startsWith("https://") ? market.url.slice(0, 300) : undefined,
      rwaRelationship: rwaRelationship(market),
      primaryMarket: market.primaryMarket,
      verifiedMarkets: market.verifiedMarkets
    }];
  });
  const byAsset = new Map<string, VNextDirectoryMarket[]>();
  for (const market of normalized) {
    const key = market.address.toLowerCase();
    byAsset.set(key, [...(byAsset.get(key) ?? []), market]);
  }
  return [...byAsset.values()].map((candidates) => {
    const evidence = candidates.flatMap((candidate) => candidate.verifiedMarkets ?? []);
    const record = buildAssetMarketRecord(evidence, { requireChart: true });
    const chosen = record?.primaryMarket
      ? candidates.find((candidate) => candidate.pairAddress?.toLowerCase() === record.primaryMarket?.pool.value.toLowerCase())
      : [...candidates].sort((left, right) => (left.pairAddress ?? "~").toLowerCase().localeCompare((right.pairAddress ?? "~").toLowerCase()))[0];
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
    return markets.filter((market) => market.signal === "moving" || market.signal === "early").sort(compareVolume);
  }
  if (view === "new") {
    return markets
      .filter((market) => market.ageMinutes !== null && market.ageMinutes <= 24 * 60)
      .sort((left, right) => (left.ageMinutes ?? Number.MAX_SAFE_INTEGER) - (right.ageMinutes ?? Number.MAX_SAFE_INTEGER) || compareVolume(left, right));
  }
  if (view === "active") {
    return markets.filter((market) => market.signal === "active" && (market.volume24h ?? 0) > 0).sort(compareVolume);
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
  if (getAddress(market.address) === ROBINHOOD_RMT_ADDRESS) return ROBINHOOD_RMT;
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
    volume24h: null,
    priceChange24h: null,
    ageMinutes: null,
    signal: null,
    marketDataState: "canonical-only",
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
    byAddress.set(key, existing ? {
      ...market,
      ...existing,
      canonicalMarkets: market.canonicalMarkets ?? existing.canonicalMarkets,
      verifiedIdentity: market.verifiedIdentity ?? existing.verifiedIdentity,
      resolution: existing.resolution ?? market.resolution
    } : market);
  }
  return [...byAddress.values()];
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
    volume24h: null,
    priceChange24h: null,
    ageMinutes: null,
    signal: "active",
    marketDataState: "identity-only",
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
  if (!exact?.primaryMarket
    || exact.priceUsd === null
    || exact.assetId !== expectedAssetId
    || exact.primaryMarket.assetId !== expectedAssetId) return null;
  return exact;
}
