import type { Address, Hash } from "viem";

export const TRADE_EXECUTION_SCHEMA_VERSION = 1;
export const TRADE_EXECUTION_STORAGE_KEY = "rmt:trade-execution-journal:v1:4663";
export const TRADE_EXECUTION_EVENT = "rmt:trade-execution-changed";

const ROBINHOOD_CHAIN_ID = 4663 as const;
const MAXIMUM_RECORDS = 24;
const RECOVERABLE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const HISTORY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export type TradeExecutionVenue = "sushi" | "uniswap-v3" | "uniswap-v4";
export type TradeExecutionSide = "buy" | "sell";
export type TradeExecutionState = "submitted" | "confirmed" | "failed";
export type TradeExecutionFailureCode =
  | "user-rejected"
  | "insufficient-funds"
  | "slippage"
  | "allowance"
  | "route-unavailable"
  | "simulation-failed"
  | "network"
  | "nonce-or-duplicate"
  | "reverted"
  | "unknown";

export type TradeExecutionFailure = {
  code: TradeExecutionFailureCode;
  title: string;
  detail: string;
  action: string;
  retryable: boolean;
};

export type TradeExecutionRecord = {
  schemaVersion: typeof TRADE_EXECUTION_SCHEMA_VERSION;
  chainId: typeof ROBINHOOD_CHAIN_ID;
  id: string;
  wallet: Address;
  token: Address;
  pair: string;
  venue: TradeExecutionVenue;
  side: TradeExecutionSide;
  amountIn: string;
  state: TradeExecutionState;
  txHash: Hash;
  createdAt: number;
  updatedAt: number;
  recoveredAt?: number;
  failureCode?: TradeExecutionFailureCode;
};

export type TradeExecutionStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type TradeExecutionIdentity = Pick<TradeExecutionRecord, "wallet" | "token" | "pair" | "venue" | "side">;

type SubmittedTradeInput = TradeExecutionIdentity & {
  amountIn: string;
  txHash: Hash;
};

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HASH = /^0x[0-9a-f]{64}$/;
const POOL_IDENTIFIER = /^(?:0x[0-9a-f]{40}|0x[0-9a-f]{64})$/;
const VENUES = new Set<TradeExecutionVenue>(["sushi", "uniswap-v3", "uniswap-v4"]);
const SIDES = new Set<TradeExecutionSide>(["buy", "sell"]);
const STATES = new Set<TradeExecutionState>(["submitted", "confirmed", "failed"]);
const FAILURE_CODES = new Set<TradeExecutionFailureCode>([
  "user-rejected",
  "insufficient-funds",
  "slippage",
  "allowance",
  "route-unavailable",
  "simulation-failed",
  "network",
  "nonce-or-duplicate",
  "reverted",
  "unknown"
]);

function browserStorage(storage?: TradeExecutionStorage) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function normalizeAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS.test(normalized) ? normalized as Address : null;
}

function normalizePair(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return POOL_IDENTIFIER.test(normalized) ? normalized : null;
}

function normalizeHash(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return HASH.test(normalized) ? normalized as Hash : null;
}

function normalizeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeRecord(value: unknown): TradeExecutionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<TradeExecutionRecord>;
  const wallet = normalizeAddress(candidate.wallet);
  const token = normalizeAddress(candidate.token);
  const pair = normalizePair(candidate.pair);
  const txHash = normalizeHash(candidate.txHash);
  const createdAt = normalizeTimestamp(candidate.createdAt);
  const updatedAt = normalizeTimestamp(candidate.updatedAt);
  const venue = VENUES.has(candidate.venue as TradeExecutionVenue)
    ? candidate.venue as TradeExecutionVenue
    : null;
  const side = SIDES.has(candidate.side as TradeExecutionSide)
    ? candidate.side as TradeExecutionSide
    : null;
  const state = STATES.has(candidate.state as TradeExecutionState)
    ? candidate.state as TradeExecutionState
    : null;
  const failureCode = candidate.failureCode && FAILURE_CODES.has(candidate.failureCode)
    ? candidate.failureCode
    : undefined;
  if (
    candidate.schemaVersion !== TRADE_EXECUTION_SCHEMA_VERSION
    || candidate.chainId !== ROBINHOOD_CHAIN_ID
    || !wallet
    || !token
    || !pair
    || !txHash
    || !createdAt
    || !updatedAt
    || !venue
    || !side
    || !state
    || typeof candidate.amountIn !== "string"
    || !/^\d+$/.test(candidate.amountIn)
  ) return null;
  const id = tradeExecutionRecordId({ wallet, token, pair, venue, side });
  const recoveredAt = normalizeTimestamp(candidate.recoveredAt);
  return {
    schemaVersion: TRADE_EXECUTION_SCHEMA_VERSION,
    chainId: ROBINHOOD_CHAIN_ID,
    id,
    wallet,
    token,
    pair,
    venue,
    side,
    amountIn: candidate.amountIn,
    state,
    txHash,
    createdAt,
    updatedAt,
    ...(recoveredAt ? { recoveredAt } : {}),
    ...(failureCode ? { failureCode } : {})
  };
}

