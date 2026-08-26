import { getAddress, type Address } from "viem";
import {
  readVNextCanonicalMarketInventory,
  type VNextCanonicalMarketInventoryPool,
  type VNextCanonicalMarketInventoryQuery,
  type VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";
import { readRobinhoodTokenIdentities } from "./universal-market-resolver";

export const CANONICAL_SEARCH_CATALOG_FRESH_MS = 5 * 60_000;
export const CANONICAL_SEARCH_CATALOG_LAST_GOOD_MS = 30 * 60_000;
export const CANONICAL_SEARCH_CATALOG_MAX_MARKETS = 4_000;
export const CANONICAL_SEARCH_CATALOG_MAX_ENTRIES = 2_048;
export const CANONICAL_SEARCH_CATALOG_BUILD_DEADLINE_MS = 2_800;
const CANONICAL_SEARCH_CATALOG_PAGE_LIMIT = 500;
const CANONICAL_SEARCH_CATALOG_MAX_PAGES = 8;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

export type VNextCanonicalSearchIdentity = {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
};

export type VNextCanonicalSearchCatalogEntry = {
  identity: VNextCanonicalSearchIdentity;
  markets: VNextCanonicalMarketInventoryPool[];
};

export type VNextCanonicalSearchCatalog =
  | {
      status: "ready";
      freshness: "current" | "last-known";
      observedAtMs: number;
      sourceManifestHash: string;
      capacity: {
        tokenCount: number;
        candidateTokenCount: number;
        marketCount: number;
        pageCount: number;
        maximumTokens: number;
        maximumMarkets: number;
        maximumPages: number;
        truncated: boolean;
      };
      entries: VNextCanonicalSearchCatalogEntry[];
    }
  | { status: "unavailable"; entries: [] };

type InventoryReader = (
  query: VNextCanonicalMarketInventoryQuery
) => Promise<VNextCanonicalMarketInventoryResult>;

type IdentityBatchReader = (
  addresses: readonly Address[]
) => Promise<Map<string, VNextCanonicalSearchIdentity>>;

export type VNextCanonicalSearchCatalogDependencies = {
  readInventory?: InventoryReader;
  readIdentities?: IdentityBatchReader;
  now?: () => number;
  buildDeadlineMs?: number;
  observeCapacity?: (
    capacity: Extract<VNextCanonicalSearchCatalog, { status: "ready" }>["capacity"]
  ) => void;
};

function marketIdentity(market: VNextCanonicalMarketInventoryPool) {
  return `${market.sourceId}:${market.poolKey}`;
}

async function buildCatalog(
  readInventory: InventoryReader,
  readIdentities: IdentityBatchReader,
  now: () => number,
  observeCapacity?: VNextCanonicalSearchCatalogDependencies["observeCapacity"]
): Promise<Extract<VNextCanonicalSearchCatalog, { status: "ready" }>> {
  const markets: VNextCanonicalMarketInventoryPool[] = [];
  const seenMarkets = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let sourceManifestHash: string | null = null;
  let pageCount = 0;
  let truncated = false;
  for (let page = 0; page < CANONICAL_SEARCH_CATALOG_MAX_PAGES; page += 1) {
    const result = await readInventory({
      limit: CANONICAL_SEARCH_CATALOG_PAGE_LIMIT,
      ...(cursor ? { cursor } : {})
    });
    if (result.status !== "verified_shadow") {
      throw new Error("Canonical inventory is unavailable for search catalog refresh.");
    }
    if (sourceManifestHash !== null && result.sourceManifestHash !== sourceManifestHash) {
      throw new Error("Canonical inventory source manifest changed during search catalog refresh.");
    }
    pageCount += 1;
    sourceManifestHash = result.sourceManifestHash;
    for (const market of result.pools) {
      const key = marketIdentity(market);
      if (seenMarkets.has(key)) continue;
      if (markets.length === CANONICAL_SEARCH_CATALOG_MAX_MARKETS) {
        truncated = true;
        break;
      }
      seenMarkets.add(key);
      markets.push(market);
    }
    if (markets.length === CANONICAL_SEARCH_CATALOG_MAX_MARKETS) {
      truncated ||= result.nextCursor !== null;
      break;
    }
    if (!result.nextCursor) break;
    if (page === CANONICAL_SEARCH_CATALOG_MAX_PAGES - 1) {
      truncated = true;
      break;
    }
    if (seenCursors.has(result.nextCursor)) {
      throw new Error("Canonical inventory search catalog cursor did not advance.");
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  if (sourceManifestHash === null) {
    throw new Error("Canonical inventory search catalog has no source manifest.");
  }

  const candidateAddresses = [...new Set(markets.flatMap((market) => [market.token0, market.token1])
    .filter((address) => address !== ZERO_ADDRESS))];
  truncated ||= candidateAddresses.length > CANONICAL_SEARCH_CATALOG_MAX_ENTRIES;
  const addresses = candidateAddresses
    .slice(0, CANONICAL_SEARCH_CATALOG_MAX_ENTRIES)
    .map((address) => getAddress(address));
  const identities = await readIdentities(addresses);
  const marketsByToken = new Map<string, VNextCanonicalMarketInventoryPool[]>();
  for (const market of markets) {
    for (const address of [market.token0, market.token1]) {
      if (address === ZERO_ADDRESS || !identities.has(address.toLowerCase())) continue;
      const current = marketsByToken.get(address) ?? [];
      current.push(market);
      marketsByToken.set(address, current);
    }
  }
  const entries = addresses.flatMap((address) => {
    const identity = identities.get(address.toLowerCase());
    const tokenMarkets = marketsByToken.get(address.toLowerCase()) ?? marketsByToken.get(address) ?? [];
    return identity && tokenMarkets.length > 0
      ? [{ identity, markets: tokenMarkets.sort((left, right) => marketIdentity(left).localeCompare(marketIdentity(right))) }]
      : [];
  });
  const capacity = {
    tokenCount: entries.length,
    candidateTokenCount: candidateAddresses.length,
    marketCount: markets.length,
    pageCount,
    maximumTokens: CANONICAL_SEARCH_CATALOG_MAX_ENTRIES,
    maximumMarkets: CANONICAL_SEARCH_CATALOG_MAX_MARKETS,
    maximumPages: CANONICAL_SEARCH_CATALOG_MAX_PAGES,
    truncated
  };
  observeCapacity?.(capacity);
  return {
    status: "ready",
    freshness: "current",
    observedAtMs: now(),
    sourceManifestHash,
    capacity,
    entries
  };
}

export function createVNextCanonicalSearchCatalogReader(
  dependencies: VNextCanonicalSearchCatalogDependencies = {}
) {
  const readInventory = dependencies.readInventory ?? readVNextCanonicalMarketInventory;
  const readIdentities = dependencies.readIdentities ?? readRobinhoodTokenIdentities;
  const now = dependencies.now ?? Date.now;
  const buildDeadlineMs = dependencies.buildDeadlineMs ?? CANONICAL_SEARCH_CATALOG_BUILD_DEADLINE_MS;
  const observeCapacity = dependencies.observeCapacity;
  let cached: Extract<VNextCanonicalSearchCatalog, { status: "ready" }> | undefined;
  let rebuild: Promise<Extract<VNextCanonicalSearchCatalog, { status: "ready" }> | null> | undefined;
  let rebuildStartedAtMs = 0;

  const fallback = (): VNextCanonicalSearchCatalog => {
    if (cached && now() - cached.observedAtMs <= CANONICAL_SEARCH_CATALOG_LAST_GOOD_MS) {
      return { ...cached, freshness: "last-known" };
    }
    return { status: "unavailable", entries: [] };
  };

  const refresh = () => {
    if (!rebuild) {
      rebuildStartedAtMs = Date.now();
      rebuild = buildCatalog(readInventory, readIdentities, now, observeCapacity)
        .then((snapshot) => {
          cached = snapshot;
          return snapshot;
        })
        .catch(() => null)
        .finally(() => {
          rebuild = undefined;
        });
    }
    const remainingMs = Math.max(0, buildDeadlineMs - (Date.now() - rebuildStartedAtMs));
    if (remainingMs === 0) return Promise.resolve(fallback());
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error("Canonical search catalog refresh timed out.")), remainingMs);
    });
    return Promise.race([rebuild, deadline])
      .then((snapshot): VNextCanonicalSearchCatalog => snapshot ?? fallback())
      .catch((): VNextCanonicalSearchCatalog => fallback())
      .finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });
  };

  return async (): Promise<VNextCanonicalSearchCatalog> => {
    if (!cached) return refresh();
    const age = now() - cached.observedAtMs;
    if (age <= CANONICAL_SEARCH_CATALOG_FRESH_MS) return cached;
    if (age <= CANONICAL_SEARCH_CATALOG_LAST_GOOD_MS) {
      void refresh();
      return { ...cached, freshness: "last-known" };
    }
    return refresh();
  };
}

export const readVNextCanonicalSearchCatalog = createVNextCanonicalSearchCatalogReader({
  observeCapacity: (capacity) => {
    console.info(JSON.stringify({ event: "vnext_canonical_search_catalog_capacity", ...capacity }));
  }
});
