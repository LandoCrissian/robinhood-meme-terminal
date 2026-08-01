import { activeChain } from "./network";

export type PositionGuard = {
  version: 1;
  wallet: string;
  token: string;
  basisUsd: number;
  highWatermarkUsd: number;
  stopLossBps: number;
  trailingStopBps: number;
  breakEvenActivationBps: number;
  recoverPrincipal: boolean;
  principalRecovered: boolean;
  enabled: boolean;
  armedAt: number;
  updatedAt: number;
  triggeredAt: number | null;
};

export type PositionGuardEvaluation = {
  currentValueUsd: number;
  highWatermarkUsd: number;
  gainBps: number;
  staticStopUsd: number;
  trailingStopUsd: number;
  breakEvenArmed: boolean;
  effectiveStopUsd: number;
  distanceToStopBps: number;
  stopTriggered: boolean;
  principalRecoveryReady: boolean;
  principalRecoveryBps: number;
};

const STORAGE_PREFIX = `rmt-position-guard-v1:${activeChain.id}`;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const VALID_STOP_BPS = new Set([500, 1000, 1500, 2000, 2500, 3000, 4000, 5000]);
const VALID_BREAK_EVEN_BPS = new Set([1000, 2500, 5000, 7500, 10000]);
const MAXIMUM_BASIS_USD = 100_000_000;

function finitePositive(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum
    ? value
    : null;
}

function timestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function normalizePositionGuard(value: unknown): PositionGuard | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PositionGuard>;
  const wallet = typeof candidate.wallet === "string" ? candidate.wallet.toLowerCase() : "";
  const token = typeof candidate.token === "string" ? candidate.token.toLowerCase() : "";
  const basisUsd = finitePositive(candidate.basisUsd, MAXIMUM_BASIS_USD);
  const highWatermarkUsd = finitePositive(candidate.highWatermarkUsd, MAXIMUM_BASIS_USD * 10_000);
  const armedAt = timestamp(candidate.armedAt);
  const updatedAt = timestamp(candidate.updatedAt);
  const triggeredAt = candidate.triggeredAt === null ? null : timestamp(candidate.triggeredAt);
  if (
    candidate.version !== 1
    || !ADDRESS.test(wallet)
    || !ADDRESS.test(token)
    || basisUsd === null
    || highWatermarkUsd === null
    || highWatermarkUsd < basisUsd * 0.000001
    || !VALID_STOP_BPS.has(candidate.stopLossBps ?? -1)
    || !VALID_STOP_BPS.has(candidate.trailingStopBps ?? -1)
    || !VALID_BREAK_EVEN_BPS.has(candidate.breakEvenActivationBps ?? -1)
    || typeof candidate.recoverPrincipal !== "boolean"
    || typeof candidate.principalRecovered !== "boolean"
    || typeof candidate.enabled !== "boolean"
    || armedAt === null
    || updatedAt === null
    || updatedAt < armedAt
    || (candidate.triggeredAt !== null && triggeredAt === null)
  ) return null;
  return {
    version: 1,
    wallet,
    token,
    basisUsd,
    highWatermarkUsd,
    stopLossBps: candidate.stopLossBps!,
    trailingStopBps: candidate.trailingStopBps!,
    breakEvenActivationBps: candidate.breakEvenActivationBps!,
    recoverPrincipal: candidate.recoverPrincipal,
    principalRecovered: candidate.principalRecovered,
    enabled: candidate.enabled,
    armedAt,
    updatedAt,
    triggeredAt
  };
}

