import { getAddress, isAddress, isHex, keccak256, type Address, type Hex } from "viem";
import type { RmtNftVerifiedMintPlan } from "./server/nft-mint-preflight";
import type { RmtNftMintReceiptReport } from "./server/nft-mint-receipt";

export const RMT_NFT_MINT_EXECUTION_STORAGE_KEY = "rmt:nft-mint-execution:v1:4663";
export const RMT_NFT_MINT_EXECUTION_CHAIN_ID = 4_663 as const;

export type RmtNftMintExecutionState = "PENDING" | "CONFIRMED" | "FAILED" | "EVIDENCE_INVALID";

export type RmtNftMintExecutionRecord = {
  schemaVersion: 1;
  chainId: typeof RMT_NFT_MINT_EXECUTION_CHAIN_ID;
  candidateId: string;
  providerCollectionSlug: string;
  collection: Address;
  wallet: Address;
  quantity: string;
  method: RmtNftVerifiedMintPlan["method"];
  target: Address;
  value: string;
  calldataHash: Hex;
  preflightDigest: Hex;
  stage: RmtNftVerifiedMintPlan["stage"];
  simulationBlockNumber: string;
  planCheckedAt: string;
  planExpiresAt: string;
  txHash: Hex;
  submittedAt: string;
  updatedAt: string;
  state: RmtNftMintExecutionState;
  blockNumber: string | null;
  mintedTokenIds: readonly string[];
  ccff00ConsumedTokenIds: readonly string[];
};

export type RmtPreparedNftMintTransaction = {
  account: Address;
  chainId: typeof RMT_NFT_MINT_EXECUTION_CHAIN_ID;
  to: Address;
  data: Hex;
  value: bigint;
};

function positiveIntegerString(value: unknown) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value);
}

function validDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function prepareRmtNftMintWalletTransaction(input: {
  plan: RmtNftVerifiedMintPlan;
  connectedAddress: Address | undefined;
  connectedChainId: number | undefined;
  selectedCandidateId: string;
  selectedQuantity: number;
  nowMs?: number;
}): RmtPreparedNftMintTransaction {
  const { plan } = input;
  if (plan.status !== "EXECUTION_PLAN_READY" || plan.chainId !== RMT_NFT_MINT_EXECUTION_CHAIN_ID) throw new Error("EXECUTION_PLAN_INVALID");
  if (plan.candidateId !== input.selectedCandidateId) throw new Error("PLAN_CONTEXT_CHANGED");
  if (!input.connectedAddress || getAddress(input.connectedAddress) !== getAddress(plan.wallet)) throw new Error("PLAN_CONTEXT_CHANGED");
  if (input.connectedChainId !== RMT_NFT_MINT_EXECUTION_CHAIN_ID) throw new Error("PLAN_CONTEXT_CHANGED");
  if (String(input.selectedQuantity) !== plan.quantity) throw new Error("PLAN_CONTEXT_CHANGED");
  if (!validDate(plan.expiresAt) || (input.nowMs ?? Date.now()) >= Date.parse(plan.expiresAt)) throw new Error("EXECUTION_PLAN_EXPIRED");
  if (!isAddress(plan.collection, { strict: false }) || !isAddress(plan.target, { strict: false }) || !isHex(plan.calldata) || plan.calldata.length < 10
    || !isHex(plan.calldataHash) || keccak256(plan.calldata).toLowerCase() !== plan.calldataHash.toLowerCase()
    || !isHex(plan.digest) || !positiveIntegerString(plan.value) || plan.rmtFeeWei !== "0" || plan.rmtAdmission !== "NOT_EVALUATED"
    || plan.projectTokenRelationship !== null) {
    throw new Error("EXECUTION_PLAN_INVALID");
  }
  return {
    account: getAddress(plan.wallet),
    chainId: RMT_NFT_MINT_EXECUTION_CHAIN_ID,
    to: getAddress(plan.target),
    data: plan.calldata,
    value: BigInt(plan.value),
  };
}

function normalizeRecord(value: unknown): RmtNftMintExecutionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<RmtNftMintExecutionRecord>;
  if (item.schemaVersion !== 1 || item.chainId !== RMT_NFT_MINT_EXECUTION_CHAIN_ID) return null;
  if (!item.candidateId || !item.providerCollectionSlug || !isAddress(item.collection ?? "") || !isAddress(item.wallet ?? "") || !isAddress(item.target ?? "")) return null;
  if (!positiveIntegerString(item.quantity) || !positiveIntegerString(item.value) || !positiveIntegerString(item.simulationBlockNumber)) return null;
  if (!isHex(item.calldataHash ?? "") || !isHex(item.preflightDigest ?? "") || !isHex(item.txHash ?? "")) return null;
  if (!validDate(item.planCheckedAt) || !validDate(item.planExpiresAt) || !validDate(item.submittedAt) || !validDate(item.updatedAt)) return null;
  if (item.method !== "MINT_PUBLIC" && item.method !== "MINT_ALLOWED_TOKEN_HOLDER") return null;
  if (item.state !== "PENDING" && item.state !== "CONFIRMED" && item.state !== "FAILED" && item.state !== "EVIDENCE_INVALID") return null;
  if (!item.stage || !Array.isArray(item.mintedTokenIds) || !Array.isArray(item.ccff00ConsumedTokenIds)) return null;
  return { ...item, collection: getAddress(item.collection!), wallet: getAddress(item.wallet!), target: getAddress(item.target!) } as RmtNftMintExecutionRecord;
}

