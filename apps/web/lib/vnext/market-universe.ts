import { assetPresentationClasses } from "./asset-presentation";
import type { VNextDirectoryMarket } from "./market-directory";
export const MARKET_UNIVERSES = ["all", "launches", "projects", "held", "rwa", "stock"] as const;
export type MarketUniverse = typeof MARKET_UNIVERSES[number];
export const MARKET_UNIVERSE_LABELS: Record<MarketUniverse, string> = { all: "All", launches: "Launches", projects: "Projects", held: "Held", rwa: "RWA", stock: "Stock Tokens" };
export function selectMarketUniverse(markets: VNextDirectoryMarket[], universe: MarketUniverse, held: ReadonlySet<string>) {
  if (universe === "all") return markets;
  if (universe === "held") return markets.filter(row => held.has(row.address.toLowerCase()));
  if (universe === "rwa") return markets.filter(row => Boolean(row.rwaRelationship));
  const kind = universe === "projects" ? "PROJECT" : universe === "stock" ? "STOCK_TOKEN" : "LAUNCH";
  return markets.filter(row => assetPresentationClasses(row).includes(kind));
}
