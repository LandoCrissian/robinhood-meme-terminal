import { getAddress, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";

export const LIVE_POSITION_GUARD_SCHEMA_VERSION = 1;
export const LIVE_POSITION_GUARD_MIN_CONFIRMATION_MS = 3_000;
export const LIVE_POSITION_GUARD_MAX_CONFIRMATION_MS = 60_000;
export const LIVE_POSITION_GUARD_MAX_HOURS = 24 * 7;
export const LIVE_POSITION_GUARD_MAX_PRICE_IMPACT_BPS = 400;
export const LIVE_POSITION_GUARD_EXECUTION_SLIPPAGE_BPS = 100;
export const LIVE_POSITION_GUARD_HEARTBEAT_STALE_AFTER_MS = 30_000;
const BPS = 10_000n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ID = /^[A-Za-z0-9_-]{8,160}$/;
const CANCELLABLE_ORDER_STATUS = new Set([
  "active",
  "approval_required",
  "cancelled",
  "executed",
  "expired",
  "inactive",
  "no_position",
  "review_required"
]);

export type LivePositionGuardSettings = {
  stopLossBps: number;
  trailingStopBps: number;
  breakEvenActivationBps: number;
  maxPriceImpactBps: number;
  expiresAfterHours: number;
};

export type LivePositionGuardObservation = {
  entryUnitQuoteX18: bigint;
  highWatermarkUnitQuoteX18: bigint;
  firstBelowFloorAt: number | null;
  firstBelowFloorBlock: bigint | null;
};

export type LivePositionGuardEvaluation = {
  effectiveFloorUnitQuoteX18: bigint;
  highWatermarkUnitQuoteX18: bigint;
  firstBelowFloorAt: number | null;
  firstBelowFloorBlock: bigint | null;
  state: "healthy" | "confirming" | "triggered";
};

export type LivePositionGuardPublicConfiguration = {
  executor: Address;
  policyId: string;
  signerId: string;
};

export type LivePositionGuardCancellationDisposition = "cancel" | "reconcile" | "review";

function integerInRange(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

export function normalizeLivePositionGuardSettings(value: unknown): LivePositionGuardSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const stopLossBps = integerInRange(candidate.stopLossBps, 500, 5_000);
  const trailingStopBps = integerInRange(candidate.trailingStopBps, 500, 5_000);
  const breakEvenActivationBps = integerInRange(candidate.breakEvenActivationBps, 1_000, 10_000);
  const maxPriceImpactBps = integerInRange(candidate.maxPriceImpactBps, 10, LIVE_POSITION_GUARD_MAX_PRICE_IMPACT_BPS);
  const expiresAfterHours = integerInRange(candidate.expiresAfterHours, 1, LIVE_POSITION_GUARD_MAX_HOURS);
  if (
    stopLossBps === null || trailingStopBps === null || breakEvenActivationBps === null
    || maxPriceImpactBps === null || expiresAfterHours === null
  ) return null;
  return { stopLossBps, trailingStopBps, breakEvenActivationBps, maxPriceImpactBps, expiresAfterHours };
}

export function livePositionGuardPublicConfiguration(
  env: Record<string, string | undefined> = process.env
): LivePositionGuardPublicConfiguration | null {
  if (env.NEXT_PUBLIC_RMT_LIVE_POSITION_GUARD_ENABLED !== "true") return null;
  const executor = env.NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR?.trim() ?? "";
  const policyId = env.NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID?.trim() ?? "";
  const signerId = env.NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID?.trim() ?? "";
  if (!isAddress(executor) || !ID.test(policyId) || !ID.test(signerId)) return null;
  return { executor: getAddress(executor), policyId, signerId };
}

export function livePositionGuardCancellationDisposition(status: unknown): LivePositionGuardCancellationDisposition {
  if (status === "executing" || status === "submitted") return "reconcile";
  if (typeof status === "string" && CANCELLABLE_ORDER_STATUS.has(status)) return "cancel";
  return "review";
}

export function livePositionGuardOrderId(input: {
  authorizationId: string;
  documentId: string;
  wallet: string;
  token: string;
}) {
  if (
    !ID.test(input.authorizationId) || !ID.test(input.documentId)
    || !ADDRESS.test(input.wallet) || !ADDRESS.test(input.token)
  ) {
    throw new Error("Invalid Position Guard order identity.");
  }
  return keccak256(stringToHex(
    `rmt-position-guard-v${LIVE_POSITION_GUARD_SCHEMA_VERSION}:${input.authorizationId}:${input.documentId}:${input.wallet.toLowerCase()}:${input.token.toLowerCase()}`
  ));
}

export function unitQuoteX18(amountOut: bigint, amountIn: bigint) {
  if (amountOut <= 0n || amountIn <= 0n) throw new Error("A positive executable quote is required.");
  return amountOut * 10n ** 18n / amountIn;
}

export function livePositionGuardHeartbeatIsFresh(lastSeenAt: unknown, now = Date.now()) {
  return typeof lastSeenAt === "number"
    && Number.isSafeInteger(lastSeenAt)
    && Number.isSafeInteger(now)
    && now - lastSeenAt >= 0
    && now - lastSeenAt <= LIVE_POSITION_GUARD_HEARTBEAT_STALE_AFTER_MS;
}

export function evaluateLivePositionGuard(input: {
  currentBlock: bigint;
  currentUnitQuoteX18: bigint;
  now: number;
  observation: LivePositionGuardObservation;
  settings: LivePositionGuardSettings;
}): LivePositionGuardEvaluation {
  const { observation, settings } = input;
  if (
    input.currentBlock <= 0n || input.currentUnitQuoteX18 <= 0n || !Number.isSafeInteger(input.now) || input.now <= 0
    || observation.entryUnitQuoteX18 <= 0n || observation.highWatermarkUnitQuoteX18 <= 0n
  ) throw new Error("Invalid Position Guard observation.");
  const highWatermark = input.currentUnitQuoteX18 > observation.highWatermarkUnitQuoteX18
    ? input.currentUnitQuoteX18
    : observation.highWatermarkUnitQuoteX18;
  const staticFloor = observation.entryUnitQuoteX18 * (BPS - BigInt(settings.stopLossBps)) / BPS;
  const trailingFloor = highWatermark * (BPS - BigInt(settings.trailingStopBps)) / BPS;
  const breakEvenArmed = highWatermark * BPS
    >= observation.entryUnitQuoteX18 * (BPS + BigInt(settings.breakEvenActivationBps));
  const effectiveFloor = [staticFloor, trailingFloor, breakEvenArmed ? observation.entryUnitQuoteX18 : 0n]
    .reduce((highest, value) => value > highest ? value : highest, 0n);

  if (input.currentUnitQuoteX18 > effectiveFloor) {
    return {
      effectiveFloorUnitQuoteX18: effectiveFloor,
      highWatermarkUnitQuoteX18: highWatermark,
      firstBelowFloorAt: null,
      firstBelowFloorBlock: null,
      state: "healthy"
    };
  }

  const firstAt = observation.firstBelowFloorAt;
  const firstBlock = observation.firstBelowFloorBlock;
  const elapsed = firstAt === null ? 0 : input.now - firstAt;
  const confirmed = firstAt !== null
    && firstBlock !== null
    && input.currentBlock > firstBlock
    && elapsed >= LIVE_POSITION_GUARD_MIN_CONFIRMATION_MS
    && elapsed <= LIVE_POSITION_GUARD_MAX_CONFIRMATION_MS;
  if (confirmed) {
    return {
      effectiveFloorUnitQuoteX18: effectiveFloor,
      highWatermarkUnitQuoteX18: highWatermark,
      firstBelowFloorAt: firstAt,
      firstBelowFloorBlock: firstBlock,
      state: "triggered"
    };
  }
  const retainFirst = firstAt !== null && firstBlock !== null && elapsed <= LIVE_POSITION_GUARD_MAX_CONFIRMATION_MS;
  return {
    effectiveFloorUnitQuoteX18: effectiveFloor,
    highWatermarkUnitQuoteX18: highWatermark,
    firstBelowFloorAt: retainFirst ? firstAt : input.now,
    firstBelowFloorBlock: retainFirst ? firstBlock : input.currentBlock,
    state: "confirming"
  };
}

export const rmtPositionGuardExecutorAbi = [{
  type: "function",
  name: "executeV3Exit",
  stateMutability: "nonpayable",
  inputs: [{
    name: "exit",
    type: "tuple",
    components: [
      { name: "token", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMinimum", type: "uint256" },
      { name: "maxSlippageBps", type: "uint16" },
      { name: "deadline", type: "uint256" },
      { name: "orderId", type: "bytes32" }
    ]
  }],
  outputs: [{ name: "amountOut", type: "uint256" }]
}] as const;

export type LivePositionGuardExecutorCall = {
  data: Hex;
  to: Address;
};
