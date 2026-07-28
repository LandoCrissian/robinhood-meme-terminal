export type TradeVenueId = "sushi" | "uniswap";
export type TradeVenueHealth = "loading" | "ready" | "unavailable";
export type TradeVenueSelectionMode = "automatic" | "manual";

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
