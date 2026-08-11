import { getAddress, isAddress, isHash, isHex, type Address, type Hash, type Hex } from "viem";
import type { AcrossFundingEvidence, AcrossFundingSourceChainId } from "../server/vnext-across-funding";
import {
  ROBINHOOD_MAINNET_CHAIN_ID,
  TRUSTED_ASSET_ADDRESSES,
  trustedPaymentAsset,
  trustedSettlementAsset
} from "./trusted-asset-registry";

export const CROSS_CHAIN_FUNDING_SCHEMA_VERSION = 1 as const;
export const CROSS_CHAIN_FUNDING_STORAGE_KEY = "rmt:vnext-cross-chain-funding:v1";
export const CROSS_CHAIN_FUNDING_CHANGED_EVENT = "rmt:vnext-cross-chain-funding-changed";
const MAX_SESSIONS = 24;
const MAX_EVENTS = 64;
const SESSION_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

export type CrossChainFundingState =
  | "quote_ready"
  | "source_submission_pending"
  | "source_submitted"
  | "deposit_confirmed"
  | "bridging"
  | "fill_pending"
  | "destination_confirmed"
  | "completed"
  | "expired"
  | "refund_eligible"
  | "refund_pending"
  | "refunded"
  | "failed"
  | "recovery_required";

export type CrossChainFundingEvent = {
  state: CrossChainFundingState;
  observedAtMs: number;
  source: "rmt" | "source_chain" | "across_api" | "destination_chain";
  detail: string;
};

export type CrossChainFundingSession = {
  schemaVersion: typeof CROSS_CHAIN_FUNDING_SCHEMA_VERSION;
  sessionId: string;
  provider: "across";
  wallet: Address;
  sourceChainId: AcrossFundingSourceChainId;
  destinationChainId: typeof ROBINHOOD_MAINNET_CHAIN_ID;
  sourceToken: Address;
  destinationToken: Address;
  sourceSpokePool: Address;
  destinationSpokePool: Address;
  inputAmountAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  quoteTimestamp: number;
  refundChainId: AcrossFundingSourceChainId;
  refundToken: Address;
  refundRecipient: Address;
  fillDeadline: number;
  exclusiveRelayer: Address;
  exclusivityParameter: number;
  message: "0x";
  sourceSpokePoolRuntimeHash: Hex;
  sourceSpokePoolImplementation: Address;
  sourceSpokePoolImplementationRuntimeHash: Hex;
  destinationSpokePoolRuntimeHash: Hex;
  destinationSpokePoolImplementation: Address;
  destinationSpokePoolImplementationRuntimeHash: Hex;
  quoteId: string;
  quoteExpiresAtMs: number;
  approvalSpender: Address;
  exactApprovalAmountAtomic: string;
  totalFeeAtomic: string;
  totalFeeAsset: Address;
  originGasAtomic: string | null;
  expectedCompletionSeconds: number;
  settlementMode: "asynchronous_fill";
  refundOnOrigin: true;
  partialFillsAllowed: false;
  depositCalldataHash: Hex;
  depositValueAtomic: "0";
  state: CrossChainFundingState;
  sourceTxHash: Hash | null;
  depositId: string | null;
  destinationTxHash: Hash | null;
  destinationOutputAtomic: string | null;
  refundTxHash: Hash | null;
  failureCode: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  events: CrossChainFundingEvent[];
};

export type CrossChainFundingTransition =
  | { type: "source_submission_requested" }
  | { type: "source_submitted"; sourceTxHash: Hash }
  | { type: "deposit_confirmed"; depositId: string }
  | { type: "bridging" }
  | { type: "fill_pending" }
  | { type: "destination_confirmed"; destinationTxHash: Hash; destinationOutputAtomic: string }
  | { type: "completed" }
  | { type: "expired" }
  | { type: "refund_eligible" }
  | { type: "refund_pending" }
  | { type: "refunded"; refundTxHash?: Hash | null }
  | { type: "failed"; failureCode: string }
  | { type: "recovery_required"; failureCode: string };

