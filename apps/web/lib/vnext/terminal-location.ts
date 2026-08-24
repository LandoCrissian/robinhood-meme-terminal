import { canonicalRobinhoodAddress } from "./robinhood-chain-links";

export type VNextTerminalLocation =
  | { context: "markets" }
  | { context: "portfolio" }
  | { context: "distribution" }
  | { context: "asset"; market: string; side?: "buy" | "sell" };

export function parseVNextTerminalLocation(search: string): VNextTerminalLocation {
  const parameters = new URLSearchParams(search);
  if (parameters.get("panel") === "portfolio") return { context: "portfolio" };
  if (parameters.get("panel") === "distribution") return { context: "distribution" };
  const rawMarket = parameters.get("market");
  if (!rawMarket) return { context: "markets" };
  try {
    const market = canonicalRobinhoodAddress(rawMarket);
    const rawSide = parameters.get("side");
    return rawSide === "buy" || rawSide === "sell"
      ? { context: "asset", market, side: rawSide }
      : { context: "asset", market };
  } catch {
    return { context: "markets" };
  }
}
