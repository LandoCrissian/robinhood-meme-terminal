import { z } from "zod";
import { sameInjectedPreferenceWallet } from "../injected-signer-preference";
import type { VNextExecutionRecord } from "./execution-recovery";

export const tradeJourneyPhases = [
  "IDENTITY_PENDING", "IDENTITY_UNAVAILABLE", "QUOTE_NOT_REQUESTED", "QUOTE_REQUESTING",
  "QUOTE_SERVICE_UNAVAILABLE", "ZEROX_NO_ROUTE", "ZEROX_PROVIDER_UNAVAILABLE", "ZEROX_POLICY_REJECTED",
  "FIRM_VERIFY_FAILED", "SIMULATION_FAILED", "AUTHORIZATION_FAILED", "ROUTE_READY", "QUOTE_EXPIRED",
  "APPROVAL_REQUIRED", "APPROVAL_PENDING", "APPROVAL_CONFIRMED", "SWAP_READY", "SWAP_PENDING",
  "SETTLEMENT_PENDING", "SWAP_SETTLED", "USER_REJECTED", "UNRESOLVED"
] as const;
export type TradeJourneyPhase = typeof tradeJourneyPhases[number];
export function tradeJourneyPhase(value: unknown): TradeJourneyPhase | undefined {
  return typeof value === "string" && (tradeJourneyPhases as readonly string[]).includes(value) ? value as TradeJourneyPhase : undefined;
}
export class TradeJourneyError extends Error {
  constructor(readonly phase: TradeJourneyPhase, message: string) { super(message); }
}
export function failureJourneyPhase(error: unknown, fallback: TradeJourneyPhase): TradeJourneyPhase {
  return tradeJourneyPhase(error && typeof error === "object" && "phase" in error ? error.phase : undefined) ?? fallback;
}
export const tradeJourneyLabels: Record<TradeJourneyPhase, string> = {
  IDENTITY_PENDING: "Verifying token...", IDENTITY_UNAVAILABLE: "Token verification temporarily unavailable",
  QUOTE_NOT_REQUESTED: "Quote not requested", QUOTE_REQUESTING: "Finding best route...",
  QUOTE_SERVICE_UNAVAILABLE: "Quote service temporarily unavailable", ZEROX_NO_ROUTE: "No 0x route currently available",
  ZEROX_PROVIDER_UNAVAILABLE: "Route provider temporarily unavailable", ZEROX_POLICY_REJECTED: "0x response rejected by execution policy",
  FIRM_VERIFY_FAILED: "Firm quote verification failed", SIMULATION_FAILED: "Transaction simulation failed",
  AUTHORIZATION_FAILED: "Exact wallet request verification failed", ROUTE_READY: "Route ready", QUOTE_EXPIRED: "Refreshing quote...",
  APPROVAL_REQUIRED: "Exact approval required", APPROVAL_PENDING: "Waiting for wallet approval",
  APPROVAL_CONFIRMED: "Approval confirmed. Preparing swap", SWAP_READY: "Swap ready",
  SWAP_PENDING: "Waiting for wallet swap confirmation", SETTLEMENT_PENDING: "Verifying swap settlement",
  SWAP_SETTLED: "Swap settled", USER_REJECTED: "Wallet request rejected", UNRESOLVED: "Wallet request unresolved"
};

/** Whitelisted operational fields only: never messages, accounts, URLs, payloads or provider bodies. */
export function emitTradeJourney(input: {
  phase: TradeJourneyPhase; quoteRequestAttempted?: boolean; providerRequestAttempted?: boolean;
  approvalRequired?: boolean; approvalHashAvailable?: boolean; quoteRefreshedAfterApproval?: boolean; retry?: number;
}) {
  const phase = tradeJourneyPhase(input.phase);
  if (!phase) return;
  console.info(JSON.stringify({ event: "rmt_trade_journey", phase,
    ...(typeof input.quoteRequestAttempted === "boolean" ? { quoteRequestAttempted: input.quoteRequestAttempted } : {}),
    ...(typeof input.providerRequestAttempted === "boolean" ? { providerRequestAttempted: input.providerRequestAttempted } : {}),
    ...(typeof input.approvalRequired === "boolean" ? { approvalRequired: input.approvalRequired } : {}),
    ...(typeof input.approvalHashAvailable === "boolean" ? { approvalHashAvailable: input.approvalHashAvailable } : {}),
    ...(typeof input.quoteRefreshedAfterApproval === "boolean" ? { quoteRefreshedAfterApproval: input.quoteRefreshedAfterApproval } : {}),
    ...(Number.isInteger(input.retry) && input.retry! >= 0 && input.retry! < 4 ? { retry: input.retry } : {}) }));
}

export function observedZeroXPhase(attempts: readonly { provider: string; status: string }[]): TradeJourneyPhase {
  const attempt = attempts.find((entry) => entry.provider === "zero-x-swap");
  if (!attempt) return "QUOTE_NOT_REQUESTED";
  if (attempt.status === "indicative") return "ROUTE_READY";
  if (attempt.status === "no_route") return "ZEROX_NO_ROUTE";
  if (attempt.status === "invalid_response") return "ZEROX_POLICY_REJECTED";
  return "ZEROX_PROVIDER_UNAVAILABLE";
}

