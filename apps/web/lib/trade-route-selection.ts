export type TradeVenueId = "sushi" | "uniswap-v3" | "uniswap-v4";
export type TradeVenueHealth = "loading" | "ready" | "unavailable";
export type TradeVenueSelectionMode = "automatic" | "manual";
export type RouteLiquidityDepth = "deep" | "strong" | "moderate" | "thin" | "unknown";

export const MIN_AUTO_ROUTE_IMPROVEMENT_BPS = 25;

export function tradeVenueLabel(venue: TradeVenueId) {
  if (venue === "sushi") return "Sushi";
  if (venue === "uniswap-v4") return "Uniswap v4";
  return "Uniswap v3";
}

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
  deadline?: string;
  quotedAtMs?: number;
  estimatedNetworkFeeWei?: string;
  liquidityUsd?: number;
  outputToken: {
    address: string;
    decimals: number;
  };
};

export type UniversalRouteRecommendation = {
  selected: TradeVenueId;
  backups: TradeVenueId[];
  protectedOutputLeader: TradeVenueId;
  selectedOutputAdvantageBps: number;
  reason: "protected-output" | "lower-network-fee" | "lower-price-impact" | "deeper-liquidity" | "fresher-quote";
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

function safeUnsigned(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function routeOutputAfterGas(quote: ComparableTradeQuote) {
  const output = positiveAmount(quote.minimumOut);
  if (output === undefined) return undefined;
  // Native ETH is represented by the zero address in RMT comparison state. Only
  // then are the output and the network fee denominated in the same asset.
  if (quote.outputToken.address.toLowerCase() !== "0x0000000000000000000000000000000000000000") return output;
  const fee = safeUnsigned(quote.estimatedNetworkFeeWei);
  return fee === undefined || fee >= output ? output : output - fee;
}

export function universalRouteRecommendation({
  selected,
  quotes,
  nowMs,
  minimumOutputImprovementBps = MIN_AUTO_ROUTE_IMPROVEMENT_BPS,
  maxPriceImpact = 0.05
}: {
  selected: TradeVenueId | null;
  quotes: ComparableTradeQuote[];
  nowMs: number;
  minimumOutputImprovementBps?: number;
  maxPriceImpact?: number;
}): UniversalRouteRecommendation | undefined {
  if (
    quotes.length === 0
    || !Number.isFinite(nowMs)
    || !Number.isInteger(minimumOutputImprovementBps)
    || minimumOutputImprovementBps < 0
    || minimumOutputImprovementBps > 10_000
    || !Number.isFinite(maxPriceImpact)
    || maxPriceImpact <= 0
    || maxPriceImpact > 1
  ) return undefined;

  const outputAddress = quotes[0]?.outputToken.address.toLowerCase();
  const outputDecimals = quotes[0]?.outputToken.decimals;
  const eligible = quotes.filter((quote) => {
    const deadline = safeUnsigned(quote.deadline);
    return (
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
      && (deadline === undefined || deadline > BigInt(Math.floor(nowMs / 1_000) + 10))
      && (quote.quotedAtMs === undefined || (Number.isFinite(quote.quotedAtMs) && quote.quotedAtMs <= nowMs))
    );
  });
  if (eligible.length === 0 || new Set(eligible.map((quote) => quote.venue)).size !== eligible.length) return undefined;

  const outputRanked = [...eligible].sort((left, right) => {
    const leftOutput = routeOutputAfterGas(left) ?? 0n;
    const rightOutput = routeOutputAfterGas(right) ?? 0n;
    if (leftOutput !== rightOutput) return leftOutput > rightOutput ? -1 : 1;
    return left.venue.localeCompare(right.venue);
  });
  const outputLeader = outputRanked[0]!;
  const leaderOutput = routeOutputAfterGas(outputLeader) ?? 0n;
  const nearLeaders = outputRanked.filter((quote) => {
    const output = routeOutputAfterGas(quote) ?? 0n;
    return improvementBps(leaderOutput, output) < minimumOutputImprovementBps;
  });

  const ranked = [...nearLeaders].sort((left, right) => {
    const leftFee = safeUnsigned(left.estimatedNetworkFeeWei);
    const rightFee = safeUnsigned(right.estimatedNetworkFeeWei);
    if (leftFee !== undefined && rightFee !== undefined && leftFee !== rightFee) return leftFee < rightFee ? -1 : 1;
    if (left.priceImpact !== right.priceImpact) return left.priceImpact - right.priceImpact;
    const leftLiquidity = Number.isFinite(left.liquidityUsd) ? left.liquidityUsd! : 0;
    const rightLiquidity = Number.isFinite(right.liquidityUsd) ? right.liquidityUsd! : 0;
    if (leftLiquidity !== rightLiquidity) return leftLiquidity > rightLiquidity ? -1 : 1;
    const leftQuotedAt = Number.isFinite(left.quotedAtMs) ? left.quotedAtMs! : 0;
    const rightQuotedAt = Number.isFinite(right.quotedAtMs) ? right.quotedAtMs! : 0;
    if (leftQuotedAt !== rightQuotedAt) return leftQuotedAt > rightQuotedAt ? -1 : 1;
    if (left.venue === selected) return -1;
    if (right.venue === selected) return 1;
    return left.venue.localeCompare(right.venue);
  });
  const winner = ranked[0] ?? outputLeader;
  const winnerOutput = routeOutputAfterGas(winner) ?? 0n;
  const selectedOutputAdvantageBps = selected
    ? improvementBps(winnerOutput, routeOutputAfterGas(eligible.find((quote) => quote.venue === selected) ?? winner) ?? winnerOutput)
    : outputRanked[1] ? improvementBps(winnerOutput, routeOutputAfterGas(outputRanked[1]) ?? winnerOutput) : 0;
  const reason: UniversalRouteRecommendation["reason"] = winner.venue === outputLeader.venue
    && nearLeaders.length === 1
      ? "protected-output"
      : safeUnsigned(winner.estimatedNetworkFeeWei) !== undefined
        ? "lower-network-fee"
        : nearLeaders.some((quote) => quote.priceImpact !== winner.priceImpact)
          ? "lower-price-impact"
          : nearLeaders.some((quote) => quote.liquidityUsd !== winner.liquidityUsd)
            ? "deeper-liquidity"
            : "fresher-quote";
  const backups = [...eligible]
    .filter((quote) => quote.venue !== winner.venue)
    .sort((left, right) => outputRanked.indexOf(left) - outputRanked.indexOf(right))
    .map((quote) => quote.venue);
  return {
    selected: winner.venue,
    backups,
    protectedOutputLeader: outputLeader.venue,
    selectedOutputAdvantageBps,
    reason
  };
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
    || maxPriceImpact > 1
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
