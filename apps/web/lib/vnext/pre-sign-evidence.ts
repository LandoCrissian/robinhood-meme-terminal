import { getAddress, isAddress, keccak256 } from "viem";
import { z } from "zod";
import {
  PERMIT2_ADDRESS,
  ROBINHOOD_SWAP_ROUTER_02,
  ROBINHOOD_UNIVERSAL_ROUTER,
  ROBINHOOD_V4_POOL_MANAGER,
  ROBINHOOD_V4_QUOTER
} from "../uniswap-v4";
import { uniswapV4PoolId } from "../uniswap-transaction-integrity";
import type { VNextUniswapV4ExecutionEvidence } from "../server/vnext-uniswap-v4-execution";
import { isRobinhoodNativeAsset } from "./robinhood-assets";
import { UP_CL_EXECUTION_ROUTER, UP_V2_EXECUTION_ROUTER } from "./up-authorization-codec";
import { ROBINHOOD_UNISWAP_V2_ROUTER } from "./uniswap-v2-authorization-codec";
import { assertRmtNetExecutionEconomics, type RmtNetExecutionEconomics } from "./execution-fee-policy";
import { assertRmtExecutionFeeV2Economics, type RmtExecutionFeeV2Economics } from "./execution-fee-policy-v2";
import type { VNextAtomicFeeSettlementProof } from "./provider-fee-settlement";
import {
  assertVNextDirectNoRmtFeeSettlement,
  VNEXT_DIRECT_NO_RMT_FEE,
  VNEXT_LEGACY_V1_FEE,
  VNEXT_PROVIDER_NATIVE_INPUT_FEE,
  VNEXT_V2_ATOMIC_INPUT_FEE,
  type VNextDirectNoRmtFeeSettlement,
  type VNextExecutionSettlementMode
} from "./execution-settlement";
import { assertVNextZeroXProviderNativeFee, type VNextZeroXProviderNativeFee } from "./zero-x-settlement";
import { assertRmtUniswapV3FeeExecution, encodeRmtUniswapV3FeeExecution, type RmtUniswapV3FeeExecution } from "./uniswap-v3-fee-executor";

const MAX_CLOCK_SKEW_MS = 5_000;

function feeAssetIdentity(address: string) {
  return isRobinhoodNativeAsset(address)
    ? "eip155:4663/native"
    : `eip155:4663/contract:${getAddress(address).toLowerCase()}`;
}

