import { decodeEventLog, getAddress, isAddress, isHash, type Address, type Hash, type Hex } from "viem";
import type { VNextAuthorizationPlan } from "./authorization-plan";
import { calculateRmtFeeFloor } from "./execution-fee-policy";
import { RMT_UNISWAP_V3_PROVIDER_ID, rmtUniswapV3FeeExecutorAbi } from "./uniswap-v3-fee-executor";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_WETH } from "../uniswap-v4";
import { isRobinhoodNativeAsset } from "./robinhood-assets";
import { UP_CL_EXECUTION_ROUTER, UP_V2_EXECUTION_ROUTER } from "./up-authorization-codec";

export const VNEXT_EXECUTION_STORAGE_KEY = "rmt:vnext-execution-journal:v1:4663";
export const VNEXT_EXECUTION_EVENT = "rmt:vnext-execution-changed";
const SCHEMA_VERSION = 1 as const;
const MAX_RECORDS = 20;
const RECOVERABLE_AGE_MS = 24 * 60 * 60 * 1_000;
const HISTORY_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const NATIVE_OUTPUT_ROUTERS = new Set([
  getAddress(ROBINHOOD_SWAP_ROUTER_02),
  getAddress(UP_V2_EXECUTION_ROUTER),
  getAddress(UP_CL_EXECUTION_ROUTER)
]);
const transferEventAbi = [{
  type: "event", name: "Transfer", anonymous: false,
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" }
  ]
}] as const;
const withdrawalEventAbi = [{
  type: "event", name: "Withdrawal", anonymous: false,
  inputs: [
    { indexed: true, name: "src", type: "address" },
    { indexed: false, name: "wad", type: "uint256" }
  ]
}] as const;