export type CrossChainFundingStorage = Pick<Storage, "getItem" | "setItem">;

const permittedTransitions: Record<CrossChainFundingState, readonly CrossChainFundingState[]> = {
  quote_ready: ["source_submission_pending", "failed"],
  source_submission_pending: ["source_submitted", "failed", "recovery_required"],
  source_submitted: ["deposit_confirmed", "failed", "recovery_required"],
  deposit_confirmed: ["bridging", "fill_pending", "destination_confirmed", "expired", "recovery_required"],
  bridging: ["fill_pending", "destination_confirmed", "expired", "failed", "recovery_required"],
  fill_pending: ["destination_confirmed", "expired", "failed", "recovery_required"],
  destination_confirmed: ["completed", "recovery_required"],
  completed: [],
  expired: ["refund_eligible", "refund_pending", "refunded", "recovery_required"],
  refund_eligible: ["refund_pending", "refunded", "recovery_required"],
  refund_pending: ["refunded", "recovery_required"],
  refunded: [],
  failed: ["recovery_required"],
  recovery_required: []
};

function canonicalAtomic(value: unknown, positive = true) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  if (positive && value === "0") return null;
  return value;
}

function timestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function hash32(value: unknown) {
  return typeof value === "string" && isHex(value) && /^0x[0-9a-fA-F]{64}$/.test(value) ? value.toLowerCase() as Hex : null;
}

function uuid(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function normalizeEvent(value: unknown): CrossChainFundingEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Partial<CrossChainFundingEvent>;
  const observedAtMs = timestamp(event.observedAtMs);
  if (
    !observedAtMs
    || !event.state || !(event.state in permittedTransitions)
    || !event.source || !["rmt", "source_chain", "across_api", "destination_chain"].includes(event.source)
    || typeof event.detail !== "string" || event.detail.length < 1 || event.detail.length > 240
  ) return null;
  return {
    state: event.state,
    observedAtMs,
    source: event.source,
    detail: event.detail
  };
}

