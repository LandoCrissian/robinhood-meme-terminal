import { getAddress, type Address } from "viem";
import {
  VNEXT_EXECUTION_SCHEMA_VERSION,
  evmAsset,
  evmChain,
  evmNativeAsset,
  type AssetBalanceSnapshot,
  type AssetMetadata,
  type WalletAccount
} from "./execution-domain";

export const ROBINHOOD_MAINNET_CHAIN_ID = 4_663;
export const ROBINHOOD_USDG_ADDRESS = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
export const ROBINHOOD_WETH_ADDRESS = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
export const ROBINHOOD_RMT_ADDRESS = getAddress("0xdBa33be56C89CC9fc014c4459028d7e5c7878671");

export const ROBINHOOD_USDG: AssetMetadata = {
  id: evmAsset(ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_USDG_ADDRESS),
  symbol: "USDG",
  name: "Global Dollar",
  decimals: 6,
  metadataState: "verified"
};

export const ROBINHOOD_WETH: AssetMetadata = {
  id: evmAsset(ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_WETH_ADDRESS),
  symbol: "WETH",
  name: "Wrapped Ether",
  decimals: 18,
  metadataState: "verified"
};

export const ROBINHOOD_ETH: AssetMetadata = {
  id: evmNativeAsset(ROBINHOOD_MAINNET_CHAIN_ID),
  symbol: "ETH",
  name: "Ether",
  decimals: 18,
  metadataState: "verified"
};

export const ROBINHOOD_RMT: AssetMetadata = {
  id: evmAsset(ROBINHOOD_MAINNET_CHAIN_ID, ROBINHOOD_RMT_ADDRESS),
  symbol: "RMT",
  name: "Robinhood Meme Terminal",
  decimals: 18,
  metadataState: "verified"
};

export function robinhoodWalletAccount(address: Address): WalletAccount {
  return {
    accountId: `eip155:${ROBINHOOD_MAINNET_CHAIN_ID}:${address.toLowerCase()}`,
    chain: evmChain(ROBINHOOD_MAINNET_CHAIN_ID),
    address,
    custody: "self_custody"
  };
}

export function confirmedBalanceSnapshot(input: {
  account: WalletAccount;
  asset: AssetMetadata;
  settledAtomic: bigint;
  observedAtMs: number;
  blockReference?: string | null;
}): AssetBalanceSnapshot {
  return {
    schemaVersion: VNEXT_EXECUTION_SCHEMA_VERSION,
    account: input.account,
    asset: input.asset,
    settledAtomic: input.settledAtomic.toString(),
    pendingIncomingAtomic: "0",
    pendingOutgoingAtomic: "0",
    reservedAtomic: "0",
    routeState: "detected",
    observedAtMs: input.observedAtMs,
    blockReference: input.blockReference ?? null
  };
}
