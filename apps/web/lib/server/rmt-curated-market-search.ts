import { getAddress, isAddress } from "viem";
import {
  RMT_CURATED_MARKET_REGISTRY,
  normalizeRmtCuratedSearch,
  rmtCuratedMarketByPool,
  rmtCuratedMarketByToken,
  rmtCuratedMarketSearchCandidates
} from "../vnext/curated-market-registry";
import type {
  VNextUniversalMarketSearchMatchedBy,
  VNextUniversalMarketSearchResult,
  VNextUniversalMarketSearchResultItem
} from "../vnext/universal-market-search-contract";
import { readRobinhoodTokenIdentity } from "./universal-market-resolver";
import { readRmtCuratedMarketSnapshot } from "./rmt-curated-market-registry";
import { excludeKnownPositiveProjectIdentityQuarantines } from "./project-identity-admission";

const POOL_ID = /^0x[0-9a-fA-F]{64}$/;
const MAX_QUERY_LENGTH = 160;

type CuratedSearchDependencies = {
  readSnapshot?: typeof readRmtCuratedMarketSnapshot;
  readIdentity?: typeof readRobinhoodTokenIdentity;
};

function resultItem(
  address: string,
  matchedBy: VNextUniversalMarketSearchMatchedBy,
  snapshot: Awaited<ReturnType<typeof readRmtCuratedMarketSnapshot>>
): VNextUniversalMarketSearchResultItem | null {
  const market = snapshot.markets.find((candidate) => candidate.address.toLowerCase() === address.toLowerCase());
  const identity = market?.verifiedIdentity;
  if (!market || !identity) return null;
  const result = {
    address: identity.address.toLowerCase(),
    name: identity.name,
    symbol: identity.symbol,
    decimals: identity.decimals,
    matchedBy,
    markets: market.canonicalMarkets ?? []
  };
  return excludeKnownPositiveProjectIdentityQuarantines([result]).length === 1 ? result : null;
}

function identityMatch(query: string, name: string, symbol: string) {
  const normalized = normalizeRmtCuratedSearch(query);
  const normalizedSymbol = normalizeRmtCuratedSearch(symbol);
  const normalizedName = normalizeRmtCuratedSearch(name);
  if (normalized === normalizedSymbol) return "symbol" as const;
  if (normalized === normalizedName) return "name" as const;
  return null;
}

export async function searchRmtCuratedMarkets(
  requestedQuery: string,
  dependencies: CuratedSearchDependencies = {}
): Promise<VNextUniversalMarketSearchResult> {
  const readSnapshot = dependencies.readSnapshot ?? readRmtCuratedMarketSnapshot;
  const readIdentity = dependencies.readIdentity ?? readRobinhoodTokenIdentity;
  const query = requestedQuery.trim();
  const exactAddress = isAddress(query, { strict: false }) ? getAddress(query) : null;
  const exactPoolId = POOL_ID.test(query) ? query.toLowerCase() : null;
  const queryKind = exactPoolId ? "v4-pool-id" : exactAddress ? "token-or-pool-address" : "text";
  if (!query || query.length > MAX_QUERY_LENGTH || (/^0x/i.test(query) && !exactAddress && !exactPoolId)) {
    return { query, queryKind, status: "invalid_query", results: [] };
  }

  if (exactAddress) {
    const curated = rmtCuratedMarketByToken(exactAddress) ?? rmtCuratedMarketByPool(exactAddress);
    if (!curated) {
      const identity = await readIdentity(exactAddress);
      return { query, queryKind, status: identity ? "not_listed" : "not_found", results: [] };
    }
    const snapshot = await readSnapshot();
    const item = resultItem(curated.token, curated.token.toLowerCase() === exactAddress.toLowerCase() ? "token" : "pool", snapshot);
    return { query, queryKind, status: item ? "found" : "inventory_unavailable", results: item ? [item] : [] };
  }

  if (exactPoolId) {
    const curated = rmtCuratedMarketByPool(exactPoolId);
    if (!curated) return { query, queryKind, status: "not_found", results: [] };
    const snapshot = await readSnapshot();
    const item = resultItem(curated.token, "pool-id", snapshot);
    return { query, queryKind, status: item ? "found" : "inventory_unavailable", results: item ? [item] : [] };
  }

  const candidates = rmtCuratedMarketSearchCandidates(query);
  if (candidates.length === 0) return { query, queryKind, status: "not_found", results: [] };
  const snapshot = await readSnapshot();
  const results = candidates.flatMap((entry) => {
    const market = snapshot.markets.find((candidate) => candidate.address.toLowerCase() === entry.token.toLowerCase());
    const identity = market?.verifiedIdentity;
    const matchedBy = identity ? identityMatch(query, identity.name, identity.symbol) ?? "normalized-name" : null;
    const item = matchedBy ? resultItem(entry.token, matchedBy, snapshot) : null;
    return item ? [item] : [];
  });
  return { query, queryKind, status: results.length ? "found" : "not_found", results };
}

export function rmtCuratedMarketCount() {
  return RMT_CURATED_MARKET_REGISTRY.length;
}
