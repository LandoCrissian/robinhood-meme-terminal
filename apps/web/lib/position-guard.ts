import { activeChain } from "./network";

export type PositionGuard = {
  version: 1;
  wallet: string;
  token: string;
  basisUsd: number;
  highWatermarkUsd: number;
  referenceTokenBalance: number | null;
  entryPriceUsd: number | null;
  highWatermarkPriceUsd: number | null;
  stopLossBps: number;
  trailingStopBps: number;
  breakEvenActivationBps: number;
  recoverPrincipal: boolean;
  principalRecovered: boolean;
  stagedProfitLock: boolean;
  handledProfitTargets: PositionGuardProfitTargetKey[];
  enabled: boolean;
  armedAt: number;
  updatedAt: number;
  triggeredAt: number | null;
};

export type PositionGuardProfitTargetKey = "principal-2x" | "bank-3x" | "bank-5x";

export type PositionGuardProfitTarget = {
  key: PositionGuardProfitTargetKey;
  multipleBps: number;
  exitBps: number;
  ready: boolean;
  handled: boolean;
};

export type PositionGuardEvaluation = {
  currentValueUsd: number;
  highWatermarkUsd: number;
  priceTracked: boolean;
  currentPriceUsd: number | null;
  highWatermarkPriceUsd: number | null;
  gainBps: number;
  staticStopUsd: number;
  trailingStopUsd: number;
  breakEvenArmed: boolean;
  effectiveStopUsd: number;
  distanceToStopBps: number;
  stopTriggered: boolean;
  principalRecoveryReady: boolean;
  principalRecoveryBps: number;
  profitTargets: PositionGuardProfitTarget[];
  activeProfitTarget: PositionGuardProfitTarget | null;
};

const STORAGE_PREFIX = `rmt-position-guard-v1:${activeChain.id}`;
export const POSITION_GUARD_CHANGED_EVENT = "rmt:position-guard-changed";
const ADDRESS = /^0x[0-9a-f]{40}$/;
const VALID_STOP_BPS = new Set([500, 1000, 1500, 2000, 2500, 3000, 4000, 5000]);
const VALID_BREAK_EVEN_BPS = new Set([1000, 2500, 5000, 7500, 10000]);
const MAXIMUM_BASIS_USD = 100_000_000;
const PROFIT_TARGET_KEYS = new Set<PositionGuardProfitTargetKey>([
  "principal-2x",
  "bank-3x",
  "bank-5x"
]);

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
  const referenceTokenBalance = candidate.referenceTokenBalance === null || candidate.referenceTokenBalance === undefined
    ? null
    : finitePositive(candidate.referenceTokenBalance);
  const entryPriceUsd = candidate.entryPriceUsd === null || candidate.entryPriceUsd === undefined
    ? null
    : finitePositive(candidate.entryPriceUsd, MAXIMUM_BASIS_USD);
  const highWatermarkPriceUsd = candidate.highWatermarkPriceUsd === null || candidate.highWatermarkPriceUsd === undefined
    ? null
    : finitePositive(candidate.highWatermarkPriceUsd, MAXIMUM_BASIS_USD * 10_000);
  const armedAt = timestamp(candidate.armedAt);
  const updatedAt = timestamp(candidate.updatedAt);
  const triggeredAt = candidate.triggeredAt === null ? null : timestamp(candidate.triggeredAt);
  const handledProfitTargets = Array.isArray(candidate.handledProfitTargets)
    ? [...new Set(candidate.handledProfitTargets.filter(
      (key): key is PositionGuardProfitTargetKey => typeof key === "string" && PROFIT_TARGET_KEYS.has(key as PositionGuardProfitTargetKey)
    ))]
    : [];
  if (
    candidate.version !== 1
    || !ADDRESS.test(wallet)
    || !ADDRESS.test(token)
    || basisUsd === null
    || highWatermarkUsd === null
    || (referenceTokenBalance === null) !== (entryPriceUsd === null)
    || (entryPriceUsd === null) !== (highWatermarkPriceUsd === null)
    || (entryPriceUsd !== null && highWatermarkPriceUsd !== null && highWatermarkPriceUsd < entryPriceUsd * 0.000001)
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
    referenceTokenBalance,
    entryPriceUsd,
    highWatermarkPriceUsd,
    stopLossBps: candidate.stopLossBps!,
    trailingStopBps: candidate.trailingStopBps!,
    breakEvenActivationBps: candidate.breakEvenActivationBps!,
    recoverPrincipal: candidate.recoverPrincipal,
    principalRecovered: candidate.principalRecovered,
    stagedProfitLock: candidate.stagedProfitLock === true,
    handledProfitTargets: candidate.principalRecovered && !handledProfitTargets.includes("principal-2x")
      ? ["principal-2x", ...handledProfitTargets]
      : handledProfitTargets,
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
  tokenBalance?: number;
  stopLossBps?: number;
  trailingStopBps?: number;
  breakEvenActivationBps?: number;
  recoverPrincipal?: boolean;
  stagedProfitLock?: boolean;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  const tokenBalance = finitePositive(input.tokenBalance);
  const entryPriceUsd = tokenBalance ? input.basisUsd / tokenBalance : null;
  const currentPriceUsd = tokenBalance ? input.currentValueUsd / tokenBalance : null;
  return normalizePositionGuard({
    version: 1,
    wallet: input.wallet,
    token: input.token,
    basisUsd: input.basisUsd,
    highWatermarkUsd: input.currentValueUsd,
    referenceTokenBalance: tokenBalance,
    entryPriceUsd,
    highWatermarkPriceUsd: currentPriceUsd,
    stopLossBps: input.stopLossBps ?? 2000,
    trailingStopBps: input.trailingStopBps ?? 2000,
    breakEvenActivationBps: input.breakEvenActivationBps ?? 5000,
    recoverPrincipal: input.recoverPrincipal ?? true,
    principalRecovered: false,
    stagedProfitLock: input.stagedProfitLock ?? true,
    handledProfitTargets: [],
    enabled: true,
    armedAt: now,
    updatedAt: now,
    triggeredAt: null
  });
}

