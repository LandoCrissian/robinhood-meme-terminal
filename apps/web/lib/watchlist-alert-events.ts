import { activeChain } from "./network";
import {
  normalizeWatchlistAlert,
  type WatchlistAlert,
  type WatchlistAlertDirection,
  type WatchlistAlertMetric
} from "./watchlist-alerts";

export type WatchlistAlertEvent = {
  id: string;
  alertId: string;
  address: string;
  name: string;
  symbol: string;
  metric: WatchlistAlertMetric;
  direction: WatchlistAlertDirection;
  threshold: number;
  observedValue: number;
  triggeredAt: number;
};

export const WATCHLIST_ALERT_HISTORY_EVENT = "rmt:watchlist-alert-history-changed";
export const MAXIMUM_WATCHLIST_ALERT_EVENTS = 100;
export const WATCHLIST_ALERT_EVENT_COOLDOWN_MS = 5 * 60_000;
const STORAGE_KEY = `rmt-watchlist-alert-events-v1:${activeChain.id}`;
const ADDRESS = /^0x[0-9a-f]{40}$/;

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

export function normalizeWatchlistAlertEvent(value: unknown): WatchlistAlertEvent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WatchlistAlertEvent>;
  const alert = normalizeWatchlistAlert({
    id: candidate.alertId,
    address: candidate.address,
    metric: candidate.metric,
    direction: candidate.direction,
    threshold: candidate.threshold,
    enabled: true,
    createdAt: candidate.triggeredAt
  });
  const id = cleanText(candidate.id, 160);
  const name = cleanText(candidate.name, 80);
  const symbol = cleanText(candidate.symbol, 20).replace(/^\$+/, "");
  const observedValue = candidate.observedValue;
  if (
    !alert
    || !id
    || !ADDRESS.test(alert.address)
    || !name
    || !symbol
    || typeof observedValue !== "number"
    || !Number.isFinite(observedValue)
    || observedValue < 0
  ) return null;
  return {
    id,
    alertId: alert.id,
    address: alert.address,
    name,
    symbol,
    metric: alert.metric,
    direction: alert.direction,
    threshold: alert.threshold,
    observedValue,
    triggeredAt: alert.createdAt
  };
}

export function normalizeWatchlistAlertEvents(value: unknown) {
  if (!Array.isArray(value)) return [] as WatchlistAlertEvent[];
  const unique = new Map<string, WatchlistAlertEvent>();
  for (const candidate of value) {
    const event = normalizeWatchlistAlertEvent(candidate);
    if (event && !unique.has(event.id)) unique.set(event.id, event);
  }
  return [...unique.values()]
    .sort((left, right) => right.triggeredAt - left.triggeredAt)
    .slice(0, MAXIMUM_WATCHLIST_ALERT_EVENTS);
}

export function readWatchlistAlertEvents() {
  if (typeof window === "undefined") return [] as WatchlistAlertEvent[];
  try {
    return normalizeWatchlistAlertEvents(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function writeWatchlistAlertEvents(events: WatchlistAlertEvent[]) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeWatchlistAlertEvents(events)));
    window.dispatchEvent(new Event(WATCHLIST_ALERT_HISTORY_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function recordWatchlistAlertEvent(input: {
  alert: WatchlistAlert;
  name: string;
  symbol: string;
  observedValue: number;
  triggeredAt?: number;
}) {
  const triggeredAt = input.triggeredAt ?? Date.now();
  const current = readWatchlistAlertEvents();
  if (current.some((event) => (
    event.alertId === input.alert.id
    && triggeredAt >= event.triggeredAt
    && triggeredAt - event.triggeredAt < WATCHLIST_ALERT_EVENT_COOLDOWN_MS
  ))) return false;
  const event = normalizeWatchlistAlertEvent({
    id: `${input.alert.id}:${triggeredAt}`,
    alertId: input.alert.id,
    address: input.alert.address,
    name: input.name,
    symbol: input.symbol,
    metric: input.alert.metric,
    direction: input.alert.direction,
    threshold: input.alert.threshold,
    observedValue: input.observedValue,
    triggeredAt
  });
  return event ? writeWatchlistAlertEvents([event, ...current]) : false;
}

export function removeWatchlistAlertEvent(id: string) {
  return writeWatchlistAlertEvents(readWatchlistAlertEvents().filter((event) => event.id !== id));
}

export function clearWatchlistAlertEvents() {
  return writeWatchlistAlertEvents([]);
}