export function normalizeCrossChainFundingSession(value: unknown): CrossChainFundingSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const session = value as Partial<CrossChainFundingSession>;
  const sessionId = uuid(session.sessionId);
  const createdAtMs = timestamp(session.createdAtMs);
  const updatedAtMs = timestamp(session.updatedAtMs);
  const fillDeadline = timestamp(session.fillDeadline);
  const quoteTimestamp = timestamp(session.quoteTimestamp);
  const exclusivityParameter = typeof session.exclusivityParameter === "number" && Number.isSafeInteger(session.exclusivityParameter) && session.exclusivityParameter >= 0
    ? session.exclusivityParameter
    : null;
  const sourceSpokePoolRuntimeHash = hash32(session.sourceSpokePoolRuntimeHash);
  const sourceSpokePoolImplementationRuntimeHash = hash32(session.sourceSpokePoolImplementationRuntimeHash);
  const destinationSpokePoolRuntimeHash = hash32(session.destinationSpokePoolRuntimeHash);
  const destinationSpokePoolImplementationRuntimeHash = hash32(session.destinationSpokePoolImplementationRuntimeHash);
  const depositCalldataHash = hash32(session.depositCalldataHash);
  const quoteExpiresAtMs = timestamp(session.quoteExpiresAtMs);
  const inputAmountAtomic = canonicalAtomic(session.inputAmountAtomic);
  const expectedOutputAtomic = canonicalAtomic(session.expectedOutputAtomic);
  const protectedOutputAtomic = canonicalAtomic(session.protectedOutputAtomic);
  const exactApprovalAmountAtomic = canonicalAtomic(session.exactApprovalAmountAtomic);
  const totalFeeAtomic = canonicalAtomic(session.totalFeeAtomic, false);
  const originGasAtomic = session.originGasAtomic === null ? null : canonicalAtomic(session.originGasAtomic, false);
  const expectedCompletionSeconds = typeof session.expectedCompletionSeconds === "number"
    && Number.isSafeInteger(session.expectedCompletionSeconds)
    && session.expectedCompletionSeconds > 0
    ? session.expectedCompletionSeconds
    : null;
  const sourceTxHash = session.sourceTxHash === null ? null : session.sourceTxHash && isHash(session.sourceTxHash) ? session.sourceTxHash.toLowerCase() as Hash : undefined;
  const destinationTxHash = session.destinationTxHash === null ? null : session.destinationTxHash && isHash(session.destinationTxHash) ? session.destinationTxHash.toLowerCase() as Hash : undefined;
  const refundTxHash = session.refundTxHash === null ? null : session.refundTxHash && isHash(session.refundTxHash) ? session.refundTxHash.toLowerCase() as Hash : undefined;
  const events = Array.isArray(session.events) ? session.events.map(normalizeEvent).filter((event): event is CrossChainFundingEvent => Boolean(event)) : [];
  const sourceAsset = session.sourceChainId && session.sourceToken
    ? trustedPaymentAsset(session.sourceChainId, session.sourceToken)
    : null;
  const destinationAsset = session.destinationToken
    ? trustedSettlementAsset(ROBINHOOD_MAINNET_CHAIN_ID, session.destinationToken)
    : null;
  const eventHistoryValid = events.every((event, index) => {
    if (index === 0) return true;
    const previous = events[index - 1];
    return event.observedAtMs > previous.observedAtMs
      && permittedTransitions[previous.state].includes(event.state);
  });
  if (
    session.schemaVersion !== CROSS_CHAIN_FUNDING_SCHEMA_VERSION || !sessionId || session.provider !== "across"
    || !session.wallet || !isAddress(session.wallet, { strict: false })
    || ![1, 42_161, 8_453].includes(session.sourceChainId ?? -1)
    || session.destinationChainId !== ROBINHOOD_MAINNET_CHAIN_ID
    || !session.sourceToken || !isAddress(session.sourceToken, { strict: false })
    || !session.destinationToken || !isAddress(session.destinationToken, { strict: false })
    || !session.sourceSpokePool || !isAddress(session.sourceSpokePool, { strict: false })
    || !session.destinationSpokePool || !isAddress(session.destinationSpokePool, { strict: false })
    || !sourceAsset || sourceAsset.symbol !== "USDC" || sourceAsset.issuer !== "Circle"
    || !destinationAsset || destinationAsset.address !== TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG
    || !session.refundToken || !isAddress(session.refundToken, { strict: false })
    || !session.refundRecipient || !isAddress(session.refundRecipient, { strict: false })
    || !session.exclusiveRelayer || !isAddress(session.exclusiveRelayer, { strict: false })
    || !session.sourceSpokePoolImplementation || !isAddress(session.sourceSpokePoolImplementation, { strict: false })
    || !session.destinationSpokePoolImplementation || !isAddress(session.destinationSpokePoolImplementation, { strict: false })
    || getAddress(session.wallet) !== getAddress(session.refundRecipient)
    || session.refundChainId !== session.sourceChainId
    || !inputAmountAtomic || !expectedOutputAtomic || !protectedOutputAtomic || !exactApprovalAmountAtomic
    || exactApprovalAmountAtomic !== inputAmountAtomic
    || totalFeeAtomic === null || (session.originGasAtomic !== null && originGasAtomic === null)
    || !session.approvalSpender || !isAddress(session.approvalSpender, { strict: false })
    || getAddress(session.approvalSpender) !== getAddress(session.sourceSpokePool)
    || !session.totalFeeAsset || !isAddress(session.totalFeeAsset, { strict: false })
    || getAddress(session.totalFeeAsset) !== getAddress(session.sourceToken)
    || !expectedCompletionSeconds || session.settlementMode !== "asynchronous_fill"
    || session.refundOnOrigin !== true || session.partialFillsAllowed !== false
    || BigInt(protectedOutputAtomic) > BigInt(expectedOutputAtomic)
    || !fillDeadline || !quoteTimestamp || exclusivityParameter === null || session.message !== "0x"
    || !sourceSpokePoolRuntimeHash || !sourceSpokePoolImplementationRuntimeHash
    || !destinationSpokePoolRuntimeHash || !destinationSpokePoolImplementationRuntimeHash
    || !depositCalldataHash || session.depositValueAtomic !== "0"
    || !quoteExpiresAtMs || !createdAtMs || !updatedAtMs || updatedAtMs < createdAtMs
    || typeof session.quoteId !== "string" || !/^[A-Za-z0-9_-]{8,160}$/.test(session.quoteId)
    || !session.state || !(session.state in permittedTransitions)
    || sourceTxHash === undefined || destinationTxHash === undefined || refundTxHash === undefined
    || (session.depositId !== null && (typeof session.depositId !== "string" || !/^[0-9]{1,78}$/.test(session.depositId)))
    || (session.destinationOutputAtomic !== null && !canonicalAtomic(session.destinationOutputAtomic))
    || (session.failureCode !== null && (typeof session.failureCode !== "string" || !/^[a-z0-9_]{3,64}$/.test(session.failureCode)))
    || events.length === 0 || events.length !== session.events?.length || !eventHistoryValid
    || events.at(-1)?.state !== session.state || events.at(-1)?.observedAtMs !== updatedAtMs
  ) return null;
  return {
    schemaVersion: CROSS_CHAIN_FUNDING_SCHEMA_VERSION,
    sessionId,
    provider: "across",
    wallet: getAddress(session.wallet),
    sourceChainId: session.sourceChainId as AcrossFundingSourceChainId,
    destinationChainId: ROBINHOOD_MAINNET_CHAIN_ID,
    sourceToken: getAddress(session.sourceToken),
    destinationToken: getAddress(session.destinationToken),
    sourceSpokePool: getAddress(session.sourceSpokePool),
    destinationSpokePool: getAddress(session.destinationSpokePool),
    inputAmountAtomic,
    expectedOutputAtomic,
    protectedOutputAtomic,
    quoteTimestamp,
    refundChainId: session.refundChainId as AcrossFundingSourceChainId,
    refundToken: getAddress(session.refundToken),
    refundRecipient: getAddress(session.refundRecipient),
    fillDeadline,
    exclusiveRelayer: getAddress(session.exclusiveRelayer),
    exclusivityParameter,
    message: "0x",
    sourceSpokePoolRuntimeHash,
    sourceSpokePoolImplementation: getAddress(session.sourceSpokePoolImplementation),
    sourceSpokePoolImplementationRuntimeHash,
    destinationSpokePoolRuntimeHash,
    destinationSpokePoolImplementation: getAddress(session.destinationSpokePoolImplementation),
    destinationSpokePoolImplementationRuntimeHash,
    quoteId: session.quoteId,
    quoteExpiresAtMs,
    approvalSpender: getAddress(session.approvalSpender),
    exactApprovalAmountAtomic,
    totalFeeAtomic,
    totalFeeAsset: getAddress(session.totalFeeAsset),
    originGasAtomic,
    expectedCompletionSeconds,
    settlementMode: "asynchronous_fill",
    refundOnOrigin: true,
    partialFillsAllowed: false,
    depositCalldataHash,
    depositValueAtomic: "0",
    state: session.state,
    sourceTxHash,
    depositId: session.depositId ?? null,
    destinationTxHash,
    destinationOutputAtomic: session.destinationOutputAtomic ?? null,
    refundTxHash,
    failureCode: session.failureCode ?? null,
    createdAtMs,
    updatedAtMs,
    events: events.slice(-MAX_EVENTS)
  };
}

