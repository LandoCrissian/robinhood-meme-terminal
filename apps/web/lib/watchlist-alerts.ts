import { activeChain } from "./network";

export type WatchlistAlertMetric = "priceUsd" | "liquidityUsd" | "volume24h";
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

export type WatchlistAlertSnapshot = Pick<
  Record<WatchlistAlertMetric, number>,
  WatchlistAlertMetric
>;

export const WATCHLIST_ALERT_EVENT = "rmt:watchlist-alerts-changed";
export const MAXIMUM_WATCHLIST_ALERTS = 50;
const STORAGE_KEY = `rmt-watchlist-alerts-v1:${activeChain.id}`;
const VALID_METRICS = new Set<WatchlistAlertMetric>(["priceUsd", "liquidityUsd", "volume24h"]);
const VALID_DIRECTIONS = new Set<WatchlistAlertDirection>(["above", "below"]);
const MAXIMUM_THRESHOLD = 1_000_000_000_000_000;

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

export function readWatchlistAlerts() {
  if (typeof window === "undefined") return [] as WatchlistAlert[];
  try {
    return normalizeWatchlistAlerts(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [] as WatchlistAlert[];
  }
}

export function replaceWatchlistAlerts(alerts: WatchlistAlert[]) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeWatchlistAlerts(alerts)));
    window.dispatchEvent(new Event(WATCHLIST_ALERT_EVENT));
    return true;
  } catch {
    return false;
  }
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
  if (!alert.enabled || !Number.isFinite(value)) return false;
  return alert.direction === "above" ? value >= alert.threshold : value <= alert.threshold;
}

export function watchlistAlertMetricLabel(metric: WatchlistAlertMetric) {
  if (metric === "priceUsd") return "Price";
  if (metric === "liquidityUsd") return "Liquidity";
  return "24h volume";
}
