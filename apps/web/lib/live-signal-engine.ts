import type { ExternalMarket } from "./external-market";

export type LiveMarketSignalKind =
  | "runner-acceleration"
  | "buy-side-activity"
  | "sell-side-pressure"
  | "liquidity-expansion"
  | "liquidity-contraction"
  | "momentum-breakout"
  | "new-market-activity";

export type LiveMarketSignal = {
  id: string;
  token: string;
  pair: string;
  symbol: string;
  name: string;
  kind: LiveMarketSignalKind;
  severity: "observe" | "review" | "urgent";
  title: string;
  evidence: string;
  strength: number;
  observedAt: string;
};

type SignalCandidate = Omit<LiveMarketSignal, "id" | "token" | "pair" | "symbol" | "name" | "observedAt">;

const SEVERITY_PRIORITY = { urgent: 3, review: 2, observe: 1 } as const;

function finite(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function signedPercent(value: number) {
  return `${value > 0 ? "+" : ""}${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function compactUsd(value: number) {
  return "$" + Math.max(0, finite(value)).toLocaleString(undefined, {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 0
  });
}

function validPreviousMarket(market: ExternalMarket, previous?: ExternalMarket) {
  return previous
    && previous.address.toLowerCase() === market.address.toLowerCase()
    && previous.pairAddress.toLowerCase() === market.pairAddress.toLowerCase()
      ? previous
      : undefined;
}

export function deriveLiveMarketSignal(
  market: ExternalMarket,
  previous?: ExternalMarket,
  now = Date.now()
): LiveMarketSignal | null {
  const candidates: SignalCandidate[] = [];
  const prior = validPreviousMarket(market, previous);
  const trades5m = Math.max(0, market.buys5m) + Math.max(0, market.sells5m);
  const trades1h = Math.max(0, market.buys1h) + Math.max(0, market.sells1h);
  const buyShare5m = trades5m > 0 ? market.buys5m / trades5m : 0;
  const sellShare5m = trades5m > 0 ? market.sells5m / trades5m : 0;
  const pace = market.volume1h > 0
    ? 12 * Math.min(Math.max(0, market.volume5m), market.volume1h) / market.volume1h
    : 0;
  const liquidEnough = market.liquidityUsd >= 5_000;
  const activeEnough = trades1h >= 10 && trades5m >= 3;

  if (
    market.signal === "moving"
    && liquidEnough
    && activeEnough
    && pace >= 1.25
  ) {
    candidates.push({
      kind: "runner-acceleration",
      severity: market.momentumScore >= 70 && pace >= 2 ? "review" : "observe",
      title: "Runner acceleration",
      evidence: `${pace.toFixed(1)}× recent pace · ${trades5m} trades in 5m · score ${market.momentumScore}`,
      strength: Math.min(100, Math.round(market.momentumScore * 0.7 + Math.min(pace, 3) / 3 * 30))
    });
  }

  if (
    liquidEnough
    && trades5m >= 5
    && buyShare5m >= 0.68
    && market.volume5m >= Math.max(250, market.liquidityUsd * 0.005)
  ) {
    candidates.push({
      kind: "buy-side-activity",
      severity: buyShare5m >= 0.8 && market.priceChange5m >= 5 ? "review" : "observe",
      title: "Buy-side activity",
      evidence: `${Math.round(buyShare5m * 100)}% of 5m trades are buys · ${compactUsd(market.volume5m)} volume`,
      strength: Math.min(100, Math.round(buyShare5m * 70 + Math.min(trades5m, 30)))
    });
  }

  if (
    trades5m >= 4
    && sellShare5m >= 0.65
    && market.priceChange5m <= -2
  ) {
    const urgent = sellShare5m >= 0.8 && market.priceChange5m <= -10;
    candidates.push({
      kind: "sell-side-pressure",
      severity: urgent ? "urgent" : "review",
      title: urgent ? "Sharp sell-side pressure" : "Sell-side pressure",
      evidence: `${Math.round(sellShare5m * 100)}% of 5m trades are sells · ${signedPercent(market.priceChange5m)} price`,
      strength: Math.min(100, Math.round(sellShare5m * 70 + Math.min(Math.abs(market.priceChange5m), 30)))
    });
  }

  if (prior && prior.liquidityUsd > 0 && market.liquidityUsd > 0) {
    const liquidityChange = (market.liquidityUsd - prior.liquidityUsd) / prior.liquidityUsd * 100;
    const absoluteChange = Math.abs(market.liquidityUsd - prior.liquidityUsd);
    if (liquidityChange >= 10 && absoluteChange >= 1_000) {
      candidates.push({
        kind: "liquidity-expansion",
        severity: "observe",
        title: "Liquidity expanded",
        evidence: `${signedPercent(liquidityChange)} since the prior snapshot · ${compactUsd(market.liquidityUsd)} now`,
        strength: Math.min(100, Math.round(liquidityChange * 2))
      });
    }
    if (liquidityChange <= -10 && absoluteChange >= 1_000) {
      candidates.push({
        kind: "liquidity-contraction",
        severity: liquidityChange <= -25 ? "urgent" : "review",
        title: liquidityChange <= -25 ? "Sharp liquidity contraction" : "Liquidity contracted",
        evidence: `${signedPercent(liquidityChange)} since the prior snapshot · ${compactUsd(market.liquidityUsd)} remains`,
        strength: Math.min(100, Math.round(Math.abs(liquidityChange) * 2))
      });
    }
  }

  if (
    prior
    && market.momentumScore >= 40
    && market.momentumScore - prior.momentumScore >= 12
    && liquidEnough
  ) {
    candidates.push({
      kind: "momentum-breakout",
      severity: market.momentumScore >= 70 ? "review" : "observe",
      title: "Momentum score advanced",
      evidence: `Score ${prior.momentumScore} → ${market.momentumScore} · ${trades5m} trades in 5m`,
      strength: Math.min(100, market.momentumScore)
    });
  }

  if (
    market.ageMinutes !== null
    && market.ageMinutes <= 30
    && liquidEnough
    && trades5m >= 3
  ) {
    candidates.push({
      kind: "new-market-activity",
      severity: "observe",
      title: "New market active",
      evidence: `${Math.max(1, Math.round(market.ageMinutes))}m old · ${trades5m} trades in 5m · ${compactUsd(market.liquidityUsd)} liquidity`,
      strength: Math.min(100, 50 + trades5m)
    });
  }

  const selected = candidates.sort((left, right) =>
    SEVERITY_PRIORITY[right.severity] - SEVERITY_PRIORITY[left.severity]
    || right.strength - left.strength
    || left.kind.localeCompare(right.kind)
  )[0];
  if (!selected) return null;

  return {
    ...selected,
    id: `${market.address.toLowerCase()}:${selected.kind}`,
    token: market.address,
    pair: market.pairAddress,
    symbol: market.symbol,
    name: market.name,
    observedAt: new Date(now).toISOString()
  };
}

export function deriveLiveMarketSignals(
  markets: ExternalMarket[],
  previousMarkets: ExternalMarket[] = [],
  now = Date.now()
) {
  const previousByToken = new Map(previousMarkets.map((market) => [market.address.toLowerCase(), market]));
  return markets.flatMap((market) => {
    const signal = deriveLiveMarketSignal(market, previousByToken.get(market.address.toLowerCase()), now);
    return signal ? [signal] : [];
  }).sort((left, right) =>
    SEVERITY_PRIORITY[right.severity] - SEVERITY_PRIORITY[left.severity]
    || right.strength - left.strength
    || left.token.toLowerCase().localeCompare(right.token.toLowerCase())
  );
}
