import { getAddress } from "viem";
import { directoryMarketsFromCanonicalPools, VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT, type VNextCanonicalDirectoryResponse } from "../vnext/market-directory";
import { boundedDirectoryFailureReasons, identityReadFailureReason, type DirectoryFailureReason } from "../vnext/directory-availability";
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

// Durable metadata is browse evidence, never a substitute for quote/trade
// identity verification. Admission and Stock Token classification remain.
export async function readVNextIndexedMarketDirectoryPage(
  requestUrl: string,
  dependencies: Dependencies = {},
  onTiming?: (timing: VNextMarketIndexerTiming) => void
): Promise<{ status: 200; body: VNextCanonicalDirectoryResponse } | { status: 400 | 503; body: { canonical: true; error: string; failureReasons?: DirectoryFailureReason[] } }> {
  const reasons = new Set<DirectoryFailureReason>();
  const fail = (reason: DirectoryFailureReason, error: string) => {
    reasons.add(reason);
    return { status: 503 as const, body: { canonical: true as const, error, failureReasons: [...reasons] } };
  };
  const cursor = new URL(requestUrl).searchParams.get("cursor");
  const inventory = await (dependencies.readInventory ?? readVNextCanonicalMarketInventory)({
    limit: VNEXT_CANONICAL_DIRECTORY_PAGE_LIMIT,
    ...(cursor !== null ? { cursor } : {})
  }, { onTiming, includeBrowseIdentities: true });
  if (inventory.status === "invalid_query") return { status: 400, body: { canonical: true, error: "Invalid canonical market directory cursor." } };
  if (inventory.status !== "verified_shadow") return fail("INDEXED_INVENTORY_UNAVAILABLE", "Canonical inventory is temporarily unavailable.");
  const candidates = directoryMarketsFromCanonicalPools(inventory.pools.map(publicVNextCanonicalMarketInventoryPool));
  type BrowseIdentity = { address: string; name: string; symbol: string; decimals: number };
  const durable = new Map<string, BrowseIdentity>((inventory.browseIdentities?.identities ?? []).map((identity) => [identity.address.toLowerCase(), identity]));
  const missing = candidates.filter((market) => !durable.has(market.address.toLowerCase()));
  if (missing.length) reasons.add("INDEXED_IDENTITY_SNAPSHOT_UNAVAILABLE");
  const [live, stocks] = await Promise.all([
    missing.length ? (dependencies.readIdentities ?? readRobinhoodTokenIdentities)(missing.map((market) => getAddress(market.address)), (reason) => reasons.add(reason))
      .catch((error: unknown) => { reasons.add(identityReadFailureReason(error)); return new Map<string, BrowseIdentity>(); }) : Promise.resolve(new Map<string, BrowseIdentity>()),
    (dependencies.readStocks ?? fetchRobinhoodStockRegistry)().catch(() => null)
  ]);
  if (!stocks || stocks.coverage === "unavailable") return fail("STOCK_CLASSIFICATION_UNAVAILABLE", "Stock Token classification is temporarily unavailable.");
  const identified = candidates.flatMap((market) => {
    const identity = durable.get(market.address.toLowerCase()) ?? live.get(market.address.toLowerCase());
    if (!identity || identity.address.toLowerCase() !== market.address.toLowerCase()) return [];
    const stock = stocks.assetsByAddress.has(market.address.toLowerCase());
    const paired = market.canonicalMarkets?.some((pool) => stocks.assetsByAddress.has(pool.token0) || stocks.assetsByAddress.has(pool.token1));
    return [{ ...market, name: identity.name, symbol: identity.symbol,
      verifiedIdentity: { address: identity.address, name: identity.name, symbol: identity.symbol, decimals: identity.decimals },
      ...(stock ? { rwaRelationship: "canonical-stock-token" as const } : paired ? { rwaRelationship: "paired-market-asset" as const } : {}) }];
  });
  if (candidates.length > 0 && identified.length === 0) return fail("IDENTITY_RPC_UNAVAILABLE", "Canonical token identity evidence is temporarily unavailable.");
  if (identified.length !== candidates.length && ![...reasons].some((reason) => reason.startsWith("IDENTITY_"))) reasons.add("IDENTITY_RESPONSE_INVALID");
  let admission;
  try { admission = await (dependencies.admit ?? applyProjectIdentityDirectoryAdmission)(identified); }
  catch { return fail("PROJECT_IDENTITY_AUTHORITY_UNAVAILABLE", "Project identity authority is temporarily unavailable."); }
  if (admission.authorityStatus !== "ready") reasons.add("PROJECT_IDENTITY_AUTHORITY_UNAVAILABLE");
  const complete = identified.length === candidates.length && admission.authorityStatus === "ready";
  return { status: 200, body: {
    canonical: true, inventorySource: "indexed", revalidationComplete: complete,
    coverage: inventory.coverage.complete && complete ? "complete" : "partial",
    nextCursor: inventory.nextCursor, updatedAt: new Date().toISOString(),
    identityEvidence: durable.size ? (live.size ? "mixed" : "last-known") : "live",
    failureReasons: boundedDirectoryFailureReasons([...reasons]),
    ...(stocks.coverage === "stale" || durable.size > 0 || !complete ? { stale: true } : {}),
    markets: admission.admitted
  } };
}
