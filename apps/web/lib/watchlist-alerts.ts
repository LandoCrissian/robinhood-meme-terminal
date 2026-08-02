import { activeChain } from "./network";
import type { ExternalMarket } from "./external-market";
import type { ExternalSellPressure } from "./external-trades";

export type WatchlistAlertMetric =
  | "priceUsd"
  | "liquidityUsd"
  | "volume24h"
  | "runnerPace"
  | "liquidityDropBps"
  | "largeSellLiquidityBps"
  | "netSellLiquidityBps";
export type WatchlistAlertDirection = "above" | "below";

export type WatchlistAlert = {
  id: string;
  address: string;
  metric: WatchlistAlertMetric;
  direction: WatchlistAlertDirection;
  threshold: number;
  enabled: boolean;
  createdAt: number;
};

export type WatchlistAlertSnapshot = Partial<Record<WatchlistAlertMetric, number>>;

export type WatchlistAlertListSnapshot = {
  alerts: WatchlistAlert[];
  updatedAt: number;
};

export const WATCHLIST_ALERT_EVENT = "rmt:watchlist-alerts-changed";
export const MAXIMUM_WATCHLIST_ALERTS = 50;
const STORAGE_KEY = `rmt-watchlist-alerts-v2:${activeChain.id}`;
const LEGACY_STORAGE_KEY = `rmt-watchlist-alerts-v1:${activeChain.id}`;
const STORAGE_VERSION = 2;
const VALID_METRICS = new Set<WatchlistAlertMetric>([
  "priceUsd",
  "liquidityUsd",
  "volume24h",
  "runnerPace",
  "liquidityDropBps",
  "largeSellLiquidityBps",
  "netSellLiquidityBps"
]);
const VALID_DIRECTIONS = new Set<WatchlistAlertDirection>(["above", "below"]);
const MAXIMUM_THRESHOLD = 1_000_000_000_000_000;

function cleanTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function nextWatchlistAlertTimestamp(previous = 0) {
  return Math.max(Date.now(), cleanTimestamp(previous) + 1);
}

export function normalizeWatchlistAlert(value: unknown): WatchlistAlert | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WatchlistAlert>;
  const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 96) : "";
  const address = typeof candidate.address === "string" ? candidate.address.toLowerCase() : "";
  const threshold = typeof candidate.threshold === "number" ? candidate.threshold : Number.NaN;
  const createdAt = typeof candidate.createdAt === "number" ? candidate.createdAt : 0;
  if (
    !/^[a-zA-Z0-9:_-]{1,96}$/.test(id)
    || !/^0x[0-9a-f]{40}$/.test(address)
    || !VALID_METRICS.has(candidate.metric as WatchlistAlertMetric)
    || !VALID_DIRECTIONS.has(candidate.direction as WatchlistAlertDirection)
    || !Number.isFinite(threshold)
    || threshold <= 0
    || threshold > MAXIMUM_THRESHOLD
    || !Number.isSafeInteger(createdAt)
    || createdAt <= 0
  ) return null;
  return {
    id,
    address,
    metric: candidate.metric as WatchlistAlertMetric,
    direction: candidate.direction as WatchlistAlertDirection,
    threshold,
    enabled: candidate.enabled !== false,
    createdAt
  };
}

export function normalizeWatchlistAlerts(value: unknown) {
  if (!Array.isArray(value)) return [] as WatchlistAlert[];
  const unique = new Map<string, WatchlistAlert>();
  for (const candidate of value) {
    const alert = normalizeWatchlistAlert(candidate);
    if (alert && !unique.has(alert.id)) unique.set(alert.id, alert);
  }
  return [...unique.values()]
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAXIMUM_WATCHLIST_ALERTS);
}

export function normalizeWatchlistAlertListSnapshot(value: unknown): WatchlistAlertListSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { alerts?: unknown; updatedAt?: unknown };
  const updatedAt = cleanTimestamp(candidate.updatedAt);
  if (!Array.isArray(candidate.alerts) || updatedAt <= 0) return null;
  const alerts = normalizeWatchlistAlerts(candidate.alerts);
  if (alerts.length !== candidate.alerts.length) return null;
  return { alerts, updatedAt };
}

export function readWatchlistAlertSnapshot(): WatchlistAlertListSnapshot {
  if (typeof window === "undefined") return { alerts: [], updatedAt: 0 };
  try {
    const current = window.localStorage.getItem(STORAGE_KEY);
    if (current) {
      return normalizeWatchlistAlertListSnapshot(JSON.parse(current)) ?? { alerts: [], updatedAt: 0 };
    }
    const legacy = normalizeWatchlistAlerts(JSON.parse(window.localStorage.getItem(LEGACY_STORAGE_KEY) || "[]"));
    return {
      alerts: legacy,
      updatedAt: legacy.reduce((latest, alert) => Math.max(latest, alert.createdAt), 0)
    };
  } catch {
    return { alerts: [], updatedAt: 0 };
  }
}

export function readWatchlistAlerts() {
  return readWatchlistAlertSnapshot().alerts;
}

