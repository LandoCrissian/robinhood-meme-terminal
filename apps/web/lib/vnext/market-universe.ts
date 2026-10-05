import { assetPresentationClasses } from "./asset-presentation";
import type { VNextDirectoryMarket } from "./market-directory";
export const MARKET_UNIVERSES = ["all", "projects", "rwa", "stock", "held"] as const;
export type MarketUniverse = typeof MARKET_UNIVERSES[number];
export const MARKET_UNIVERSE_LABELS: Record<MarketUniverse, string> = { all: "All Markets", projects: "Project Tokens", held: "Held", rwa: "RWA", stock: "Stock Tokens" };
export function normalizeMarketUniverse(scope: string | null, legacyView?: string | null): MarketUniverse {
  return MARKET_UNIVERSES.includes(scope as MarketUniverse) ? scope as MarketUniverse : legacyView === "rwa" ? "rwa" : "all";
}
export function selectMarketUniverse(markets: VNextDirectoryMarket[], universe: MarketUniverse, held: ReadonlySet<string>) {
  if (universe === "all") return markets;
  if (universe === "held") return markets.filter(row => held.has(row.address.toLowerCase()));
  if (universe === "rwa") return markets.filter(row => Boolean(row.rwaRelationship));
  const kind = universe === "projects" ? "PROJECT" : "STOCK_TOKEN";
  return markets.filter(row => assetPresentationClasses(row).includes(kind));
}
