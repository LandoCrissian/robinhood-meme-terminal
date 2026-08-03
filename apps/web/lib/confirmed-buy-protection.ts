import { formatEther, formatUnits } from "viem";

export type ConfirmedBuyProtectionSnapshot = {
  acquiredTokenBalance: number;
  totalTokenBalance: number;
  basisUsd: number;
  currentValueUsd: number;
  basisKind: "confirmed-purchase" | "full-position-reference" | "market-estimate";
};

export function confirmedBuyProtectionSnapshot(input: {
  beforeBalance: bigint;
  afterBalance: bigint;
  tokenDecimals: number;
  amountInWei: bigint;
  ethUsd?: number;
  marketPriceUsd: number;
}): ConfirmedBuyProtectionSnapshot | null {
  if (
    input.beforeBalance < 0n
    || input.afterBalance <= input.beforeBalance
    || !Number.isSafeInteger(input.tokenDecimals)
    || input.tokenDecimals < 0
    || input.tokenDecimals > 255
    || input.amountInWei <= 0n
    || !Number.isFinite(input.marketPriceUsd)
    || input.marketPriceUsd <= 0
  ) return null;
  const acquiredTokenBalance = Number(formatUnits(input.afterBalance - input.beforeBalance, input.tokenDecimals));
  const totalTokenBalance = Number(formatUnits(input.afterBalance, input.tokenDecimals));
  if (
    !Number.isFinite(acquiredTokenBalance)
    || acquiredTokenBalance <= 0
    || !Number.isFinite(totalTokenBalance)
    || totalTokenBalance <= 0
  ) return null;
  const currentValueUsd = totalTokenBalance * input.marketPriceUsd;
  const spentUsd = typeof input.ethUsd === "number" && Number.isFinite(input.ethUsd) && input.ethUsd > 0
    ? Number(formatEther(input.amountInWei)) * input.ethUsd
    : 0;
  const hadExistingPosition = input.beforeBalance > 0n;
  const basisUsd = hadExistingPosition ? currentValueUsd : spentUsd > 0 ? spentUsd : acquiredTokenBalance * input.marketPriceUsd;
  if (!Number.isFinite(basisUsd) || basisUsd <= 0 || !Number.isFinite(currentValueUsd) || currentValueUsd <= 0) return null;
  return {
    acquiredTokenBalance,
    totalTokenBalance,
    basisUsd,
    currentValueUsd,
    basisKind: hadExistingPosition
      ? "full-position-reference"
      : spentUsd > 0
        ? "confirmed-purchase"
        : "market-estimate"
  };
}