export function replaceWatchlistAlerts(
  alerts: WatchlistAlert[],
  options: { emit?: boolean; updatedAt?: number } = {}
) {
  if (typeof window === "undefined") return false;
  try {
    const previous = readWatchlistAlertSnapshot();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      alerts: normalizeWatchlistAlerts(alerts),
      updatedAt: options.updatedAt === undefined
        ? nextWatchlistAlertTimestamp(previous.updatedAt)
        : cleanTimestamp(options.updatedAt)
    }));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (options.emit !== false) window.dispatchEvent(new Event(WATCHLIST_ALERT_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function resolveWatchlistAlertSnapshot(
  local: WatchlistAlertListSnapshot,
  remote: WatchlistAlertListSnapshot | null
): WatchlistAlertListSnapshot {
  if (!remote) {
    return {
      alerts: local.alerts,
      updatedAt: local.updatedAt || nextWatchlistAlertTimestamp()
    };
  }
  if (remote.updatedAt >= local.updatedAt) return remote;
  return local;
}

export function createWatchlistAlert(input: Omit<WatchlistAlert, "id" | "createdAt" | "enabled">) {
  const createdAt = Date.now();
  const id = `${input.address.toLowerCase()}:${input.metric}:${input.direction}:${createdAt}`;
  const alert = normalizeWatchlistAlert({ ...input, id, createdAt, enabled: true });
  if (!alert) return false;
  return replaceWatchlistAlerts([alert, ...readWatchlistAlerts()]);
}

export function removeWatchlistAlert(id: string) {
  return replaceWatchlistAlerts(readWatchlistAlerts().filter((alert) => alert.id !== id));
}

export function watchlistAlertMatches(alert: WatchlistAlert, snapshot: WatchlistAlertSnapshot) {
  const value = snapshot[alert.metric];
  if (!alert.enabled || typeof value !== "number" || !Number.isFinite(value)) return false;
  return alert.direction === "above" ? value >= alert.threshold : value <= alert.threshold;
}

export function watchlistAlertMetricLabel(metric: WatchlistAlertMetric) {
  if (metric === "priceUsd") return "Price";
  if (metric === "liquidityUsd") return "Liquidity";
  if (metric === "volume24h") return "24h volume";
  if (metric === "runnerPace") return "Runner pace";
  if (metric === "liquidityDropBps") return "Liquidity drop";
  if (metric === "largeSellLiquidityBps") return "Largest confirmed sell";
  return "5m net sell flow";
}

export function watchlistAlertThresholdLabel(alert: Pick<WatchlistAlert, "metric" | "threshold">) {
  if (alert.metric === "runnerPace") return `${alert.threshold.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
  if (
    alert.metric === "liquidityDropBps"
    || alert.metric === "largeSellLiquidityBps"
    || alert.metric === "netSellLiquidityBps"
  ) return `${(alert.threshold / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  return alert.threshold.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    notation: alert.threshold >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: alert.metric === "priceUsd" ? 6 : 2
  });
}

export function watchlistAlertDisplayValue(metric: WatchlistAlertMetric, threshold: number) {
  return metric.endsWith("Bps") ? threshold / 100 : threshold;
}

export function watchlistAlertStoredValue(metric: WatchlistAlertMetric, displayed: number) {
  return metric.endsWith("Bps") ? Math.round(displayed * 100) : displayed;
}

export function marketWatchlistAlertSnapshot(
  market: ExternalMarket,
  previous?: ExternalMarket,
  sellPressure?: ExternalSellPressure
): WatchlistAlertSnapshot {
  const trades5m = Math.max(0, market.buys5m) + Math.max(0, market.sells5m);
  const trades1h = Math.max(0, market.buys1h) + Math.max(0, market.sells1h);
  const volumePace = market.volume1h > 0
    ? 12 * Math.min(Math.max(0, market.volume5m), market.volume1h) / market.volume1h
    : 0;
  const qualifiedRunnerPace = market.signal === "moving"
    && market.liquidityUsd >= 5_000
    && trades5m >= 3
    && trades1h >= 10
      ? volumePace
      : undefined;
  const samePool = previous
    && previous.address.toLowerCase() === market.address.toLowerCase()
    && previous.pairAddress.toLowerCase() === market.pairAddress.toLowerCase();
  const liquidityDropBps = samePool && previous.liquidityUsd > 0 && market.liquidityUsd > 0
    ? Math.max(0, Math.round((previous.liquidityUsd - market.liquidityUsd) / previous.liquidityUsd * 10_000))
    : undefined;
  return {
    priceUsd: market.priceUsd,
    liquidityUsd: market.liquidityUsd,
    volume24h: market.volume24h,
    ...(qualifiedRunnerPace === undefined ? {} : { runnerPace: qualifiedRunnerPace }),
    ...(liquidityDropBps === undefined ? {} : { liquidityDropBps }),
    ...(sellPressure ? {
      largeSellLiquidityBps: sellPressure.largestSellLiquidityBps,
      netSellLiquidityBps: sellPressure.netSellLiquidityBps
    } : {})
  };
}
