import { getAddress } from "viem";
import { directoryMarketsFromCanonicalPools, VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT, type VNextCanonicalDirectoryResponse } from "../vnext/market-directory";
import { readVNextCanonicalMarketInventory, publicVNextCanonicalMarketInventoryPool, type VNextMarketIndexerTiming } from "./vnext-market-indexer";
import { readRobinhoodTokenIdentities } from "./universal-market-resolver";
import { applyProjectIdentityDirectoryAdmission } from "./project-identity-admission";
import { fetchRobinhoodStockRegistry } from "./robinhood-stock-token-registry";

type Dependencies = {
  readInventory?: typeof readVNextCanonicalMarketInventory;
  readIdentities?: typeof readRobinhoodTokenIdentities;
  readStocks?: typeof fetchRobinhoodStockRegistry;
  admit?: typeof applyProjectIdentityDirectoryAdmission;
};

// Inventory and admission are browse authority; activity providers are not.
// Preserve validated pagination rather than imposing a curated-token cap.
export async function readVNextIndexedMarketDirectoryPage(
  requestUrl: string,
  dependencies: Dependencies = {},
  onTiming?: (timing: VNextMarketIndexerTiming) => void
): Promise<{ status: 200; body: VNextCanonicalDirectoryResponse } | { status: 400 | 503; body: { canonical: true; error: string } }> {
  const cursor = new URL(requestUrl).searchParams.get("cursor");
  const inventory = await (dependencies.readInventory ?? readVNextCanonicalMarketInventory)({
    limit: VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT,
    ...(cursor !== null ? { cursor } : {})
  }, { onTiming });
  if (inventory.status === "invalid_query") return { status: 400, body: { canonical: true, error: "Invalid canonical market directory cursor." } };
  if (inventory.status !== "verified_shadow") return { status: 503, body: { canonical: true, error: "Canonical inventory is temporarily unavailable." } };
  const candidates = directoryMarketsFromCanonicalPools(inventory.pools.map(publicVNextCanonicalMarketInventoryPool));
  const [identities, stocks] = await Promise.all([
    (dependencies.readIdentities ?? readRobinhoodTokenIdentities)(candidates.map((market) => getAddress(market.address))),
    (dependencies.readStocks ?? fetchRobinhoodStockRegistry)()
  ]);
  // Never present an unclassified Stock Token as an ordinary tradable asset.
  if (stocks.coverage === "unavailable") return { status: 503, body: { canonical: true, error: "Stock Token classification is temporarily unavailable." } };
  const identified = candidates.flatMap((market) => {
    const identity = identities.get(market.address.toLowerCase());
    if (!identity || identity.address.toLowerCase() !== market.address.toLowerCase()) return [];
    const stock = stocks.assetsByAddress.has(market.address.toLowerCase());
    const paired = market.canonicalMarkets?.some((pool) => stocks.assetsByAddress.has(pool.token0) || stocks.assetsByAddress.has(pool.token1));
    return [{ ...market, name: identity.name, symbol: identity.symbol,
      verifiedIdentity: { address: identity.address, name: identity.name, symbol: identity.symbol, decimals: identity.decimals },
      ...(stock ? { rwaRelationship: "canonical-stock-token" as const }
        : paired ? { rwaRelationship: "paired-market-asset" as const } : {}) }];
  });
  const admission = await (dependencies.admit ?? applyProjectIdentityDirectoryAdmission)(identified);
  return { status: 200, body: {
    canonical: true,
    inventorySource: "indexed",
    revalidationComplete: identified.length === candidates.length && admission.authorityStatus === "ready",
    coverage: inventory.coverage.complete && identified.length === candidates.length && admission.authorityStatus === "ready" ? "complete" : "partial",
    nextCursor: inventory.nextCursor,
    updatedAt: new Date().toISOString(),
    ...(stocks.coverage === "stale" ? { stale: true } : {}),
    markets: admission.admitted
  } };
}
