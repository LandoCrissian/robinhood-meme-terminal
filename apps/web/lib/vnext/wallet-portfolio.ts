import { formatUnits } from "viem";
import type { VNextDirectoryMarket } from "./market-directory";
import {
  ROBINHOOD_USDG_ADDRESS,
  ROBINHOOD_WETH_ADDRESS
} from "./robinhood-assets";
import type { VNextDetectedWalletAsset } from "./wallet-assets";

export type VNextWalletAssetValuation = {
  address: string;
  priceUsd: number | null;
  valueUsd: number | null;
  source: "canonical_usdg" | "eth_spot" | "live_directory" | "unavailable";
};

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function balanceNumber(asset: VNextDetectedWalletAsset) {
  if (asset.decimals === null) return null;
  const value = Number(formatUnits(BigInt(asset.balanceAtomic), asset.decimals));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function walletPortfolioSummary(input: {
  assets: VNextDetectedWalletAsset[];
  markets: VNextDirectoryMarket[];
  nativeBalance: bigint | undefined;
  ethUsd: number | undefined;
}) {
  const marketPrices = new Map<string, { priceUsd: number; liquidityUsd: number }>();
  for (const market of input.markets) {
    const priceUsd = finitePositive(market.priceUsd);
    if (priceUsd === null) continue;
    const key = market.address.toLowerCase();
    const existing = marketPrices.get(key);
    const liquidityUsd = market.liquidityUsd ?? 0;
    if (!existing || liquidityUsd > existing.liquidityUsd) {
      marketPrices.set(key, { priceUsd, liquidityUsd });
    }
  }

  const ethUsd = finitePositive(input.ethUsd);
  const valuations = input.assets.map((asset): VNextWalletAssetValuation => {
    const key = asset.address.toLowerCase();
    const quantity = balanceNumber(asset);
    if (quantity === null) return { address: asset.address, priceUsd: null, valueUsd: null, source: "unavailable" };
    if (key === ROBINHOOD_USDG_ADDRESS.toLowerCase()) {
      return { address: asset.address, priceUsd: 1, valueUsd: quantity, source: "canonical_usdg" };
    }
    if (key === ROBINHOOD_WETH_ADDRESS.toLowerCase() && ethUsd !== null) {
      return { address: asset.address, priceUsd: ethUsd, valueUsd: quantity * ethUsd, source: "eth_spot" };
    }
    const market = marketPrices.get(key);
    return market
      ? { address: asset.address, priceUsd: market.priceUsd, valueUsd: quantity * market.priceUsd, source: "live_directory" }
      : { address: asset.address, priceUsd: null, valueUsd: null, source: "unavailable" };
  });

  const nativeQuantity = input.nativeBalance === undefined ? null : Number(formatUnits(input.nativeBalance, 18));
  const nativeValueUsd = nativeQuantity !== null && Number.isFinite(nativeQuantity) && ethUsd !== null
    ? nativeQuantity * ethUsd
    : null;
  const positiveNative = input.nativeBalance !== undefined && input.nativeBalance > 0n;
  const pricedAssets = valuations.filter((valuation) => valuation.valueUsd !== null);
  const knownPortfolioUsd = pricedAssets.reduce((sum, valuation) => sum + (valuation.valueUsd ?? 0), 0) + (nativeValueUsd ?? 0);

  return {
    valuations,
    knownPortfolioUsd,
    hasKnownValue: pricedAssets.length > 0 || nativeValueUsd !== null,
    pricedPositionCount: pricedAssets.length + (positiveNative && nativeValueUsd !== null ? 1 : 0),
    unpricedPositionCount: valuations.length - pricedAssets.length + (positiveNative && nativeValueUsd === null ? 1 : 0),
    nativeValueUsd
  };
}
