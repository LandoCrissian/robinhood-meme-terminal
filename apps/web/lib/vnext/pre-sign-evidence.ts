import { getAddress, isAddress, keccak256 } from "viem";
import { z } from "zod";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { isRobinhoodNativeAsset } from "./robinhood-assets";
import { UP_CL_EXECUTION_ROUTER, UP_V2_EXECUTION_ROUTER } from "./up-authorization-codec";
import { SUSHI_RED_SNWAPPER } from "../sushi";
import { SUSHI_RED_SNWAPPER_CODE_HASH, SUSHI_ROUTE_EXECUTOR, SUSHI_ROUTE_EXECUTOR_CODE_HASH } from "./sushi-authorization-codec";
import { assertRmtNetExecutionEconomics, type RmtNetExecutionEconomics } from "./execution-fee-policy";
import { assertRmtUniswapV3FeeExecution, encodeRmtUniswapV3FeeExecution, type RmtUniswapV3FeeExecution } from "./uniswap-v3-fee-executor";

const MAX_CLOCK_SKEW_MS = 5_000;

export type VNextPreSignEvidence = {
  verificationId: string;
  sourceQuoteRequestId: string;
  provider: "sushi" | "uniswap-v3" | "up-v2" | "up-cl";
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
  route: "direct" | "weth_hop" | "aggregated";
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
  executor?: string | null;
  executorRuntimeHash?: string | null;
  onchainDeadline?: boolean;
  freshnessKind?: "onchain_deadline" | "server_authorization_expiry";
  exactSimulationPassed: boolean;
  userPaysGas: true;
  rmtFeeEnabled: boolean;
  netEconomics?: RmtNetExecutionEconomics;
  feeExecution?: RmtUniswapV3FeeExecution | null;
  verifiedAtMs: number;
  expiresAtMs: number;
  authorizationReady: false;
};

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const evidenceSchema = z.object({
  verificationId: z.string().uuid(),
  sourceQuoteRequestId: z.string().uuid(),
  provider: z.enum(["sushi", "uniswap-v3", "up-v2", "up-cl"]),
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
  route: z.enum(["direct", "weth_hop", "aggregated"]),
  fees: z.array(z.number().int().positive()).max(2),
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
  executor: z.string().nullable().optional(),
  executorRuntimeHash: hash.nullable().optional(),
  onchainDeadline: z.boolean().optional(),
  freshnessKind: z.enum(["onchain_deadline", "server_authorization_expiry"]).optional(),
  exactSimulationPassed: z.boolean(),
  userPaysGas: z.literal(true),
  rmtFeeEnabled: z.boolean(),
  netEconomics: z.unknown().optional(),
  feeExecution: z.unknown().nullable().optional(),
  verifiedAtMs: z.number().int().positive(),
  expiresAtMs: z.number().int().positive(),
  authorizationReady: z.literal(false)
});

