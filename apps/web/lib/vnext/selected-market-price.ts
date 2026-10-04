import type { AssetMarketEvidence, ExternalMarket } from "../external-market";
import { isExternalPoolIdentity, normalizeExternalPoolIdentity } from "../external-ohlcv";
import type { VNextDirectoryMarket } from "./market-directory";
import type { PresentationEvidence, TokenMarketPresentation } from "./token-presentation";

type ObservedMarket = Pick<ExternalMarket, "address" | "primaryMarket" | "verifiedMarkets"> & { pairAddress?: string };
const observationProvider = (evidence?: AssetMarketEvidence) => evidence?.provenance.startsWith("dexscreener")
  ? "DexScreener" : evidence?.provenance === "geckoterminal-pool-feed" ? "GeckoTerminal" : null;

/** Provider observations establish a perspective, not canonical pool admission. */
export function selectedMarketPool(market: ObservedMarket): string | undefined {
  const pool = market.primaryMarket?.pool.value ?? market.pairAddress;
  return pool && isExternalPoolIdentity(pool) ? normalizeExternalPoolIdentity(pool) : undefined;
}

function exactObservation(market: ObservedMarket, pool: string): AssetMarketEvidence | undefined {
  return [market.primaryMarket, ...(market.verifiedMarkets ?? [])].find((entry) => entry
    && entry.chainId === 4663
    && entry.token.address.toLowerCase() === market.address.toLowerCase()
    && entry.pool.value.toLowerCase() === pool.toLowerCase()
    && entry.displayEligibility === "eligible");
}

/** Rebind ALL summary metrics together; never label another pool's price as selected. */
export function marketAtSelectedPool<T extends ObservedMarket>(market: T, pool: string): T | undefined {
  if (selectedMarketPool(market)?.toLowerCase() === pool.toLowerCase()
    && (!market.primaryMarket || exactObservation(market, pool) === market.primaryMarket)) return market;
  const observation = exactObservation(market, pool);
  if (!observation) return undefined;
  const url = observationProvider(observation) === "DexScreener" ? `https://dexscreener.com/robinhood/${observation.pool.value}`
    : `https://www.geckoterminal.com/robinhood/pools/${observation.pool.value}`;
  return {
    ...market, primaryMarket: observation, pairAddress: observation.pool.value, dexId: observation.venue,
    url, venue: { kind: "dex", dexId: observation.venue, pairAddress: observation.pool.value, url, execution: "read-only" },
    priceUsd: observation.priceUsd, liquidityUsd: observation.liquidityUsd,
    marketCapUsd: observation.marketCapUsd, fdvUsd: observation.fdvUsd,
    volume24h: observation.volume24h, priceChange24h: observation.priceChange24h,
    pairCreatedAt: observation.pairCreatedAt, ageMinutes: null,
    // Derived age and short-window metrics belong to the old primary and cannot be transferred.
    volume5m: null, volume1h: null, priceChange5m: null, priceChange1h: null,
    buys5m: null, sells5m: null, buys1h: null, sells1h: null, buys24h: null, sells24h: null
  };
}

export function retainSelectedMarket(previous: VNextDirectoryMarket, next?: VNextDirectoryMarket): VNextDirectoryMarket {
  if (!next || next.address.toLowerCase() !== previous.address.toLowerCase()) return previous;
  const pool = selectedMarketPool(previous);
  if (!pool) return next;
  const observation = marketAtSelectedPool(next, pool);
  if (!observation) return { ...previous, canonicalMarkets: next.canonicalMarkets ?? previous.canonicalMarkets,
    verifiedIdentity: next.verifiedIdentity ?? previous.verifiedIdentity,
    resolution: next.resolution ?? previous.resolution };
  // A different observation provider is separately visible, not a silent price override.
  if (previous.primaryMarket && observation.primaryMarket
    && observationProvider(previous.primaryMarket) !== observationProvider(observation.primaryMarket)) return previous;
  return observation;
}

export function selectedMarketSnapshot(directory: VNextDirectoryMarket, market?: ExternalMarket,
  presentation?: PresentationEvidence<TokenMarketPresentation>, pool = selectedMarketPool(directory)) {
  const samePool = market && market.address.toLowerCase() === directory.address.toLowerCase()
    && (!pool || selectedMarketPool(market)?.toLowerCase() === pool.toLowerCase())
    && (!directory.primaryMarket || observationProvider(directory.primaryMarket) === observationProvider(market.primaryMarket)) ? market : undefined;
  const observed = samePool ?? directory;
  const external = presentation?.data && (!pool || presentation.data.pool.toLowerCase() === pool.toLowerCase())
    && presentation.data.token.toLowerCase() === directory.address.toLowerCase() ? presentation.data : undefined;
  // A selected provider snapshot remains its own authority, including its null fields.
  // Gecko refreshes its own selected observation, or a selection without a provider.
  const provider = observed.primaryMarket;
  const useGecko = (!provider || observationProvider(provider) === "GeckoTerminal") && external;
  const source = useGecko ? "GeckoTerminal" : observationProvider(provider) ?? "Market observation";
  return {
    pool: pool ?? selectedMarketPool(observed) ?? external?.pool,
    source,
    priceUsd: useGecko ? external.priceUsd : observed.priceUsd,
    liquidityUsd: useGecko ? external.liquidityUsd : observed.liquidityUsd,
    volume24h: useGecko ? external.volume24hUsd : observed.volume24h,
    priceChange24h: useGecko ? external.priceChange24h : observed.priceChange24h,
    quote: provider?.quoteToken.symbol ?? null
  };
}

/** A disclosure threshold, never admission, ranking, averaging or execution authority. */
export const OBSERVED_PRICE_DISPERSION_PERCENT = 20;
export function observedMarketPrices(directory: VNextDirectoryMarket, selectedPool?: string) {
  const byPool = new Map<string, AssetMarketEvidence>();
  for (const observation of [directory.primaryMarket, ...(directory.verifiedMarkets ?? [])]) {
    if (!observation || observation.chainId !== 4663 || observation.displayEligibility !== "eligible"
      || observation.token.address.toLowerCase() !== directory.address.toLowerCase()
      || observation.priceUsd === null || observation.priceUsd <= 0 || !Number.isFinite(observation.priceUsd)) continue;
    const key = observation.pool.value.toLowerCase();
    if (!byPool.has(key)) byPool.set(key, observation);
  }
  const observations = [...byPool.values()];
  const prices = observations.map(o => o.priceUsd!);
  const dispersion = prices.length > 1 ? 100 * (Math.max(...prices) / Math.min(...prices) - 1) : 0;
  return { observations: observations.sort((a, b) => Number(b.pool.value.toLowerCase() === selectedPool?.toLowerCase())
    - Number(a.pool.value.toLowerCase() === selectedPool?.toLowerCase()) || a.pool.value.localeCompare(b.pool.value)),
    dispersion, dispersed: dispersion > OBSERVED_PRICE_DISPERSION_PERCENT };
}
