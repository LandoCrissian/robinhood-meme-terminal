import { isAddress, isHash, zeroAddress, type Address, type Hash } from "viem";

const minSqrtPrice = 4295128739n;
const maxSqrtPrice = 1461446703485210103287273052203988822378723970342n;
const basisPoints = 10_000n;

// Draft review requirements. A production source registry and limits require separate approval.
export const growthPricePolicy = {
  maxAgeSeconds: 120n,
  minHistorySeconds: 1_800n,
  maxHistorySeconds: 7_200n,
  minObservations: 12n,
  minQuoteDepthWei: 5n * 10n ** 18n,
  minConfirmations: 2n,
  maxObservationSkewSeconds: 30n,
  maxSourceDisagreementBps: 50n,
  maxSpotDeviationBps: 100n,
} as const;

export type GrowthPriceBlock = { number: bigint; hash: Hash; timestamp: bigint };
export type GrowthPriceMarket = { chainId: number; authority: Address; marketId: Hash };
export type GrowthPriceSource = {
  market: GrowthPriceMarket;
  venue: string;
  operator: string;
  authorityCodeHash: Hash;
};

// Adapters must produce these facts from the configured venue's own market history.
// The quote depth is the minimum two-sided executable depth within 1% over the window.
export type GrowthPriceObservation = {
  market: GrowthPriceMarket;
  token: Address;
  quote: typeof zeroAddress;
  method: "time-weighted";
  start: GrowthPriceBlock;
  end: GrowthPriceBlock;
  observations: bigint;
  minQuoteDepthWei: bigint;
  // Square root of token base units per quote wei, scaled by 2^96.
  sqrtPriceX96: bigint;
};

type GrowthPriceReader = {
  getChainId(): Promise<number>;
  getHead(): Promise<GrowthPriceBlock>;
  getCanonicalBlock(number: bigint): Promise<GrowthPriceBlock>;
  getAuthorityCodeHash(authority: Address, block: GrowthPriceBlock): Promise<Hash>;
  getTargetSqrtPrice(market: GrowthPriceMarket, block: GrowthPriceBlock): Promise<bigint>;
};

type Unavailable = {
  status: "unavailable";
  reason: "unsupported_market" | "independent_sources_missing" | "wrong_chain" | "invalid_observation"
    | "stale" | "insufficient_history" | "thin_market" | "source_disagreement"
    | "spot_outside_bounds" | "noncanonical" | "source_unavailable";
};
type GrowthPriceEvidence = Unavailable | {
  status: "verified";
  referenceSqrtPriceX96: bigint;
  observedAt: bigint;
  validUntil: bigint;
  head: GrowthPriceBlock;
  sources: { source: GrowthPriceSource; observation: GrowthPriceObservation }[];
};

const unavailable = (reason: Unavailable["reason"]): Unavailable => ({ status: "unavailable", reason });
const same = (first: string, second: string) => first.toLowerCase() === second.toLowerCase();
const sameMarket = (first: GrowthPriceMarket, second: GrowthPriceMarket) => first.chainId === second.chainId
  && same(first.authority, second.authority) && same(first.marketId, second.marketId);
const sameBlock = (first: GrowthPriceBlock, second: GrowthPriceBlock) => first.number === second.number
  && first.timestamp === second.timestamp && same(first.hash, second.hash);
const validHash = (value: string) => isHash(value) && !/^0x0+$/i.test(value);
const validBlock = (block: GrowthPriceBlock) => block.number >= 0n && block.timestamp > 0n && validHash(block.hash);
const validPrice = (price: bigint) => price >= minSqrtPrice && price < maxSqrtPrice;
const validAddress = (address: Address) => isAddress(address) && !same(address, zeroAddress);
const validMarket = (market: GrowthPriceMarket) => Number.isSafeInteger(market.chainId) && market.chainId > 0
  && validAddress(market.authority) && validHash(market.marketId);
const validSourceLabel = (value: string) => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);

export function withinActualPriceBps(observedSqrt: bigint, referenceSqrt: bigint, toleranceBps: bigint): boolean {
  if (!validPrice(observedSqrt) || !validPrice(referenceSqrt) || toleranceBps < 0n || toleranceBps > basisPoints) return false;
  const observed = observedSqrt ** 2n;
  const reference = referenceSqrt ** 2n;
  const difference = observed >= reference ? observed - reference : reference - observed;
  return difference * basisPoints <= reference * toleranceBps;
}

/**
 * Validates two observations from an operator-approved registry. The caller supplies reviewed adapters and a
 * block-bound chain reader. Chain checks validate timestamps, runtime identities and branch consistency.
 * Adapter facts and independence of the registered operators require separate verification before release.
 * No source registry, provider fallback or automatic signer is shipped.
 */