export function evaluatePositionGuard(
  guard: PositionGuard,
  currentValueUsd: number,
  tokenBalance?: number
): PositionGuardEvaluation | null {
  if (!Number.isFinite(currentValueUsd) || currentValueUsd <= 0) return null;
  const currentTokenBalance = finitePositive(tokenBalance);
  const priceTracking = currentTokenBalance !== null
    && guard.entryPriceUsd !== null
    && guard.highWatermarkPriceUsd !== null;
  const currentPriceUsd = priceTracking ? currentValueUsd / currentTokenBalance : null;
  const highWatermarkPriceUsd = priceTracking
    ? Math.max(guard.highWatermarkPriceUsd!, currentPriceUsd!)
    : null;
  const highWatermarkUsd = priceTracking
    ? highWatermarkPriceUsd! * currentTokenBalance
    : Math.max(guard.highWatermarkUsd, currentValueUsd);
  const staticStopUsd = priceTracking
    ? guard.entryPriceUsd! * (1 - guard.stopLossBps / 10_000) * currentTokenBalance
    : guard.basisUsd * (1 - guard.stopLossBps / 10_000);
  const trailingStopUsd = priceTracking
    ? highWatermarkPriceUsd! * (1 - guard.trailingStopBps / 10_000) * currentTokenBalance
    : highWatermarkUsd * (1 - guard.trailingStopBps / 10_000);
  const breakEvenArmed = priceTracking
    ? highWatermarkPriceUsd! >= guard.entryPriceUsd! * (1 + guard.breakEvenActivationBps / 10_000)
    : highWatermarkUsd >= guard.basisUsd * (1 + guard.breakEvenActivationBps / 10_000);
  const breakEvenFloorUsd = priceTracking ? guard.entryPriceUsd! * currentTokenBalance : guard.basisUsd;
  const effectiveStopUsd = Math.max(staticStopUsd, trailingStopUsd, breakEvenArmed ? breakEvenFloorUsd : 0);
  const distanceToStopBps = Math.max(0, Math.round((currentValueUsd - effectiveStopUsd) / currentValueUsd * 10_000));
  const gainBps = priceTracking
    ? Math.round((currentPriceUsd! - guard.entryPriceUsd!) / guard.entryPriceUsd! * 10_000)
    : Math.round((currentValueUsd - guard.basisUsd) / guard.basisUsd * 10_000);
  const reachedMultiple = (multiple: number) => priceTracking
    ? currentPriceUsd! >= guard.entryPriceUsd! * multiple
    : currentValueUsd >= guard.basisUsd * multiple;
  const principalRecoveryReady = guard.recoverPrincipal
    && !guard.principalRecovered
    && !guard.handledProfitTargets.includes("principal-2x")
    && reachedMultiple(2);
  const principalRecoveryBps = principalRecoveryReady
    ? Math.min(10_000, Math.max(1, Math.ceil(guard.basisUsd / currentValueUsd * 10_000)))
    : 0;
  const profitTargets: PositionGuardProfitTarget[] = [
    ...(guard.recoverPrincipal ? [{
      key: "principal-2x" as const,
      multipleBps: 20_000,
      exitBps: principalRecoveryReady ? principalRecoveryBps : 5_000,
      ready: principalRecoveryReady,
      handled: guard.principalRecovered || guard.handledProfitTargets.includes("principal-2x")
    }] : []),
    ...(guard.stagedProfitLock ? [
      {
        key: "bank-3x" as const,
        multipleBps: 30_000,
        exitBps: 2_500,
        ready: reachedMultiple(3),
        handled: guard.handledProfitTargets.includes("bank-3x")
      },
      {
        key: "bank-5x" as const,
        multipleBps: 50_000,
        exitBps: 2_000,
        ready: reachedMultiple(5),
        handled: guard.handledProfitTargets.includes("bank-5x")
      }
    ] : [])
  ];
  const activeProfitTarget = profitTargets.find((target) => target.ready && !target.handled) ?? null;
  return {
    currentValueUsd,
    highWatermarkUsd,
    priceTracked: priceTracking,
    currentPriceUsd,
    highWatermarkPriceUsd,
    gainBps,
    staticStopUsd,
    trailingStopUsd,
    breakEvenArmed,
    effectiveStopUsd,
    distanceToStopBps,
    stopTriggered: guard.enabled && (priceTracking
      ? currentPriceUsd! <= effectiveStopUsd / currentTokenBalance
      : currentValueUsd <= effectiveStopUsd),
    principalRecoveryReady,
    principalRecoveryBps,
    profitTargets,
    activeProfitTarget
  };
}

