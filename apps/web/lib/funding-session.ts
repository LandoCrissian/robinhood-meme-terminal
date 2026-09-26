import { getAddress, isAddress } from "viem";

export const RMT_FUNDING_CHAIN_ID = 4_663 as const;

export type RmtFundingStatus =
  | "NOT_SUBMITTED"
  | "SUBMITTED_PENDING"
  | "DELIVERED"
  | "FAILED"
  | "CANCELLED"
  | "UNKNOWN";

export type RmtFundingSession = {
  version: 1;
  destination: `0x${string}`;
  chainId: typeof RMT_FUNDING_CHAIN_ID;
  asset: `0x${string}`;
  status: RmtFundingStatus;
  method?: "fiat" | "crypto";
  providerStatus?: "submitted" | "confirmed" | "completed";
  balanceIncreaseObservedAt?: number;
  initialBalanceAtomic: string;
  startedAt: number;
  updatedAt: number;
};

export type RmtFundingBinding = Pick<RmtFundingSession, "destination" | "chainId" | "asset">;

type AddFundsResult =
  | { method: "fiat"; status: "submitted" | "confirmed" }
  | { method: "crypto"; status: "completed" };

const TOKEN_ADDRESS = /^0x[0-9a-f]{40}$/i;
const STATUS = new Set<RmtFundingStatus>([
  "NOT_SUBMITTED",
  "SUBMITTED_PENDING",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN"
]);

function canonicalFundingBinding(input: { destination: string; chainId: number; asset: string }): RmtFundingBinding {
  if (input.chainId !== RMT_FUNDING_CHAIN_ID) throw new Error("Funding requires Robinhood Chain 4663.");
  if (!isAddress(input.destination, { strict: false })) throw new Error("Funding requires an exact destination address.");
  if (!TOKEN_ADDRESS.test(input.asset)) throw new Error("Funding requires an exact destination asset.");
  return {
    destination: getAddress(input.destination),
    chainId: RMT_FUNDING_CHAIN_ID,
    asset: getAddress(input.asset)
  };
}

export function fundingSessionStorageKey(input: { destination: string; chainId: number; asset: string }) {
  const binding = canonicalFundingBinding(input);
  return `rmt:funding:v1:${binding.chainId}:${binding.destination.toLowerCase()}:${binding.asset.toLowerCase()}`;
}

export function createFundingSession(input: {
  destination: string;
  asset: string;
  initialBalanceAtomic: bigint;
  now?: number;
}): RmtFundingSession {
  if (typeof input.initialBalanceAtomic !== "bigint" || input.initialBalanceAtomic < 0n) {
    throw new Error("Funding requires an exact destination asset balance baseline.");
  }
  const binding = canonicalFundingBinding({
    destination: input.destination,
    chainId: RMT_FUNDING_CHAIN_ID,
    asset: input.asset
  });
  const now = input.now ?? Date.now();
  return {
    version: 1,
    ...binding,
    status: "NOT_SUBMITTED",
    initialBalanceAtomic: input.initialBalanceAtomic.toString(),
    startedAt: now,
    updatedAt: now
  };
}

export function recordFundingResult(session: RmtFundingSession, result: AddFundsResult, now = Date.now()): RmtFundingSession {
  // Provider acceptance is not destination settlement. Delivery is established
  // only by a later balance observation at the exact destination.
  return {
    ...session,
    method: result.method,
    providerStatus: result.status,
    status: "SUBMITTED_PENDING",
    updatedAt: now
  };
}

export function recordFundingCheckoutOpened(session: RmtFundingSession, now = Date.now()): RmtFundingSession {
  // Once provider UI is opened, RMT cannot prove that no payment was submitted
  // merely because the browser reloads or the SDK promise never settles.
  return { ...session, status: "UNKNOWN", updatedAt: now };
}

export function classifyFundingFailure(error: unknown): { status: "FAILED" | "CANCELLED" | "UNKNOWN"; message: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/cancel|closed|exited|dismiss/i.test(message)) return {
    status: "CANCELLED",
    message: "The funding window closed before Privy returned a submission. Check the destination balance before starting another deposit."
  };
  if (/not authenticated|unauthenticated|login|unsupported|not available|no.*route/i.test(message)) return {
    status: "FAILED",
    message: /login|authenticated/i.test(message)
      ? "Your session expired before funding started. Sign in again and retry."
      : "No supported provider route is available for this asset, device, or region. Direct receive remains available."
  };
  if (/already.*progress|in progress/i.test(message)) return {
    status: "UNKNOWN",
    message: "A funding flow may already be in progress. Reconcile the destination balance before opening another one."
  };
  return {
    status: "UNKNOWN",
    message: "Privy did not return a final funding state. Reconcile the destination balance before trying again."
  };
}

export function recordFundingFailure(session: RmtFundingSession, error: unknown, now = Date.now()) {
  const failure = classifyFundingFailure(error);
  // Once provider UI has opened, an SDK rejection or error string cannot prove
  // that no external payment was submitted. Preserve unresolved authority until
  // exact destination evidence or provider support establishes a final outcome.
  const status = session.status === "NOT_SUBMITTED"
    ? failure.status
    : failure.status === "CANCELLED"
      ? "CANCELLED"
      : "UNKNOWN";
  return {
    session: { ...session, status, updatedAt: now } satisfies RmtFundingSession,
    message: failure.message
  };
}

export function reconcileFundingSession(session: RmtFundingSession, currentBalanceAtomic: bigint | undefined, now = Date.now()) {
  if (!fundingSessionNeedsReconciliation(session) || currentBalanceAtomic === undefined) return session;
  if (currentBalanceAtomic <= BigInt(session.initialBalanceAtomic)) return session;
  const providerFinal = session.providerStatus === "confirmed" || session.providerStatus === "completed";
  if (session.balanceIncreaseObservedAt !== undefined && !providerFinal) return session;
  return {
    ...session,
    balanceIncreaseObservedAt: session.balanceIncreaseObservedAt ?? now,
    status: providerFinal ? "DELIVERED" : session.status,
    updatedAt: now
  } satisfies RmtFundingSession;
}

export function fundingSessionNeedsReconciliation(session: RmtFundingSession | undefined) {
  return session?.status === "SUBMITTED_PENDING" || session?.status === "UNKNOWN" || session?.status === "CANCELLED";
}

export function parseFundingSession(
  value: string | null,
  expected: { destination: string; chainId: number; asset: string }
): RmtFundingSession | undefined {
  if (!value) return undefined;
  try {
    const binding = canonicalFundingBinding(expected);
    const parsed = JSON.parse(value) as Partial<RmtFundingSession>;
    if (
      parsed.version !== 1
      || parsed.chainId !== binding.chainId
      || !parsed.destination
      || getAddress(parsed.destination) !== binding.destination
      || !parsed.asset
      || !TOKEN_ADDRESS.test(parsed.asset)
      || getAddress(parsed.asset) !== binding.asset
      || !parsed.status
      || !STATUS.has(parsed.status)
      || typeof parsed.startedAt !== "number"
      || typeof parsed.updatedAt !== "number"
      || typeof parsed.initialBalanceAtomic !== "string"
      || !/^\d+$/.test(parsed.initialBalanceAtomic)
    ) return undefined;
    return parsed as RmtFundingSession;
  } catch {
    return undefined;
  }
}