export function readRmtNftMintExecutionRecords(storage: Pick<Storage, "getItem">): readonly RmtNftMintExecutionRecord[] {
  try {
    const raw = storage.getItem(RMT_NFT_MINT_EXECUTION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRecord).filter((item): item is RmtNftMintExecutionRecord => item !== null).slice(-20);
  } catch {
    return [];
  }
}

export function writeRmtNftMintExecutionRecord(storage: Pick<Storage, "getItem" | "setItem">, record: RmtNftMintExecutionRecord) {
  const records = readRmtNftMintExecutionRecords(storage).filter((item) => item.txHash.toLowerCase() !== record.txHash.toLowerCase());
  storage.setItem(RMT_NFT_MINT_EXECUTION_STORAGE_KEY, JSON.stringify([...records, record].slice(-20)));
}

export function pendingRmtNftMintExecution(storage: Pick<Storage, "getItem">, wallet: Address, candidateId: string) {
  return [...readRmtNftMintExecutionRecords(storage)].reverse().find((record) => record.state === "PENDING"
    && record.candidateId === candidateId && record.wallet.toLowerCase() === wallet.toLowerCase()) ?? null;
}

export function submittedRmtNftMintExecutionRecord(plan: RmtNftVerifiedMintPlan, txHash: Hex, submittedAt = new Date().toISOString()): RmtNftMintExecutionRecord {
  return {
    schemaVersion: 1,
    chainId: RMT_NFT_MINT_EXECUTION_CHAIN_ID,
    candidateId: plan.candidateId,
    providerCollectionSlug: plan.providerCollectionSlug,
    collection: plan.collection,
    wallet: plan.wallet,
    quantity: plan.quantity,
    method: plan.method,
    target: plan.target,
    value: plan.value,
    calldataHash: plan.calldataHash,
    preflightDigest: plan.digest,
    stage: plan.stage,
    simulationBlockNumber: plan.simulationBlockNumber,
    planCheckedAt: plan.checkedAt,
    planExpiresAt: plan.expiresAt,
    txHash,
    submittedAt,
    updatedAt: submittedAt,
    state: "PENDING",
    blockNumber: null,
    mintedTokenIds: [],
    ccff00ConsumedTokenIds: [],
  };
}

export function resolveRmtNftMintExecutionRecord(record: RmtNftMintExecutionRecord, report: RmtNftMintReceiptReport): RmtNftMintExecutionRecord {
  if (report.txHash.toLowerCase() !== record.txHash.toLowerCase() || report.candidateId !== record.candidateId
    || report.wallet.toLowerCase() !== record.wallet.toLowerCase() || report.collection.toLowerCase() !== record.collection.toLowerCase()
    || report.target.toLowerCase() !== record.target.toLowerCase() || report.quantity !== record.quantity || report.method !== record.method
    || report.value !== record.value) throw new Error("RECEIPT_CONTEXT_CHANGED");
  if (report.status === "MINT_PENDING" || report.status === "EVIDENCE_UNAVAILABLE") return record;
  return {
    ...record,
    state: report.status === "MINT_CONFIRMED" ? "CONFIRMED" : report.status === "MINT_FAILED" ? "FAILED" : "EVIDENCE_INVALID",
    updatedAt: report.receiptVerifiedAt,
    blockNumber: report.blockNumber,
    mintedTokenIds: report.mintedTokenIds,
    ccff00ConsumedTokenIds: report.ccff00ConsumedTokenIds,
  };
}

export function rmtNftMintReceiptRequestBody(record: RmtNftMintExecutionRecord) {
  return {
    txHash: record.txHash,
    candidateId: record.candidateId,
    providerCollectionSlug: record.providerCollectionSlug,
    collection: record.collection,
    wallet: record.wallet,
    quantity: record.quantity,
    method: record.method,
    target: record.target,
    value: record.value,
    calldataHash: record.calldataHash,
    preflightDigest: record.preflightDigest,
    stage: record.stage,
    simulationBlockNumber: record.simulationBlockNumber,
    planCheckedAt: record.planCheckedAt,
  };
}

export function isRmtWalletUserRejection(cause: unknown) {
  if (!cause || typeof cause !== "object") return false;
  const value = cause as { code?: unknown; name?: unknown; message?: unknown };
  return value.code === 4001 || value.name === "UserRejectedRequestError" || (typeof value.message === "string" && /user rejected|denied transaction/i.test(value.message));
}