export function createCrossChainFundingSession(input: {
  sessionId: string;
  evidence: AcrossFundingEvidence;
  nowMs: number;
}) {
  if (!uuid(input.sessionId) || input.evidence.recipient !== input.evidence.depositor || input.evidence.refundRecipient !== input.evidence.recipient) {
    throw new Error("RMT rejected an invalid funding session identity.");
  }
  const session: CrossChainFundingSession = {
    schemaVersion: CROSS_CHAIN_FUNDING_SCHEMA_VERSION,
    sessionId: input.sessionId,
    provider: "across",
    wallet: input.evidence.recipient,
    sourceChainId: input.evidence.sourceChainId,
    destinationChainId: ROBINHOOD_MAINNET_CHAIN_ID,
    sourceToken: input.evidence.sourceToken,
    destinationToken: input.evidence.destinationToken,
    sourceSpokePool: input.evidence.sourceSpokePool,
    destinationSpokePool: input.evidence.destinationSpokePool,
    inputAmountAtomic: input.evidence.inputAmountAtomic,
    expectedOutputAtomic: input.evidence.expectedOutputAtomic,
    protectedOutputAtomic: input.evidence.protectedOutputAtomic,
    quoteTimestamp: input.evidence.quoteTimestamp,
    refundChainId: input.evidence.refundChainId,
    refundToken: input.evidence.refundToken,
    refundRecipient: input.evidence.refundRecipient,
    fillDeadline: input.evidence.fillDeadline,
    exclusiveRelayer: input.evidence.exclusiveRelayer,
    exclusivityParameter: input.evidence.exclusivityParameter,
    message: "0x",
    sourceSpokePoolRuntimeHash: input.evidence.sourceSpokePoolRuntimeHash,
    sourceSpokePoolImplementation: input.evidence.sourceSpokePoolImplementation,
    sourceSpokePoolImplementationRuntimeHash: input.evidence.sourceSpokePoolImplementationRuntimeHash,
    destinationSpokePoolRuntimeHash: input.evidence.destinationSpokePoolRuntimeHash,
    destinationSpokePoolImplementation: input.evidence.destinationSpokePoolImplementation,
    destinationSpokePoolImplementationRuntimeHash: input.evidence.destinationSpokePoolImplementationRuntimeHash,
    quoteId: input.evidence.quoteId,
    quoteExpiresAtMs: input.evidence.quoteExpiresAtMs,
    approvalSpender: input.evidence.approvalSpender,
    exactApprovalAmountAtomic: input.evidence.exactApprovalAmountAtomic,
    totalFeeAtomic: input.evidence.totalFeeAtomic,
    totalFeeAsset: input.evidence.totalFeeAsset,
    originGasAtomic: input.evidence.originGasAtomic,
    expectedCompletionSeconds: input.evidence.expectedCompletionSeconds,
    settlementMode: "asynchronous_fill",
    refundOnOrigin: true,
    partialFillsAllowed: false,
    depositCalldataHash: input.evidence.depositCalldataHash,
    depositValueAtomic: "0",
    state: "quote_ready",
    sourceTxHash: null,
    depositId: null,
    destinationTxHash: null,
    destinationOutputAtomic: null,
    refundTxHash: null,
    failureCode: null,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
    events: [{ state: "quote_ready", observedAtMs: input.nowMs, source: "rmt", detail: "Strict Across funding quote verified." }]
  };
  const normalized = normalizeCrossChainFundingSession(session);
  if (!normalized) throw new Error("RMT could not normalize the funding session.");
  return normalized;
}

