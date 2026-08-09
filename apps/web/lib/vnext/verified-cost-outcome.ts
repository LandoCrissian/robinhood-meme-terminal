import { getAddress } from "viem";
import type { VNextPreSignEvidence } from "./pre-sign-evidence";
import { ROBINHOOD_USDG_ADDRESS } from "./robinhood-assets";

export type VNextVerifiedUsdgOutcome =
  | {
      kind: "buy_cost_ceiling";
      tradeAmountUsdgAtomic: string;
      networkCostUsdgAtomic: string;
      totalCostUsdgAtomic: string;
    }
  | {
      kind: "sell_proceeds_after_gas";
      protectedProceedsUsdgAtomic: string;
      networkCostUsdgAtomic: string;
      proceedsAfterGasUsdgAtomic: string;
      gasExceedsProtectedProceeds: boolean;
    };

export function deriveVNextVerifiedUsdgOutcome(
  evidence: VNextPreSignEvidence,
  nowMs: number
): VNextVerifiedUsdgOutcome | null {
  if (
    !Number.isFinite(nowMs)
    || evidence.estimatedNetworkCostUsdgAtomic === null
    || evidence.networkCostValuationExpiresAtMs === null
    || evidence.networkCostValuationExpiresAtMs <= nowMs
  ) return null;

  const networkCost = BigInt(evidence.estimatedNetworkCostUsdgAtomic);
  if (getAddress(evidence.inputAsset) === ROBINHOOD_USDG_ADDRESS) {
    const tradeAmount = BigInt(evidence.inputAmountAtomic);
    return {
      kind: "buy_cost_ceiling",
      tradeAmountUsdgAtomic: tradeAmount.toString(),
      networkCostUsdgAtomic: networkCost.toString(),
      totalCostUsdgAtomic: (tradeAmount + networkCost).toString()
    };
  }

  if (getAddress(evidence.outputAsset) === ROBINHOOD_USDG_ADDRESS) {
    const protectedProceeds = BigInt(evidence.protectedOutputAtomic);
    const gasExceedsProtectedProceeds = networkCost > protectedProceeds;
    return {
      kind: "sell_proceeds_after_gas",
      protectedProceedsUsdgAtomic: protectedProceeds.toString(),
      networkCostUsdgAtomic: networkCost.toString(),
      proceedsAfterGasUsdgAtomic: (gasExceedsProtectedProceeds ? 0n : protectedProceeds - networkCost).toString(),
      gasExceedsProtectedProceeds
    };
  }

  return null;
}
