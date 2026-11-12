export type OpeningPosition = {
  depositedETH: bigint;
  depositedTokens: bigint;
  sqrtPrice: bigint;
  liquidity: bigint;
};

const q96 = 1n << 96n;

// The example spends 1% of either initial deposit. Full range and the V1 seed
// and supply limits keep both examples inside the position. Outputs are estimates
// because real execution can traverse additional bitmap words and round per step.
export function openingExamples(position: OpeningPosition) {
  const grossBuy = position.depositedETH / 100n;
  const grossSell = position.depositedTokens / 100n;
  const afterFee = (amount: bigint) => amount * 997n / 1_000n;
  const lq = position.liquidity * q96;
  const price = position.sqrtPrice;
  const buyDivisor = lq + afterFee(grossBuy) * price;
  const buyPrice = (lq * price + buyDivisor - 1n) / buyDivisor;
  const sellPrice = price + afterFee(grossSell) * q96 / position.liquidity;
  return {
    grossBuy,
    grossSell,
    tokensOut: position.liquidity * (price - buyPrice) / q96,
    nativeOut: lq * (sellPrice - price) / (sellPrice * price),
  };
}
