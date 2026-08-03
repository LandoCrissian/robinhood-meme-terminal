import { createHash } from "node:crypto";
import type { WatchlistAlert, WatchlistAlertSnapshot } from "../watchlist-alerts";
import { watchlistAlertMatches } from "../watchlist-alerts";

export const SMS_ALERT_EVALUATOR_SCHEMA_VERSION = 1;

export type SmsAlertRuleState = Readonly<{
  initialized: boolean;
  matched: boolean;
  observedValue: number | null;
  evaluatedAt: number;
  triggeredAt: number | null;
}>;

export type SmsAlertTransition = Readonly<{
  next: SmsAlertRuleState;
  transition: "armed" | "triggered" | "cleared" | "unchanged" | "unavailable";
  shouldSend: boolean;
}>;

export function smsAlertStateKey(value: string) {
  return createHash("sha256").update(`rmt-sms-state:${value}`).digest("hex");
}

export function normalizeSmsAlertRuleState(value: unknown): SmsAlertRuleState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SmsAlertRuleState>;
  const observedValue = candidate.observedValue === null
    ? null
    : typeof candidate.observedValue === "number" && Number.isFinite(candidate.observedValue)
      ? candidate.observedValue
      : null;
  const evaluatedAt = typeof candidate.evaluatedAt === "number" && Number.isSafeInteger(candidate.evaluatedAt)
    ? candidate.evaluatedAt
    : 0;
  const triggeredAt = candidate.triggeredAt === null
    ? null
    : typeof candidate.triggeredAt === "number" && Number.isSafeInteger(candidate.triggeredAt)
      ? candidate.triggeredAt
      : null;
  if (candidate.initialized !== true || typeof candidate.matched !== "boolean" || evaluatedAt <= 0) return null;
  return { initialized: true, matched: candidate.matched, observedValue, evaluatedAt, triggeredAt };
}

export function evaluateSmsAlertTransition(
  alert: WatchlistAlert,
  snapshot: WatchlistAlertSnapshot,
  previous: SmsAlertRuleState | null,
  now: number
): SmsAlertTransition {
  const observed = snapshot[alert.metric];
  if (typeof observed !== "number" || !Number.isFinite(observed)) {
    return {
      next: previous ?? {
        initialized: true,
        matched: false,
        observedValue: null,
        evaluatedAt: now,
        triggeredAt: null
      },
      transition: "unavailable",
      shouldSend: false
    };
  }
  const matched = watchlistAlertMatches(alert, snapshot);
  if (!previous) {
    return {
      next: {
        initialized: true,
        matched,
        observedValue: observed,
        evaluatedAt: now,
        triggeredAt: null
      },
      transition: "armed",
      shouldSend: false
    };
  }
  const triggered = !previous.matched && matched;
  const cleared = previous.matched && !matched;
  return {
    next: {
      initialized: true,
      matched,
      observedValue: observed,
      evaluatedAt: now,
      triggeredAt: triggered ? now : previous.triggeredAt
    },
    transition: triggered ? "triggered" : cleared ? "cleared" : "unchanged",
    shouldSend: triggered
  };
}

export function smsAlertObservedLabel(metric: WatchlistAlert["metric"], value: number) {
  if (!Number.isFinite(value)) throw new Error("invalid_sms_alert_value");
  if (metric.endsWith("Bps")) return `${(value / 100).toFixed(2)}%`;
  if (metric === "runnerPace") return `${value.toFixed(2)}x`;
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: metric === "priceUsd" ? 6 : 2,
    notation: Math.abs(value) >= 10_000 ? "compact" : "standard"
  });
}

export function smsAlertDayKey(now: number) {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error("invalid_sms_alert_time");
  return new Date(now).toISOString().slice(0, 10);
}

export function smsAlertPriority(alert: WatchlistAlert) {
  if (alert.metric === "largeSellLiquidityBps") return 0;
  if (alert.metric === "netSellLiquidityBps") return 1;
  if (alert.metric === "liquidityDropBps") return 2;
  if (alert.metric === "priceUsd" && alert.direction === "below") return 3;
  if (alert.metric === "runnerPace") return 4;
  return 5;
}