export function parseVNextPreSignEvidence(value: unknown, expected: {
  quoteRequestId: string;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  provider: "sushi" | "uniswap-v3" | "up-v2" | "up-cl";
  protectedOutputFloorAtomic: string;
  recipient: string;
}, nowMs: number): VNextPreSignEvidence {
  const parsed = evidenceSchema.safeParse(value);
  if (!parsed.success) throw new Error("RMT rejected malformed pre-sign evidence.");
  const evidence = parsed.data as VNextPreSignEvidence;
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
    || getAddress(evidence.router) !== getAddress(evidence.provider === "sushi" ? SUSHI_RED_SNWAPPER : evidence.provider === "uniswap-v3" ? ROBINHOOD_SWAP_ROUTER_02 : evidence.provider === "up-v2" ? UP_V2_EXECUTION_ROUTER : UP_CL_EXECUTION_ROUTER)
    || evidence.protectedOutputAtomic === "0"
    || BigInt(evidence.protectedOutputAtomic) > BigInt(evidence.expectedOutputAtomic)
    || evidence.verifiedAtMs > nowMs + MAX_CLOCK_SKEW_MS
    || evidence.expiresAtMs <= nowMs
    || evidence.expiresAtMs - evidence.verifiedAtMs > 300_000
    || evidence.authorizationReady !== false
  ) throw new Error("RMT rejected inconsistent pre-sign evidence.");
  if (evidence.rmtFeeEnabled) {
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
    || getAddress(evidence.approvalSpender) !== getAddress(evidence.router)
  ) {
    throw new Error("RMT rejected hidden or inconsistent fee authority.");
  }
  if (evidence.route === "direct" && (evidence.fees.length !== 1 || evidence.pools.length !== 1)) throw new Error("RMT rejected an inconsistent direct route.");
  if (evidence.route === "weth_hop" && (evidence.fees.length !== 2 || evidence.pools.length !== 2)) throw new Error("RMT rejected an inconsistent multihop route.");
  if (evidence.provider === "sushi" && (
    evidence.route !== "aggregated" || evidence.fees.length !== 0 || evidence.pools.length !== 0
    || evidence.stableFlags !== undefined || evidence.tickSpacings !== undefined
    || evidence.quoteBlock !== undefined || evidence.quoteBlockHash !== undefined
    || evidence.routerRuntimeHash.toLowerCase() !== SUSHI_RED_SNWAPPER_CODE_HASH
    || !evidence.executor || getAddress(evidence.executor) !== SUSHI_ROUTE_EXECUTOR
    || evidence.executorRuntimeHash?.toLowerCase() !== SUSHI_ROUTE_EXECUTOR_CODE_HASH
    || evidence.factoryRuntimeHash !== null || evidence.quoterRuntimeHash !== null
    || evidence.onchainDeadline !== false || evidence.freshnessKind !== "server_authorization_expiry"
  )) throw new Error("RMT rejected incomplete Sushi execution evidence.");
  if (evidence.provider === "up-v2" && (
    evidence.stableFlags?.length !== evidence.pools.length || evidence.tickSpacings !== undefined
    || evidence.quoteBlock === undefined || evidence.quoteBlockHash === undefined
  )) throw new Error("RMT rejected incomplete up v2 route evidence.");
  if (evidence.provider === "up-cl" && (
    evidence.tickSpacings?.length !== evidence.pools.length || evidence.stableFlags !== undefined
    || evidence.quoteBlock === undefined || evidence.quoteBlockHash === undefined
  )) throw new Error("RMT rejected incomplete up CL route evidence.");
  if (evidence.provider === "uniswap-v3" && (evidence.stableFlags !== undefined || evidence.tickSpacings !== undefined || evidence.quoteBlock !== undefined || evidence.quoteBlockHash !== undefined)) {
    throw new Error("RMT rejected foreign route evidence on Uniswap.");
  }
  if (evidence.provider !== "sushi" && (
    evidence.route === "aggregated" || evidence.executor != null || evidence.executorRuntimeHash != null
    || evidence.factoryRuntimeHash === null || evidence.quoterRuntimeHash === null
    || (evidence.onchainDeadline !== undefined && evidence.onchainDeadline !== true)
    || (evidence.freshnessKind !== undefined && evidence.freshnessKind !== "onchain_deadline")
  )) throw new Error("RMT rejected inconsistent onchain-deadline execution evidence.");
  evidence.pools.forEach((pool) => {
    if (!isAddress(pool)) throw new Error("RMT rejected an invalid route pool.");
  });
  if (evidence.nextActionTarget !== null && !isAddress(evidence.nextActionTarget)) throw new Error("RMT rejected an invalid next-action target.");
  const nativeInput = isRobinhoodNativeAsset(evidence.inputAsset);
  if (
    evidence.transactionValueAtomic !== (nativeInput ? evidence.inputAmountAtomic : "0")
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
