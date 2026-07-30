export type TradePreferences = {
  buyAmounts: [string, string, string];
  routePreference: TradeRoutePreference;
  maxPriceImpactBps: TradePriceImpactLimitBps;
};

export type TradeRoutePreference = "automatic" | "sushi" | "uniswap";
export type TradePriceImpactLimitBps = 100 | 200 | 500;

export const TRADE_PREFERENCES_EVENT = "rmt:trade-preferences-changed";
export const TRADE_PREFERENCES_STORAGE_KEY = "rmt-trade-preferences-v1";
export const DEFAULT_TRADE_PREFERENCES: TradePreferences = {
  buyAmounts: ["0.0001", "0.001", "0.01"],
  routePreference: "automatic",
  maxPriceImpactBps: 500
};

const DECIMAL_AMOUNT = /^(?:0|[1-9]\d{0,2})(?:\.\d{1,18})?$/;

export function normalizeBuyPreset(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!DECIMAL_AMOUNT.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const normalizedFraction = fraction.replace(/0+$/, "");
  const normalized = normalizedFraction ? `${whole}.${normalizedFraction}` : whole;
  return Number(normalized) > 0 ? normalized : null;
}

export function normalizeTradePreferences(value: unknown): TradePreferences {
  if (!value || typeof value !== "object") return DEFAULT_TRADE_PREFERENCES;
  const candidate = value as {
    buyAmounts?: unknown;
    routePreference?: unknown;
    maxPriceImpactBps?: unknown;
  };
  const amounts = candidate.buyAmounts;
  if (!Array.isArray(amounts) || amounts.length !== 3) return DEFAULT_TRADE_PREFERENCES;
  const normalized = amounts.map(normalizeBuyPreset);
  if (normalized.some((amount) => amount === null) || new Set(normalized).size !== 3) {
    return DEFAULT_TRADE_PREFERENCES;
  }
  const routePreference: TradeRoutePreference =
    candidate.routePreference === "sushi" || candidate.routePreference === "uniswap"
      ? candidate.routePreference
      : "automatic";
  const maxPriceImpactBps: TradePriceImpactLimitBps =
    candidate.maxPriceImpactBps === 100 || candidate.maxPriceImpactBps === 200
      ? candidate.maxPriceImpactBps
      : 500;
  return {
    buyAmounts: normalized as [string, string, string],
    routePreference,
    maxPriceImpactBps
  };
}

export function readTradePreferences(): TradePreferences {
  if (typeof window === "undefined") return DEFAULT_TRADE_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(TRADE_PREFERENCES_STORAGE_KEY) || "null");
    return normalizeTradePreferences(parsed);
  } catch {
    return DEFAULT_TRADE_PREFERENCES;
  }
}

export function writeTradePreferences(value: TradePreferences) {
  if (typeof window === "undefined") return false;
  const normalized = normalizeTradePreferences(value);
  try {
    window.localStorage.setItem(TRADE_PREFERENCES_STORAGE_KEY, JSON.stringify({
      version: 2,
      ...normalized
    }));
    window.dispatchEvent(new Event(TRADE_PREFERENCES_EVENT));
    return true;
  } catch {
    return false;
  }
}