export type VNextPreSignEvidence = {
  verificationId: string;
  sourceQuoteRequestId: string;
  provider: "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "zero-x-swap" | "up-v2" | "up-cl";
  status: "verified" | "approval_required" | "approval_simulation_failed" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
  chainId: 4_663;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  indicativeProtectedOutputFloorAtomic: string;
  expectedOutputAtomic: string;
  protectedOutputAtomic: string;
  recipient: string;
  router: string;
  approvalSpender: string;
  approvalRequired: boolean;
  sufficientBalance: boolean;
  allowanceAtomic: string;
  balanceAtomic: string;
  route: "direct" | "weth_hop" | "v4_pool" | "aggregated";
  fees: number[];
  pools: string[];
  stableFlags?: boolean[];
  tickSpacings?: number[];
  quoteBlock?: string;
  quoteBlockHash?: string;
  deadline: string;
  calldataHash: string;
  nextAction: "approval" | "swap" | null;
  nextActionTarget: string | null;
  nextActionCalldataHash: string | null;
  transactionValueAtomic: string;
  nativeBalanceWei: string;
  gasPriceWei: string;
  feeCeilingWei: string;
  estimatedGasUnits: string | null;
  gasLimitUnits: string | null;
  estimatedNetworkCostWei: string | null;
  estimatedNetworkCostUsdgAtomic: string | null;
  networkCostValuationSource: "canonical_uniswap_v3_weth_usdg_quote_plus_1pct" | null;
  networkCostValuedAtMs: number | null;
  networkCostValuationExpiresAtMs: number | null;
  gasState: "sufficient" | "insufficient" | "unavailable" | "not_checked";
  routerRuntimeHash: string;
  factoryRuntimeHash: string | null;
  quoterRuntimeHash: string | null;
  exactSimulationPassed: boolean;
  userPaysGas: true;
  rmtFeeEnabled: boolean;
  settlementMode: VNextExecutionSettlementMode;
  directNoRmtFee?: VNextDirectNoRmtFeeSettlement;
  netEconomics?: RmtNetExecutionEconomics;
  feeExecution?: RmtUniswapV3FeeExecution | null;
  feeV2Economics?: RmtExecutionFeeV2Economics;
  feeV2Settlement?: VNextAtomicFeeSettlementProof;
  providerNativeFee?: VNextZeroXProviderNativeFee;
  infrastructureVerifiedAtBlock?: string;
  infrastructureVerifiedAtBlockHash?: string;
  authorizationInfrastructureVerifiedAtBlock?: string;
  authorizationInfrastructureVerifiedAtBlockHash?: string;
  v2VerificationCommitment?: string;
  approvalKind?: "erc20_to_permit2" | "permit2_to_router" | "erc20_to_allowance_holder" | null;
  v4Execution?: VNextUniswapV4ExecutionEvidence;
  verifiedAtMs: number;
  expiresAtMs: number;
  authorizationReady: boolean;
};

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const evidenceSchema = z.object({
  verificationId: z.string().uuid(),
  sourceQuoteRequestId: z.string().uuid(),
  provider: z.enum(["uniswap-v2", "uniswap-v3", "uniswap-v4", "zero-x-swap", "up-v2", "up-cl"]),
  status: z.enum(["verified", "approval_required", "approval_simulation_failed", "insufficient_balance", "insufficient_gas", "gas_unavailable", "simulation_failed"]),
  chainId: z.literal(4_663),
  inputAsset: z.string(),
  outputAsset: z.string(),
  inputAmountAtomic: atomic,
  indicativeProtectedOutputFloorAtomic: atomic,
  expectedOutputAtomic: atomic,
  protectedOutputAtomic: atomic,
  recipient: z.string(),
  router: z.string(),
  approvalSpender: z.string(),
  approvalRequired: z.boolean(),
  sufficientBalance: z.boolean(),
  allowanceAtomic: atomic,
  balanceAtomic: atomic,
  route: z.enum(["direct", "weth_hop", "v4_pool", "aggregated"]),
  fees: z.array(z.number().int().nonnegative()).max(2),
  pools: z.array(z.string()).max(2),
  stableFlags: z.array(z.boolean()).min(1).max(2).optional(),
  tickSpacings: z.array(z.number().int().positive().max(16_383)).min(1).max(2).optional(),
  quoteBlock: atomic.optional(),
  quoteBlockHash: hash.optional(),
  deadline: atomic,
  calldataHash: hash,
  nextAction: z.enum(["approval", "swap"]).nullable(),
  nextActionTarget: z.string().nullable(),
  nextActionCalldataHash: hash.nullable(),
  transactionValueAtomic: atomic,
  nativeBalanceWei: atomic,
  gasPriceWei: atomic,
  feeCeilingWei: atomic,
  estimatedGasUnits: atomic.nullable(),
  gasLimitUnits: atomic.nullable(),
  estimatedNetworkCostWei: atomic.nullable(),
  estimatedNetworkCostUsdgAtomic: atomic.nullable(),
  networkCostValuationSource: z.literal("canonical_uniswap_v3_weth_usdg_quote_plus_1pct").nullable(),
  networkCostValuedAtMs: z.number().int().positive().nullable(),
  networkCostValuationExpiresAtMs: z.number().int().positive().nullable(),
  gasState: z.enum(["sufficient", "insufficient", "unavailable", "not_checked"]),
  routerRuntimeHash: hash,
  factoryRuntimeHash: hash.nullable(),
  quoterRuntimeHash: hash.nullable(),
  exactSimulationPassed: z.boolean(),
  userPaysGas: z.literal(true),
  rmtFeeEnabled: z.boolean(),
  settlementMode: z.enum([VNEXT_DIRECT_NO_RMT_FEE, VNEXT_PROVIDER_NATIVE_INPUT_FEE, VNEXT_V2_ATOMIC_INPUT_FEE, VNEXT_LEGACY_V1_FEE]),
  directNoRmtFee: z.unknown().optional(),
  netEconomics: z.unknown().optional(),
  feeExecution: z.unknown().nullable().optional(),
  feeV2Economics: z.unknown().optional(),
  feeV2Settlement: z.unknown().optional(),
  providerNativeFee: z.unknown().optional(),
  infrastructureVerifiedAtBlock: atomic.optional(),
  infrastructureVerifiedAtBlockHash: hash.optional(),
  authorizationInfrastructureVerifiedAtBlock: atomic.optional(),
  authorizationInfrastructureVerifiedAtBlockHash: hash.optional(),
  v2VerificationCommitment: z.string().regex(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/).max(8_192).optional(),
  approvalKind: z.enum(["erc20_to_permit2", "permit2_to_router", "erc20_to_allowance_holder"]).nullable().optional(),
  v4Execution: z.unknown().optional(),
  verifiedAtMs: z.number().int().positive(),
  expiresAtMs: z.number().int().positive(),
  authorizationReady: z.boolean()
});

