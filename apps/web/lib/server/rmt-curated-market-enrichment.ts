import type { RmtCuratedMarketEntry } from "../vnext/curated-market-registry";
import { RMT_CURATED_MARKET_REGISTRY } from "../vnext/curated-market-registry";

type ProviderTokenIdentity = { address?: unknown };

export type RmtCuratedProviderPairIdentity = {
  chainId?: unknown;
  pairAddress?: unknown;
  baseToken?: ProviderTokenIdentity;
  quoteToken?: ProviderTokenIdentity;
};

function normalizedIdentity(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function rmtCuratedEnrichmentTokens(
  registry: readonly RmtCuratedMarketEntry[] = RMT_CURATED_MARKET_REGISTRY
) {
  return [...new Set(registry.filter((entry) => entry.enabled).map((entry) => entry.token.toLowerCase()))];
}

export function rmtCuratedEntryForProviderPair(
  pair: RmtCuratedProviderPairIdentity,
  registry: readonly RmtCuratedMarketEntry[] = RMT_CURATED_MARKET_REGISTRY
) {
  if (pair.chainId !== "robinhood") return null;
  const poolIdentity = normalizedIdentity(pair.pairAddress);
  const baseToken = normalizedIdentity(pair.baseToken?.address);
  const quoteToken = normalizedIdentity(pair.quoteToken?.address);
  if (!poolIdentity || !baseToken || !quoteToken) return null;

  const entry = registry.find((candidate) => candidate.enabled
    && candidate.market.poolKey.toLowerCase() === poolIdentity);
  if (!entry) return null;

  const expectedAssets = [entry.market.token0.toLowerCase(), entry.market.token1.toLowerCase()].sort();
  const observedAssets = [baseToken, quoteToken].sort();
  if (expectedAssets[0] !== observedAssets[0] || expectedAssets[1] !== observedAssets[1]) return null;
  if (!observedAssets.includes(entry.token.toLowerCase())) return null;
  return entry;
}

export function filterRmtCuratedProviderPairs<Pair extends RmtCuratedProviderPairIdentity>(
  pairs: readonly Pair[],
  registry: readonly RmtCuratedMarketEntry[] = RMT_CURATED_MARKET_REGISTRY
) {
  return pairs.filter((pair) => rmtCuratedEntryForProviderPair(pair, registry) !== null);
}

export function missingRmtCuratedProviderTokens(
  pairs: readonly RmtCuratedProviderPairIdentity[],
  registry: readonly RmtCuratedMarketEntry[] = RMT_CURATED_MARKET_REGISTRY
) {
  const returned = new Set(pairs.flatMap((pair) => {
    const entry = rmtCuratedEntryForProviderPair(pair, registry);
    return entry ? [entry.token.toLowerCase()] : [];
  }));
  return rmtCuratedEnrichmentTokens(registry).filter((token) => !returned.has(token));
}