function targetState(transition: CrossChainFundingTransition): CrossChainFundingState {
  return transition.type === "source_submission_requested" ? "source_submission_pending" : transition.type;
}

function eventSource(transition: CrossChainFundingTransition): CrossChainFundingEvent["source"] {
  if (transition.type === "source_submitted" || transition.type === "deposit_confirmed") return "source_chain";
  if (["bridging", "fill_pending", "expired", "refund_eligible", "refund_pending", "refunded"].includes(transition.type)) return "across_api";
  if (transition.type === "destination_confirmed" || transition.type === "completed") return "destination_chain";
  return "rmt";
}

function eventDetail(transition: CrossChainFundingTransition) {
  switch (transition.type) {
    case "source_submission_requested": return "Waiting for source-chain wallet authorization.";
    case "source_submitted": return "Source transaction submitted; destination funds are not yet available.";
    case "deposit_confirmed": return "Across deposit confirmed on the source chain.";
    case "bridging": return "Across funding is in flight.";
    case "fill_pending": return "Waiting for the verified destination fill.";
    case "destination_confirmed": return "Destination fill confirmed; reconciling the USDG balance.";
    case "completed": return "Destination USDG balance reconciled and available.";
    case "expired": return "Fill deadline expired before completion.";
    case "refund_eligible": return "The expired deposit is eligible for an origin-chain refund.";
    case "refund_pending": return "Refund processing is pending Across settlement.";
    case "refunded": return "Origin-chain refund confirmed.";
    case "failed": return "Funding failed before confirmed completion.";
    case "recovery_required": return "Automated reconciliation stopped; manual recovery review is required.";
  }
}

