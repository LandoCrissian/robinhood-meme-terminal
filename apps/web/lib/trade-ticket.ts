export type PriceImpactTone = "calm" | "caution" | "danger";

// Market-risk disclosure thresholds. These are intentionally distinct from
// transaction-integrity checks such as quote freshness, protected output,
// calldata validation, exact simulation, balance, and wallet authorization.
export const PRICE_IMPACT_CAUTION = 0.05;
export const PRICE_IMPACT_CRITICAL = 0.10;

// Retained as the conservative fallback for callers that explicitly ask RMT
// to enforce an impact ceiling. The public terminal requests complete quotes
// and treats the user's saved value as an alert unless a strict mode is added.
export const PRICE_IMPACT_BLOCK = 0.05;

export function spendableTradeBalance(balance: bigint, reserve = 0n) {
  return balance > reserve ? balance - reserve : 0n;
}

export function fractionalTradeAmount(balance: bigint, basisPoints: bigint) {
  if (balance <= 0n) return 0n;
  if (basisPoints <= 0n || basisPoints > 10_000n) {
    throw new Error("Trade fraction must be between 1 and 10,000 basis points.");
  }
  return balance * basisPoints / 10_000n;
}

export function quoteSecondsRemaining(deadline: string | undefined, nowSeconds: number) {
  if (!deadline || !/^\d+$/.test(deadline) || !Number.isSafeInteger(nowSeconds)) return 0;
  const remaining = BigInt(deadline) - BigInt(nowSeconds);
  if (remaining <= 0n) return 0;
  return remaining > 3_600n ? 3_600 : Number(remaining);
}

export function priceImpactTone(priceImpact: number | undefined): PriceImpactTone {
  if (priceImpact === undefined || !Number.isFinite(priceImpact) || priceImpact < 0) return "calm";
  if (priceImpact > PRICE_IMPACT_CRITICAL) return "danger";
  if (priceImpact > PRICE_IMPACT_CAUTION) return "caution";
  return "calm";
}

export function saferTradeAmount(inputAmount: bigint, priceImpact: number | undefined, targetImpact = 0.04) {
  if (inputAmount <= 0n || priceImpact === undefined || !Number.isFinite(priceImpact) || priceImpact <= 0) return 0n;
  if (!Number.isFinite(targetImpact) || targetImpact <= 0 || targetImpact >= PRICE_IMPACT_BLOCK) {
    throw new Error("Safe trade target must be above zero and below the blocking threshold.");
  }
  if (priceImpact <= targetImpact) return inputAmount;
  const conservativeScalePpm = Math.max(1, Math.floor(targetImpact / priceImpact * 900_000));
  return inputAmount * BigInt(conservativeScalePpm) / 1_000_000n;
}

export function curvePriceImpact(
  side: "buy" | "sell",
  spotPriceWei: bigint,
  inputAmount: bigint,
  outputAmount: bigint
) {
  if (spotPriceWei <= 0n || inputAmount <= 0n || outputAmount <= 0n) return undefined;
  const executionPriceWei = side === "buy"
    ? inputAmount * 1_000_000_000_000_000_000n / outputAmount
    : outputAmount * 1_000_000_000_000_000_000n / inputAmount;
  const adverseDelta = side === "buy"
    ? executionPriceWei > spotPriceWei ? executionPriceWei - spotPriceWei : 0n
    : executionPriceWei < spotPriceWei ? spotPriceWei - executionPriceWei : 0n;
  const partsPerMillion = adverseDelta * 1_000_000n / spotPriceWei;
  return Number(partsPerMillion > 10_000_000n ? 10_000_000n : partsPerMillion) / 1_000_000;
}

export function estimatedNetworkFeeWei(gas: bigint, gasPrice: bigint) {
  if (gas <= 0n || gasPrice <= 0n) return 0n;
  return gas * gasPrice;
}

export function conservativeNetworkFeeReserve(estimate: bigint | undefined, fallback: bigint) {
  if (estimate === undefined || estimate <= 0n) return fallback;
  return estimate * 2n > fallback ? estimate * 2n : fallback;
}

export function estimatedNetworkFeeUsd(feeWei: bigint | undefined, ethUsd: number | undefined) {
  if (feeWei === undefined || feeWei <= 0n || ethUsd === undefined || !Number.isFinite(ethUsd) || ethUsd <= 0) {
    return undefined;
  }
  const whole = feeWei / 1_000_000_000_000_000_000n;
  const remainder = feeWei % 1_000_000_000_000_000_000n;
  return (Number(whole) + Number(remainder) / 1e18) * ethUsd;
}
