export type PriceImpactTone = "calm" | "caution" | "danger";

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
  if (priceImpact > 0.05) return "danger";
  if (priceImpact > 0.01) return "caution";
  return "calm";
}
