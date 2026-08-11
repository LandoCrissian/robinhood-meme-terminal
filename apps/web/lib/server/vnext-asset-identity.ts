import { getAddress, type Address } from "viem";
import {
  ROBINHOOD_ETH,
  ROBINHOOD_NATIVE_ASSET_ADDRESS,
  isRobinhoodNativeAsset
} from "../vnext/robinhood-assets";
import { readRobinhoodTokenIdentity } from "./universal-market-resolver";

export type VNextVerifiedAssetIdentity = {
  address: Address;
  symbol: string;
  decimals: number;
  native: boolean;
};

export async function readVNextVerifiedAssetIdentity(address: Address): Promise<VNextVerifiedAssetIdentity | null> {
  if (isRobinhoodNativeAsset(address)) {
    if (ROBINHOOD_ETH.decimals === null || !ROBINHOOD_ETH.symbol) return null;
    return {
      address: ROBINHOOD_NATIVE_ASSET_ADDRESS,
      symbol: ROBINHOOD_ETH.symbol,
      decimals: ROBINHOOD_ETH.decimals,
      native: true
    };
  }
  const identity = await readRobinhoodTokenIdentity(address);
  return identity ? {
    address: getAddress(address),
    symbol: identity.symbol,
    decimals: identity.decimals,
    native: false
  } : null;
}
