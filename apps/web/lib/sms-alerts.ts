import type { WatchlistAlertMetric } from "./watchlist-alerts";

export const SMS_ALERT_CONSENT_VERSION = "2026-08-01";
export const SMS_ALERT_MAX_PER_DAY = 5;
export const SMS_ALERT_SCHEMA_VERSION = 1;

export type SmsAlertPreferenceStatus = {
  available: boolean;
  enabled: boolean;
  maxDailyMessages: number;
  phoneLast4: string;
  phoneLinked: boolean;
  reason: "active" | "delivery_locked" | "delivery_paused" | "phone_required" | "signed_out";
};

export type SmsAlertMessageInput = {
  address: string;
  metric: WatchlistAlertMetric;
  observed: string;
  symbol: string;
};

export function normalizeSmsDailyLimit(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(SMS_ALERT_MAX_PER_DAY, Math.max(1, value))
    : SMS_ALERT_MAX_PER_DAY;
}

export function smsAlertMetricShortLabel(metric: WatchlistAlertMetric) {
  if (metric === "priceUsd") return "price";
  if (metric === "liquidityUsd") return "liquidity";
  if (metric === "volume24h") return "24h volume";
  if (metric === "runnerPace") return "runner pace";
  if (metric === "liquidityDropBps") return "liquidity drop";
  if (metric === "largeSellLiquidityBps") return "large sell";
  return "net sell flow";
}

function safeSymbol(value: string) {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 12);
  return cleaned || "TOKEN";
}

function safeObserved(value: string) {
  return value.replace(/[^A-Za-z0-9$%.,+\- ]/g, "").trim().slice(0, 20) || "triggered";
}

export function formatSmsAlertMessage(input: SmsAlertMessageInput) {
  const address = input.address.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("invalid_alert_address");
  const message = `RMT ${safeSymbol(input.symbol)}: ${smsAlertMetricShortLabel(input.metric)} ${safeObserved(input.observed)}. https://www.rmtlaunch.fun/market/${address} Reply STOP to opt out.`;
  if (message.length > 160) throw new Error("sms_alert_exceeds_one_segment");
  return message;
}
