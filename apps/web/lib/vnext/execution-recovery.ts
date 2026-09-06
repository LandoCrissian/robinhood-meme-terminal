import {
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  isHash,
  keccak256,
  type Address,
  type Hash,
  type Hex
} from "viem";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import { assertVNextZeroXPlanBinding, RMT_ZERO_X_FEE_TREASURY, zeroXIntegratorFeeAmount } from "./zero-x-settlement";
import { assertRmtNetExecutionEconomics, calculateRmtFeeFloor } from "./execution-fee-policy";
import { assertRmtExecutionFeeV2Economics } from "./execution-fee-policy-v2";
import {
  assertVNextAtomicFeeAuthorizationBinding,
  isVNextWalletFeeSettlementAdmitted
} from "./provider-fee-settlement";
import {
  assertRmtUniswapV3FeeExecution,
  encodeRmtUniswapV3FeeExecution,
  RMT_UNISWAP_V3_PROVIDER_ID,
  rmtUniswapV3FeeExecutorAbi
} from "./uniswap-v3-fee-executor";
import { RMT_UNISWAP_V3_FEE_MAINNET_PROOF } from "./uniswap-v3-fee-mainnet-proof";
import {
  VNEXT_DIRECT_NO_RMT_FEE,
  VNEXT_LEGACY_V1_FEE,
  VNEXT_V2_ATOMIC_INPUT_FEE
} from "./execution-settlement";
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
import { ROBINHOOD_UNISWAP_V2_ROUTER } from "./uniswap-v2-authorization-codec";
import {
  decodeRmtUniswapV2FeeAuthorizationV2,
  RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
  RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID,
  RMT_UNISWAP_V2_V2_POLICY_HASH,
  RMT_UNISWAP_V2_V2_POLICY_ID_HASH,
  RMT_UNISWAP_V2_V2_PROVIDER_ID,
  RMT_UNISWAP_V2_V2_TREASURY,
  rmtUniswapV2FeeExecutorV2Abi
} from "./uniswap-v2-fee-executor-v2";
export { vNextProviderLabel as vNextExecutionProviderLabel } from "./provider-presentation";

