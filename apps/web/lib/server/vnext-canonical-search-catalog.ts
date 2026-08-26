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
};

function marketIdentity(market: VNextCanonicalMarketInventoryPool) {
  return `${market.sourceId}:${market.poolKey}`;
}

async function buildCatalog(
  readInventory: InventoryReader,
  readIdentities: IdentityBatchReader,
  now: () => number
): Promise<Extract<VNextCanonicalSearchCatalog, { status: "ready" }>> {
  const markets: VNextCanonicalMarketInventoryPool[] = [];
  const seenMarkets = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let sourceManifestHash: string | null = null;
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
    sourceManifestHash = result.sourceManifestHash;
    for (const market of result.pools) {
      const key = marketIdentity(market);
      if (seenMarkets.has(key)) continue;
      seenMarkets.add(key);
      markets.push(market);
      if (markets.length === CANONICAL_SEARCH_CATALOG_MAX_MARKETS) break;
    }
    if (markets.length === CANONICAL_SEARCH_CATALOG_MAX_MARKETS || !result.nextCursor) break;
    if (seenCursors.has(result.nextCursor)) {
      throw new Error("Canonical inventory search catalog cursor did not advance.");
    }
    seenCursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  if (sourceManifestHash === null) {
    throw new Error("Canonical inventory search catalog has no source manifest.");
  }

  const addresses = [...new Set(markets.flatMap((market) => [market.token0, market.token1])
    .filter((address) => address !== ZERO_ADDRESS))]
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
  return {
    status: "ready",
    freshness: "current",
    observedAtMs: now(),
    sourceManifestHash,
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
      rebuild = buildCatalog(readInventory, readIdentities, now)
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

export const readVNextCanonicalSearchCatalog = createVNextCanonicalSearchCatalogReader();
