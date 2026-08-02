import type {
  WatchlistAlertDirection,
  WatchlistAlertMetric
} from "./watchlist-alerts";
import { watchlistAlertStoredValue } from "./watchlist-alerts";

export type MarketProtectionPresetId =
  | "large-sell"
  | "net-sell-flow"
  | "liquidity-drop"
  | "runner-pace";

export type MarketProtectionPreset = {
  id: MarketProtectionPresetId;
  label: string;
  detail: string;
  metric: WatchlistAlertMetric;
  direction: WatchlistAlertDirection;
  displayedThreshold: number;
};

export const MARKET_PROTECTION_PRESETS: MarketProtectionPreset[] = [
  {
    id: "large-sell",
    label: "Large sell",
    detail: "1% of liquidity",
    metric: "largeSellLiquidityBps",
    direction: "above",
    displayedThreshold: 1
  },
  {
    id: "net-sell-flow",
    label: "Net sell flow",
    detail: "3% of liquidity · 5m",
    metric: "netSellLiquidityBps",
    direction: "above",
    displayedThreshold: 3
  },
  {
    id: "liquidity-drop",
    label: "Liquidity drop",
    detail: "10% between scans",
    metric: "liquidityDropBps",
    direction: "above",
    displayedThreshold: 10
  },
  {
    id: "runner-pace",
    label: "Runner pace",
    detail: "1.5× qualified pace",
    metric: "runnerPace",
    direction: "above",
    displayedThreshold: 1.5
  }
];

export function marketProtectionPreset(id: MarketProtectionPresetId) {
  return MARKET_PROTECTION_PRESETS.find((preset) => preset.id === id) ?? null;
}

export function marketProtectionAlertInput(id: MarketProtectionPresetId, address: string) {
  const preset = marketProtectionPreset(id);
  if (!preset) return null;
  return {
    address: address.toLowerCase(),
    metric: preset.metric,
    direction: preset.direction,
    threshold: watchlistAlertStoredValue(preset.metric, preset.displayedThreshold)
  };
}