export function transitionCrossChainFundingSession(
  session: CrossChainFundingSession,
  transition: CrossChainFundingTransition,
  nowMs: number
) {
  const normalized = normalizeCrossChainFundingSession(session);
  if (!normalized || !timestamp(nowMs) || nowMs < normalized.updatedAtMs) throw new Error("RMT rejected invalid funding transition data.");
  const nextState = targetState(transition);
  if (normalized.state === nextState) return normalized;
  if (!permittedTransitions[normalized.state].includes(nextState)) {
    throw new Error(`RMT rejected invalid funding transition ${normalized.state} -> ${nextState}.`);
  }
  const next: CrossChainFundingSession = {
    ...normalized,
    state: nextState,
    updatedAtMs: nowMs,
    events: [...normalized.events, { state: nextState, observedAtMs: nowMs, source: eventSource(transition), detail: eventDetail(transition) }].slice(-MAX_EVENTS)
  };
  if (transition.type === "source_submitted") next.sourceTxHash = transition.sourceTxHash.toLowerCase() as Hash;
  if (transition.type === "deposit_confirmed") next.depositId = transition.depositId;
  if (transition.type === "destination_confirmed") {
    next.destinationTxHash = transition.destinationTxHash.toLowerCase() as Hash;
    next.destinationOutputAtomic = transition.destinationOutputAtomic;
  }
  if (transition.type === "refunded") {
    next.refundTxHash = transition.refundTxHash ? transition.refundTxHash.toLowerCase() as Hash : null;
  }
  if (transition.type === "failed" || transition.type === "recovery_required") next.failureCode = transition.failureCode;
  const result = normalizeCrossChainFundingSession(next);
  if (!result) throw new Error("RMT rejected an inconsistent funding transition result.");
  return result;
}

export function registerCrossChainFundingSourceSubmission(
  session: CrossChainFundingSession,
  sourceTxHash: Hash,
  nowMs: number
) {
  const normalized = normalizeCrossChainFundingSession(session);
  if (!normalized || !isHash(sourceTxHash) || !timestamp(nowMs)) {
    throw new Error("RMT rejected invalid source-submission recovery data.");
  }
  const transactionHash = sourceTxHash.toLowerCase() as Hash;
  if (normalized.sourceTxHash) {
    if (normalized.sourceTxHash !== transactionHash) throw new Error("Funding source transaction cannot be replaced.");
    return normalized;
  }
  let next = normalized;
  let observedAtMs = Math.max(nowMs, normalized.updatedAtMs + 1);
  if (next.state === "quote_ready") {
    next = transitionCrossChainFundingSession(next, { type: "source_submission_requested" }, observedAtMs);
    observedAtMs += 1;
  }
  if (next.state !== "source_submission_pending") {
    throw new Error("Funding session is not awaiting a source transaction.");
  }
  return transitionCrossChainFundingSession(next, { type: "source_submitted", sourceTxHash: transactionHash }, observedAtMs);
}

export function availableCrossChainFundingOutput(session: CrossChainFundingSession) {
  return session.state === "completed" && session.destinationOutputAtomic ? session.destinationOutputAtomic : "0";
}

export function pendingCrossChainFundingOutput(session: CrossChainFundingSession) {
  return ["source_submitted", "deposit_confirmed", "bridging", "fill_pending", "destination_confirmed"].includes(session.state)
    ? session.protectedOutputAtomic
    : "0";
}