export const VNEXT_EXECUTION_STORAGE_KEY = "rmt:vnext-execution-journal:v1:4663";
export const VNEXT_EXECUTION_EVENT = "rmt:vnext-execution-changed";
export const VNEXT_WALLET_REQUEST_EVENT = "rmt:vnext-wallet-request-changed";
const SCHEMA_VERSION = 1 as const;
const JOURNAL_ENVELOPE_VERSION = 2 as const;
const MAX_RECORDS = 20;
const RECOVERABLE_AGE_MS = 24 * 60 * 60 * 1_000;
const HISTORY_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const ACTIVE_PROVIDER_REQUESTS = new Set<string>();
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
    actualUserNetOutputAtomic?: string;
  };
  feeV2Settlement?: {
    provider: "uniswap-v2" | "uniswap-v3";
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
  providerNativeFee?: {
    provider: "zero-x-swap";
    treasury: Address;
    feeAsset: Address;
    feeBps: 25;
    feeAmountAtomic: string;
    expectedOutputAtomic: string;
    protectedOutputAtomic: string;
    providerFeeAsset: Address | null;
    providerFeeAtomic: string | null;
    transactionTarget: Address;
    calldataHash: Hex;
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
  deadline?: string;
  txHash: Hash;
  state: "submitted" | "confirmed" | "reverted";
  failureClassification?: "EXPIRED_ONCHAIN_DEADLINE";
  networkGasSpentWei?: string;
  submittedAtMs: number;
  updatedAtMs: number;
};

export type VNextWalletRequestState =
  | "PREPARED"
  | "PROMPT_REQUESTED"
  | "PROVIDER_PENDING"
  | "USER_REJECTED"
  | "EXPIRED_UNSUBMITTED"
  | "UNRESOLVED"
  | "HASH_RECEIVED"
  | "RECEIPT_CONFIRMED"
  | "RECEIPT_REVERTED";

export type VNextWalletRequestRecord = {
  schemaVersion: typeof SCHEMA_VERSION;
  requestId: string;
  planId: string;
  payloadHash: Hex;
  wallet: Address;
  chainId: 4_663;
  provider: VNextAuthorizationPlan["provider"];
  planKind: VNextAuthorizationPlan["kind"];
  target: Address;
  value: string;
  calldataHash: Hex;
  inputAsset: Address;
  outputAsset: Address;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  finalOnchainDeadline: string;
  planExpiresAtMs: number;
  requestedAtMs: number;
  walletNonceBeforeRequest: string;
  requestBlockNumber?: string;
  requestBlockHash?: Hash;
  connectorId?: string;
  connectorType?: string;
  walletClientType?: string;
  walletName?: string;
  promptRequestedAtMs?: number;
  providerPendingAtMs?: number;
  recoveryPlan?: VNextAuthorizationPlan;
  v4DirectSettlement?: VNextExecutionRecord["v4DirectSettlement"];
  state: VNextWalletRequestState;
  txHash?: Hash;
  updatedAtMs: number;
};

export type VNextExecutionStorage = Pick<Storage, "getItem" | "setItem">;

export function markVNextWalletProviderRequestActive(requestId: string) {
  if (/^[0-9a-f-]{36}$/i.test(requestId)) ACTIVE_PROVIDER_REQUESTS.add(requestId);
}

export function clearVNextWalletProviderRequestActive(requestId: string) {
  ACTIVE_PROVIDER_REQUESTS.delete(requestId);
}

export function isVNextWalletProviderRequestActive(requestId: string) {
  return ACTIVE_PROVIDER_REQUESTS.has(requestId);
}

function targetStorage(storage?: VNextExecutionStorage) {
  if (storage) return storage;
  return typeof window === "undefined" ? null : window.localStorage;
}

function normalizeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

const JOURNAL_PROVIDERS = new Set<VNextAuthorizationPlan["provider"]>(["uniswap-v2", "uniswap-v3", "uniswap-v4", "zero-x-swap", "up-v2", "up-cl"]);

type VNextFeeV2RecoveryProvider = "uniswap-v2" | "uniswap-v3";

function feeV2RecoveryAuthority(provider: VNextAuthorizationPlan["provider"] | undefined) {
  if (!provider || !isVNextWalletFeeSettlementAdmitted(provider)) return null;
  if (provider === "uniswap-v2") return {
    provider,
    implementationId: RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID,
    policyIdHash: RMT_UNISWAP_V2_V2_POLICY_ID_HASH,
    providerId: RMT_UNISWAP_V2_V2_PROVIDER_ID,
    providerTarget: ROBINHOOD_UNISWAP_V2_ROUTER,
    executionTarget: RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR,
    policyHash: RMT_UNISWAP_V2_V2_POLICY_HASH,
    treasury: RMT_UNISWAP_V2_V2_TREASURY
  } as const;
  if (provider === "uniswap-v3") return {
    provider,
    implementationId: RMT_UNISWAP_V3_V2_IMPLEMENTATION_ID,
    policyIdHash: RMT_UNISWAP_V3_V2_POLICY_ID_HASH,
    providerId: RMT_UNISWAP_V3_V2_PROVIDER_ID,
    providerTarget: ROBINHOOD_SWAP_ROUTER_02,
    executionTarget: null,
    policyHash: null,
    treasury: null
  } as const;
  return null;
}

function normalizeRecord(value: unknown): VNextExecutionRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<VNextExecutionRecord>;
  const submittedAtMs = normalizeTimestamp(candidate.submittedAtMs);
  const updatedAtMs = normalizeTimestamp(candidate.updatedAtMs);
  const deadline = candidate.deadline === undefined
    ? undefined
    : /^[1-9][0-9]*$/.test(candidate.deadline) ? candidate.deadline : null;
  const failureClassification = candidate.failureClassification === undefined
    ? undefined
    : candidate.failureClassification === "EXPIRED_ONCHAIN_DEADLINE" ? candidate.failureClassification : null;
  const networkGasSpentWei = candidate.networkGasSpentWei === undefined
    ? undefined
    : /^[1-9][0-9]*$/.test(candidate.networkGasSpentWei) ? candidate.networkGasSpentWei : null;
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
      || (feeCandidate.actualUserNetOutputAtomic !== undefined && !/^[1-9][0-9]*$/.test(feeCandidate.actualUserNetOutputAtomic))
      || ((feeCandidate.actualFeeAtomic !== undefined || feeCandidate.grossActualOutputAtomic !== undefined
        || feeCandidate.actualUserNetOutputAtomic !== undefined)
        && (
          !outputAmountAtomic || candidate.state !== "confirmed"
          || feeCandidate.actualFeeAtomic === undefined || feeCandidate.grossActualOutputAtomic === undefined
          || (feeCandidate.actualUserNetOutputAtomic !== undefined
            && feeCandidate.actualUserNetOutputAtomic !== outputAmountAtomic)
        ))
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
      ...(feeCandidate.grossActualOutputAtomic !== undefined ? { grossActualOutputAtomic: feeCandidate.grossActualOutputAtomic } : {}),
      ...(feeCandidate.actualFeeAtomic !== undefined && feeCandidate.grossActualOutputAtomic !== undefined && outputAmountAtomic
        ? { actualUserNetOutputAtomic: feeCandidate.actualUserNetOutputAtomic ?? outputAmountAtomic }
        : {})
    };
  })();
  const feeV2Candidate = candidate.kind === "swap" ? candidate.feeV2Settlement : undefined;
  const feeV2Settlement = feeV2Candidate === undefined ? undefined : (() => {
    const actualRmtFeeAtomic = feeV2Candidate?.actualRmtFeeAtomic;
    const actualProviderOutputAtomic = feeV2Candidate?.actualProviderOutputAtomic;
    const authority = feeV2RecoveryAuthority(feeV2Candidate?.provider);
    if (
      !feeV2Candidate || !authority
      || feeV2Candidate.implementationId !== authority.implementationId
      || !isAddress(feeV2Candidate.executor, { strict: false })
      || !isAddress(feeV2Candidate.executionTarget, { strict: false })
      || getAddress(feeV2Candidate.executor) !== getAddress(feeV2Candidate.executionTarget)
      || (authority.executionTarget !== null && getAddress(feeV2Candidate.executionTarget) !== getAddress(authority.executionTarget))
      || !isAddress(feeV2Candidate.providerTarget, { strict: false })
      || getAddress(feeV2Candidate.providerTarget) !== getAddress(authority.providerTarget)
      || !isHash(feeV2Candidate.executionId) || !isHash(feeV2Candidate.policyIdHash)
      || feeV2Candidate.policyIdHash.toLowerCase() !== authority.policyIdHash.toLowerCase()
      || !isHash(feeV2Candidate.policyHash) || feeV2Candidate.policyVersion !== 2
      || (authority.policyHash !== null && feeV2Candidate.policyHash.toLowerCase() !== authority.policyHash.toLowerCase())
      || !isHash(feeV2Candidate.providerId)
      || feeV2Candidate.providerId.toLowerCase() !== authority.providerId.toLowerCase()
      || !isAddress(feeV2Candidate.treasury, { strict: false })
      || (authority.treasury !== null && getAddress(feeV2Candidate.treasury) !== getAddress(authority.treasury))
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
      provider: authority.provider as VNextFeeV2RecoveryProvider,
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
  const providerNativeCandidate = candidate.kind === "swap" ? candidate.providerNativeFee : undefined;
  const providerNativeFee = providerNativeCandidate === undefined ? undefined : (
    providerNativeCandidate.provider === "zero-x-swap"
    && isAddress(providerNativeCandidate.treasury, { strict: false })
    && getAddress(providerNativeCandidate.treasury) === RMT_ZERO_X_FEE_TREASURY
    && isAddress(providerNativeCandidate.feeAsset, { strict: false })
    && isAddress(candidate.inputAsset ?? "", { strict: false })
    && getAddress(providerNativeCandidate.feeAsset) === getAddress(candidate.inputAsset!)
    && providerNativeCandidate.feeBps === 25
    && /^[1-9][0-9]*$/.test(providerNativeCandidate.feeAmountAtomic)
    && /^[1-9][0-9]*$/.test(candidate.inputAmountAtomic ?? "")
    && providerNativeCandidate.feeAmountAtomic === zeroXIntegratorFeeAmount(candidate.inputAmountAtomic!)
    && /^[1-9][0-9]*$/.test(providerNativeCandidate.expectedOutputAtomic)
    && /^[1-9][0-9]*$/.test(providerNativeCandidate.protectedOutputAtomic)
    && BigInt(providerNativeCandidate.protectedOutputAtomic) <= BigInt(providerNativeCandidate.expectedOutputAtomic)
    && isAddress(providerNativeCandidate.transactionTarget, { strict: false })
    && isHash(providerNativeCandidate.calldataHash)
    && (providerNativeCandidate.providerFeeAsset === null) === (providerNativeCandidate.providerFeeAtomic === null)
    && (providerNativeCandidate.providerFeeAsset === null || isAddress(providerNativeCandidate.providerFeeAsset, { strict: false }))
    && (providerNativeCandidate.providerFeeAtomic === null || /^[1-9][0-9]*$/.test(providerNativeCandidate.providerFeeAtomic))
      ? {
          ...providerNativeCandidate,
          treasury: getAddress(providerNativeCandidate.treasury),
          feeAsset: getAddress(providerNativeCandidate.feeAsset),
          providerFeeAsset: providerNativeCandidate.providerFeeAsset ? getAddress(providerNativeCandidate.providerFeeAsset) : null,
          transactionTarget: getAddress(providerNativeCandidate.transactionTarget),
          calldataHash: providerNativeCandidate.calldataHash.toLowerCase() as Hex
        }
      : null
  );
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
    || outputAmountAtomic === null || deadline === null || failureClassification === null || networkGasSpentWei === null
    || feeSettlement === null || feeV2Settlement === null || providerNativeFee === null || v4DirectSettlement === null || provider === null
    || [feeSettlement, feeV2Settlement, providerNativeFee].filter((value) => value !== undefined).length > 1
    || (feeV2Settlement !== undefined && provider !== feeV2Settlement.provider)
    || (providerNativeFee !== undefined && provider !== "zero-x-swap")
    || (provider === "zero-x-swap" && candidate.kind === "swap" && providerNativeFee === undefined)
    || (v4DirectSettlement !== undefined && provider !== "uniswap-v4")
    || (provider === "uniswap-v4" && candidate.kind === "swap" && v4DirectSettlement === undefined)
    || !submittedAtMs || !updatedAtMs || updatedAtMs < submittedAtMs
    || !["erc20_approval", "swap"].includes(candidate.kind ?? "")
    || !["submitted", "confirmed", "reverted"].includes(candidate.state ?? "")
    || (outputAmountAtomic !== undefined && (candidate.kind !== "swap" || candidate.state !== "confirmed"))
    || (failureClassification !== undefined && (candidate.state !== "reverted" || candidate.kind !== "swap"))
    || (networkGasSpentWei !== undefined && candidate.state !== "reverted")
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
    ...(providerNativeFee ? { providerNativeFee } : {}),
    ...(v4DirectSettlement ? { v4DirectSettlement } : {}),
    planId: candidate.planId,
    payloadHash: candidate.payloadHash.toLowerCase() as Hex,
    ...(deadline ? { deadline } : {}),
    txHash: candidate.txHash.toLowerCase() as Hash,
    state: candidate.state as VNextExecutionRecord["state"],
    ...(failureClassification ? { failureClassification } : {}),
    ...(networkGasSpentWei ? { networkGasSpentWei } : {}),
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

const WALLET_REQUEST_STATES = new Set<VNextWalletRequestState>([
  "PREPARED", "PROMPT_REQUESTED", "PROVIDER_PENDING", "USER_REJECTED",
  "EXPIRED_UNSUBMITTED", "UNRESOLVED", "HASH_RECEIVED",
  "RECEIPT_CONFIRMED", "RECEIPT_REVERTED"
]);
const BLOCKING_WALLET_REQUEST_STATES = new Set<VNextWalletRequestState>([
  "PROMPT_REQUESTED", "PROVIDER_PENDING", "UNRESOLVED", "HASH_RECEIVED"
]);
const HASHED_WALLET_REQUEST_STATES = new Set<VNextWalletRequestState>([
  "HASH_RECEIVED", "RECEIPT_CONFIRMED", "RECEIPT_REVERTED"
]);

function normalizeWalletRequest(value: unknown): VNextWalletRequestRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<VNextWalletRequestRecord>;
  const requestedAtMs = normalizeTimestamp(candidate.requestedAtMs);
  const updatedAtMs = normalizeTimestamp(candidate.updatedAtMs);
  const planExpiresAtMs = normalizeTimestamp(candidate.planExpiresAtMs);
  const requestBlockNumber = candidate.requestBlockNumber === undefined
    ? undefined
    : /^(0|[1-9][0-9]*)$/.test(candidate.requestBlockNumber) ? candidate.requestBlockNumber : null;
  const requestBlockHash = candidate.requestBlockHash === undefined
    ? undefined
    : isHash(candidate.requestBlockHash) ? candidate.requestBlockHash.toLowerCase() as Hash : null;
  const connectorId = typeof candidate.connectorId === "string" && /^[\x20-\x7e]{1,160}$/.test(candidate.connectorId)
    ? candidate.connectorId : undefined;
  const connectorType = typeof candidate.connectorType === "string" && /^[\x20-\x7e]{1,80}$/.test(candidate.connectorType)
    ? candidate.connectorType : undefined;
  const walletClientType = typeof candidate.walletClientType === "string" && /^[\x20-\x7e]{1,80}$/.test(candidate.walletClientType)
    ? candidate.walletClientType : undefined;
  const walletName = typeof candidate.walletName === "string" && /^[\x20-\x7e]{1,80}$/.test(candidate.walletName)
    ? candidate.walletName : undefined;
  const promptRequestedAtMs = candidate.promptRequestedAtMs === undefined ? undefined : normalizeTimestamp(candidate.promptRequestedAtMs);
  const providerPendingAtMs = candidate.providerPendingAtMs === undefined ? undefined : normalizeTimestamp(candidate.providerPendingAtMs);
  const v4Candidate = candidate.planKind === "swap" ? candidate.v4DirectSettlement : undefined;
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
  const recoveryPlan = (() => {
    if (candidate.recoveryPlan === undefined) return undefined;
    try {
      const plan = candidate.recoveryPlan as VNextAuthorizationPlan;
      if (
        !plan || typeof plan !== "object"
        || !isHash(plan.payloadHash) || authorizationPayloadHash(plan).toLowerCase() !== plan.payloadHash.toLowerCase()
        || plan.planId !== candidate.planId || plan.payloadHash.toLowerCase() !== candidate.payloadHash?.toLowerCase()
        || plan.chainId !== 4_663 || plan.provider !== candidate.provider || plan.kind !== candidate.planKind
        || getAddress(plan.recipient) !== getAddress(candidate.wallet ?? "")
        || getAddress(plan.target) !== getAddress(candidate.target ?? "")
        || plan.value !== candidate.value || keccak256(plan.data).toLowerCase() !== candidate.calldataHash?.toLowerCase()
        || getAddress(plan.inputAsset) !== getAddress(candidate.inputAsset ?? "")
        || getAddress(plan.outputAsset) !== getAddress(candidate.outputAsset ?? "")
        || plan.inputAmountAtomic !== candidate.inputAmountAtomic
        || plan.protectedOutputAtomic !== candidate.protectedOutputAtomic
        || plan.deadline !== candidate.finalOnchainDeadline
        || plan.expiresAtMs !== candidate.planExpiresAtMs
        || !isVNextPlanRecoveryAdmissible(plan, candidate.wallet ?? "")
      ) return null;
      return plan;
    } catch {
      return null;
    }
  })();
  if (
    candidate.schemaVersion !== SCHEMA_VERSION
    || typeof candidate.requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(candidate.requestId)
    || typeof candidate.planId !== "string" || !/^[0-9a-f-]{36}$/i.test(candidate.planId)
    || !candidate.payloadHash || !isHash(candidate.payloadHash)
    || !candidate.wallet || !isAddress(candidate.wallet, { strict: false })
    || candidate.chainId !== 4_663 || !candidate.provider || !JOURNAL_PROVIDERS.has(candidate.provider)
    || !candidate.planKind || !["erc20_approval", "swap"].includes(candidate.planKind)
    || !candidate.target || !isAddress(candidate.target, { strict: false })
    || !/^(0|[1-9][0-9]*)$/.test(candidate.value ?? "")
    || !candidate.calldataHash || !isHash(candidate.calldataHash)
    || !candidate.inputAsset || !isAddress(candidate.inputAsset, { strict: false })
    || !candidate.outputAsset || !isAddress(candidate.outputAsset, { strict: false })
    || getAddress(candidate.inputAsset) === getAddress(candidate.outputAsset)
    || !/^[1-9][0-9]*$/.test(candidate.inputAmountAtomic ?? "")
    || !/^[1-9][0-9]*$/.test(candidate.protectedOutputAtomic ?? "")
    || !/^[1-9][0-9]*$/.test(candidate.finalOnchainDeadline ?? "")
    || !planExpiresAtMs || !requestedAtMs || !updatedAtMs || updatedAtMs < requestedAtMs
    || !/^(0|[1-9][0-9]*)$/.test(candidate.walletNonceBeforeRequest ?? "")
    || requestBlockNumber === null || requestBlockHash === null || promptRequestedAtMs === null || providerPendingAtMs === null
    || v4DirectSettlement === null || recoveryPlan === null
    || (requestBlockHash !== undefined && requestBlockNumber === undefined)
    || (candidate.provider === "uniswap-v4" && candidate.planKind === "swap" && v4DirectSettlement === undefined)
    || !candidate.state || !WALLET_REQUEST_STATES.has(candidate.state)
    || (candidate.txHash !== undefined && !isHash(candidate.txHash))
    || (HASHED_WALLET_REQUEST_STATES.has(candidate.state) && !candidate.txHash)
    || (!HASHED_WALLET_REQUEST_STATES.has(candidate.state) && candidate.txHash !== undefined)
  ) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    requestId: candidate.requestId,
    planId: candidate.planId,
    payloadHash: candidate.payloadHash.toLowerCase() as Hex,
    wallet: getAddress(candidate.wallet),
    chainId: 4_663,
    provider: candidate.provider,
    planKind: candidate.planKind,
    target: getAddress(candidate.target),
    value: candidate.value!,
    calldataHash: candidate.calldataHash.toLowerCase() as Hex,
    inputAsset: getAddress(candidate.inputAsset),
    outputAsset: getAddress(candidate.outputAsset),
    inputAmountAtomic: candidate.inputAmountAtomic!,
    protectedOutputAtomic: candidate.protectedOutputAtomic!,
    finalOnchainDeadline: candidate.finalOnchainDeadline!,
    planExpiresAtMs,
    requestedAtMs,
    walletNonceBeforeRequest: candidate.walletNonceBeforeRequest!,
    ...(requestBlockNumber !== undefined ? { requestBlockNumber } : {}),
    ...(requestBlockHash !== undefined ? { requestBlockHash } : {}),
    ...(connectorId ? { connectorId } : {}),
    ...(connectorType ? { connectorType } : {}),
    ...(walletClientType ? { walletClientType } : {}),
    ...(walletName ? { walletName } : {}),
    ...(promptRequestedAtMs ? { promptRequestedAtMs } : {}),
    ...(providerPendingAtMs ? { providerPendingAtMs } : {}),
    ...(recoveryPlan ? { recoveryPlan } : {}),
    ...(v4DirectSettlement ? { v4DirectSettlement } : {}),
    state: candidate.state,
    ...(candidate.txHash ? { txHash: candidate.txHash.toLowerCase() as Hash } : {}),
    updatedAtMs
  };
}

export function normalizeVNextWalletRequestJournal(value: unknown, nowMs = Date.now()) {
  if (!Array.isArray(value)) return [] as VNextWalletRequestRecord[];
  const unique = new Map<string, VNextWalletRequestRecord>();
  value.forEach((candidate) => {
    const record = normalizeWalletRequest(candidate);
    if (!record || (!BLOCKING_WALLET_REQUEST_STATES.has(record.state) && nowMs - record.updatedAtMs > HISTORY_AGE_MS)) return;
    const existing = unique.get(record.requestId);
    if (!existing || record.updatedAtMs > existing.updatedAtMs) unique.set(record.requestId, record);
  });
  return [...unique.values()]
    .sort((left, right) => Number(BLOCKING_WALLET_REQUEST_STATES.has(right.state)) - Number(BLOCKING_WALLET_REQUEST_STATES.has(left.state)) || right.updatedAtMs - left.updatedAtMs)
    .slice(0, MAX_RECORDS);
}

function readStoredEnvelope(storage?: VNextExecutionStorage, nowMs = Date.now()) {
  const target = targetStorage(storage);
  if (!target) return { executions: [] as VNextExecutionRecord[], walletRequests: [] as VNextWalletRequestRecord[] };
  try {
    const raw = JSON.parse(target.getItem(VNEXT_EXECUTION_STORAGE_KEY) || "[]") as unknown;
    if (Array.isArray(raw)) return { executions: normalizeVNextExecutionJournal(raw, nowMs), walletRequests: [] as VNextWalletRequestRecord[] };
    if (!raw || typeof raw !== "object") return { executions: [] as VNextExecutionRecord[], walletRequests: [] as VNextWalletRequestRecord[] };
    const envelope = raw as { schemaVersion?: unknown; executions?: unknown; walletRequests?: unknown };
    if (envelope.schemaVersion !== JOURNAL_ENVELOPE_VERSION) return { executions: [] as VNextExecutionRecord[], walletRequests: [] as VNextWalletRequestRecord[] };
    return {
      executions: normalizeVNextExecutionJournal(envelope.executions, nowMs),
      walletRequests: normalizeVNextWalletRequestJournal(envelope.walletRequests, nowMs)
    };
  } catch {
    return { executions: [] as VNextExecutionRecord[], walletRequests: [] as VNextWalletRequestRecord[] };
  }
}

export function readVNextExecutionJournal(storage?: VNextExecutionStorage, nowMs = Date.now()) {
  return readStoredEnvelope(storage, nowMs).executions;
}

export function readVNextWalletRequestJournal(storage?: VNextExecutionStorage, nowMs = Date.now()) {
  return readStoredEnvelope(storage, nowMs).walletRequests;
}

function writeCombinedJournal(records: VNextExecutionRecord[], walletRequests: VNextWalletRequestRecord[], storage?: VNextExecutionStorage, nowMs = Date.now()) {
  const target = targetStorage(storage);
  if (!target) return false;
  const normalized = normalizeVNextExecutionJournal(records, nowMs);
  const normalizedRequests = normalizeVNextWalletRequestJournal(walletRequests, nowMs);
  try {
    target.setItem(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify({
      schemaVersion: JOURNAL_ENVELOPE_VERSION,
      executions: normalized,
      walletRequests: normalizedRequests
    }));
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(VNEXT_EXECUTION_EVENT, { detail: normalized }));
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(VNEXT_WALLET_REQUEST_EVENT, { detail: normalizedRequests }));
    return true;
  } catch {
    return false;
  }
}

