import { decodeEventLog, getAddress, isAddress, isHash, keccak256, type Address, type Hash, type Hex } from "viem";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import { calculateRmtFeeFloor } from "./execution-fee-policy";
import { assertRmtExecutionFeeV2Economics } from "./execution-fee-policy-v2";
import { assertVNextAtomicFeeAuthorizationBinding } from "./provider-fee-settlement";
import { RMT_UNISWAP_V3_PROVIDER_ID, rmtUniswapV3FeeExecutorAbi } from "./uniswap-v3-fee-executor";
import {
  decodeRmtUniswapV3FeeAuthorizationV2,
  RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID,
  RMT_UNISWAP_V3_V2_POLICY_ID_HASH,
  RMT_UNISWAP_V3_V2_PROVIDER_ID,
  rmtUniswapV3FeeExecutorV2Abi
} from "./uniswap-v3-fee-executor-v2";
import { ROBINHOOD_SWAP_ROUTER_02, ROBINHOOD_V4_POOL_MANAGER, ROBINHOOD_WETH } from "../uniswap-v4";
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
const v4SwapEventAbi = [{
  type: "event", name: "Swap", anonymous: false,
  inputs: [
    { indexed: true, name: "id", type: "bytes32" },
    { indexed: true, name: "sender", type: "address" },
    { indexed: false, name: "amount0", type: "int128" },
    { indexed: false, name: "amount1", type: "int128" },
    { indexed: false, name: "sqrtPriceX96", type: "uint160" },
    { indexed: false, name: "liquidity", type: "uint128" },
    { indexed: false, name: "tick", type: "int24" },
    { indexed: false, name: "fee", type: "uint24" }
  ]
}] as const;

