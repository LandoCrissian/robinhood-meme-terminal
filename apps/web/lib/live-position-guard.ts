import { getAddress, isAddress, keccak256, stringToHex, type Address, type Hex } from "viem";

export const LIVE_POSITION_GUARD_SCHEMA_VERSION = 2;
export const LIVE_POSITION_GUARD_MIN_CONFIRMATION_MS = 3_000;
export const LIVE_POSITION_GUARD_MAX_CONFIRMATION_MS = 60_000;
export const LIVE_POSITION_GUARD_MAX_HOURS = 24 * 7;
export const LIVE_POSITION_GUARD_MAX_PRICE_IMPACT_BPS = 400;
export const LIVE_POSITION_GUARD_EXECUTION_SLIPPAGE_BPS = 100;
export const LIVE_POSITION_GUARD_TWAP_SECONDS = 300;
export const LIVE_POSITION_GUARD_HEARTBEAT_STALE_AFTER_MS = 30_000;
const BPS = 10_000n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ORDER_ID = /^0x[0-9a-fA-F]{64}$/;
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
const REPLACEABLE_ORDER_STATUS = new Set([
  "cancelled",
  "executed",
  "expired",
  "inactive"
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
  enabled: boolean;
  executor: Address;
  policyId: string;
  signerId: string;
};

export type LivePositionGuardCancellationDisposition = "cancel" | "reconcile" | "review";

export type LivePositionGuardRuntimeAuthority = {
  status: "ready" | "no_position" | "approval_required" | "review_required";
  reviewReason:
    | null
    | "invalid_order_limit"
    | "allowance_exceeds_order_limit"
    | "balance_below_order_limit";
};

export type LivePositionGuardPreparedPlan = {
  amountIn: bigint;
  breakEvenActivationBps: number;
  expiresAt: number;
  fee: number;
  maxSlippageBps: number;
  orderId: Hex;
  pair: Address;
  stopLossBps: number;
  token: Address;
  trailingStopBps: number;
  twapSeconds: number;
};

export type LivePositionGuardOnchainOrder = {
  amountIn: bigint;
  breakEvenActivationBps: number;
  entryUnitQuoteX18: bigint;
  expiresAt: number;
  fee: number;
  firstBelowFloorAt: number;
  firstBelowFloorBlock: bigint;
  highWatermarkUnitQuoteX18: bigint;
  maxSlippageBps: number;
  pool: Address;
  status: number;
  stopLossBps: number;
  token: Address;
  trailingStopBps: number;
  twapSeconds: number;
};

export type LivePositionGuardOnchainPreview = {
  currentUnitQuoteX18: bigint;
  effectiveFloorUnitQuoteX18: bigint;
  firstBelowFloorAt: number;
  firstBelowFloorBlock: bigint;
  highWatermarkUnitQuoteX18: bigint;
  state: number;
  twapAmountOut: bigint;
};

function integerInRange(value: unknown, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function integerValue(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return null;
}

function bigintValue(value: unknown) {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]{0,78})$/.test(value)) return BigInt(value);
  return null;
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function normalizeLivePositionGuardSettings(value: unknown): LivePositionGuardSettings | null {
  const candidate = recordValue(value);
  if (!candidate) return null;
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

export function normalizeLivePositionGuardPreparedPlan(value: unknown): LivePositionGuardPreparedPlan | null {
  const candidate = recordValue(value);
  if (!candidate) return null;
  const token = typeof candidate.token === "string" && isAddress(candidate.token) ? getAddress(candidate.token) : null;
  const pair = typeof candidate.pair === "string" && isAddress(candidate.pair) ? getAddress(candidate.pair) : null;
  const amountIn = bigintValue(candidate.amountIn);
  const fee = integerInRange(candidate.fee, 1, 1_000_000);
  const stopLossBps = integerInRange(candidate.stopLossBps, 500, 5_000);
  const trailingStopBps = integerInRange(candidate.trailingStopBps, 500, 5_000);
  const breakEvenActivationBps = integerInRange(candidate.breakEvenActivationBps, 1_000, 10_000);
  const maxSlippageBps = integerInRange(candidate.maxSlippageBps, 1, 500);
  const twapSeconds = integerInRange(candidate.twapSeconds, 60, 1_800);
  const expiresAt = integerValue(candidate.expiresAt);
  const orderId = typeof candidate.orderId === "string" && ORDER_ID.test(candidate.orderId)
    ? candidate.orderId as Hex
    : null;
  if (
    !token || !pair || !amountIn || amountIn <= 0n || fee === null || stopLossBps === null
    || trailingStopBps === null || breakEvenActivationBps === null || maxSlippageBps === null
    || twapSeconds === null || expiresAt === null || expiresAt <= 0 || !orderId
  ) return null;
  return {
    amountIn,
    breakEvenActivationBps,
    expiresAt,
    fee,
    maxSlippageBps,
    orderId,
    pair,
    stopLossBps,
    token,
    trailingStopBps,
    twapSeconds
  };
}

export function normalizeLivePositionGuardOnchainOrder(value: unknown): LivePositionGuardOnchainOrder | null {
  const candidate = recordValue(value);
  if (!candidate) return null;
  const token = typeof candidate.token === "string" && isAddress(candidate.token) ? getAddress(candidate.token) : null;
  const pool = typeof candidate.pool === "string" && isAddress(candidate.pool) ? getAddress(candidate.pool) : null;
  const amountIn = bigintValue(candidate.amountIn);
  const entryUnitQuoteX18 = bigintValue(candidate.entryUnitQuoteX18);
  const highWatermarkUnitQuoteX18 = bigintValue(candidate.highWatermarkUnitQuoteX18);
  const firstBelowFloorBlock = bigintValue(candidate.firstBelowFloorBlock);
  const expiresAt = integerValue(candidate.expiresAt);
  const firstBelowFloorAt = integerValue(candidate.firstBelowFloorAt);
  const twapSeconds = integerValue(candidate.twapSeconds);
  const fee = integerValue(candidate.fee);
  const stopLossBps = integerValue(candidate.stopLossBps);
  const trailingStopBps = integerValue(candidate.trailingStopBps);
  const breakEvenActivationBps = integerValue(candidate.breakEvenActivationBps);
  const maxSlippageBps = integerValue(candidate.maxSlippageBps);
  const status = integerValue(candidate.status);
  if (
    !token || !pool || amountIn === null || entryUnitQuoteX18 === null || highWatermarkUnitQuoteX18 === null
    || firstBelowFloorBlock === null || expiresAt === null || firstBelowFloorAt === null || twapSeconds === null
    || fee === null || stopLossBps === null || trailingStopBps === null || breakEvenActivationBps === null
    || maxSlippageBps === null || status === null
  ) return null;
  return {
    amountIn,
    breakEvenActivationBps,
    entryUnitQuoteX18,
    expiresAt,
    fee,
    firstBelowFloorAt,
    firstBelowFloorBlock,
    highWatermarkUnitQuoteX18,
    maxSlippageBps,
    pool,
    status,
    stopLossBps,
    token,
    trailingStopBps,
    twapSeconds
  };
}

export function normalizeLivePositionGuardOnchainPreview(value: unknown): LivePositionGuardOnchainPreview | null {
  const candidate = recordValue(value);
  if (!candidate) return null;
  const state = integerValue(candidate.state);
  const twapAmountOut = bigintValue(candidate.twapAmountOut);
  const currentUnitQuoteX18 = bigintValue(candidate.currentUnitQuoteX18);
  const effectiveFloorUnitQuoteX18 = bigintValue(candidate.effectiveFloorUnitQuoteX18);
  const highWatermarkUnitQuoteX18 = bigintValue(candidate.highWatermarkUnitQuoteX18);
  const firstBelowFloorAt = integerValue(candidate.firstBelowFloorAt);
  const firstBelowFloorBlock = bigintValue(candidate.firstBelowFloorBlock);
  if (
    state === null || twapAmountOut === null || currentUnitQuoteX18 === null
    || effectiveFloorUnitQuoteX18 === null || highWatermarkUnitQuoteX18 === null
    || firstBelowFloorAt === null || firstBelowFloorBlock === null
  ) return null;
  return {
    currentUnitQuoteX18,
    effectiveFloorUnitQuoteX18,
    firstBelowFloorAt,
    firstBelowFloorBlock,
    highWatermarkUnitQuoteX18,
    state,
    twapAmountOut
  };
}

export function livePositionGuardOnchainOrderMatchesPlan(
  order: LivePositionGuardOnchainOrder,
  plan: LivePositionGuardPreparedPlan
) {
  return order.status === 1
    && order.token.toLowerCase() === plan.token.toLowerCase()
    && order.pool.toLowerCase() === plan.pair.toLowerCase()
    && order.amountIn === plan.amountIn
    && order.fee === plan.fee
    && order.stopLossBps === plan.stopLossBps
    && order.trailingStopBps === plan.trailingStopBps
    && order.breakEvenActivationBps === plan.breakEvenActivationBps
    && order.maxSlippageBps === plan.maxSlippageBps
    && order.twapSeconds === plan.twapSeconds
    && order.expiresAt === plan.expiresAt;
}

export function livePositionGuardPublicConfiguration(
  env: Record<string, string | undefined> = process.env
): LivePositionGuardPublicConfiguration | null {
  const executor = env.NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR?.trim() ?? "";
  const policyId = env.NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID?.trim() ?? "";
  const signerId = env.NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID?.trim() ?? "";
  if (!isAddress(executor) || !ID.test(policyId) || !ID.test(signerId)) return null;
  return {
    enabled: env.NEXT_PUBLIC_RMT_LIVE_POSITION_GUARD_ENABLED === "true",
    executor: getAddress(executor),
    policyId,
    signerId
  };
}

export function livePositionGuardCancellationDisposition(status: unknown): LivePositionGuardCancellationDisposition {
  if (status === "executing" || status === "submitted") return "reconcile";
  if (typeof status === "string" && CANCELLABLE_ORDER_STATUS.has(status)) return "cancel";
  return "review";
}

export function livePositionGuardCanReplaceOrder(status: unknown, walletCleanupReportedAt: unknown) {
  return typeof status === "string"
    && REPLACEABLE_ORDER_STATUS.has(status)
    && typeof walletCleanupReportedAt === "number"
    && Number.isSafeInteger(walletCleanupReportedAt)
    && walletCleanupReportedAt > 0;
}

export function livePositionGuardAuthorityMatchesPlan(input: {
  allowance: bigint;
  balance: bigint;
  amountIn: bigint;
}) {
  return input.amountIn > 0n
    && input.allowance === input.amountIn
    && input.balance >= input.amountIn;
}

/** Re-check the indivisible wallet authority immediately before every evaluator decision. */
export function livePositionGuardRuntimeAuthority(input: {
  allowance: bigint;
  balance: bigint;
  amountLimit: bigint;
}): LivePositionGuardRuntimeAuthority {
  if (input.amountLimit <= 0n) {
    return { status: "review_required", reviewReason: "invalid_order_limit" };
  }
  if (input.allowance > input.amountLimit) {
    return { status: "review_required", reviewReason: "allowance_exceeds_order_limit" };
  }
  if (input.balance === 0n) {
    return { status: "no_position", reviewReason: null };
  }
  if (input.allowance < input.amountLimit) {
    return { status: "approval_required", reviewReason: null };
  }
  if (input.balance < input.amountLimit) {
    return { status: "review_required", reviewReason: "balance_below_order_limit" };
  }
  return { status: "ready", reviewReason: null };
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

const v3OrderComponents = [
  { name: "token", type: "address" },
  { name: "pool", type: "address" },
  { name: "amountIn", type: "uint128" },
  { name: "entryUnitQuoteX18", type: "uint256" },
  { name: "highWatermarkUnitQuoteX18", type: "uint256" },
  { name: "expiresAt", type: "uint64" },
  { name: "firstBelowFloorAt", type: "uint64" },
  { name: "firstBelowFloorBlock", type: "uint64" },
  { name: "twapSeconds", type: "uint32" },
  { name: "fee", type: "uint24" },
  { name: "stopLossBps", type: "uint16" },
  { name: "trailingStopBps", type: "uint16" },
  { name: "breakEvenActivationBps", type: "uint16" },
  { name: "maxSlippageBps", type: "uint16" },
  { name: "status", type: "uint8" }
] as const;

const v3PreviewComponents = [
  { name: "state", type: "uint8" },
  { name: "twapAmountOut", type: "uint256" },
  { name: "currentUnitQuoteX18", type: "uint256" },
  { name: "effectiveFloorUnitQuoteX18", type: "uint256" },
  { name: "highWatermarkUnitQuoteX18", type: "uint256" },
  { name: "firstBelowFloorAt", type: "uint64" },
  { name: "firstBelowFloorBlock", type: "uint64" }
] as const;

export const rmtPositionGuardExecutorAbi = [
  {
    type: "function",
    name: "registerV3Order",
    stateMutability: "nonpayable",
    inputs: [{
      name: "request",
      type: "tuple",
      components: [
        { name: "token", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "amountIn", type: "uint128" },
        { name: "stopLossBps", type: "uint16" },
        { name: "trailingStopBps", type: "uint16" },
        { name: "breakEvenActivationBps", type: "uint16" },
        { name: "maxSlippageBps", type: "uint16" },
        { name: "twapSeconds", type: "uint32" },
        { name: "expiresAt", type: "uint64" },
        { name: "orderId", type: "bytes32" }
      ]
    }],
    outputs: []
  },
  {
    type: "function",
    name: "checkpointV3Order",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [{ name: "preview", type: "tuple", components: v3PreviewComponents }]
  },
  {
    type: "function",
    name: "executeV3Exit",
    stateMutability: "nonpayable",
    inputs: [{
      name: "request",
      type: "tuple",
      components: [
        { name: "orderId", type: "bytes32" },
        { name: "amountOutMinimum", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    }],
    outputs: [{ name: "amountOut", type: "uint256" }]
  },
  {
    type: "function",
    name: "cancelV3Order",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: []
  },
  {
    type: "function",
    name: "getV3Order",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }, { name: "orderId", type: "bytes32" }],
    outputs: [{ name: "order", type: "tuple", components: v3OrderComponents }]
  },
  {
    type: "function",
    name: "previewV3Order",
    stateMutability: "view",
    inputs: [{ name: "wallet", type: "address" }, { name: "orderId", type: "bytes32" }],
    outputs: [{ name: "preview", type: "tuple", components: v3PreviewComponents }]
  }
] as const;

export type LivePositionGuardExecutorCall = {
  data: Hex;
  to: Address;
};
