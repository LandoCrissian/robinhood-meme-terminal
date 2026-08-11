import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { ROBINHOOD_SWAP_ROUTER_02 } from "../uniswap-v4";
import { isRobinhoodNativeAsset } from "./robinhood-assets";

const MAX_CLOCK_SKEW_MS = 5_000;

export type VNextPreSignEvidence = {
  verificationId: string;
  sourceQuoteRequestId: string;
  provider: "uniswap-v3";
  status: "verified" | "approval_required" | "insufficient_balance" | "insufficient_gas" | "gas_unavailable" | "simulation_failed";
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
  route: "direct" | "weth_hop";
  fees: number[];
  pools: string[];
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
  factoryRuntimeHash: string;
  quoterRuntimeHash: string;
  exactSimulationPassed: boolean;
  userPaysGas: true;
  rmtFeeEnabled: false;
  verifiedAtMs: number;
  expiresAtMs: number;
  authorizationReady: false;
};

const atomic = z.string().regex(/^(0|[1-9][0-9]*)$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const evidenceSchema = z.object({
  verificationId: z.string().uuid(),
  sourceQuoteRequestId: z.string().uuid(),
  provider: z.literal("uniswap-v3"),
  status: z.enum(["verified", "approval_required", "insufficient_balance", "insufficient_gas", "gas_unavailable", "simulation_failed"]),
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
  route: z.enum(["direct", "weth_hop"]),
  fees: z.array(z.number().int().positive()).min(1).max(2),
  pools: z.array(z.string()).min(1).max(2),
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
  factoryRuntimeHash: hash,
  quoterRuntimeHash: hash,
  exactSimulationPassed: z.boolean(),
  userPaysGas: z.literal(true),
  rmtFeeEnabled: z.literal(false),
  verifiedAtMs: z.number().int().positive(),
  expiresAtMs: z.number().int().positive(),
  authorizationReady: z.literal(false)
});

export function parseVNextPreSignEvidence(value: unknown, expected: {
  quoteRequestId: string;
  inputAsset: string;
  outputAsset: string;
  inputAmountAtomic: string;
  provider: "uniswap-v3";
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
    || getAddress(evidence.router) !== getAddress(ROBINHOOD_SWAP_ROUTER_02)
    || getAddress(evidence.approvalSpender) !== getAddress(ROBINHOOD_SWAP_ROUTER_02)
    || evidence.protectedOutputAtomic === "0"
    || BigInt(evidence.protectedOutputAtomic) > BigInt(evidence.expectedOutputAtomic)
    || evidence.verifiedAtMs > nowMs + MAX_CLOCK_SKEW_MS
    || evidence.expiresAtMs <= nowMs
    || evidence.expiresAtMs - evidence.verifiedAtMs > 300_000
    || evidence.authorizationReady !== false
  ) throw new Error("RMT rejected inconsistent pre-sign evidence.");
  if (evidence.route === "direct" && (evidence.fees.length !== 1 || evidence.pools.length !== 1)) throw new Error("RMT rejected an inconsistent direct route.");
  if (evidence.route === "weth_hop" && (evidence.fees.length !== 2 || evidence.pools.length !== 2)) throw new Error("RMT rejected an inconsistent multihop route.");
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
