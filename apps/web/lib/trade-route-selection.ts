export type TradeVenueId = "sushi" | "uniswap";
export type TradeVenueHealth = "loading" | "ready" | "unavailable";
export type TradeVenueSelectionMode = "automatic" | "manual";

export const MIN_AUTO_ROUTE_IMPROVEMENT_BPS = 25;

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
  minimumImprovementBps = MIN_AUTO_ROUTE_IMPROVEMENT_BPS
}: {
  selected: TradeVenueId | null;
  quotes: ComparableTradeQuote[];
  minimumImprovementBps?: number;
}): ProtectedOutputRecommendation | undefined {
  if (
    quotes.length < 2
    || !Number.isInteger(minimumImprovementBps)
    || minimumImprovementBps < 0
    || minimumImprovementBps > 10_000
  ) return undefined;

  const outputAddress = quotes[0]?.outputToken.address.toLowerCase();
  const outputDecimals = quotes[0]?.outputToken.decimals;
  const uniqueVenues = new Set(quotes.map((quote) => quote.venue));
  const comparable = quotes.every((quote) => (
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
  if (!comparable || uniqueVenues.size !== quotes.length) return undefined;

  const ranked = [...quotes].sort((left, right) => {
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
  const selectedQuote = quotes.find((quote) => quote.venue === selected);
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
