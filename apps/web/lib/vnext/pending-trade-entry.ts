import type { TradeSide } from "./intent-draft";

export type PendingTradeEntry = { marketAddress: string; side: TradeSide; wallet?: string };

// Login can populate balances/change the request key, not the selected asset.
export function pendingTradeEntryMatches(entry: PendingTradeEntry, marketAddress: string, side: TradeSide, wallet?: string) {
  return entry.marketAddress.toLowerCase() === marketAddress.toLowerCase()
    && entry.side === side
    && (!entry.wallet || !wallet || entry.wallet.toLowerCase() === wallet.toLowerCase());
}