export function crossChainFundingDisclosure(session: CrossChainFundingSession) {
  const normalized = normalizeCrossChainFundingSession(session);
  if (!normalized) throw new Error("RMT rejected an invalid funding disclosure session.");
  return {
    provider: normalized.provider,
    currentState: normalized.state,
    sourceChainId: normalized.sourceChainId,
    sourceToken: normalized.sourceToken,
    inputAmountAtomic: normalized.inputAmountAtomic,
    destinationChainId: normalized.destinationChainId,
    destinationToken: normalized.destinationToken,
    expectedOutputAtomic: normalized.expectedOutputAtomic,
    protectedOutputAtomic: normalized.protectedOutputAtomic,
    recipient: normalized.wallet,
    approvalSpender: normalized.approvalSpender,
    exactApprovalAmountAtomic: normalized.exactApprovalAmountAtomic,
    totalFeeAtomic: normalized.totalFeeAtomic,
    totalFeeAsset: normalized.totalFeeAsset,
    originGasAtomic: normalized.originGasAtomic,
    expectedCompletionSeconds: normalized.expectedCompletionSeconds,
    quoteExpiresAtMs: normalized.quoteExpiresAtMs,
    asynchronousSettlement: true,
    fundsAvailableOnlyAfterDestinationConfirmation: true,
    partialFillsAllowed: false,
    refundOnOrigin: true,
    refundAsset: normalized.refundToken,
    refundChainId: normalized.refundChainId,
    refundRecipient: normalized.refundRecipient,
    pendingOutputAtomic: pendingCrossChainFundingOutput(normalized),
    availableOutputAtomic: availableCrossChainFundingOutput(normalized)
  } as const;
}

export function crossChainFundingProofRecord(session: CrossChainFundingSession) {
  const normalized = normalizeCrossChainFundingSession(session);
  if (!normalized) throw new Error("RMT rejected an invalid funding proof session.");
  const observedAt = (state: CrossChainFundingState) =>
    normalized.events.find((event) => event.state === state)?.observedAtMs ?? null;
  const sourceSubmittedAtMs = observedAt("source_submitted");
  const destinationConfirmedAtMs = observedAt("destination_confirmed");
  const completedAtMs = observedAt("completed");
  const refundedAtMs = observedAt("refunded");
  const terminalAtMs = completedAtMs ?? refundedAtMs;
  return {
    schemaVersion: CROSS_CHAIN_FUNDING_SCHEMA_VERSION,
    proofKind: "cross_chain_funding_lifecycle",
    proofStatus: normalized.state === "completed"
      ? "completed"
      : normalized.state === "refunded"
        ? "refunded"
        : "incomplete",
    provider: normalized.provider,
    sessionId: normalized.sessionId,
    quoteId: normalized.quoteId,
    wallet: normalized.wallet,
    source: {
      chainId: normalized.sourceChainId,
      token: normalized.sourceToken,
      spokePool: normalized.sourceSpokePool,
      spokePoolRuntimeHash: normalized.sourceSpokePoolRuntimeHash,
      implementation: normalized.sourceSpokePoolImplementation,
      implementationRuntimeHash: normalized.sourceSpokePoolImplementationRuntimeHash,
      inputAmountAtomic: normalized.inputAmountAtomic,
      transactionHash: normalized.sourceTxHash,
      depositTransactionDataHash: normalized.depositCalldataHash,
      depositValueAtomic: normalized.depositValueAtomic,
      depositId: normalized.depositId
    },
    destination: {
      chainId: normalized.destinationChainId,
      token: normalized.destinationToken,
      spokePool: normalized.destinationSpokePool,
      spokePoolRuntimeHash: normalized.destinationSpokePoolRuntimeHash,
      implementation: normalized.destinationSpokePoolImplementation,
      implementationRuntimeHash: normalized.destinationSpokePoolImplementationRuntimeHash,
      expectedOutputAtomic: normalized.expectedOutputAtomic,
      protectedOutputAtomic: normalized.protectedOutputAtomic,
      realizedOutputAtomic: normalized.destinationOutputAtomic,
      transactionHash: normalized.destinationTxHash
    },
    economics: {
      totalFeeAtomic: normalized.totalFeeAtomic,
      totalFeeAsset: normalized.totalFeeAsset,
      originGasAtomic: normalized.originGasAtomic,
      expectedCompletionSeconds: normalized.expectedCompletionSeconds,
      settlementMode: normalized.settlementMode,
      partialFillsAllowed: normalized.partialFillsAllowed
    },
    refund: {
      chainId: normalized.refundChainId,
      token: normalized.refundToken,
      recipient: normalized.refundRecipient,
      onOrigin: normalized.refundOnOrigin,
      transactionHash: normalized.refundTxHash
    },
    timing: {
      quoteTimestamp: normalized.quoteTimestamp,
      quoteExpiresAtMs: normalized.quoteExpiresAtMs,
      fillDeadline: normalized.fillDeadline,
      sourceSubmittedAtMs,
      destinationConfirmedAtMs,
      completedAtMs,
      refundedAtMs,
      realizedCompletionMs: sourceSubmittedAtMs !== null && terminalAtMs !== null
        ? terminalAtMs - sourceSubmittedAtMs
        : null
    },
    availability: {
      pendingOutputAtomic: pendingCrossChainFundingOutput(normalized),
      availableOutputAtomic: availableCrossChainFundingOutput(normalized)
    },
    currentState: normalized.state,
    failureCode: normalized.failureCode,
    lifecycle: normalized.events.map((event) => ({ ...event })),
    recordedAtMs: normalized.updatedAtMs,
    serverSubmittedFunds: false
  } as const;
}