export type VNextExecutionRecord = {
  schemaVersion: typeof SCHEMA_VERSION;
  chainId: 4_663;
  wallet: Address;
  kind: "erc20_approval" | "swap";
  inputAsset: Address;
  outputAsset: Address;
  inputAmountAtomic: string;
  outputAmountAtomic?: string;
  feeSettlement?: {
    executor: Address;
    executionId: Hex;
    policyIdHash: Hex;
    policyHash: Hex;
    policyVersion: number;
    treasury: Address;
    feeAsset: Address;
    feeBps: number;
    feeSide: "input" | "output";
    routeIdentity: Hex;
    providerInputAtomic: string;
    protectedUserNetOutputAtomic: string;
    maximumFeeAtomic: string;
    actualFeeAtomic?: string;
    grossActualOutputAtomic?: string;
  };
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
  const outputAmountAtomic = candidate.outputAmountAtomic === undefined
    ? undefined
    : /^(?:[1-9][0-9]*)$/.test(candidate.outputAmountAtomic) ? candidate.outputAmountAtomic : null;
  // Approval plans can carry the eventual swap fee commitment for disclosure,
  // but an ERC-20 approval never settles that fee. Older journals may therefore
  // contain fee metadata on an approval record; discard it while preserving the
  // transaction so receipt recovery can resolve the confirmed allowance safely.
  const feeCandidate = candidate.kind === "swap" ? candidate.feeSettlement : undefined;
  const feeSettlement = feeCandidate === undefined ? undefined : (() => {
    if (
      !feeCandidate || !isAddress(feeCandidate.executor, { strict: false })
      || !isHash(feeCandidate.executionId) || !isHash(feeCandidate.policyIdHash) || !isHash(feeCandidate.policyHash)
      || !Number.isSafeInteger(feeCandidate.policyVersion) || feeCandidate.policyVersion <= 0
      || !isAddress(feeCandidate.treasury, { strict: false }) || !isAddress(feeCandidate.feeAsset, { strict: false })
      || !Number.isSafeInteger(feeCandidate.feeBps) || feeCandidate.feeBps <= 0 || feeCandidate.feeBps > 100
      || !["input", "output"].includes(feeCandidate.feeSide)
      || !isHash(feeCandidate.routeIdentity)
      || !/^[1-9][0-9]*$/.test(feeCandidate.providerInputAtomic)
      || !/^[1-9][0-9]*$/.test(feeCandidate.protectedUserNetOutputAtomic)
      || !/^(0|[1-9][0-9]*)$/.test(feeCandidate.maximumFeeAtomic)
      || (feeCandidate.actualFeeAtomic !== undefined && !/^(0|[1-9][0-9]*)$/.test(feeCandidate.actualFeeAtomic))
      || (feeCandidate.grossActualOutputAtomic !== undefined && !/^[1-9][0-9]*$/.test(feeCandidate.grossActualOutputAtomic))
      || ((feeCandidate.actualFeeAtomic !== undefined || feeCandidate.grossActualOutputAtomic !== undefined)
        && (!outputAmountAtomic || candidate.state !== "confirmed"))
    ) return null;
    return {
      executor: getAddress(feeCandidate.executor), executionId: feeCandidate.executionId.toLowerCase() as Hex,
      policyIdHash: feeCandidate.policyIdHash.toLowerCase() as Hex,
      policyHash: feeCandidate.policyHash.toLowerCase() as Hex, policyVersion: feeCandidate.policyVersion,
      treasury: getAddress(feeCandidate.treasury), feeAsset: getAddress(feeCandidate.feeAsset),
      feeBps: feeCandidate.feeBps, feeSide: feeCandidate.feeSide, routeIdentity: feeCandidate.routeIdentity.toLowerCase() as Hex,
      providerInputAtomic: feeCandidate.providerInputAtomic,
      protectedUserNetOutputAtomic: feeCandidate.protectedUserNetOutputAtomic,
      maximumFeeAtomic: feeCandidate.maximumFeeAtomic,
      ...(feeCandidate.actualFeeAtomic !== undefined ? { actualFeeAtomic: feeCandidate.actualFeeAtomic } : {}),
      ...(feeCandidate.grossActualOutputAtomic !== undefined ? { grossActualOutputAtomic: feeCandidate.grossActualOutputAtomic } : {})
    };
  })();
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
    || outputAmountAtomic === null
    || feeSettlement === null
    || !submittedAtMs || !updatedAtMs || updatedAtMs < submittedAtMs
    || !["erc20_approval", "swap"].includes(candidate.kind ?? "")
    || !["submitted", "confirmed", "reverted"].includes(candidate.state ?? "")
    || (outputAmountAtomic !== undefined && (candidate.kind !== "swap" || candidate.state !== "confirmed"))
  ) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    chainId: 4_663,
    wallet: getAddress(candidate.wallet),
    kind: candidate.kind as VNextExecutionRecord["kind"],
    inputAsset: getAddress(candidate.inputAsset),
    outputAsset: getAddress(candidate.outputAsset),
    inputAmountAtomic: candidate.inputAmountAtomic,
    ...(outputAmountAtomic ? { outputAmountAtomic } : {}),
    ...(feeSettlement ? { feeSettlement } : {}),
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
    ...(input.plan.kind === "swap" && input.plan.feeExecution ? { feeSettlement: {
      executor: getAddress(input.plan.feeExecution.executor),
      executionId: input.plan.feeExecution.executionId,
      policyIdHash: input.plan.feeExecution.policyIdHash,
      policyHash: input.plan.feeExecution.policyHash,
      policyVersion: input.plan.feeExecution.policyVersion,
      treasury: getAddress(input.plan.feeExecution.treasury),
      feeAsset: getAddress(input.plan.feeExecution.feeAsset),
      feeBps: input.plan.feeExecution.feeBps,
      feeSide: input.plan.feeExecution.feeSide,
      routeIdentity: input.plan.feeExecution.routeIdentity,
      providerInputAtomic: input.plan.feeExecution.providerInputAtomic,
      protectedUserNetOutputAtomic: input.plan.feeExecution.protectedUserNetOutputAtomic,
      maximumFeeAtomic: input.plan.feeExecution.maximumFeeAtomic
    } } : {}),
    planId: input.plan.planId,
    payloadHash: input.plan.payloadHash.toLowerCase() as Hex,
    txHash: normalizedHash,
    state: "submitted",
    submittedAtMs: nowMs,
    updatedAtMs: nowMs
  };
  return writeJournal([record, ...current], storage, nowMs) ? record : null;
}

