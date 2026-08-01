import type { TradeFeeEstimateState } from "./use-trade-fee-estimate";

export function isTradePreflightReady(estimate: TradeFeeEstimateState) {
  return estimate.status === "ready"
    && typeof estimate.gas === "bigint"
    && estimate.gas > 0n
    && typeof estimate.gasPrice === "bigint"
    && estimate.gasPrice > 0n
    && typeof estimate.feeWei === "bigint"
    && estimate.feeWei > 0n;
}
