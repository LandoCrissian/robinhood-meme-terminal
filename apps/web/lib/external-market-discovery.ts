import type { ExternalMarket } from "./external-market";

export type ExternalMarketDiscoveryView = "trending" | "new" | "top" | "explore";

type DiscoveryMarket = Pick<
  ExternalMarket,
  | "ageMinutes"
  | "buys1h"
  | "liquidityUsd"
  | "momentumScore"
  | "pairCreatedAt"
  | "sells1h"
  | "signal"
  | "volume1h"
>;

export function externalMarketViewCounts(markets: DiscoveryMarket[]) {
  return {
    trending: markets.filter((market) => market.signal !== "active").length,
    new: markets.filter(
      (market) => market.ageMinutes !== null && market.ageMinutes <= 24 * 60
    ).length,
    top: markets.filter((market) => market.volume1h > 0).length,
    explore: markets.length
  };
}

export function selectExternalMarketView<Market extends DiscoveryMarket>(
  markets: Market[],
  view: ExternalMarketDiscoveryView
) {
  if (view === "new") {
    return markets
      .filter((market) => market.ageMinutes !== null && market.ageMinutes <= 24 * 60)
      .sort((a, b) =>
        (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0)
        || b.momentumScore - a.momentumScore
      );
  }
  if (view === "top") {
    return markets
      .filter((market) => market.volume1h > 0)
      .sort((a, b) =>
        b.volume1h - a.volume1h
        || (b.buys1h + b.sells1h) - (a.buys1h + a.sells1h)
        || b.liquidityUsd - a.liquidityUsd
      );
  }
  if (view === "trending") {
    return markets.filter((market) => market.signal !== "active");
  }
  return markets;
}