export function settledVNextFeeExecution(record: VNextExecutionRecord, logs: readonly {
  address: string;
  data: Hex;
  topics: readonly Hex[];
}[]) {
  const expected = record.feeSettlement;
  if (record.kind !== "swap" || !expected) return null;
  const matches = logs.flatMap((log) => {
    if (!isAddress(log.address, { strict: false }) || getAddress(log.address) !== expected.executor || log.topics.length === 0) return [];
    try {
      const decoded = decodeEventLog({
        abi: rmtUniswapV3FeeExecutorAbi,
        eventName: "RMTUniswapV3FeeSettled",
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]]
      });
      return decoded.eventName === "RMTUniswapV3FeeSettled" ? [decoded.args] : [];
    } catch {
      return [];
    }
  });
  if (matches.length !== 1) return null;
  const event = matches[0];
  const actualFee = event.actualRmtFee;
  const grossOutput = event.grossActualOutput;
  const netOutput = event.actualUserNetOutput;
  const maximumFee = BigInt(expected.maximumFeeAtomic);
  const feeCandidate = BigInt(calculateRmtFeeFloor(grossOutput.toString(), expected.feeBps));
  const expectedActualFee = expected.feeSide === "input"
    ? maximumFee
    : feeCandidate < maximumFee ? feeCandidate : maximumFee;
  if (
    event.executionId.toLowerCase() !== expected.executionId.toLowerCase()
    || event.policyHash.toLowerCase() !== expected.policyHash.toLowerCase()
    || getAddress(event.trader) !== record.wallet
    || event.policyIdHash.toLowerCase() !== expected.policyIdHash.toLowerCase()
    || event.policyVersion !== BigInt(expected.policyVersion)
    || event.providerId.toLowerCase() !== RMT_UNISWAP_V3_PROVIDER_ID.toLowerCase()
    || getAddress(event.router) !== getAddress(ROBINHOOD_SWAP_ROUTER_02)
    || event.routeIdentity.toLowerCase() !== expected.routeIdentity.toLowerCase()
    || getAddress(event.feeAsset) !== expected.feeAsset
    || Number(event.feeBps) !== expected.feeBps
    || Number(event.feeSide) !== (expected.feeSide === "input" ? 0 : 1)
    || event.userGrossInput !== BigInt(record.inputAmountAtomic)
    || event.providerInput !== BigInt(expected.providerInputAtomic)
    || actualFee !== expectedActualFee || actualFee > maximumFee
    || netOutput < BigInt(expected.protectedUserNetOutputAtomic)
    || (expected.feeSide === "input" ? netOutput !== grossOutput : netOutput + actualFee !== grossOutput)
    || getAddress(event.treasury) !== expected.treasury
  ) return null;
  return {
    outputAmountAtomic: netOutput.toString(),
    actualFeeAtomic: actualFee.toString(),
    grossActualOutputAtomic: grossOutput.toString()
  };
}

export function settledVNextOutputAtomic(record: VNextExecutionRecord, logs: readonly {
  address: string;
  data: Hex;
  topics: readonly Hex[];
}[]) {
  if (record.kind !== "swap") return null;
  if (isRobinhoodNativeAsset(record.outputAsset)) {
    const withdrawals = logs.flatMap((log) => {
      if (!isAddress(log.address, { strict: false }) || getAddress(log.address) !== getAddress(ROBINHOOD_WETH) || log.topics.length === 0) return [];
      try {
        const decoded = decodeEventLog({
          abi: withdrawalEventAbi,
          data: log.data,
          topics: log.topics as [Hex, ...Hex[]]
        });
        return decoded.eventName === "Withdrawal"
          && NATIVE_OUTPUT_ROUTERS.has(getAddress(decoded.args.src))
          && decoded.args.wad > 0n
          ? [decoded.args.wad]
          : [];
      } catch {
        return [];
      }
    });
    return withdrawals.length === 1 ? withdrawals[0].toString() : null;
  }
  let received = 0n;
  logs.forEach((log) => {
    if (!isAddress(log.address, { strict: false }) || getAddress(log.address) !== record.outputAsset || log.topics.length === 0) return;
    try {
      const decoded = decodeEventLog({
        abi: transferEventAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]]
      });
      if (decoded.eventName === "Transfer" && getAddress(decoded.args.to) === record.wallet) received += decoded.args.value;
    } catch {
      return;
    }
  });
  return received > 0n ? received.toString() : null;
}

export function resolveVNextExecution(
  txHash: string,
  state: "confirmed" | "reverted",
  storage?: VNextExecutionStorage,
  nowMs = Date.now(),
  settlement?: { outputAmountAtomic: string; actualFeeAtomic?: string; grossActualOutputAtomic?: string }
) {
  if (!isHash(txHash)) return null;
  const normalizedHash = txHash.toLowerCase();
  const current = readVNextExecutionJournal(storage, nowMs);
  const existing = current.find((record) => record.txHash === normalizedHash);
  if (!existing) return null;
  const outputAmountAtomic = settlement?.outputAmountAtomic;
  if (outputAmountAtomic !== undefined && (
    state !== "confirmed" || existing.kind !== "swap" || !/^[1-9][0-9]*$/.test(outputAmountAtomic)
  )) return null;
  const resolved: VNextExecutionRecord = {
    ...existing,
    state,
    ...(state === "confirmed" && existing.kind === "swap" && (outputAmountAtomic ?? existing.outputAmountAtomic)
      ? { outputAmountAtomic: outputAmountAtomic ?? existing.outputAmountAtomic }
      : { outputAmountAtomic: undefined }),
    ...(existing.feeSettlement ? { feeSettlement: {
      ...existing.feeSettlement,
      ...(state === "confirmed" && settlement?.actualFeeAtomic !== undefined && settlement.grossActualOutputAtomic !== undefined
        ? { actualFeeAtomic: settlement.actualFeeAtomic, grossActualOutputAtomic: settlement.grossActualOutputAtomic }
        : { actualFeeAtomic: undefined, grossActualOutputAtomic: undefined })
    } } : {}),
    updatedAtMs: nowMs
  };
  return writeJournal([resolved, ...current.filter((record) => record.txHash !== normalizedHash)], storage, nowMs) ? resolved : null;
}