function writeJournal(records: VNextExecutionRecord[], storage?: VNextExecutionStorage, nowMs = Date.now()) {
  return writeCombinedJournal(records, readVNextWalletRequestJournal(storage, nowMs), storage, nowMs);
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

export function findBlockingVNextWalletRequest(wallet: string, storage?: VNextExecutionStorage, nowMs = Date.now()) {
  if (!isAddress(wallet, { strict: false })) return null;
  const normalizedWallet = getAddress(wallet);
  const journal = readStoredEnvelope(storage, nowMs);
  return journal.walletRequests.find((record) => {
    if (record.wallet !== normalizedWallet || !BLOCKING_WALLET_REQUEST_STATES.has(record.state)) return false;
    if (record.state !== "HASH_RECEIVED") return true;
    const execution = journal.executions.find((candidate) => candidate.txHash === record.txHash);
    return !execution || execution.state === "submitted";
  }) ?? null;
}

function boundVNextSwapCalldataHash(plan: VNextAuthorizationPlan): Hex | null {
  if (plan.settlementMode === "PROVIDER_NATIVE_INPUT_FEE") {
    try { assertVNextZeroXPlanBinding(plan); return plan.providerNativeFee!.transactionCalldataHash; } catch { return null; }
  }
  if (plan.settlementMode === VNEXT_DIRECT_NO_RMT_FEE) {
    return plan.directAuthorization?.calldataHash ?? null;
  }
  if (plan.settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE) {
    return plan.feeV2Authorization?.calldataHash ?? null;
  }
  if (plan.settlementMode !== VNEXT_LEGACY_V1_FEE) return null;

  const execution = plan.feeExecution;
  const economics = plan.netEconomics;
  if (
    plan.provider !== "uniswap-v3"
    || !execution
    || !economics
    || economics.rmtFee.state !== "planned"
    || plan.directNoRmtFee !== undefined
    || plan.directAuthorization !== undefined
    || plan.feeV2Economics !== undefined
    || plan.feeV2Authorization !== undefined
  ) return null;

  try {
    assertRmtNetExecutionEconomics(economics);
    assertRmtUniswapV3FeeExecution(execution, economics);
    const canonicalData = encodeRmtUniswapV3FeeExecution(execution);
    if (
      getAddress(plan.target) !== RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor
      || getAddress(execution.executor) !== RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executor
      || execution.executorRuntimeHash.toLowerCase() !== RMT_UNISWAP_V3_FEE_MAINNET_PROOF.executorRuntimeHash
      || getAddress(execution.treasury) !== RMT_UNISWAP_V3_FEE_MAINNET_PROOF.treasury
      || execution.policyIdHash.toLowerCase() !== RMT_UNISWAP_V3_FEE_MAINNET_PROOF.policyIdHash
      || execution.policyVersion !== RMT_UNISWAP_V3_FEE_MAINNET_PROOF.policyVersion
      || execution.policyHash.toLowerCase() !== RMT_UNISWAP_V3_FEE_MAINNET_PROOF.policyHash
      || execution.feeBps !== RMT_UNISWAP_V3_FEE_MAINNET_PROOF.feeBps
      || getAddress(execution.trader) !== getAddress(plan.recipient)
      || execution.userGrossInputAtomic !== plan.inputAmountAtomic
      || execution.protectedUserNetOutputAtomic !== plan.protectedOutputAtomic
      || execution.deadline !== plan.deadline
      || canonicalData.toLowerCase() !== plan.data.toLowerCase()
    ) return null;
    return keccak256(canonicalData);
  } catch {
    return null;
  }
}

export function recordPreparedVNextWalletRequest(input: {
  requestId: string;
  wallet: string;
  plan: VNextAuthorizationPlan;
  walletNonceBeforeRequest: bigint;
  requestBlockNumber: bigint;
  requestBlockHash?: string;
  connectorId?: string;
  connectorType?: string;
  walletClientType?: string;
  walletName?: string;
}, storage?: VNextExecutionStorage, nowMs = Date.now()) {
  const boundCalldataHash = input.plan.kind === "swap" ? boundVNextSwapCalldataHash(input.plan) : null;
  const calldataHash = keccak256(input.plan.data);
  if (
    !/^[0-9a-f-]{36}$/i.test(input.requestId)
    || !isAddress(input.wallet, { strict: false })
    || input.walletNonceBeforeRequest < 0n
    || input.requestBlockNumber < 0n
    || (input.requestBlockHash !== undefined && !isHash(input.requestBlockHash))
    || [input.connectorId, input.connectorType, input.walletClientType, input.walletName].some((value) => (
      value !== undefined && !/^[\x20-\x7e]{1,160}$/.test(value)
    ))
    || authorizationPayloadHash(input.plan).toLowerCase() !== input.plan.payloadHash.toLowerCase()
    || !isVNextPlanRecoveryAdmissible(input.plan, input.wallet)
    || (input.plan.kind === "swap" && (
      !boundCalldataHash || calldataHash.toLowerCase() !== boundCalldataHash.toLowerCase()
    ))
  ) return null;
  const wallet = getAddress(input.wallet);
  if (wallet !== getAddress(input.plan.recipient) || findBlockingVNextWalletRequest(wallet, storage, nowMs)) return null;
  const current = readStoredEnvelope(storage, nowMs);
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
  const record: VNextWalletRequestRecord = {
    schemaVersion: SCHEMA_VERSION,
    requestId: input.requestId,
    planId: input.plan.planId,
    payloadHash: input.plan.payloadHash.toLowerCase() as Hex,
    wallet,
    chainId: 4_663,
    provider: input.plan.provider,
    planKind: input.plan.kind,
    target: getAddress(input.plan.target),
    value: input.plan.value,
    calldataHash,
    inputAsset: getAddress(input.plan.inputAsset),
    outputAsset: getAddress(input.plan.outputAsset),
    inputAmountAtomic: input.plan.inputAmountAtomic,
    protectedOutputAtomic: input.plan.protectedOutputAtomic,
    finalOnchainDeadline: input.plan.deadline,
    planExpiresAtMs: input.plan.expiresAtMs,
    requestedAtMs: nowMs,
    walletNonceBeforeRequest: input.walletNonceBeforeRequest.toString(),
    requestBlockNumber: input.requestBlockNumber.toString(),
    ...(input.requestBlockHash ? { requestBlockHash: input.requestBlockHash.toLowerCase() as Hash } : {}),
    ...(input.connectorId ? { connectorId: input.connectorId } : {}),
    ...(input.connectorType ? { connectorType: input.connectorType } : {}),
    ...(input.walletClientType ? { walletClientType: input.walletClientType } : {}),
    ...(input.walletName ? { walletName: input.walletName } : {}),
    recoveryPlan: input.plan,
    ...(v4DirectSettlement ? { v4DirectSettlement } : {}),
    state: "PREPARED",
    updatedAtMs: nowMs
  };
  return writeCombinedJournal(current.executions, [record, ...current.walletRequests], storage, nowMs) ? record : null;
}

export function transitionVNextWalletRequest(
  requestId: string,
  state: VNextWalletRequestState,
  storage?: VNextExecutionStorage,
  nowMs = Date.now()
) {
  const current = readStoredEnvelope(storage, nowMs);
  const existing = current.walletRequests.find((record) => record.requestId === requestId);
  if (!existing) return null;
  const allowed: Record<VNextWalletRequestState, readonly VNextWalletRequestState[]> = {
    PREPARED: ["PROMPT_REQUESTED", "EXPIRED_UNSUBMITTED", "UNRESOLVED"],
    PROMPT_REQUESTED: ["PROVIDER_PENDING", "USER_REJECTED", "EXPIRED_UNSUBMITTED", "UNRESOLVED", "HASH_RECEIVED"],
    PROVIDER_PENDING: ["USER_REJECTED", "UNRESOLVED", "HASH_RECEIVED", "EXPIRED_UNSUBMITTED"],
    USER_REJECTED: [],
    EXPIRED_UNSUBMITTED: [],
    UNRESOLVED: ["USER_REJECTED", "HASH_RECEIVED", "EXPIRED_UNSUBMITTED"],
    HASH_RECEIVED: [],
    RECEIPT_CONFIRMED: [],
    RECEIPT_REVERTED: []
  };
  if (!allowed[existing.state].includes(state)) return null;
  const updated = {
    ...existing,
    state,
    txHash: undefined,
    ...(state === "PROMPT_REQUESTED" ? { promptRequestedAtMs: nowMs } : {}),
    ...(state === "PROVIDER_PENDING" ? { providerPendingAtMs: nowMs } : {}),
    updatedAtMs: nowMs
  } as VNextWalletRequestRecord;
  return writeCombinedJournal(
    current.executions,
    [updated, ...current.walletRequests.filter((record) => record.requestId !== requestId)],
    storage,
    nowMs
  ) ? updated : null;
}

export function reconcileExpiredVNextWalletRequest(input: {
  request: VNextWalletRequestRecord;
  latestNonce: bigint | null;
  pendingNonce: bigint | null;
  nowMs: number;
}, storage?: VNextExecutionStorage) {
  const { request } = input;
  // Opaque 0x calldata has no RMT-proven onchain deadline. Never infer that
  // an unanswered wallet request is safely unsubmitted from a local timeout.
  if (request.provider === "zero-x-swap") return request;
  if (request.planKind !== "swap" || input.nowMs < Number(BigInt(request.finalOnchainDeadline) * 1_000n)) return request;
  const before = BigInt(request.walletNonceBeforeRequest);
  const safelyUnsubmitted = input.latestNonce !== null && input.pendingNonce !== null
    && input.latestNonce === before && input.pendingNonce === before;
  return transitionVNextWalletRequest(
    request.requestId,
    safelyUnsubmitted ? "EXPIRED_UNSUBMITTED" : "UNRESOLVED",
    storage,
    input.nowMs
  ) ?? request;
}

export function classifyVNextRevertedExecution(input: {
  decodedRevertReason?: string | null;
  transactionDeadline?: string;
  receiptBlockTimestamp?: bigint | null;
}) {
  if (
    input.decodedRevertReason === "Transaction too old"
    || input.transactionDeadline !== undefined
      && input.receiptBlockTimestamp !== undefined
      && input.receiptBlockTimestamp !== null
      && BigInt(input.transactionDeadline) < input.receiptBlockTimestamp
  ) return "EXPIRED_ONCHAIN_DEADLINE" as const;
  return null;
}

function feeV2AssetAddress(assetId: string) {
  if (assetId === "eip155:4663/native") return "0x0000000000000000000000000000000000000000" as Address;
  const address = assetId.startsWith("eip155:4663/contract:") ? assetId.slice("eip155:4663/contract:".length) : "";
  return isAddress(address, { strict: false }) ? getAddress(address) : null;
}

function feeV2PlanAuthority(plan: VNextAuthorizationPlan, wallet: Address) {
  if (!plan.feeV2Economics || !plan.feeV2Authorization || plan.settlementMode !== VNEXT_V2_ATOMIC_INPUT_FEE) return null;
  try {
    const economics = plan.feeV2Economics;
    const binding = plan.feeV2Authorization;
    const authority = feeV2RecoveryAuthority(plan.provider);
    if (!authority) return null;
    assertRmtExecutionFeeV2Economics(economics);
    assertVNextAtomicFeeAuthorizationBinding(binding, economics, binding);
    const inputAsset = feeV2AssetAddress(economics.inputAsset);
    const outputAsset = feeV2AssetAddress(economics.outputAsset);
    if (
      !inputAsset || !outputAsset
      || binding.provider !== plan.provider || binding.verificationState !== "verified_atomic"
      || binding.settlementMode !== "v2-atomic-input-fee"
      || binding.implementationId !== authority.implementationId
      || binding.atomicFeeSettlement !== true || binding.revertsAtomically !== true
      || authorizationPayloadHash(plan).toLowerCase() !== plan.payloadHash.toLowerCase()
      || getAddress(binding.recipient) !== wallet || getAddress(plan.recipient) !== wallet
      || getAddress(binding.providerTarget) !== getAddress(authority.providerTarget)
      || getAddress(plan.router) !== getAddress(authority.providerTarget)
      || (authority.executionTarget !== null && getAddress(binding.executionTarget) !== getAddress(authority.executionTarget))
      || getAddress(inputAsset) !== getAddress(plan.inputAsset)
      || getAddress(outputAsset) !== getAddress(plan.outputAsset)
      || economics.userGrossInputAtomic !== plan.inputAmountAtomic
      || economics.providerProtectedOutputAtomic !== plan.protectedOutputAtomic
      || binding.deadline !== plan.deadline
      || (authority.policyHash !== null && economics.policyHash.toLowerCase() !== authority.policyHash.toLowerCase())
      || (authority.treasury !== null && getAddress(economics.treasury) !== getAddress(authority.treasury))
    ) return null;
    return { economics, binding, authority };
  } catch {
    return null;
  }
}

function exactV2ApprovalPlan(plan: VNextAuthorizationPlan, wallet: Address) {
  const feeAuthority = feeV2PlanAuthority(plan, wallet);
  if (!feeAuthority || plan.kind !== "erc20_approval" || plan.value !== "0" || isRobinhoodNativeAsset(plan.inputAsset)) return false;
  try {
    const decoded = decodeFunctionData({ abi: erc20Abi, data: plan.data });
    if (decoded.functionName !== "approve") return false;
    const canonical = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: decoded.args });
    return canonical.toLowerCase() === plan.data.toLowerCase()
      && getAddress(plan.target) === getAddress(plan.inputAsset)
      && getAddress(decoded.args[0]) === getAddress(feeAuthority.binding.executionTarget)
      && decoded.args[1] === BigInt(plan.inputAmountAtomic);
  } catch {
    return false;
  }
}

