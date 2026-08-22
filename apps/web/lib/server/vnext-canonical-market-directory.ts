import {
  publicVNextCanonicalMarketInventoryPool,
  readVNextCanonicalMarketInventory,
  type VNextCanonicalMarketInventoryQuery,
  type VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";
import {
  VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT,
  directoryMarketsFromCanonicalPools,
  type VNextCanonicalDirectoryResponse
} from "../vnext/market-directory";

type CanonicalInventoryReader = (
  query: VNextCanonicalMarketInventoryQuery
) => Promise<VNextCanonicalMarketInventoryResult>;

export type VNextCanonicalMarketDirectoryPage =
  | { status: 200; body: VNextCanonicalDirectoryResponse }
  | { status: 400 | 503; body: { canonical: true; error: string } };

export async function readVNextCanonicalMarketDirectoryPage(
  requestUrl: string,
  readInventory: CanonicalInventoryReader = readVNextCanonicalMarketInventory
): Promise<VNextCanonicalMarketDirectoryPage> {
  const cursor = new URL(requestUrl).searchParams.get("cursor") ?? undefined;
  let inventory: VNextCanonicalMarketInventoryResult;
  try {
    inventory = await readInventory({
      limit: VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT,
      cursor
    });
  } catch {
    return { status: 503, body: { canonical: true, error: "Canonical market directory is not ready." } };
  }

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
      markets: directoryMarketsFromCanonicalPools(
        inventory.pools.map(publicVNextCanonicalMarketInventoryPool)
      )
    }
  };
}