function pruneRecords(records: TradeExecutionRecord[], now: number) {
  return records
    .filter((record) => now - record.updatedAt <= HISTORY_MAX_AGE_MS)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAXIMUM_RECORDS);
}

function emitJournalChange(records: TradeExecutionRecord[]) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TRADE_EXECUTION_EVENT, { detail: records }));
}

function storeRecords(records: TradeExecutionRecord[], storage?: TradeExecutionStorage, now = Date.now()) {
  const target = browserStorage(storage);
  if (!target) return false;
  try {
    const normalized = pruneRecords(records, now);
    target.setItem(TRADE_EXECUTION_STORAGE_KEY, JSON.stringify(normalized));
    emitJournalChange(normalized);
    return true;
  } catch {
    return false;
  }
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    const candidate = error as Error & { shortMessage?: unknown; details?: unknown; code?: unknown; cause?: unknown };
    return [candidate.shortMessage, candidate.message, candidate.details, candidate.code, candidate.cause]
      .filter((value) => value !== undefined && value !== null)
      .map(String)
      .join(" ");
  }
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    return [candidate.shortMessage, candidate.message, candidate.details, candidate.code, candidate.reason]
      .filter((value) => value !== undefined && value !== null)
      .map(String)
      .join(" ");
  }
  return String(error ?? "");
}

function failure(
  code: TradeExecutionFailureCode,
  title: string,
  detail: string,
  action: string,
  retryable: boolean
): TradeExecutionFailure {
  return { code, title, detail, action, retryable };
}

export function tradeExecutionRecordId(identity: TradeExecutionIdentity) {
  return [
    identity.wallet.toLowerCase(),
    identity.token.toLowerCase(),
    identity.pair.toLowerCase(),
    identity.venue,
    identity.side
  ].join(":");
}

export function normalizeTradeExecutionJournal(value: unknown, now = Date.now()) {
  if (!Array.isArray(value)) return [] as TradeExecutionRecord[];
  const unique = new Map<string, TradeExecutionRecord>();
  for (const candidate of value) {
    const record = normalizeRecord(candidate);
    if (!record) continue;
    const existing = unique.get(record.id);
    if (!existing || record.updatedAt > existing.updatedAt) unique.set(record.id, record);
  }
  return pruneRecords([...unique.values()], now);
}

export function readTradeExecutionJournal(storage?: TradeExecutionStorage, now = Date.now()) {
  const target = browserStorage(storage);
  if (!target) return [] as TradeExecutionRecord[];
  try {
    return normalizeTradeExecutionJournal(JSON.parse(target.getItem(TRADE_EXECUTION_STORAGE_KEY) || "[]"), now);
  } catch {
    return [] as TradeExecutionRecord[];
  }
}

export function recordSubmittedTrade(input: SubmittedTradeInput, storage?: TradeExecutionStorage, now = Date.now()) {
  const wallet = normalizeAddress(input.wallet);
  const token = normalizeAddress(input.token);
  const pair = normalizePair(input.pair);
  const txHash = normalizeHash(input.txHash);
  if (
    !wallet
    || !token
    || !pair
    || !txHash
    || !VENUES.has(input.venue)
    || !SIDES.has(input.side)
    || !/^\d+$/.test(input.amountIn)
  ) return null;
  const id = tradeExecutionRecordId({ wallet, token, pair, venue: input.venue, side: input.side });
  const current = readTradeExecutionJournal(storage, now).filter((record) => record.id !== id);
  const record: TradeExecutionRecord = {
    schemaVersion: TRADE_EXECUTION_SCHEMA_VERSION,
    chainId: ROBINHOOD_CHAIN_ID,
    id,
    wallet,
    token,
    pair,
    venue: input.venue,
    side: input.side,
    amountIn: input.amountIn,
    state: "submitted",
    txHash,
    createdAt: now,
    updatedAt: now
  };
  return storeRecords([record, ...current], storage, now) ? record : null;
}

export function findRecoverableTrade(identity: TradeExecutionIdentity, storage?: TradeExecutionStorage, now = Date.now()) {
  const id = tradeExecutionRecordId(identity);
  const record = readTradeExecutionJournal(storage, now).find((candidate) => candidate.id === id);
  if (!record || record.state !== "submitted" || now - record.createdAt > RECOVERABLE_MAX_AGE_MS) return null;
  if (record.recoveredAt === undefined) {
    updateTradeExecutionRecord(record.id, { recoveredAt: now }, storage, now);
  }
  return { ...record, recoveredAt: record.recoveredAt ?? now };
}

export function updateTradeExecutionRecord(
  id: string,
  update: Partial<Pick<TradeExecutionRecord, "state" | "failureCode" | "recoveredAt">>,
  storage?: TradeExecutionStorage,
  now = Date.now()
) {
  const current = readTradeExecutionJournal(storage, now);
  const record = current.find((candidate) => candidate.id === id);
  if (!record) return null;
  const next: TradeExecutionRecord = {
    ...record,
    ...update,
    updatedAt: now
  };
  return storeRecords([next, ...current.filter((candidate) => candidate.id !== id)], storage, now)
    ? next
    : null;
}