export async function validateGrowthPriceEvidence(
  target: { market: GrowthPriceMarket; token: Address },
  sources: readonly GrowthPriceSource[],
  observations: readonly GrowthPriceObservation[],
  reader: GrowthPriceReader,
  now: bigint,
): Promise<GrowthPriceEvidence> {
  const policy = growthPricePolicy;
  if (!validMarket(target.market) || !validAddress(target.token)) return unavailable("unsupported_market");
  if (sources.length !== 2 || observations.length !== 2) return unavailable("independent_sources_missing");
  const [first, second] = sources;
  if (first.venue === second.venue || first.operator === second.operator || same(first.market.authority, second.market.authority)
    || sources.some(({ market, venue, operator, authorityCodeHash }) => !validMarket(market)
      || market.chainId !== target.market.chainId || same(market.authority, target.market.authority)
      || !validSourceLabel(venue) || !validSourceLabel(operator) || !validHash(authorityCodeHash))) {
    return unavailable("independent_sources_missing");
  }
  const evidence: { source: GrowthPriceSource; observation: GrowthPriceObservation }[] = [];
  for (const source of sources) {
    const observation = observations.find(({ market }) => sameMarket(source.market, market));
    if (!observation || !same(observation.token, target.token) || !same(observation.quote, zeroAddress)
      || observation.method !== "time-weighted" || !validPrice(observation.sqrtPriceX96)
      || !validBlock(observation.start) || !validBlock(observation.end) || observation.start.number >= observation.end.number) {
      return unavailable("invalid_observation");
    }
    const age = now - observation.end.timestamp;
    if (age < 0n || age > policy.maxAgeSeconds) return unavailable("stale");
    const history = observation.end.timestamp - observation.start.timestamp;
    if (history < policy.minHistorySeconds || history > policy.maxHistorySeconds || observation.observations < policy.minObservations) {
      return unavailable("insufficient_history");
    }
    if (observation.minQuoteDepthWei < policy.minQuoteDepthWei) return unavailable("thin_market");
    evidence.push({ source, observation });
  }
  const [a, b] = evidence.map(({ observation }) => observation);
  const [older, newer] = a.end.timestamp <= b.end.timestamp ? [a, b] : [b, a];
  if (newer.end.timestamp - older.end.timestamp > policy.maxObservationSkewSeconds) return unavailable("stale");
  const [low, high] = a.sqrtPriceX96 <= b.sqrtPriceX96 ? [a.sqrtPriceX96, b.sqrtPriceX96] : [b.sqrtPriceX96, a.sqrtPriceX96];
  if (!withinActualPriceBps(high, low, policy.maxSourceDisagreementBps)) return unavailable("source_disagreement");

  try {
    const [chainId, head] = await Promise.all([reader.getChainId(), reader.getHead()]);
    if (chainId !== target.market.chainId) return unavailable("wrong_chain");
    if (!validBlock(head) || head.timestamp > now || now - head.timestamp > policy.maxAgeSeconds) return unavailable("stale");
    const matches = await Promise.all(evidence.map(async ({ source, observation: { start, end } }) => {
      if (head.number - end.number < policy.minConfirmations || end.timestamp > head.timestamp) return false;
      const [actualStart, actualEnd, startCodeHash, endCodeHash] = await Promise.all([
        reader.getCanonicalBlock(start.number), reader.getCanonicalBlock(end.number),
        reader.getAuthorityCodeHash(source.market.authority, start),
        reader.getAuthorityCodeHash(source.market.authority, end),
      ]);
      return sameBlock(start, actualStart) && sameBlock(end, actualEnd)
        && same(source.authorityCodeHash, startCodeHash) && same(source.authorityCodeHash, endCodeHash);
    }));
    if (!matches.every(Boolean)) return unavailable("noncanonical");
    const spot = await reader.getTargetSqrtPrice(target.market, head);
    if (!sameBlock(head, await reader.getCanonicalBlock(head.number))) return unavailable("noncanonical");
    if (!evidence.every(({ observation }) => withinActualPriceBps(spot, observation.sqrtPriceX96, policy.maxSpotDeviationBps))) {
      return unavailable("spot_outside_bounds");
    }
    return { status: "verified", referenceSqrtPriceX96: (low + high) / 2n,
      observedAt: older.end.timestamp, validUntil: older.end.timestamp + policy.maxAgeSeconds, head, sources: evidence };
  } catch {
    return unavailable("source_unavailable");
  }
}