export type VNextExecutionRecord = {
  schemaVersion: typeof SCHEMA_VERSION;
  chainId: 4_663;
  wallet: Address;
  provider?: VNextAuthorizationPlan["provider"];
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
  feeV2Settlement?: {
    provider: "uniswap-v3";
    implementationId: string;
    executor: Address;
    executionTarget: Address;
    providerTarget: Address;
    executionId: Hex;
    policyIdHash: Hex;
    policyHash: Hex;
    policyVersion: 2;
    providerId: Hex;
    treasury: Address;
    requestedInputAsset: Address;
    requestedOutputAsset: Address;
    feeAsset: Address;
    feeBps: 25;
    feeSide: "input";
    userGrossInputAtomic: string;
    expectedFeeAtomic: string;
    maximumFeeAtomic: string;
    providerInputAtomic: string;
    protectedOutputAtomic: string;
    routeIdentity: Hex;
    calldataHash: Hex;
    actualRmtFeeAtomic?: string;
    actualProviderOutputAtomic?: string;
  };
  v4DirectSettlement?: {
    poolId: Hex;
    poolManager: Address;
    outputCurrencyIndex: 0 | 1;
    protectedOutputAtomic: string;
    rmtFeeAtomic: "0";
    treasuryTransferAtomic: "0";
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

const JOURNAL_PROVIDERS = new Set<VNextAuthorizationPlan["provider"]>(["uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl"]);

export function vNextExecutionProviderLabel(provider?: VNextExecutionRecord["provider"]) {
  if (provider === "uniswap-v2") return "Uniswap V2";
  if (provider === "uniswap-v3") return "Uniswap V3";
  if (provider === "uniswap-v4") return "Uniswap V4";
  if (provider === "up-v2") return "UP V2";
  if (provider === "up-cl") return "UP CL";
  return null;
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
  const feeV2Candidate = candidate.kind === "swap" ? candidate.feeV2Settlement : undefined;
  const feeV2Settlement = feeV2Candidate === undefined ? undefined : (() => {
    const actualRmtFeeAtomic = feeV2Candidate?.actualRmtFeeAtomic;
    const actualProviderOutputAtomic = feeV2Candidate?.actualProviderOutputAtomic;
    if (
      !feeV2Candidate || feeV2Candidate.provider !== "uniswap-v3"
      || typeof feeV2Candidate.implementationId !== "string" || !feeV2Candidate.implementationId.trim()
      || !isAddress(feeV2Candidate.executor, { strict: false })
      || !isAddress(feeV2Candidate.executionTarget, { strict: false })
      || getAddress(feeV2Candidate.executor) !== getAddress(feeV2Candidate.executionTarget)
      || !isAddress(feeV2Candidate.providerTarget, { strict: false })
      || getAddress(feeV2Candidate.providerTarget) !== getAddress(ROBINHOOD_SWAP_ROUTER_02)
      || !isHash(feeV2Candidate.executionId) || !isHash(feeV2Candidate.policyIdHash)
      || feeV2Candidate.policyIdHash.toLowerCase() !== RMT_UNISWAP_V3_V2_POLICY_ID_HASH.toLowerCase()
      || !isHash(feeV2Candidate.policyHash) || feeV2Candidate.policyVersion !== 2
      || !isHash(feeV2Candidate.providerId)
      || feeV2Candidate.providerId.toLowerCase() !== RMT_UNISWAP_V3_V2_PROVIDER_ID.toLowerCase()
      || !isAddress(feeV2Candidate.treasury, { strict: false })
      || !isAddress(feeV2Candidate.requestedInputAsset, { strict: false })
      || !isAddress(feeV2Candidate.requestedOutputAsset, { strict: false })
      || !isAddress(feeV2Candidate.feeAsset, { strict: false })
      || !isAddress(candidate.inputAsset ?? "", { strict: false })
      || !isAddress(candidate.outputAsset ?? "", { strict: false })
      || feeV2Candidate.feeBps !== 25 || feeV2Candidate.feeSide !== "input"
      || !/^[1-9][0-9]*$/.test(feeV2Candidate.userGrossInputAtomic)
      || !/^(0|[1-9][0-9]*)$/.test(feeV2Candidate.expectedFeeAtomic)
      || !/^(0|[1-9][0-9]*)$/.test(feeV2Candidate.maximumFeeAtomic)
      || !/^[1-9][0-9]*$/.test(feeV2Candidate.providerInputAtomic)
      || !/^[1-9][0-9]*$/.test(feeV2Candidate.protectedOutputAtomic)
      || !isHash(feeV2Candidate.routeIdentity) || !isHash(feeV2Candidate.calldataHash)
      || (actualRmtFeeAtomic !== undefined && !/^(0|[1-9][0-9]*)$/.test(actualRmtFeeAtomic))
      || (actualProviderOutputAtomic !== undefined && !/^[1-9][0-9]*$/.test(actualProviderOutputAtomic))
      || ((actualRmtFeeAtomic !== undefined || actualProviderOutputAtomic !== undefined)
        && (!actualRmtFeeAtomic || !actualProviderOutputAtomic || candidate.state !== "confirmed"
          || outputAmountAtomic !== actualProviderOutputAtomic))
    ) return null;
    const grossInput = BigInt(feeV2Candidate.userGrossInputAtomic);
    const expectedFee = BigInt(calculateRmtFeeFloor(feeV2Candidate.userGrossInputAtomic, 25));
    if (
      getAddress(feeV2Candidate.requestedInputAsset) !== getAddress(candidate.inputAsset ?? "")
      || getAddress(feeV2Candidate.requestedOutputAsset) !== getAddress(candidate.outputAsset ?? "")
      || getAddress(feeV2Candidate.feeAsset) !== getAddress(feeV2Candidate.requestedInputAsset)
      || BigInt(feeV2Candidate.expectedFeeAtomic) !== expectedFee
      || BigInt(feeV2Candidate.maximumFeeAtomic) !== expectedFee
      || BigInt(feeV2Candidate.providerInputAtomic) !== grossInput - expectedFee
      || (actualRmtFeeAtomic !== undefined && BigInt(actualRmtFeeAtomic) !== expectedFee)
      || (actualProviderOutputAtomic !== undefined && BigInt(actualProviderOutputAtomic) < BigInt(feeV2Candidate.protectedOutputAtomic))
    ) return null;
    return {
      provider: "uniswap-v3" as const,
      implementationId: feeV2Candidate.implementationId,
      executor: getAddress(feeV2Candidate.executor),
      executionTarget: getAddress(feeV2Candidate.executionTarget),
      providerTarget: getAddress(feeV2Candidate.providerTarget),
      executionId: feeV2Candidate.executionId.toLowerCase() as Hex,
      policyIdHash: feeV2Candidate.policyIdHash.toLowerCase() as Hex,
      policyHash: feeV2Candidate.policyHash.toLowerCase() as Hex,
      policyVersion: 2 as const,
      providerId: feeV2Candidate.providerId.toLowerCase() as Hex,
      treasury: getAddress(feeV2Candidate.treasury),
      requestedInputAsset: getAddress(feeV2Candidate.requestedInputAsset),
      requestedOutputAsset: getAddress(feeV2Candidate.requestedOutputAsset),
      feeAsset: getAddress(feeV2Candidate.feeAsset),
      feeBps: 25 as const,
      feeSide: "input" as const,
      userGrossInputAtomic: feeV2Candidate.userGrossInputAtomic,
      expectedFeeAtomic: feeV2Candidate.expectedFeeAtomic,
      maximumFeeAtomic: feeV2Candidate.maximumFeeAtomic,
      providerInputAtomic: feeV2Candidate.providerInputAtomic,
      protectedOutputAtomic: feeV2Candidate.protectedOutputAtomic,
      routeIdentity: feeV2Candidate.routeIdentity.toLowerCase() as Hex,
      calldataHash: feeV2Candidate.calldataHash.toLowerCase() as Hex,
      ...(actualRmtFeeAtomic !== undefined ? { actualRmtFeeAtomic } : {}),
      ...(actualProviderOutputAtomic !== undefined ? { actualProviderOutputAtomic } : {})
    };
  })();
  const v4Candidate = candidate.kind === "swap" ? candidate.v4DirectSettlement : undefined;
  const v4DirectSettlement = v4Candidate === undefined ? undefined : (
    candidate.provider === "uniswap-v4"
    && isHash(v4Candidate.poolId)
    && isAddress(v4Candidate.poolManager, { strict: false })
    && getAddress(v4Candidate.poolManager) === getAddress(ROBINHOOD_V4_POOL_MANAGER)
    && (v4Candidate.outputCurrencyIndex === 0 || v4Candidate.outputCurrencyIndex === 1)
    && /^[1-9][0-9]*$/.test(v4Candidate.protectedOutputAtomic)
    && v4Candidate.rmtFeeAtomic === "0"
    && v4Candidate.treasuryTransferAtomic === "0"
      ? {
          poolId: v4Candidate.poolId.toLowerCase() as Hex,
          poolManager: ROBINHOOD_V4_POOL_MANAGER,
          outputCurrencyIndex: v4Candidate.outputCurrencyIndex,
          protectedOutputAtomic: v4Candidate.protectedOutputAtomic,
          rmtFeeAtomic: "0" as const,
          treasuryTransferAtomic: "0" as const
        }
      : null
  );
  const provider = candidate.provider === undefined
    ? undefined
    : JOURNAL_PROVIDERS.has(candidate.provider) ? candidate.provider : null;
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
    || feeSettlement === null || feeV2Settlement === null || v4DirectSettlement === null || provider === null
    || (feeSettlement !== undefined && feeV2Settlement !== undefined)
    || (feeV2Settlement !== undefined && provider !== "uniswap-v3")
    || (v4DirectSettlement !== undefined && provider !== "uniswap-v4")
    || (provider === "uniswap-v4" && candidate.kind === "swap" && v4DirectSettlement === undefined)
    || !submittedAtMs || !updatedAtMs || updatedAtMs < submittedAtMs
    || !["erc20_approval", "swap"].includes(candidate.kind ?? "")
    || !["submitted", "confirmed", "reverted"].includes(candidate.state ?? "")
    || (outputAmountAtomic !== undefined && (candidate.kind !== "swap" || candidate.state !== "confirmed"))
  ) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    chainId: 4_663,
    wallet: getAddress(candidate.wallet),
    ...(provider ? { provider } : {}),
    kind: candidate.kind as VNextExecutionRecord["kind"],
    inputAsset: getAddress(candidate.inputAsset),
    outputAsset: getAddress(candidate.outputAsset),
    inputAmountAtomic: candidate.inputAmountAtomic,
    ...(outputAmountAtomic ? { outputAmountAtomic } : {}),
    ...(feeSettlement ? { feeSettlement } : {}),
    ...(feeV2Settlement ? { feeV2Settlement } : {}),
    ...(v4DirectSettlement ? { v4DirectSettlement } : {}),
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

function v2SettlementFromPlan(plan: VNextAuthorizationPlan, wallet: Address): VNextExecutionRecord["feeV2Settlement"] | null {
  if (plan.kind !== "swap" || !plan.feeV2Economics || !plan.feeV2Authorization || plan.provider !== "uniswap-v3") return null;
  try {
    const economics = plan.feeV2Economics;
    const binding = plan.feeV2Authorization;
    assertRmtExecutionFeeV2Economics(economics);
    assertVNextAtomicFeeAuthorizationBinding(binding, economics, binding);
    const decoded = decodeRmtUniswapV3FeeAuthorizationV2(plan.data);
    const authorization = decoded.authorization;
    const calldataHash = keccak256(plan.data);
    const expectedValue = isRobinhoodNativeAsset(authorization.requestedInputAsset)
      ? authorization.userGrossInput
      : 0n;
    if (
      binding.provider !== "uniswap-v3" || binding.verificationState !== "verified_atomic"
      || binding.settlementMode !== "v2-atomic-input-fee"
      || binding.implementationId !== RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID
      || binding.atomicFeeSettlement !== true || binding.revertsAtomically !== true
      || authorizationPayloadHash(plan).toLowerCase() !== plan.payloadHash.toLowerCase()
      || calldataHash.toLowerCase() !== binding.calldataHash.toLowerCase()
      || getAddress(plan.target) !== getAddress(binding.executionTarget)
      || getAddress(binding.recipient) !== wallet
      || getAddress(authorization.trader) !== wallet
      || getAddress(binding.providerTarget) !== getAddress(plan.router)
      || getAddress(plan.router) !== getAddress(ROBINHOOD_SWAP_ROUTER_02)
      || binding.executionId.toLowerCase() !== authorization.executionId.toLowerCase()
      || authorization.policyIdHash.toLowerCase() !== RMT_UNISWAP_V3_V2_POLICY_ID_HASH.toLowerCase()
      || authorization.policyHash.toLowerCase() !== economics.policyHash.toLowerCase()
      || authorization.policyVersion !== 2n
      || authorization.feeBps !== 25 || authorization.feeSide !== 0
      || getAddress(authorization.treasury) !== getAddress(economics.treasury)
      || getAddress(authorization.requestedInputAsset) !== getAddress(plan.inputAsset)
      || getAddress(authorization.requestedOutputAsset) !== getAddress(plan.outputAsset)
      || getAddress(authorization.feeAsset) !== getAddress(plan.inputAsset)
      || authorization.userGrossInput !== BigInt(plan.inputAmountAtomic)
      || authorization.userGrossInput !== BigInt(economics.userGrossInputAtomic)
      || authorization.expectedFeeAtomic !== BigInt(economics.expectedFeeAtomic)
      || authorization.maximumFeeAtomic !== BigInt(economics.maximumFeeAtomic)
      || authorization.providerInput !== BigInt(economics.providerInputAtomic)
      || authorization.protectedOutput !== BigInt(plan.protectedOutputAtomic)
      || authorization.protectedOutput !== BigInt(economics.providerProtectedOutputAtomic)
      || authorization.deadline !== BigInt(plan.deadline)
      || authorization.deadline !== BigInt(binding.deadline)
      || BigInt(plan.value) !== expectedValue
    ) return null;
    return {
      provider: "uniswap-v3",
      implementationId: binding.implementationId,
      executor: getAddress(plan.target),
      executionTarget: getAddress(binding.executionTarget),
      providerTarget: getAddress(binding.providerTarget),
      executionId: authorization.executionId.toLowerCase() as Hex,
      policyIdHash: authorization.policyIdHash.toLowerCase() as Hex,
      policyHash: authorization.policyHash.toLowerCase() as Hex,
      policyVersion: 2,
      providerId: RMT_UNISWAP_V3_V2_PROVIDER_ID,
      treasury: getAddress(authorization.treasury),
      requestedInputAsset: getAddress(authorization.requestedInputAsset),
      requestedOutputAsset: getAddress(authorization.requestedOutputAsset),
      feeAsset: getAddress(authorization.feeAsset),
      feeBps: 25,
      feeSide: "input",
      userGrossInputAtomic: authorization.userGrossInput.toString(),
      expectedFeeAtomic: authorization.expectedFeeAtomic.toString(),
      maximumFeeAtomic: authorization.maximumFeeAtomic.toString(),
      providerInputAtomic: authorization.providerInput.toString(),
      protectedOutputAtomic: authorization.protectedOutput.toString(),
      routeIdentity: authorization.routeIdentity.toLowerCase() as Hex,
      calldataHash: calldataHash.toLowerCase() as Hex
    };
  } catch {
    return null;
  }
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
  const carriesV2Authority = Boolean(input.plan.feeV2Economics || input.plan.feeV2Authorization);
  if (carriesV2Authority && input.plan.feeExecution) return null;
  const feeV2Settlement = input.plan.kind === "swap" && carriesV2Authority
    ? v2SettlementFromPlan(input.plan, wallet)
    : undefined;
  if (input.plan.kind === "swap" && carriesV2Authority && !feeV2Settlement) return null;
  const v4DirectSettlement = input.plan.kind === "swap" && input.plan.provider === "uniswap-v4" && input.plan.v4Execution
    ? {
        poolId: input.plan.v4Execution.poolId,
        poolManager: getAddress(input.plan.v4Execution.poolManager),
        outputCurrencyIndex: getAddress(input.plan.outputAsset) === getAddress(input.plan.v4Execution.poolKey.currency0) ? 0 as const : 1 as const,
        protectedOutputAtomic: input.plan.protectedOutputAtomic,
        rmtFeeAtomic: "0" as const,
        treasuryTransferAtomic: "0" as const
      }
    : undefined;
  const record: VNextExecutionRecord = {
    schemaVersion: SCHEMA_VERSION,
    chainId: 4_663,
    wallet,
    provider: input.plan.provider,
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
    ...(feeV2Settlement ? { feeV2Settlement } : {}),
    ...(v4DirectSettlement ? { v4DirectSettlement } : {}),
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

export function settledVNextFeeExecutionV2(record: VNextExecutionRecord, logs: readonly {
  address: string;
  data: Hex;
  topics: readonly Hex[];
}[]) {
  const expected = record.feeV2Settlement;
  if (record.kind !== "swap" || !expected || expected.provider !== "uniswap-v3") return null;
  const emitterLogs = logs.filter((log) =>
    isAddress(log.address, { strict: false }) && getAddress(log.address) === expected.executionTarget
  );
  if (emitterLogs.length !== 1 || emitterLogs[0].topics.length === 0) return null;
  try {
    const decoded = decodeEventLog({
      abi: rmtUniswapV3FeeExecutorV2Abi,
      eventName: "RMTUniswapV3FeeSettledV2",
      data: emitterLogs[0].data,
      topics: emitterLogs[0].topics as [Hex, ...Hex[]]
    });
    if (decoded.eventName !== "RMTUniswapV3FeeSettledV2") return null;
    const event = decoded.args;
    const exactFee = BigInt(calculateRmtFeeFloor(expected.userGrossInputAtomic, 25));
    if (
      getAddress(emitterLogs[0].address) !== expected.executor
      || expected.executor !== expected.executionTarget
      || event.executionId.toLowerCase() !== expected.executionId.toLowerCase()
      || event.policyIdHash.toLowerCase() !== expected.policyIdHash.toLowerCase()
      || event.policyHash.toLowerCase() !== expected.policyHash.toLowerCase()
      || event.policyVersion !== 2n
      || getAddress(event.trader) !== record.wallet
      || event.providerId.toLowerCase() !== expected.providerId.toLowerCase()
      || event.providerId.toLowerCase() !== RMT_UNISWAP_V3_V2_PROVIDER_ID.toLowerCase()
      || getAddress(event.router) !== expected.providerTarget
      || getAddress(event.router) !== getAddress(ROBINHOOD_SWAP_ROUTER_02)
      || event.routeIdentity.toLowerCase() !== expected.routeIdentity.toLowerCase()
      || getAddress(event.requestedInputAsset) !== expected.requestedInputAsset
      || getAddress(event.requestedOutputAsset) !== expected.requestedOutputAsset
      || getAddress(event.feeAsset) !== expected.feeAsset
      || Number(event.feeBps) !== 25 || Number(event.feeSide) !== 0
      || event.userGrossInput !== BigInt(expected.userGrossInputAtomic)
      || event.userGrossInput !== BigInt(record.inputAmountAtomic)
      || event.providerInput !== BigInt(expected.providerInputAtomic)
      || event.actualRmtFee !== exactFee
      || event.actualRmtFee !== BigInt(expected.expectedFeeAtomic)
      || event.actualRmtFee > BigInt(expected.maximumFeeAtomic)
      || event.actualProviderOutput < BigInt(expected.protectedOutputAtomic)
      || getAddress(event.treasury) !== expected.treasury
    ) return null;
    return {
      outputAmountAtomic: event.actualProviderOutput.toString(),
      actualRmtFeeAtomic: event.actualRmtFee.toString(),
      actualProviderOutputAtomic: event.actualProviderOutput.toString()
    };
  } catch {
    return null;
  }
}

export function settledVNextOutputAtomic(record: VNextExecutionRecord, logs: readonly {
  address: string;
  data: Hex;
  topics: readonly Hex[];
}[]) {
  if (record.kind !== "swap") return null;
  if (record.feeV2Settlement) return null;
  if (isRobinhoodNativeAsset(record.outputAsset)) {
    if (record.provider === "uniswap-v4") {
      const expected = record.v4DirectSettlement;
      if (!expected) return null;
      const swaps = logs.flatMap((log) => {
        if (!isAddress(log.address, { strict: false }) || getAddress(log.address) !== expected.poolManager || log.topics.length === 0) return [];
        try {
          const decoded = decodeEventLog({
            abi: v4SwapEventAbi,
            eventName: "Swap",
            data: log.data,
            topics: log.topics as [Hex, ...Hex[]]
          });
          if (decoded.eventName !== "Swap" || decoded.args.id.toLowerCase() !== expected.poolId.toLowerCase()) return [];
          const delta = expected.outputCurrencyIndex === 0 ? decoded.args.amount0 : decoded.args.amount1;
          return delta > 0n && delta >= BigInt(expected.protectedOutputAtomic) ? [delta] : [];
        } catch {
          return [];
        }
      });
      return swaps.length === 1 ? swaps[0].toString() : null;
    }
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
  settlement?: {
    outputAmountAtomic: string;
    actualFeeAtomic?: string;
    grossActualOutputAtomic?: string;
    actualRmtFeeAtomic?: string;
    actualProviderOutputAtomic?: string;
  }
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
  if (state === "confirmed" && existing.feeV2Settlement && (
    !settlement?.actualRmtFeeAtomic || !settlement.actualProviderOutputAtomic
    || settlement.outputAmountAtomic !== settlement.actualProviderOutputAtomic
    || settlement.actualRmtFeeAtomic !== existing.feeV2Settlement.expectedFeeAtomic
    || !/^[1-9][0-9]*$/.test(settlement.actualProviderOutputAtomic)
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
    ...(existing.feeV2Settlement ? { feeV2Settlement: {
      ...existing.feeV2Settlement,
      ...(state === "confirmed" && settlement?.actualRmtFeeAtomic !== undefined && settlement.actualProviderOutputAtomic !== undefined
        ? {
            actualRmtFeeAtomic: settlement.actualRmtFeeAtomic,
            actualProviderOutputAtomic: settlement.actualProviderOutputAtomic
          }
        : { actualRmtFeeAtomic: undefined, actualProviderOutputAtomic: undefined })
    } } : {}),
    updatedAtMs: nowMs
  };
  return writeJournal([resolved, ...current.filter((record) => record.txHash !== normalizedHash)], storage, nowMs) ? resolved : null;
}