const RETRYABLE = new Set<TradeJourneyPhase>(["IDENTITY_UNAVAILABLE", "QUOTE_SERVICE_UNAVAILABLE", "ZEROX_PROVIDER_UNAVAILABLE", "QUOTE_EXPIRED"]);
/** Retry fresh read-only work, never a wallet request, stale quote or failed invariant. */
export async function revalidateAfterApproval<T>(options: {
  attempt: () => Promise<T>; current: () => boolean; onRetry: (phase: TradeJourneyPhase, retry: number) => void;
  wait?: (ms: number) => Promise<void>;
}) {
  for (let retry = 0; retry < 4; retry++) {
    if (!options.current()) throw new TradeJourneyError("UNRESOLVED", "Trading context changed. No new wallet request was sent.");
    try { return await options.attempt(); }
    catch (error) {
      const phase = failureJourneyPhase(error, "AUTHORIZATION_FAILED");
      if (!RETRYABLE.has(phase) || retry === 3 || !options.current()) throw error;
      options.onRetry(phase, retry + 1);
      await (options.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))([1500, 4000, 8000][retry]);
    }
  }
  throw new TradeJourneyError("UNRESOLVED", "Post-approval reconciliation exhausted.");
}

export const PENDING_APPROVAL_JOURNEY_KEY = "rmt:pending-approval-journey:v1:4663";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const address = z.string().regex(/^0x[0-9a-f]{40}$/i);
const schema = z.object({
  version: z.literal(1), chainId: z.literal(4663), userId: z.string().min(1).max(256), wallet: address,
  walletKey: z.string().min(1).max(512), marketAddress: address, side: z.enum(["buy", "sell"]),
  amount: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/).max(160),
  buyInputKey: z.string().max(180).optional(), sellOutputKey: z.string().max(180),
  inputAsset: address, outputAsset: address, inputAmountAtomic: z.string().regex(/^[1-9][0-9]*$/).max(78),
  approvalPlanId: z.string().uuid(), approvalPayloadHash: z.string().regex(/^0x[0-9a-f]{64}$/i),
  approvalTxHash: z.string().regex(/^0x[0-9a-f]{64}$/i).optional(),
  createdAtMs: z.number().int().nonnegative(), expiresAtMs: z.number().int().positive()
}).strict();
export type PendingApprovalJourney = z.infer<typeof schema>;
function sessionStorage(): StorageLike | undefined { try { return typeof window === "undefined" ? undefined : window.sessionStorage; } catch { return undefined; } }
export function readPendingApprovalJourney(storage = sessionStorage(), now = Date.now()): PendingApprovalJourney | null {
  try {
    const raw = storage?.getItem(PENDING_APPROVAL_JOURNEY_KEY);
    if (!raw || raw.length > 3000) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.createdAtMs > now || parsed.data.expiresAtMs <= now
      || parsed.data.expiresAtMs - parsed.data.createdAtMs > 10 * 60_000) return null;
    return parsed.data;
  } catch { return null; }
}
export function savePendingApprovalJourney(value: PendingApprovalJourney, storage = sessionStorage()) {
  try { const parsed = schema.parse(value); storage?.setItem(PENDING_APPROVAL_JOURNEY_KEY, JSON.stringify(parsed)); } catch { /* Storage is not execution authority. */ }
}
export function clearPendingApprovalJourney(storage = sessionStorage()) { try { storage?.removeItem(PENDING_APPROVAL_JOURNEY_KEY); } catch { /* No fallback authority. */ } }
export function pendingApprovalWalletMatches(pending: PendingApprovalJourney, context: { userId: string; wallet?: string; walletKey: string | null; chainId?: number }) {
  return pending.userId === context.userId && pending.wallet.toLowerCase() === context.wallet?.toLowerCase() && context.chainId === 4663
    && (pending.walletKey === context.walletKey || sameInjectedPreferenceWallet(pending.walletKey, context.walletKey));
}
export function pendingApprovalRecordMatches(pending: PendingApprovalJourney | null, record: VNextExecutionRecord | null | undefined) {
  return Boolean(pending && record && record.provider === "zero-x-swap" && record.kind === "erc20_approval" && record.state === "confirmed"
    && record.chainId === 4663 && record.wallet.toLowerCase() === pending.wallet.toLowerCase()
    && record.planId === pending.approvalPlanId && record.payloadHash.toLowerCase() === pending.approvalPayloadHash.toLowerCase()
    && record.inputAsset.toLowerCase() === pending.inputAsset.toLowerCase() && record.outputAsset.toLowerCase() === pending.outputAsset.toLowerCase()
    && record.inputAmountAtomic === pending.inputAmountAtomic
    && (!pending.approvalTxHash || pending.approvalTxHash.toLowerCase() === record.txHash.toLowerCase()));
}
