"use client";
import type { VNextDirectoryMarket } from "../../lib/vnext/market-directory";
import { useScannerRows } from "./use-scanner-rows";
const marketKey = (row: VNextDirectoryMarket) => row.address.toLowerCase();
export function useAnchoredMarketRows(markets: VNextDirectoryMarket[], context: string) {
  return useScannerRows(markets, marketKey, context);
}