export function markTradeExecutionConfirmed(id: string, storage?: TradeExecutionStorage, now = Date.now()) {
  return updateTradeExecutionRecord(id, { state: "confirmed", failureCode: undefined }, storage, now);
}

export function markTradeExecutionFailed(
  id: string,
  failureCode: TradeExecutionFailureCode,
  storage?: TradeExecutionStorage,
  now = Date.now()
) {
  return updateTradeExecutionRecord(id, { state: "failed", failureCode }, storage, now);
}

export function classifyTradeExecutionError(error: unknown): TradeExecutionFailure {
  const text = errorText(error).toLowerCase();
  if (/user rejected|user denied|rejected the request|request rejected|action_rejected|code.?4001|denied transaction/.test(text)) {
    return failure(
      "user-rejected",
      "Wallet request was declined",
      "Nothing was submitted to Robinhood Chain.",
      "Review the order and open the wallet again when you are ready.",
      true
    );
  }
  if (/insufficient funds|insufficient balance|exceeds balance|not enough funds|funds for gas|insufficient native/.test(text)) {
    return failure(
      "insufficient-funds",
      "Balance cannot cover this order",
      "The wallet does not have enough input asset or native ETH for the transaction and network reserve.",
      "Reduce the order or fund the wallet, then request a fresh quote.",
      true
    );
  }
  if (/slippage|too little received|insufficient output|minimum output|minimum amount|price impact|amountoutminimum/.test(text)) {
    return failure(
      "slippage",
      "Protected minimum was not available",
      "The market moved beyond the signed quote or minimum-output boundary.",
      "Request a fresh quote or reduce the order. RMT will not silently loosen the minimum received.",
      true
    );
  }
  if (/allowance|approval|approve|permit2|transfer amount exceeds allowance/.test(text)) {
    return failure(
      "allowance",
      "Approval did not complete",
      "The router did not receive the exact token authority required for this sell.",
      "Recheck the approval receipt before attempting another approval or swap.",
      true
    );
  }
  if (/no route|route unavailable|no available route|pool not found|pair not found|insufficient liquidity|liquidity removed/.test(text)) {
    return failure(
      "route-unavailable",
      "No executable route is available",
      "The selected pool or venue cannot currently satisfy this order.",
      "Reduce the order, change venue, or wait for liquidity to return.",
      true
    );
  }
  if (/nonce too low|replacement transaction|already known|duplicate submission|underpriced/.test(text)) {
    return failure(
      "nonce-or-duplicate",
      "A transaction may already be in flight",
      "The wallet or RPC reported a duplicate or nonce conflict.",
      "Check the transaction history before submitting again.",
      false
    );
  }
  if (/estimate gas|estimategas|simulation|preflight|gas required exceeds allowance/.test(text)) {
    return failure(
      "simulation-failed",
      "Exact transaction simulation failed",
      "RMT could not prove that this exact order would execute successfully.",
      "Do not sign. Refresh the quote or inspect the token and route evidence.",
      true
    );
  }
  if (/timeout|timed out|network|rpc|gateway|rate limit|429|503|failed to fetch|socket|connection|temporarily unavailable/.test(text)) {
    return failure(
      "network",
      "Chain confirmation is temporarily unavailable",
      "The transaction may still be pending or confirmed even though the current RPC check failed.",
      "Do not resubmit until the hash is checked on Blockscout or RMT finishes reconciliation.",
      false
    );
  }
  if (/revert|execution reverted|transaction failed|status.?reverted/.test(text)) {
    return failure(
      "reverted",
      "Transaction reverted onchain",
      "Robinhood Chain accepted the transaction but the EVM reverted it.",
      "Review the explorer receipt and request a completely fresh quote before trying again.",
      true
    );
  }
  return failure(
    "unknown",
    "Execution status needs review",
    "RMT could not map the wallet or RPC response to a safe automatic action.",
    "Check Blockscout and copy the diagnostic record before attempting another submission.",
    false
  );
}

export function tradeExecutionDiagnostics(input: {
  record?: TradeExecutionRecord | null;
  failure?: TradeExecutionFailure | null;
  rawError?: string;
  status: string;
}) {
  const record = input.record;
  return JSON.stringify({
    schemaVersion: TRADE_EXECUTION_SCHEMA_VERSION,
    chainId: ROBINHOOD_CHAIN_ID,
    status: input.status,
    ...(record ? {
      wallet: record.wallet,
      token: record.token,
      pair: record.pair,
      venue: record.venue,
      side: record.side,
      amountIn: record.amountIn,
      txHash: record.txHash,
      state: record.state,
      createdAt: new Date(record.createdAt).toISOString(),
      updatedAt: new Date(record.updatedAt).toISOString()
    } : {}),
    ...(input.failure ? {
      failureCode: input.failure.code,
      failureTitle: input.failure.title,
      retryable: input.failure.retryable
    } : {}),
    ...(input.rawError ? { rawError: input.rawError.slice(0, 500) } : {})
  }, null, 2);
}