export function advancePositionGuard(
  guard: PositionGuard,
  currentValueUsd: number,
  now = Date.now(),
  tokenBalance?: number
) {
  const evaluation = evaluatePositionGuard(guard, currentValueUsd, tokenBalance);
  if (!evaluation) return guard;
  const triggeredAt = guard.triggeredAt ?? (evaluation.stopTriggered ? now : null);
  const currentTokenBalance = finitePositive(tokenBalance);
  const currentPriceUsd = currentTokenBalance && guard.highWatermarkPriceUsd !== null
    ? currentValueUsd / currentTokenBalance
    : null;
  const highWatermarkPriceUsd = currentPriceUsd === null
    ? guard.highWatermarkPriceUsd
    : Math.max(guard.highWatermarkPriceUsd!, currentPriceUsd);
  if (
    evaluation.highWatermarkUsd === guard.highWatermarkUsd
    && highWatermarkPriceUsd === guard.highWatermarkPriceUsd
    && triggeredAt === guard.triggeredAt
  ) return guard;
  return {
    ...guard,
    highWatermarkUsd: evaluation.highWatermarkUsd,
    highWatermarkPriceUsd,
    updatedAt: now,
    triggeredAt
  } satisfies PositionGuard;
}

export function acknowledgePrincipalRecovery(guard: PositionGuard, now = Date.now()) {
  return acknowledgeProfitTarget(guard, "principal-2x", now);
}

export function acknowledgeProfitTarget(
  guard: PositionGuard,
  target: PositionGuardProfitTargetKey,
  now = Date.now()
) {
  if (!PROFIT_TARGET_KEYS.has(target)) return guard;
  return {
    ...guard,
    principalRecovered: target === "principal-2x" ? true : guard.principalRecovered,
    handledProfitTargets: guard.handledProfitTargets.includes(target)
      ? guard.handledProfitTargets
      : [...guard.handledProfitTargets, target],
    updatedAt: now
  } satisfies PositionGuard;
}

export function resetPositionGuardTrigger(
  guard: PositionGuard,
  currentValueUsd: number,
  now = Date.now(),
  tokenBalance?: number
) {
  if (!Number.isFinite(currentValueUsd) || currentValueUsd <= 0) return guard;
  const currentTokenBalance = finitePositive(tokenBalance);
  return {
    ...guard,
    highWatermarkUsd: currentValueUsd,
    highWatermarkPriceUsd: currentTokenBalance && guard.highWatermarkPriceUsd !== null
      ? currentValueUsd / currentTokenBalance
      : guard.highWatermarkPriceUsd,
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
    window.dispatchEvent(new CustomEvent(POSITION_GUARD_CHANGED_EVENT, {
      detail: { wallet: normalized.wallet, token: normalized.token }
    }));
    return true;
  } catch {
    return false;
  }
}

export function removePositionGuard(wallet: string, token: string) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(storageKey(wallet, token));
    window.dispatchEvent(new CustomEvent(POSITION_GUARD_CHANGED_EVENT, {
      detail: { wallet: wallet.toLowerCase(), token: token.toLowerCase() }
    }));
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

export type PositionGuardExitReason = "protected-floor" | "principal-2x" | "bank-3x" | "bank-5x";

export type PositionGuardExitRequest = {
  exitBps: number;
  reason: PositionGuardExitReason;
};

export type PreparedPositionExit = PositionGuardExitRequest & {
  amount: string;
  token: string;
  wallet: string;
  createdAt: number;
};

export function exactTokenAmountForExit(balanceUnits: bigint, decimals: number, exitBps: number) {
  if (
    balanceUnits <= 0n
    || !Number.isSafeInteger(decimals)
    || decimals < 0
    || decimals > 255
    || !Number.isSafeInteger(exitBps)
    || exitBps < 1
    || exitBps > 10_000
  ) return null;
  const exitUnits = balanceUnits * BigInt(exitBps) / 10_000n;
  if (exitUnits <= 0n) return null;
  if (decimals === 0) return exitUnits.toString();
  const padded = exitUnits.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function positionGuardExitLabel(reason: PositionGuardExitReason) {
  if (reason === "protected-floor") return "Protected floor exit";
  if (reason === "principal-2x") return "Recover original basis";
  if (reason === "bank-3x") return "Bank gains at 3×";
  return "Bank gains at 5×";
}

export function positionGuardAfterConfirmedExit(guard: PositionGuard, reason: PositionGuardExitReason, now = Date.now()) {
  if (reason === "protected-floor") return null;
  return acknowledgeProfitTarget(guard, reason, now);
}
