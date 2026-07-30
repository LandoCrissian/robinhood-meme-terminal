export type TradeVenueId = "sushi" | "uniswap";
export type TradeVenueHealth = "loading" | "ready" | "unavailable";
export type TradeVenueSelectionMode = "automatic" | "manual";
export type RouteLiquidityDepth = "deep" | "strong" | "moderate" | "thin" | "unknown";

export const MIN_AUTO_ROUTE_IMPROVEMENT_BPS = 25;

export function routeLiquidityDepth(liquidityUsd: number): RouteLiquidityDepth {
  if (!Number.isFinite(liquidityUsd) || liquidityUsd <= 0) return "unknown";
  if (liquidityUsd < 10_000) return "thin";
  if (liquidityUsd < 50_000) return "moderate";
  if (liquidityUsd < 250_000) return "strong";
  return "deep";
}

export function routeLiquidityDepthLabel(liquidityUsd: number) {
  const depth = routeLiquidityDepth(liquidityUsd);
  return depth === "unknown" ? "Unknown" : depth[0].toUpperCase() + depth.slice(1);
}

export type ComparableTradeQuote = {
  venue: TradeVenueId;
  minimumOut: string;
  priceImpact: number;
  outputToken: {
    address: string;
    decimals: number;
  };
};

export type ProtectedOutputRecommendation = {
  leader: TradeVenueId;
  leaderAdvantageBps: number;
  automaticVenue: TradeVenueId;
  automaticImprovementBps: number;
};

function positiveAmount(value: string) {
  try {
    const amount = BigInt(value);
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}

function improvementBps(better: bigint, baseline: bigint) {
  if (baseline <= 0n || better <= baseline) return 0;
  const bps = (better - baseline) * 10_000n / baseline;
  return Number(bps > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : bps);
}

export function protectedOutputRecommendation({
  selected,
  quotes,
  minimumImprovementBps = MIN_AUTO_ROUTE_IMPROVEMENT_BPS,
  maxPriceImpact = 0.05
}: {
  selected: TradeVenueId | null;
  quotes: ComparableTradeQuote[];
  minimumImprovementBps?: number;
  maxPriceImpact?: number;
}): ProtectedOutputRecommendation | undefined {
  if (
    quotes.length < 2
    || !Number.isInteger(minimumImprovementBps)
    || minimumImprovementBps < 0
    || minimumImprovementBps > 10_000
    || !Number.isFinite(maxPriceImpact)
    || maxPriceImpact <= 0
    || maxPriceImpact > 0.05
  ) return undefined;

  const eligibleQuotes = quotes.filter((quote) => quote.priceImpact <= maxPriceImpact);
  if (eligibleQuotes.length < 2) return undefined;
  const outputAddress = eligibleQuotes[0]?.outputToken.address.toLowerCase();
  const outputDecimals = eligibleQuotes[0]?.outputToken.decimals;
  const uniqueVenues = new Set(eligibleQuotes.map((quote) => quote.venue));
  const comparable = eligibleQuotes.every((quote) => (
    /^0x[a-f0-9]{40}$/.test(quote.outputToken.address.toLowerCase())
    && quote.outputToken.address.toLowerCase() === outputAddress
    && quote.outputToken.decimals === outputDecimals
    && Number.isInteger(quote.outputToken.decimals)
    && quote.outputToken.decimals >= 0
    && quote.outputToken.decimals <= 36
    && Number.isFinite(quote.priceImpact)
    && quote.priceImpact >= 0
    && quote.priceImpact <= 1
    && positiveAmount(quote.minimumOut) !== undefined
  ));
  if (!comparable || uniqueVenues.size !== eligibleQuotes.length) return undefined;

  const ranked = [...eligibleQuotes].sort((left, right) => {
    const leftOutput = positiveAmount(left.minimumOut) ?? 0n;
    const rightOutput = positiveAmount(right.minimumOut) ?? 0n;
    if (leftOutput !== rightOutput) return leftOutput > rightOutput ? -1 : 1;
    if (left.priceImpact !== right.priceImpact) return left.priceImpact - right.priceImpact;
    if (left.venue === selected) return -1;
    if (right.venue === selected) return 1;
    return left.venue.localeCompare(right.venue);
  });
  const leader = ranked[0];
  const runnerUp = ranked[1];
  if (!leader || !runnerUp) return undefined;

  const leaderOutput = positiveAmount(leader.minimumOut) ?? 0n;
  const runnerUpOutput = positiveAmount(runnerUp.minimumOut) ?? 0n;
  const leaderAdvantageBps = improvementBps(leaderOutput, runnerUpOutput);
  const selectedQuote = eligibleQuotes.find((quote) => quote.venue === selected);
  if (!selectedQuote) {
    return {
      leader: leader.venue,
      leaderAdvantageBps,
      automaticVenue: leader.venue,
      automaticImprovementBps: leaderAdvantageBps
    };
  }

  const selectedOutput = positiveAmount(selectedQuote.minimumOut) ?? 0n;
  const automaticImprovementBps = improvementBps(leaderOutput, selectedOutput);
  return {
    leader: leader.venue,
    leaderAdvantageBps,
    automaticVenue: automaticImprovementBps >= minimumImprovementBps ? leader.venue : selectedQuote.venue,
    automaticImprovementBps
  };
}

export function resilientTradeVenue({
  selected,
  mode,
  venues,
  health
}: {
  selected: TradeVenueId | null;
  mode: TradeVenueSelectionMode;
  venues: TradeVenueId[];
  health: Partial<Record<TradeVenueId, TradeVenueHealth>>;
}) {
  if (mode === "manual" || !selected || health[selected] !== "unavailable") return selected;
  return venues.find((venue) => venue !== selected && health[venue] === "ready") ?? selected;
}
