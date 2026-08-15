import { isAddress } from "viem";
import {
  normalizeDirectoryMarkets,
  selectVNextMarketDirectoryView,
  type VNextDirectoryMarket,
  type VNextDirectoryResponse
} from "../vnext/market-directory";
import { RMT_SITE_URL } from "../site-identity";

export const PUBLIC_VNEXT_MARKET_MINIMUM_LIQUIDITY_USD = 5_000;
export const PUBLIC_VNEXT_MARKET_MINIMUM_VOLUME_24H_USD = 100;
export const PUBLIC_VNEXT_MARKET_DIRECTORY_REVALIDATE_SECONDS = 300;

export type PublicVNextMarketInventoryView = "all" | "trending" | "new" | "active";

export type PublicVNextInventoryMarket = VNextDirectoryMarket & {
  pairAddress: string;
};

export type PublicVNextDirectorySnapshot = {
  markets: PublicVNextInventoryMarket[];
  updatedAt?: string;
  stale: boolean;
  error?: string;
};

export const PUBLIC_VNEXT_MARKET_INVENTORY_VIEWS: ReadonlyArray<{
  id: PublicVNextMarketInventoryView;
  label: string;
  path: string;
  summary: string;
}> = [
  {
    id: "all",
    label: "All markets",
    path: "/markets/robinhood-chain",
    summary: "Qualified Robinhood Chain markets ordered by liquidity and activity."
  },
  {
    id: "trending",
    label: "Trending",
    path: "/markets/robinhood-chain/trending",
    summary: "Markets currently classified as moving or early by the canonical RMT directory."
  },
  {
    id: "new",
    label: "New",
    path: "/markets/robinhood-chain/new",
    summary: "Markets created within the last 24 hours, ordered from newest first."
  },
  {
    id: "active",
    label: "Active",
    path: "/markets/robinhood-chain/active",
    summary: "Markets with active directory signals and non-zero 24-hour volume."
  }
] as const;

const directoryEndpoint = `${RMT_SITE_URL}/api/vnext/market-directory`;
const DIRECTORY_TIMEOUT_MS = 5_000;
let lastSuccessfulSnapshot: PublicVNextDirectorySnapshot | undefined;

function hasText(value: string) {
  return value.trim().length > 0;
}

export function isPublicVNextInventoryMarket(
  market: VNextDirectoryMarket
): market is PublicVNextInventoryMarket {
  return Boolean(
    isAddress(market.address, { strict: false })
    && market.pairAddress
    && isAddress(market.pairAddress, { strict: false })
    && hasText(market.name)
    && hasText(market.symbol)
    && market.liquidityUsd >= PUBLIC_VNEXT_MARKET_MINIMUM_LIQUIDITY_USD
    && market.volume24h >= PUBLIC_VNEXT_MARKET_MINIMUM_VOLUME_24H_USD
  );
}

export function selectPublicVNextMarketInventory(
  markets: VNextDirectoryMarket[],
  view: PublicVNextMarketInventoryView
) {
  const eligible = markets.filter(isPublicVNextInventoryMarket);
  return selectVNextMarketDirectoryView(eligible, view).filter(isPublicVNextInventoryMarket);
}

export function publicVNextMarketInventoryView(view: string) {
  return PUBLIC_VNEXT_MARKET_INVENTORY_VIEWS.find((candidate) => candidate.id === view) ?? null;
}

export async function fetchPublicVNextDirectorySnapshot(): Promise<PublicVNextDirectorySnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIRECTORY_TIMEOUT_MS);
  try {
    const response = await fetch(directoryEndpoint, {
      headers: { Accept: "application/json" },
      next: { revalidate: PUBLIC_VNEXT_MARKET_DIRECTORY_REVALIDATE_SECONDS },
      signal: controller.signal
    });
    const payload = await response.json() as VNextDirectoryResponse;
    const markets = normalizeDirectoryMarkets(payload).filter(isPublicVNextInventoryMarket);
    if (!response.ok || markets.length === 0) {
      throw new Error("Canonical market directory is unavailable.");
    }
    const updatedAt = typeof payload.updatedAt === "string" && Number.isFinite(Date.parse(payload.updatedAt))
      ? payload.updatedAt
      : undefined;
    const snapshot: PublicVNextDirectorySnapshot = {
      markets,
      updatedAt,
      stale: Boolean(payload.stale),
      error: payload.stale ? "The canonical market snapshot is delayed." : undefined
    };
    lastSuccessfulSnapshot = snapshot;
    return snapshot;
  } catch {
    if (lastSuccessfulSnapshot) {
      return {
        ...lastSuccessfulSnapshot,
        stale: true,
        error: "The latest refresh is delayed; RMT is showing the last successful public snapshot."
      };
    }
    return {
      markets: [],
      stale: true,
      error: "The public market inventory is temporarily unavailable."
    };
  } finally {
    clearTimeout(timeout);
  }
}
