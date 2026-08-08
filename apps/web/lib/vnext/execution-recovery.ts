import { getAddress, isAddress, isHash, type Address, type Hash, type Hex } from "viem";
import type { VNextAuthorizationPlan } from "./authorization-plan";

export const VNEXT_EXECUTION_STORAGE_KEY = "rmt:vnext-execution-journal:v1:4663";
export const VNEXT_EXECUTION_EVENT = "rmt:vnext-execution-changed";
const SCHEMA_VERSION = 1 as const;
const MAX_RECORDS = 20;
const RECOVERABLE_AGE_MS = 24 * 60 * 60 * 1_000;
const HISTORY_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export type VNextExecutionRecord = {
  schemaVersion: typeof SCHEMA_VERSION;
  chainId: 4_663;
  wallet: Address;
  kind: "erc20_approval" | "swap";
  inputAsset: Address;
  outputAsset: Address;
  inputAmountAtomic: string;
  planId: string;
  payloadHash: Hex;
  txHash: Hash;
  state: "submitted" | "confirmed" | "reverted";
  submittedAtMs: number;
  updatedAtMs: number;
};

export type VNextExecutionStorage = Pick<Storage, "getItem" | "setItem">;

function targetStorage(storage?: VNextExecutionStorage) {
  if (storage) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

function normalizeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeRecord(value: unknown): VNextExecutionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<VNextExecutionRecord>;
  const submittedAtMs = normalizeTimestamp(candidate.submittedAtMs);
  const updatedAtMs = normalizeTimestamp(candidate.updatedAtMs);
  if (
    candidate.schemaVersion !== SCHEMA_VERSION || candidate.chainId !== 4_663
    || !candidate.wallet || !isAddress(candidate.wallet, { strict: false })
    || !candidate.inputAsset || !isAddress(candidate.inputAsset, { strict: false })
    || !candidate.outputAsset || !isAddress(candidate.outputAsset, { strict: false })
    || candidate.inputAsset.toLowerCase() === candidate.outputAsset.toLowerCase()
    || !candidate.txHash || !isHash(candidate.txHash)
    || !candidate.payloadHash || !isHash(candidate.payloadHash)
    || !candidate.planId || !/^[0-9a-f-]{36}$/i.test(candidate.planId)
    || !candidate.inputAmountAtomic || !/^[1-9][0-9]*$/.test(candidate.inputAmountAtomic)
    || !submittedAtMs || !updatedAtMs || updatedAtMs < submittedAtMs
    || !["erc20_approval", "swap"].includes(candidate.kind ?? "")
    || !["submitted", "confirmed", "reverted"].includes(candidate.state ?? "")
  ) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    chainId: 4_663,
    wallet: getAddress(candidate.wallet),
    kind: candidate.kind as VNextExecutionRecord["kind"],
    inputAsset: getAddress(candidate.inputAsset),
    outputAsset: getAddress(candidate.outputAsset),
    inputAmountAtomic: candidate.inputAmountAtomic,
    planId: candidate.planId,
    payloadHash: candidate.payloadHash.toLowerCase() as Hex,
    txHash: candidate.txHash.toLowerCase() as Hash,
    state: candidate.state as VNextExecutionRecord["state"],
    submittedAtMs,
    updatedAtMs
  };
}

export function normalizeVNextExecutionJournal(value: unknown, nowMs = Date.now()) {
  if (!Array.isArray(value)) return [] as VNextExecutionRecord[];
  const unique = new Map<string, VNextExecutionRecord>();
  value.forEach((candidate) => {
    const record = normalizeRecord(candidate);
    if (!record || nowMs - record.updatedAtMs > HISTORY_AGE_MS) return;
    const existing = unique.get(record.txHash);
    if (!existing || record.updatedAtMs > existing.updatedAtMs) unique.set(record.txHash, record);
  });
  return [...unique.values()].sort((left, right) => right.updatedAtMs - left.updatedAtMs).slice(0, MAX_RECORDS);
}

export function readVNextExecutionJournal(storage?: VNextExecutionStorage, nowMs = Date.now()) {
  const target = targetStorage(storage);
  if (!target) return [] as VNextExecutionRecord[];
  try {
    return normalizeVNextExecutionJournal(JSON.parse(target.getItem(VNEXT_EXECUTION_STORAGE_KEY) || "[]"), nowMs);
  } catch {
    return [] as VNextExecutionRecord[];
  }
}

function writeJournal(records: VNextExecutionRecord[], storage?: VNextExecutionStorage, nowMs = Date.now()) {
  const target = targetStorage(storage);
  if (!target) return false;
  const normalized = normalizeVNextExecutionJournal(records, nowMs);
  try {
    target.setItem(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify(normalized));
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(VNEXT_EXECUTION_EVENT, { detail: normalized }));
    return true;
  } catch {
    return false;
  }
}

export function findUnresolvedVNextExecution(wallet: string, storage?: VNextExecutionStorage, nowMs = Date.now()) {
  if (!isAddress(wallet, { strict: false })) return null;
  const normalizedWallet = getAddress(wallet);
  return readVNextExecutionJournal(storage, nowMs).find((record) =>
    record.wallet === normalizedWallet
    && record.state === "submitted"
    && nowMs - record.submittedAtMs <= RECOVERABLE_AGE_MS
  ) ?? null;
}

export function recordSubmittedVNextExecution(input: {
  wallet: string;
  plan: VNextAuthorizationPlan;
  txHash: string;
}, storage?: VNextExecutionStorage, nowMs = Date.now()) {
  if (!isAddress(input.wallet, { strict: false }) || !isHash(input.txHash)) return null;
  const wallet = getAddress(input.wallet);
  if (wallet !== getAddress(input.plan.recipient)) return null;
  const current = readVNextExecutionJournal(storage, nowMs);
  const normalizedHash = input.txHash.toLowerCase() as Hash;
  const existing = current.find((record) => record.txHash === normalizedHash);
  if (existing) return existing;
  const record: VNextExecutionRecord = {
    schemaVersion: SCHEMA_VERSION,
    chainId: 4_663,
    wallet,
    kind: input.plan.kind,
    inputAsset: getAddress(input.plan.inputAsset),
    outputAsset: getAddress(input.plan.outputAsset),
    inputAmountAtomic: input.plan.inputAmountAtomic,
    planId: input.plan.planId,
    payloadHash: input.plan.payloadHash.toLowerCase() as Hex,
    txHash: normalizedHash,
    state: "submitted",
    submittedAtMs: nowMs,
    updatedAtMs: nowMs
  };
  return writeJournal([record, ...current], storage, nowMs) ? record : null;
}

export function resolveVNextExecution(txHash: string, state: "confirmed" | "reverted", storage?: VNextExecutionStorage, nowMs = Date.now()) {
  if (!isHash(txHash)) return null;
  const normalizedHash = txHash.toLowerCase();
  const current = readVNextExecutionJournal(storage, nowMs);
  const existing = current.find((record) => record.txHash === normalizedHash);
  if (!existing) return null;
  const resolved: VNextExecutionRecord = { ...existing, state, updatedAtMs: nowMs };
  return writeJournal([resolved, ...current.filter((record) => record.txHash !== normalizedHash)], storage, nowMs) ? resolved : null;
}
