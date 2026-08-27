import type { VNextCanonicalDirectoryResponse } from "../vnext/market-directory";
import { readRmtCuratedMarketSnapshot } from "./rmt-curated-market-registry";
import {
  publicVNextCanonicalMarketInventoryPool,
  type VNextCanonicalMarketInventoryQuery,
  type VNextCanonicalMarketInventoryResult,
  type VNextMarketIndexerTiming
} from "./vnext-market-indexer";
import {
  VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT,
  directoryMarketsFromCanonicalPools
} from "../vnext/market-directory";

type LegacyInventoryReader = (query: VNextCanonicalMarketInventoryQuery) => Promise<VNextCanonicalMarketInventoryResult>;

export type VNextCanonicalMarketDirectoryPage =
  | { status: 200; body: VNextCanonicalDirectoryResponse }
  | { status: 400 | 503; body: { canonical: true; error: string } };

export async function readVNextCanonicalMarketDirectoryPage(
  requestUrl: string,
  reader: ((...args: any[]) => Promise<any>) = readRmtCuratedMarketSnapshot,
  onTiming?: (timing: VNextMarketIndexerTiming) => void
): Promise<VNextCanonicalMarketDirectoryPage> {
  const cursor = new URL(requestUrl).searchParams.get("cursor");
  if (reader !== readRmtCuratedMarketSnapshot) {
    let inventory: VNextCanonicalMarketInventoryResult;
    try {
      inventory = await (reader as LegacyInventoryReader)({
        limit: VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT,
        cursor: cursor ?? undefined
      });
    } catch {
      return { status: 503, body: { canonical: true, error: "Canonical market directory is not ready." } };
    }
    onTiming?.({ indexerReadMs: 0, inventoryJsonMs: 0, inventorySchemaMs: 0 });
    if (inventory.status === "invalid_query") {
      return { status: 400, body: { canonical: true, error: "Invalid canonical market directory cursor." } };
    }
    if (inventory.status !== "verified_shadow") {
      return { status: 503, body: { canonical: true, error: "Canonical market directory is not ready." } };
    }
    return {
      status: 200,
      body: {
        canonical: true,
        coverage: inventory.coverage.complete ? "complete" : "partial",
        nextCursor: inventory.nextCursor,
        updatedAt: new Date().toISOString(),
        markets: directoryMarketsFromCanonicalPools(inventory.pools.map(publicVNextCanonicalMarketInventoryPool))
      }
    };
  }
  if (cursor !== null) return { status: 400, body: { canonical: true, error: "The curated directory has one bounded page." } };
  try {
    const snapshot = await readRmtCuratedMarketSnapshot();
    return {
      status: 200,
      body: {
        canonical: true,
        coverage: "complete",
        nextCursor: null,
        updatedAt: snapshot.verifiedAt,
        ...(snapshot.stale ? { stale: true } : {}),
        markets: snapshot.markets
      }
    };
  } catch {
    return { status: 503, body: { canonical: true, error: "The curated market registry is temporarily unavailable." } };
  }
}
