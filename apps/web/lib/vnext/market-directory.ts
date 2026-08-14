import { getAddress, isAddress } from "viem";
import type { ExternalMarket, ExternalMarketResponse, UniversalMarketResolution } from "../external-market";
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

export type VNextDirectoryMarket = Pick<ExternalMarket,
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
> & {
  pairAddress?: string;
  dexId?: string;
  url?: string;
  rwaRelationship?: VNextRwaRelationship;
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

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
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
  const seen = new Set<string>();
  return payload.markets.flatMap((market): VNextDirectoryMarket[] => {
    if (!isAddress(market.address, { strict: false })) return [];
    const address = getAddress(market.address);
    const key = address.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    const symbol = text(market.symbol, 16) || `${address.slice(0, 6)}…${address.slice(-4)}`;
    const name = text(market.name, 80) || symbol;
    return [{
      address,
      name,
      symbol,
      priceUsd: Math.max(0, finite(market.priceUsd)),
      liquidityUsd: Math.max(0, finite(market.liquidityUsd)),
      marketCapUsd: Math.max(0, finite(market.marketCapUsd)),
      volume24h: Math.max(0, finite(market.volume24h)),
      priceChange24h: finite(market.priceChange24h),
      ageMinutes: market.ageMinutes === null ? null : Math.max(0, finite(market.ageMinutes)),
      signal: market.signal,
      imageUri: safeTokenArtworkUrl(market.imageUri) ?? undefined,
      resolution: market.resolution,
      pairAddress: typeof market.pairAddress === "string" && isAddress(market.pairAddress, { strict: false })
        ? getAddress(market.pairAddress)
        : undefined,
      dexId: text(market.dexId, 30) || undefined,
      url: typeof market.url === "string" && market.url.startsWith("https://") ? market.url.slice(0, 300) : undefined,
      rwaRelationship: rwaRelationship(market)
    }];
  });
}

function compareVolume(left: VNextDirectoryMarket, right: VNextDirectoryMarket) {
  return right.volume24h - left.volume24h || right.liquidityUsd - left.liquidityUsd;
}

function compareLiquidity(left: VNextDirectoryMarket, right: VNextDirectoryMarket) {
  return right.liquidityUsd - left.liquidityUsd || right.volume24h - left.volume24h;
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
    return markets.filter((market) => market.signal === "active" && market.volume24h > 0).sort(compareVolume);
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

export function resolutionFromLookup(payload: ExternalMarketResponse, address: string) {
  if (typeof payload.resolution?.token.address === "string" && payload.resolution.token.address.toLowerCase() === address.toLowerCase()) return payload.resolution;
  return payload.markets?.find((market) => typeof market.address === "string" && market.address.toLowerCase() === address.toLowerCase())?.resolution;
}
