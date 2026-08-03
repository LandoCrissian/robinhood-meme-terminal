export type TradePreparationMode = "speed" | "standard";

export const SPEED_QUOTE_DEBOUNCE_MS = 60;
export const STANDARD_QUOTE_DEBOUNCE_MS = 350;
export const SPEED_QUOTE_REFRESH_MS = 8_000;
export const STANDARD_QUOTE_REFRESH_MS = 15_000;
export const SHARED_QUOTE_CACHE_MS = 1_500;

export function quoteDebounceMs(mode: TradePreparationMode) {
  return mode === "speed" ? SPEED_QUOTE_DEBOUNCE_MS : STANDARD_QUOTE_DEBOUNCE_MS;
}

export function quoteRefreshMs(mode: TradePreparationMode) {
  return mode === "speed" ? SPEED_QUOTE_REFRESH_MS : STANDARD_QUOTE_REFRESH_MS;
}

export function quoteRequestKey(endpoint: string, body: unknown) {
  return `${endpoint}:${JSON.stringify(body)}`;
}