export function createPositionGuard(input: {
  wallet: string;
  token: string;
  basisUsd: number;
  currentValueUsd: number;
  stopLossBps?: number;
  trailingStopBps?: number;
  breakEvenActivationBps?: number;
  recoverPrincipal?: boolean;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  return normalizePositionGuard({
    version: 1,
    wallet: input.wallet,
    token: input.token,
    basisUsd: input.basisUsd,
    highWatermarkUsd: input.currentValueUsd,
    stopLossBps: input.stopLossBps ?? 2000,
    trailingStopBps: input.trailingStopBps ?? 2000,
    breakEvenActivationBps: input.breakEvenActivationBps ?? 5000,
    recoverPrincipal: input.recoverPrincipal ?? true,
    principalRecovered: false,
    enabled: true,
    armedAt: now,
    updatedAt: now,
    triggeredAt: null
  });
}

export function evaluatePositionGuard(
  guard: PositionGuard,
  currentValueUsd: number
): PositionGuardEvaluation | null {
  if (!Number.isFinite(currentValueUsd) || currentValueUsd <= 0) return null;
  const highWatermarkUsd = Math.max(guard.highWatermarkUsd, currentValueUsd);
  const staticStopUsd = guard.basisUsd * (1 - guard.stopLossBps / 10_000);
  const trailingStopUsd = highWatermarkUsd * (1 - guard.trailingStopBps / 10_000);
  const breakEvenArmed = highWatermarkUsd >= guard.basisUsd * (1 + guard.breakEvenActivationBps / 10_000);
  const effectiveStopUsd = Math.max(staticStopUsd, trailingStopUsd, breakEvenArmed ? guard.basisUsd : 0);
  const distanceToStopBps = Math.max(0, Math.round((currentValueUsd - effectiveStopUsd) / currentValueUsd * 10_000));
  const principalRecoveryReady = guard.recoverPrincipal
    && !guard.principalRecovered
    && currentValueUsd >= guard.basisUsd * 2;
  const principalRecoveryBps = principalRecoveryReady
    ? Math.min(10_000, Math.max(1, Math.ceil(guard.basisUsd / currentValueUsd * 10_000)))
    : 0;
  return {
    currentValueUsd,
    highWatermarkUsd,
    gainBps: Math.round((currentValueUsd - guard.basisUsd) / guard.basisUsd * 10_000),
    staticStopUsd,
    trailingStopUsd,
    breakEvenArmed,
    effectiveStopUsd,
    distanceToStopBps,
    stopTriggered: guard.enabled && currentValueUsd <= effectiveStopUsd,
    principalRecoveryReady,
    principalRecoveryBps
  };
}

export function advancePositionGuard(guard: PositionGuard, currentValueUsd: number, now = Date.now()) {
  const evaluation = evaluatePositionGuard(guard, currentValueUsd);
  if (!evaluation) return guard;
  const triggeredAt = guard.triggeredAt ?? (evaluation.stopTriggered ? now : null);
  if (evaluation.highWatermarkUsd === guard.highWatermarkUsd && triggeredAt === guard.triggeredAt) return guard;
  return {
    ...guard,
    highWatermarkUsd: evaluation.highWatermarkUsd,
    updatedAt: now,
    triggeredAt
  } satisfies PositionGuard;
}

export function acknowledgePrincipalRecovery(guard: PositionGuard, now = Date.now()) {
  return { ...guard, principalRecovered: true, updatedAt: now } satisfies PositionGuard;
}

export function resetPositionGuardTrigger(guard: PositionGuard, currentValueUsd: number, now = Date.now()) {
  if (!Number.isFinite(currentValueUsd) || currentValueUsd <= 0) return guard;
  return {
    ...guard,
    highWatermarkUsd: currentValueUsd,
    updatedAt: now,
    triggeredAt: null
  } satisfies PositionGuard;
}

function storageKey(wallet: string, token: string) {
  return `${STORAGE_PREFIX}:${wallet.toLowerCase()}:${token.toLowerCase()}`;
}

export function readPositionGuard(wallet: string, token: string) {
  if (typeof window === "undefined") return null;
  try {
    return normalizePositionGuard(JSON.parse(window.localStorage.getItem(storageKey(wallet, token)) || "null"));
  } catch {
    return null;
  }
}

export function writePositionGuard(guard: PositionGuard) {
  if (typeof window === "undefined") return false;
  const normalized = normalizePositionGuard(guard);
  if (!normalized) return false;
  try {
    window.localStorage.setItem(storageKey(normalized.wallet, normalized.token), JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function removePositionGuard(wallet: string, token: string) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(storageKey(wallet, token));
    return true;
  } catch {
    return false;
  }
}

export function tokenAmountForExit(balance: number, exitBps: number) {
  if (!Number.isFinite(balance) || balance <= 0 || !Number.isSafeInteger(exitBps) || exitBps < 1 || exitBps > 10_000) return null;
  const value = balance * exitBps / 10_000;
  return value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: 18
  });
}