function targetStorage(storage?: CrossChainFundingStorage) {
  if (storage) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

export function normalizeCrossChainFundingJournal(value: unknown, nowMs = Date.now()) {
  if (!Array.isArray(value)) return [] as CrossChainFundingSession[];
  const sessions = new Map<string, CrossChainFundingSession>();
  for (const valueSession of value) {
    const session = normalizeCrossChainFundingSession(valueSession);
    if (!session || nowMs - session.updatedAtMs > SESSION_RETENTION_MS) continue;
    const existing = sessions.get(session.sessionId);
    if (!existing || session.updatedAtMs > existing.updatedAtMs) sessions.set(session.sessionId, session);
  }
  return [...sessions.values()].sort((left, right) => right.updatedAtMs - left.updatedAtMs).slice(0, MAX_SESSIONS);
}

export function readCrossChainFundingJournal(storage?: CrossChainFundingStorage, nowMs = Date.now()) {
  const target = targetStorage(storage);
  if (!target) return [] as CrossChainFundingSession[];
  try {
    return normalizeCrossChainFundingJournal(JSON.parse(target.getItem(CROSS_CHAIN_FUNDING_STORAGE_KEY) || "[]"), nowMs);
  } catch {
    return [] as CrossChainFundingSession[];
  }
}

export function writeCrossChainFundingSession(session: CrossChainFundingSession, storage?: CrossChainFundingStorage, nowMs = Date.now()) {
  const target = targetStorage(storage);
  const normalized = normalizeCrossChainFundingSession(session);
  if (!target || !normalized) return false;
  const current = readCrossChainFundingJournal(storage, nowMs);
  const next = normalizeCrossChainFundingJournal([normalized, ...current.filter((item) => item.sessionId !== normalized.sessionId)], nowMs);
  try {
    target.setItem(CROSS_CHAIN_FUNDING_STORAGE_KEY, JSON.stringify(next));
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CROSS_CHAIN_FUNDING_CHANGED_EVENT, { detail: next }));
    return true;
  } catch {
    return false;
  }
}

export function unresolvedCrossChainFunding(wallet: string, storage?: CrossChainFundingStorage, nowMs = Date.now()) {
  if (!isAddress(wallet, { strict: false })) return [];
  const normalizedWallet = getAddress(wallet);
  return readCrossChainFundingJournal(storage, nowMs).filter((session) =>
    session.wallet === normalizedWallet && !["completed", "refunded", "failed"].includes(session.state)
  );
}