function v2SettlementFromPlan(plan: VNextAuthorizationPlan, wallet: Address): VNextExecutionRecord["feeV2Settlement"] | null {
  if (plan.kind !== "swap") return null;
  const feeAuthority = feeV2PlanAuthority(plan, wallet);
  if (!feeAuthority) return null;
  try {
    const { economics, binding, authority } = feeAuthority;
    const decoded = plan.provider === "uniswap-v2"
      ? decodeRmtUniswapV2FeeAuthorizationV2(plan.data)
      : plan.provider === "uniswap-v3"
        ? decodeRmtUniswapV3FeeAuthorizationV2(plan.data)
        : null;
    if (!decoded) return null;
    const authorization = decoded.authorization;
    const calldataHash = keccak256(plan.data);
    const expectedValue = isRobinhoodNativeAsset(authorization.requestedInputAsset)
      ? authorization.userGrossInput
      : 0n;
    if (
      calldataHash.toLowerCase() !== binding.calldataHash.toLowerCase()
      || getAddress(plan.target) !== getAddress(binding.executionTarget)
      || getAddress(authorization.trader) !== wallet
      || getAddress(plan.router) !== getAddress(authority.providerTarget)
      || binding.executionId.toLowerCase() !== authorization.executionId.toLowerCase()
      || authorization.policyIdHash.toLowerCase() !== authority.policyIdHash.toLowerCase()
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
      || authorization.expectedProviderOutput !== BigInt(economics.providerGrossExpectedOutputAtomic)
      || authorization.protectedOutput !== BigInt(plan.protectedOutputAtomic)
      || authorization.protectedOutput !== BigInt(economics.providerProtectedOutputAtomic)
      || authorization.deadline !== BigInt(plan.deadline)
      || authorization.deadline !== BigInt(binding.deadline)
      || BigInt(plan.value) !== expectedValue
      || (plan.provider === "uniswap-v2" && (
        getAddress(authorization.routedInputAsset) !== decoded.route.tokenIn
        || getAddress(authorization.routedOutputAsset) !== decoded.route.tokenOut
      ))
    ) return null;
    return {
      provider: authority.provider,
      implementationId: binding.implementationId,
      executor: getAddress(plan.target),
      executionTarget: getAddress(binding.executionTarget),
      providerTarget: getAddress(binding.providerTarget),
      executionId: authorization.executionId.toLowerCase() as Hex,
      policyIdHash: authorization.policyIdHash.toLowerCase() as Hex,
      policyHash: authorization.policyHash.toLowerCase() as Hex,
      policyVersion: 2,
      providerId: authority.providerId,
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

export function isVNextPlanRecoveryAdmissible(plan: VNextAuthorizationPlan, wallet: string) {
  try {
    if (!isAddress(wallet, { strict: false }) || getAddress(wallet) !== getAddress(plan.recipient)) return false;
    if (plan.settlementMode === "PROVIDER_NATIVE_INPUT_FEE") {
      assertVNextZeroXPlanBinding(plan);
      return plan.payloadHash === authorizationPayloadHash(plan);
    }
    const carriesV2Authority = Boolean(plan.feeV2Economics || plan.feeV2Authorization);
    if (!carriesV2Authority) return plan.settlementMode !== VNEXT_V2_ATOMIC_INPUT_FEE;
    if (!plan.feeV2Economics || !plan.feeV2Authorization || plan.feeExecution) return false;
    const normalizedWallet = getAddress(wallet);
    return plan.kind === "swap"
      ? v2SettlementFromPlan(plan, normalizedWallet) !== null
      : exactV2ApprovalPlan(plan, normalizedWallet);
  } catch {
    return false;
  }
}

function buildSubmittedVNextExecutionRecord(input: {
  wallet: string;
  plan: VNextAuthorizationPlan;
  txHash: string;
}, nowMs: number): VNextExecutionRecord | null {
  if (!isAddress(input.wallet, { strict: false }) || !isHash(input.txHash)) return null;
  const wallet = getAddress(input.wallet);
  if (wallet !== getAddress(input.plan.recipient)) return null;
  if (!isVNextPlanRecoveryAdmissible(input.plan, wallet)) return null;
  const normalizedHash = input.txHash.toLowerCase() as Hash;
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
  const providerNativeFee = input.plan.kind === "swap" && input.plan.provider === "zero-x-swap" && input.plan.providerNativeFee
    ? {
        provider: "zero-x-swap" as const,
        treasury: getAddress(input.plan.providerNativeFee.treasury),
        feeAsset: getAddress(input.plan.providerNativeFee.feeAsset),
        feeBps: 25 as const,
        feeAmountAtomic: input.plan.providerNativeFee.feeAmountAtomic,
        expectedOutputAtomic: input.plan.providerNativeFee.expectedOutputAtomic,
        protectedOutputAtomic: input.plan.providerNativeFee.protectedOutputAtomic,
        providerFeeAsset: input.plan.providerNativeFee.providerFeeAsset ? getAddress(input.plan.providerNativeFee.providerFeeAsset) : null,
        providerFeeAtomic: input.plan.providerNativeFee.providerFeeAtomic,
        transactionTarget: getAddress(input.plan.providerNativeFee.transactionTarget!),
        calldataHash: input.plan.providerNativeFee.transactionCalldataHash!
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
    ...(providerNativeFee ? { providerNativeFee } : {}),
    ...(v4DirectSettlement ? { v4DirectSettlement } : {}),
    planId: input.plan.planId,
    payloadHash: input.plan.payloadHash.toLowerCase() as Hex,
    ...(input.plan.provider !== "zero-x-swap" ? { deadline: input.plan.deadline } : {}),
    txHash: normalizedHash,
    state: "submitted",
    submittedAtMs: nowMs,
    updatedAtMs: nowMs
  };
  return record;
}

export function recordSubmittedVNextExecution(input: {
  wallet: string;
  plan: VNextAuthorizationPlan;
  txHash: string;
}, storage?: VNextExecutionStorage, nowMs = Date.now()) {
  const current = readVNextExecutionJournal(storage, nowMs);
  const record = buildSubmittedVNextExecutionRecord(input, nowMs);
  if (!record) return null;
  const existing = current.find((candidate) => candidate.txHash === record.txHash);
  if (existing) {
    return existing.wallet === record.wallet
      && existing.planId === record.planId
      && existing.payloadHash === record.payloadHash
      ? existing
      : null;
  }
  return record && writeJournal([record, ...current], storage, nowMs) ? record : null;
}

export function promoteVNextWalletRequestToSubmitted(input: {
  requestId: string;
  wallet: string;
  plan: VNextAuthorizationPlan;
  txHash: string;
}, storage?: VNextExecutionStorage, nowMs = Date.now()) {
  const current = readStoredEnvelope(storage, nowMs);
  const request = current.walletRequests.find((candidate) => candidate.requestId === input.requestId);
  const record = buildSubmittedVNextExecutionRecord(input, nowMs);
  if (
    !request || !record
    || request.wallet !== record.wallet
    || request.planId !== record.planId
    || request.payloadHash.toLowerCase() !== record.payloadHash.toLowerCase()
    || !["PROMPT_REQUESTED", "PROVIDER_PENDING", "UNRESOLVED"].includes(request.state)
  ) return null;
  const hashReceived: VNextWalletRequestRecord = {
    ...request,
    state: "HASH_RECEIVED",
    txHash: record.txHash,
    updatedAtMs: nowMs
  };
  const executions = [record, ...current.executions.filter((candidate) => candidate.txHash !== record.txHash)];
  const requests = [hashReceived, ...current.walletRequests.filter((candidate) => candidate.requestId !== request.requestId)];
  return writeCombinedJournal(executions, requests, storage, nowMs) ? record : null;
}

export function promoteDiscoveredVNextWalletRequestToSubmitted(input: {
  requestId: string;
  txHash: string;
}, storage?: VNextExecutionStorage, nowMs = Date.now()) {
  if (!isHash(input.txHash)) return null;
  const current = readStoredEnvelope(storage, nowMs);
  const request = current.walletRequests.find((candidate) => candidate.requestId === input.requestId);
  if (!request || !request.recoveryPlan || !["PROMPT_REQUESTED", "PROVIDER_PENDING", "UNRESOLVED"].includes(request.state)) return null;
  const record = buildSubmittedVNextExecutionRecord({ wallet: request.wallet, plan: request.recoveryPlan, txHash: input.txHash }, nowMs);
  if (!record) return null;
  const hashReceived: VNextWalletRequestRecord = {
    ...request,
    state: "HASH_RECEIVED",
    txHash: record.txHash,
    updatedAtMs: nowMs
  };
  const executions = [record, ...current.executions.filter((candidate) => candidate.txHash !== record.txHash)];
  const requests = [hashReceived, ...current.walletRequests.filter((candidate) => candidate.requestId !== request.requestId)];
  return writeCombinedJournal(executions, requests, storage, nowMs) ? record : null;
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
    grossActualOutputAtomic: grossOutput.toString(),
    actualUserNetOutputAtomic: netOutput.toString()
  };
}

function settledVNextUniswapV3FeeExecutionV2(record: VNextExecutionRecord, logs: readonly {
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

function settledVNextUniswapV2FeeExecutionV2(record: VNextExecutionRecord, logs: readonly {
  address: string;
  data: Hex;
  topics: readonly Hex[];
}[]) {
  const expected = record.feeV2Settlement;
  if (record.kind !== "swap" || !expected || expected.provider !== "uniswap-v2") return null;
  const emitterLogs = logs.filter((log) =>
    isAddress(log.address, { strict: false }) && getAddress(log.address) === expected.executionTarget
  );
  if (emitterLogs.length !== 1 || emitterLogs[0].topics.length === 0) return null;
  try {
    const decoded = decodeEventLog({
      abi: rmtUniswapV2FeeExecutorV2Abi,
      eventName: "RMTUniswapV2FeeSettledV2",
      data: emitterLogs[0].data,
      topics: emitterLogs[0].topics as [Hex, ...Hex[]]
    });
    if (decoded.eventName !== "RMTUniswapV2FeeSettledV2") return null;
    const event = decoded.args;
    const exactFee = BigInt(calculateRmtFeeFloor(expected.userGrossInputAtomic, 25));
    if (
      getAddress(emitterLogs[0].address) !== RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR
      || expected.executor !== RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR
      || expected.executionTarget !== RMT_UNISWAP_V2_V2_DEPLOYED_EXECUTOR
      || expected.implementationId !== RMT_UNISWAP_V2_V2_IMPLEMENTATION_ID
      || event.executionId.toLowerCase() !== expected.executionId.toLowerCase()
      || event.policyIdHash.toLowerCase() !== RMT_UNISWAP_V2_V2_POLICY_ID_HASH.toLowerCase()
      || event.policyIdHash.toLowerCase() !== expected.policyIdHash.toLowerCase()
      || event.policyHash.toLowerCase() !== RMT_UNISWAP_V2_V2_POLICY_HASH.toLowerCase()
      || event.policyHash.toLowerCase() !== expected.policyHash.toLowerCase()
      || event.policyVersion !== 2n
      || getAddress(event.trader) !== record.wallet
      || event.providerId.toLowerCase() !== RMT_UNISWAP_V2_V2_PROVIDER_ID.toLowerCase()
      || event.providerId.toLowerCase() !== expected.providerId.toLowerCase()
      || getAddress(event.router) !== ROBINHOOD_UNISWAP_V2_ROUTER
      || getAddress(event.router) !== expected.providerTarget
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
      || getAddress(event.treasury) !== RMT_UNISWAP_V2_V2_TREASURY
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

export function settledVNextFeeExecutionV2(record: VNextExecutionRecord, logs: readonly {
  address: string;
  data: Hex;
  topics: readonly Hex[];
}[]) {
  if (record.feeV2Settlement?.provider === "uniswap-v2") {
    return settledVNextUniswapV2FeeExecutionV2(record, logs);
  }
  if (record.feeV2Settlement?.provider === "uniswap-v3") {
    return settledVNextUniswapV3FeeExecutionV2(record, logs);
  }
  return null;
}

export function settledVNextOutputAtomic(record: VNextExecutionRecord, logs: readonly {
  address: string;
  data: Hex;
  topics: readonly Hex[];
}[]) {
  if (record.kind !== "swap") return null;
  if (record.feeV2Settlement) return null;
  if (isRobinhoodNativeAsset(record.outputAsset)) {
    // WETH withdrawals inside an aggregate route do not prove ETH delivery.
    if (record.provider === "zero-x-swap") return null;
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
    actualUserNetOutputAtomic?: string;
    actualRmtFeeAtomic?: string;
    actualProviderOutputAtomic?: string;
  },
  failure?: {
    classification?: "EXPIRED_ONCHAIN_DEADLINE";
    networkGasSpentWei?: string;
  }
) {
  if (!isHash(txHash)) return null;
  const normalizedHash = txHash.toLowerCase();
  const current = readStoredEnvelope(storage, nowMs);
  const existing = current.executions.find((record) => record.txHash === normalizedHash);
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
  if (state === "confirmed" && existing.feeSettlement && (
    settlement?.actualFeeAtomic === undefined || settlement.grossActualOutputAtomic === undefined
    || settlement.actualUserNetOutputAtomic === undefined
    || settlement.outputAmountAtomic !== settlement.actualUserNetOutputAtomic
    || !/^(0|[1-9][0-9]*)$/.test(settlement.actualFeeAtomic)
    || !/^[1-9][0-9]*$/.test(settlement.grossActualOutputAtomic)
    || !/^[1-9][0-9]*$/.test(settlement.actualUserNetOutputAtomic)
  )) return null;
  if (state === "confirmed" && existing.feeSettlement && settlement) {
    const actualFee = BigInt(settlement.actualFeeAtomic!);
    const grossOutput = BigInt(settlement.grossActualOutputAtomic!);
    const userNetOutput = BigInt(settlement.actualUserNetOutputAtomic!);
    const maximumFee = BigInt(existing.feeSettlement.maximumFeeAtomic);
    const outputSideCandidate = BigInt(calculateRmtFeeFloor(grossOutput.toString(), existing.feeSettlement.feeBps));
    const expectedActualFee = existing.feeSettlement.feeSide === "input"
      ? maximumFee
      : outputSideCandidate < maximumFee ? outputSideCandidate : maximumFee;
    if (
      actualFee !== expectedActualFee || actualFee > maximumFee
      || userNetOutput < BigInt(existing.feeSettlement.protectedUserNetOutputAtomic)
      || (existing.feeSettlement.feeSide === "input"
        ? userNetOutput !== grossOutput
        : userNetOutput + actualFee !== grossOutput)
    ) return null;
  }
  if (failure?.networkGasSpentWei !== undefined && !/^[1-9][0-9]*$/.test(failure.networkGasSpentWei)) return null;
  if (state !== "reverted" && (failure?.classification || failure?.networkGasSpentWei)) return null;
  const resolved: VNextExecutionRecord = {
    ...existing,
    state,
    ...(state === "confirmed" && existing.kind === "swap" && (outputAmountAtomic ?? existing.outputAmountAtomic)
      ? { outputAmountAtomic: outputAmountAtomic ?? existing.outputAmountAtomic }
      : { outputAmountAtomic: undefined }),
    ...(existing.feeSettlement ? { feeSettlement: {
      ...existing.feeSettlement,
      ...(state === "confirmed" && settlement?.actualFeeAtomic !== undefined
        && settlement.grossActualOutputAtomic !== undefined && settlement.actualUserNetOutputAtomic !== undefined
        ? {
            actualFeeAtomic: settlement.actualFeeAtomic,
            grossActualOutputAtomic: settlement.grossActualOutputAtomic,
            actualUserNetOutputAtomic: settlement.actualUserNetOutputAtomic
          }
        : { actualFeeAtomic: undefined, grossActualOutputAtomic: undefined, actualUserNetOutputAtomic: undefined })
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
    ...(state === "reverted" && failure?.classification ? { failureClassification: failure.classification } : { failureClassification: undefined }),
    ...(state === "reverted" && failure?.networkGasSpentWei ? { networkGasSpentWei: failure.networkGasSpentWei } : { networkGasSpentWei: undefined }),
    updatedAtMs: nowMs
  };
  const matchingRequest = current.walletRequests.find((request) =>
    request.state === "HASH_RECEIVED"
    && request.txHash === normalizedHash
    && request.wallet === existing.wallet
    && request.planId === existing.planId
    && request.payloadHash === existing.payloadHash
  );
  const terminalRequest = matchingRequest ? {
    ...matchingRequest,
    state: state === "confirmed" ? "RECEIPT_CONFIRMED" as const : "RECEIPT_REVERTED" as const,
    updatedAtMs: nowMs
  } : null;
  const executions = [resolved, ...current.executions.filter((record) => record.txHash !== normalizedHash)];
  const walletRequests = terminalRequest
    ? [terminalRequest, ...current.walletRequests.filter((request) => request.requestId !== terminalRequest.requestId)]
    : current.walletRequests;
  return writeCombinedJournal(executions, walletRequests, storage, nowMs) ? resolved : null;
}