export function parseVNextPreSignEvidence(value: unknown, expected: {
  quoteRequestId: string;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  provider: "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "zero-x-swap" | "up-v2" | "up-cl";
  protectedOutputFloorAtomic: string;
  recipient: string;
}, nowMs: number): VNextPreSignEvidence {
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) throw new Error("RMT rejected malformed pre-sign evidence.");
  const evidence = parsed.data as VNextPreSignEvidence;
  const hasAuthorizationBlock = evidence.authorizationInfrastructureVerifiedAtBlock !== undefined;
  const hasAuthorizationBlockHash = evidence.authorizationInfrastructureVerifiedAtBlockHash !== undefined;
  if (hasAuthorizationBlock !== hasAuthorizationBlockHash) {
    throw new Error("RMT rejected incomplete authorization-time infrastructure authority.");
  }
  if (hasAuthorizationBlock && (
    evidence.provider !== "uniswap-v2"
    || evidence.settlementMode !== VNEXT_V2_ATOMIC_INPUT_FEE
    || !evidence.infrastructureVerifiedAtBlock
    || !evidence.infrastructureVerifiedAtBlockHash
    || BigInt(evidence.authorizationInfrastructureVerifiedAtBlock!) < BigInt(evidence.infrastructureVerifiedAtBlock)
  )) {
    throw new Error("RMT rejected invalid authorization-time infrastructure authority.");
  }
  if (
    evidence.sourceQuoteRequestId !== expected.quoteRequestId
    || !isAddress(evidence.inputAsset)
    || getAddress(evidence.inputAsset) !== getAddress(expected.inputAsset)
    || !isAddress(evidence.outputAsset)
    || getAddress(evidence.outputAsset) !== getAddress(expected.outputAsset)
    || evidence.inputAmountAtomic !== expected.inputAmountAtomic
    || evidence.provider !== expected.provider
    || evidence.indicativeProtectedOutputFloorAtomic !== expected.protectedOutputFloorAtomic
    || evidence.indicativeProtectedOutputFloorAtomic === "0"
    || BigInt(evidence.protectedOutputAtomic) < BigInt(expected.protectedOutputFloorAtomic)
    || !isAddress(evidence.recipient)
    || getAddress(evidence.recipient) !== getAddress(expected.recipient)
    || (evidence.provider !== "zero-x-swap" && getAddress(evidence.router) !== getAddress(evidence.provider === "uniswap-v2" ? ROBINHOOD_UNISWAP_V2_ROUTER : evidence.provider === "uniswap-v3" ? ROBINHOOD_SWAP_ROUTER_02 : evidence.provider === "uniswap-v4" ? ROBINHOOD_UNIVERSAL_ROUTER : evidence.provider === "up-v2" ? UP_V2_EXECUTION_ROUTER : UP_CL_EXECUTION_ROUTER))
    || evidence.protectedOutputAtomic === "0"
    || BigInt(evidence.protectedOutputAtomic) > BigInt(evidence.expectedOutputAtomic)
    || evidence.verifiedAtMs > nowMs + MAX_CLOCK_SKEW_MS
    || evidence.expiresAtMs <= nowMs
    || evidence.expiresAtMs - evidence.verifiedAtMs > 300_000
    || evidence.authorizationReady !== (evidence.provider === "zero-x-swap" && evidence.status === "verified")
    || (evidence.provider !== "zero-x-swap" && (evidence.factoryRuntimeHash === null || evidence.quoterRuntimeHash === null))
  ) throw new Error("RMT rejected inconsistent pre-sign evidence.");
  const hasV2Economics = evidence.feeV2Economics !== undefined;
  const hasV2Settlement = evidence.feeV2Settlement !== undefined;
  const hasProviderNativeFee = evidence.providerNativeFee !== undefined;
  if (hasV2Economics !== hasV2Settlement) throw new Error("RMT rejected incomplete V2 fee-settlement evidence.");
  if (evidence.settlementMode === VNEXT_DIRECT_NO_RMT_FEE) {
    assertVNextDirectNoRmtFeeSettlement(evidence.directNoRmtFee, evidence.inputAmountAtomic);
    if (
      evidence.rmtFeeEnabled
      || evidence.feeExecution != null
      || hasV2Economics
      || evidence.netEconomics?.rmtFee.state === "planned"
      || hasProviderNativeFee
    ) throw new Error("RMT rejected hidden fee authority in DIRECT_NO_RMT_FEE evidence.");
  } else if (evidence.directNoRmtFee !== undefined) {
    throw new Error("RMT rejected fee-free settlement fields in a fee-bearing mode.");
  }
  if (evidence.settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE && (!hasV2Economics || !hasV2Settlement)) {
    throw new Error("RMT rejected incomplete V2 fee-settlement evidence.");
  }
  if (evidence.settlementMode === VNEXT_PROVIDER_NATIVE_INPUT_FEE) {
    const providerNativeFee = evidence.providerNativeFee;
    if (
      evidence.provider !== "zero-x-swap"
      || !providerNativeFee
      || !evidence.rmtFeeEnabled
      || evidence.directNoRmtFee !== undefined
      || evidence.feeExecution != null
      || hasV2Economics
      || hasV2Settlement
      || evidence.netEconomics !== undefined
      || evidence.v4Execution !== undefined
    ) throw new Error("RMT rejected incomplete 0x provider-native fee evidence.");
    assertVNextZeroXProviderNativeFee(providerNativeFee);
    const firmQuote = providerNativeFee.firmQuote;
    if (!firmQuote || evidence.factoryRuntimeHash !== null || evidence.quoterRuntimeHash !== null
      || providerNativeFee.chainId !== evidence.chainId
      || getAddress(providerNativeFee.feeAsset) !== getAddress(evidence.inputAsset)
      || getAddress(providerNativeFee.outputAsset) !== getAddress(evidence.outputAsset)
      || evidence.routerRuntimeHash !== firmQuote.targetRuntimeHash
      || evidence.gasLimitUnits !== firmQuote.nextActionGasLimitUnits
      || (firmQuote.gasPriceWei !== null && evidence.gasPriceWei !== firmQuote.gasPriceWei)
      || evidence.exactSimulationPassed !== firmQuote.exactSimulationPassed
      || evidence.verifiedAtMs < firmQuote.observedAtMs || evidence.expiresAtMs !== firmQuote.expiresAtMs
      || evidence.approvalRequired !== (!isRobinhoodNativeAsset(evidence.inputAsset) && BigInt(evidence.allowanceAtomic) < BigInt(evidence.inputAmountAtomic))
      || evidence.approvalKind !== (evidence.approvalRequired ? "erc20_to_allowance_holder" : null)
      || (firmQuote.allowanceTarget !== null && getAddress(evidence.approvalSpender) !== getAddress(firmQuote.allowanceTarget))
      || evidence.sufficientBalance !== (BigInt(evidence.balanceAtomic) >= BigInt(isRobinhoodNativeAsset(evidence.inputAsset) ? providerNativeFee.transactionValueAtomic! : evidence.inputAmountAtomic))
      || (!["verified", "approval_required"].includes(evidence.status) && (evidence.nextAction !== null || evidence.nextActionTarget !== null || evidence.nextActionCalldataHash !== null))
    ) throw new Error("RMT rejected incomplete 0x firm quote, balance, allowance or simulation binding.");
    if (
      providerNativeFee.userGrossInputAtomic !== evidence.inputAmountAtomic
      || providerNativeFee.expectedOutputAtomic !== evidence.expectedOutputAtomic
      || providerNativeFee.protectedOutputAtomic !== evidence.protectedOutputAtomic
      || getAddress(providerNativeFee.recipient) !== getAddress(evidence.recipient)
      || getAddress(providerNativeFee.transactionTarget!) !== getAddress(evidence.router)
      || providerNativeFee.transactionCalldataHash?.toLowerCase() !== evidence.calldataHash.toLowerCase()
      || (evidence.status === "verified" && providerNativeFee.authorizationState !== "verified")
      || (evidence.status === "approval_required" && providerNativeFee.authorizationState !== "approval_required")
      || (!["verified", "approval_required"].includes(evidence.status) && providerNativeFee.authorizationState !== "blocked")
    ) throw new Error("RMT rejected changed 0x provider-native fee authority.");
  } else if (hasProviderNativeFee) {
    throw new Error("RMT rejected 0x provider-native fee evidence outside its settlement mode.");
  }
  if (evidence.provider === "zero-x-swap" && evidence.settlementMode !== VNEXT_PROVIDER_NATIVE_INPUT_FEE) throw new Error("RMT rejected 0x claiming custom or fee-free settlement.");
  if (
    evidence.settlementMode === VNEXT_V2_ATOMIC_INPUT_FEE
    && (evidence.status === "verified" || evidence.status === "approval_required")
    && !evidence.v2VerificationCommitment
  ) {
    throw new Error("RMT rejected V2 evidence without server authorization authority.");
  }
  if (evidence.settlementMode !== VNEXT_V2_ATOMIC_INPUT_FEE && evidence.v2VerificationCommitment !== undefined) {
    throw new Error("RMT rejected V2 authorization authority outside V2 mode.");
  }
  if (evidence.settlementMode !== VNEXT_V2_ATOMIC_INPUT_FEE && hasV2Economics) {
    throw new Error("RMT rejected V2 fee evidence outside V2_ATOMIC_INPUT_FEE mode.");
  }
  if (evidence.settlementMode === VNEXT_LEGACY_V1_FEE && !evidence.rmtFeeEnabled) {
    throw new Error("RMT rejected incomplete historical V1 fee evidence.");
  }
  if (evidence.feeV2Economics && evidence.feeV2Settlement) {
    assertRmtExecutionFeeV2Economics(evidence.feeV2Economics);
    if (
      evidence.feeV2Settlement.verificationState !== "verified_atomic"
      || evidence.feeV2Settlement.provider !== evidence.provider
      || evidence.feeV2Settlement.settlementMode !== evidence.feeV2Economics.settlementMode
      || evidence.feeV2Economics.inputAsset !== feeAssetIdentity(evidence.inputAsset)
      || evidence.feeV2Economics.outputAsset !== feeAssetIdentity(evidence.outputAsset)
      || evidence.feeV2Economics.userGrossInputAtomic !== evidence.inputAmountAtomic
      || evidence.feeV2Economics.expectedUserNetOutputAtomic !== evidence.expectedOutputAtomic
      || evidence.feeV2Economics.protectedUserNetOutputAtomic !== evidence.protectedOutputAtomic
      || !isAddress(evidence.feeV2Settlement.executionTarget)
      || !isAddress(evidence.feeV2Settlement.providerTarget)
      || getAddress(evidence.feeV2Settlement.providerTarget) !== getAddress(evidence.router)
      || evidence.feeV2Settlement.calldataHash.toLowerCase() !== evidence.calldataHash.toLowerCase()
      || getAddress(evidence.feeV2Settlement.recipient) !== getAddress(evidence.recipient)
      || evidence.feeV2Settlement.deadline !== evidence.deadline
      || evidence.feeV2Settlement.atomicFeeSettlement !== true
      || evidence.feeV2Settlement.revertsAtomically !== true
    ) throw new Error("RMT rejected inconsistent V2 fee-settlement evidence.");
    if (evidence.provider === "uniswap-v2" && (
      !evidence.infrastructureVerifiedAtBlock
      || evidence.infrastructureVerifiedAtBlock === "0"
      || !evidence.infrastructureVerifiedAtBlockHash
    )) throw new Error("RMT rejected Uniswap V2 fee evidence without block-pinned infrastructure authority.");
    if (evidence.provider !== "uniswap-v2" && (
      evidence.infrastructureVerifiedAtBlock !== undefined
      || evidence.infrastructureVerifiedAtBlockHash !== undefined
    )) throw new Error("RMT rejected foreign Uniswap V2 infrastructure authority.");
  }
  if (evidence.rmtFeeEnabled && evidence.settlementMode !== VNEXT_PROVIDER_NATIVE_INPUT_FEE) {
    if (evidence.provider !== "uniswap-v3" || !evidence.netEconomics || !evidence.feeExecution) {
      throw new Error("RMT rejected incomplete fee-executor evidence.");
    }
    assertRmtNetExecutionEconomics(evidence.netEconomics);
    assertRmtUniswapV3FeeExecution(evidence.feeExecution, evidence.netEconomics);
    if (
      evidence.netEconomics.rmtFee.state !== "planned"
      || evidence.inputAmountAtomic !== evidence.netEconomics.userGrossInputAtomic
      || evidence.expectedOutputAtomic !== evidence.netEconomics.expectedUserNetOutputAtomic
      || evidence.protectedOutputAtomic !== evidence.netEconomics.protectedUserNetOutputAtomic
      || getAddress(evidence.approvalSpender) !== getAddress(evidence.feeExecution.executor)
      || getAddress(evidence.feeExecution.trader) !== getAddress(evidence.recipient)
      || evidence.feeExecution.deadline !== evidence.deadline
      || keccak256(encodeRmtUniswapV3FeeExecution(evidence.feeExecution)) !== evidence.calldataHash
      || (evidence.nextAction === "swap" && (
        !evidence.nextActionTarget
        || getAddress(evidence.nextActionTarget) !== getAddress(evidence.feeExecution.executor)
        || evidence.nextActionCalldataHash !== evidence.calldataHash
      ))
    ) throw new Error("RMT rejected changed fee-executor economics.");
  } else if (
    evidence.feeExecution != null
    || (evidence.netEconomics && evidence.netEconomics.rmtFee.state !== "disabled")
    || (evidence.provider !== "uniswap-v4" && getAddress(evidence.approvalSpender) !== getAddress(
      evidence.feeV2Settlement?.executionTarget ?? evidence.router
    ))
  ) {
    throw new Error("RMT rejected hidden or inconsistent fee authority.");
  }
  if (evidence.route === "direct" && (evidence.fees.length !== 1 || evidence.pools.length !== 1)) throw new Error("RMT rejected an inconsistent direct route.");
  if (evidence.route === "weth_hop" && (evidence.fees.length !== 2 || evidence.pools.length !== 2)) throw new Error("RMT rejected an inconsistent multihop route.");
  if (evidence.route === "v4_pool" && (evidence.provider !== "uniswap-v4" || evidence.fees.length !== 1 || evidence.pools.length !== 1)) {
    throw new Error("RMT rejected inconsistent V4 route evidence.");
  }
  if (evidence.route === "aggregated" && (evidence.provider !== "zero-x-swap" || evidence.fees.length !== 0 || evidence.pools.length !== 0)) {
    throw new Error("RMT rejected inconsistent 0x aggregated-route evidence.");
  }
  if (evidence.provider === "zero-x-swap" && evidence.route !== "aggregated") throw new Error("RMT rejected recursive 0x route classification.");
  if (evidence.provider === "up-v2" && (
    evidence.stableFlags?.length !== evidence.pools.length || evidence.tickSpacings !== undefined
    || evidence.quoteBlock === undefined || evidence.quoteBlockHash === undefined
  )) throw new Error("RMT rejected incomplete up v2 route evidence.");
  if (evidence.provider === "uniswap-v2" && (
    evidence.fees.some((fee) => fee !== 30)
    || evidence.stableFlags !== undefined || evidence.tickSpacings !== undefined
    || evidence.quoteBlock === undefined || evidence.quoteBlockHash === undefined
  )) throw new Error("RMT rejected incomplete Uniswap V2 route evidence.");
  if (evidence.provider === "up-cl" && (
    evidence.tickSpacings?.length !== evidence.pools.length || evidence.stableFlags !== undefined
    || evidence.quoteBlock === undefined || evidence.quoteBlockHash === undefined
  )) throw new Error("RMT rejected incomplete up CL route evidence.");
  if ((evidence.provider === "uniswap-v3" || evidence.provider === "uniswap-v4") && (evidence.stableFlags !== undefined || evidence.tickSpacings !== undefined || evidence.quoteBlock !== undefined || evidence.quoteBlockHash !== undefined)) {
    throw new Error("RMT rejected foreign route evidence on Uniswap.");
  }
  if (evidence.provider === "uniswap-v4") {
    const v4 = evidence.v4Execution;
    if (!v4
      || !/^0x[0-9a-fA-F]{64}$/.test(v4.poolId)
      || evidence.pools[0]?.toLowerCase() !== v4.poolId.toLowerCase()
      || uniswapV4PoolId(v4.poolKey).toLowerCase() !== v4.poolId.toLowerCase()
      || getAddress(v4.poolManager) !== getAddress(ROBINHOOD_V4_POOL_MANAGER)
      || getAddress(v4.quoter) !== getAddress(ROBINHOOD_V4_QUOTER)
      || getAddress(v4.universalRouter) !== getAddress(ROBINHOOD_UNIVERSAL_ROUTER)
      || getAddress(v4.permit2) !== getAddress(PERMIT2_ADDRESS)
      || v4.hookData !== "0x"
      || v4.rmtFeeAtomic !== "0"
      || v4.treasuryTransferAtomic !== "0"
      || evidence.fees[0] !== v4.poolKey.fee
      || (evidence.approvalRequired && evidence.approvalKind == null)
      || (evidence.approvalKind === "erc20_to_permit2" && getAddress(evidence.approvalSpender) !== getAddress(PERMIT2_ADDRESS))
      || (evidence.approvalKind === "permit2_to_router" && getAddress(evidence.approvalSpender) !== getAddress(ROBINHOOD_UNIVERSAL_ROUTER))
      || (!evidence.approvalRequired && evidence.approvalKind != null)
      || (!evidence.approvalRequired && getAddress(evidence.approvalSpender) !== getAddress(ROBINHOOD_UNIVERSAL_ROUTER))
    ) throw new Error("RMT rejected malformed V4 execution evidence.");
  } else if (evidence.provider !== "zero-x-swap") {
    if (evidence.v4Execution !== undefined || evidence.approvalKind !== undefined) throw new Error("RMT rejected foreign V4 execution evidence.");
    evidence.pools.forEach((pool) => {
      if (!isAddress(pool)) throw new Error("RMT rejected an invalid route pool.");
    });
  }
  if (evidence.nextActionTarget !== null && !isAddress(evidence.nextActionTarget)) throw new Error("RMT rejected an invalid next-action target.");
  const nativeInput = isRobinhoodNativeAsset(evidence.inputAsset);
  if (
    (evidence.settlementMode !== VNEXT_PROVIDER_NATIVE_INPUT_FEE && evidence.transactionValueAtomic !== (nativeInput ? evidence.inputAmountAtomic : "0"))
    || (evidence.settlementMode === VNEXT_PROVIDER_NATIVE_INPUT_FEE && evidence.status === "verified" && evidence.transactionValueAtomic !== evidence.providerNativeFee?.transactionValueAtomic)
    || (evidence.settlementMode === VNEXT_PROVIDER_NATIVE_INPUT_FEE && evidence.status === "approval_required" && evidence.transactionValueAtomic !== "0")
    || (evidence.settlementMode === VNEXT_PROVIDER_NATIVE_INPUT_FEE && nativeInput && evidence.providerNativeFee?.transactionValueAtomic === "0")
    || (nativeInput && evidence.approvalRequired)
  ) throw new Error("RMT rejected inconsistent native transaction value.");
  const completeGasEstimate = evidence.estimatedGasUnits !== null && evidence.gasLimitUnits !== null && evidence.estimatedNetworkCostWei !== null;
  if ((evidence.gasState === "sufficient" || evidence.gasState === "insufficient") !== completeGasEstimate) {
    throw new Error("RMT rejected incomplete gas evidence.");
  }
  if (completeGasEstimate && (
    BigInt(evidence.estimatedGasUnits!) <= 0n
    || BigInt(evidence.gasLimitUnits!) < BigInt(evidence.estimatedGasUnits!)
    || BigInt(evidence.feeCeilingWei) < BigInt(evidence.gasPriceWei)
    || BigInt(evidence.estimatedNetworkCostWei!) !== BigInt(evidence.gasLimitUnits!) * BigInt(evidence.feeCeilingWei)
    || (evidence.gasState === "sufficient") !== (
      BigInt(evidence.nativeBalanceWei) >= BigInt(evidence.transactionValueAtomic) + BigInt(evidence.estimatedNetworkCostWei!)
    )
  )) throw new Error("RMT rejected inconsistent gas economics.");
  const valuationParts = [
    evidence.estimatedNetworkCostUsdgAtomic,
    evidence.networkCostValuationSource,
    evidence.networkCostValuedAtMs,
    evidence.networkCostValuationExpiresAtMs
  ];
  const completeValuation = valuationParts.every((value) => value !== null);
  if (!completeValuation && valuationParts.some((value) => value !== null)) {
    throw new Error("RMT rejected incomplete network-cost valuation evidence.");
  }
  if (completeValuation && (
    evidence.estimatedNetworkCostWei === null
    || BigInt(evidence.estimatedNetworkCostUsdgAtomic!) <= 0n
    || evidence.networkCostValuedAtMs! > evidence.verifiedAtMs + MAX_CLOCK_SKEW_MS
    || evidence.networkCostValuationExpiresAtMs! <= nowMs
    || evidence.networkCostValuationExpiresAtMs! - evidence.networkCostValuedAtMs! > 30_000
  )) throw new Error("RMT rejected stale or inconsistent network-cost valuation evidence.");
  if (evidence.status === "verified" && (!evidence.exactSimulationPassed || evidence.approvalRequired || !evidence.sufficientBalance)) {
    throw new Error("RMT rejected a false verified status.");
  }
  if (evidence.status === "approval_required" && (!evidence.approvalRequired || !evidence.sufficientBalance || evidence.exactSimulationPassed)) {
    throw new Error("RMT rejected inconsistent approval evidence.");
  }
  if (evidence.status === "approval_simulation_failed" && (!evidence.approvalRequired || !evidence.sufficientBalance || evidence.exactSimulationPassed || evidence.gasState !== "not_checked")) {
    throw new Error("RMT rejected inconsistent failed approval simulation evidence.");
  }
  if (evidence.status === "insufficient_balance" && (evidence.sufficientBalance || evidence.exactSimulationPassed)) {
    throw new Error("RMT rejected inconsistent balance evidence.");
  }
  if (evidence.status === "simulation_failed" && (evidence.approvalRequired || !evidence.sufficientBalance || evidence.exactSimulationPassed)) {
    throw new Error("RMT rejected inconsistent simulation evidence.");
  }
  if (evidence.status === "insufficient_gas" && (evidence.gasState !== "insufficient" || !evidence.sufficientBalance)) {
    throw new Error("RMT rejected inconsistent insufficient-gas evidence.");
  }
  if (evidence.status === "gas_unavailable" && (evidence.gasState !== "unavailable" || !evidence.sufficientBalance)) {
    throw new Error("RMT rejected inconsistent unavailable-gas evidence.");
  }
  if (evidence.status === "verified" && (evidence.gasState !== "sufficient" || evidence.nextAction !== "swap")) {
    throw new Error("RMT rejected verified evidence without swap gas readiness.");
  }
  if (evidence.status === "approval_required" && (evidence.gasState !== "sufficient" || evidence.nextAction !== "approval")) {
    throw new Error("RMT rejected approval evidence without approval gas readiness.");
  }
  return evidence;
}
