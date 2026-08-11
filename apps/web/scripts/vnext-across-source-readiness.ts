import { getAddress, isAddress } from "viem";
import { readAcrossFundingWalletReadiness } from "../lib/server/vnext-across-funding";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  TRUSTED_ASSET_ADDRESSES
} from "../lib/vnext/trusted-asset-registry";

const sources = [{
  chainId: BASE_MAINNET_CHAIN_ID,
  chainName: "Base",
  sourceToken: TRUSTED_ASSET_ADDRESSES.BASE_USDC
}, {
  chainId: ARBITRUM_MAINNET_CHAIN_ID,
  chainName: "Arbitrum",
  sourceToken: TRUSTED_ASSET_ADDRESSES.ARBITRUM_USDC
}, {
  chainId: ETHEREUM_MAINNET_CHAIN_ID,
  chainName: "Ethereum",
  sourceToken: TRUSTED_ASSET_ADDRESSES.ETHEREUM_USDC
}] as const;

async function main() {
  const walletInput = process.env.RMT_ACROSS_PREFLIGHT_WALLET?.trim() ?? "";
  const requestedInputAtomic = process.env.RMT_ACROSS_PREFLIGHT_AMOUNT_ATOMIC?.trim() ?? "";
  if (!isAddress(walletInput, { strict: false }) || !/^[1-9][0-9]{0,77}$/.test(requestedInputAtomic)) {
    throw new Error("Set RMT_ACROSS_PREFLIGHT_WALLET and a positive RMT_ACROSS_PREFLIGHT_AMOUNT_ATOMIC.");
  }
  const wallet = getAddress(walletInput);
  const observations = await Promise.all(sources.map(async (source) => {
    try {
      const readiness = await readAcrossFundingWalletReadiness({
        sourceChainId: source.chainId,
        sourceToken: source.sourceToken,
        wallet,
        requestedInputAtomic
      });
      return { ...source, ...readiness, readable: true } as const;
    } catch {
      return {
        ...source,
        requestedInputAtomic,
        sourceBalanceAtomic: null,
        nativeGasBalanceAtomic: null,
        sufficientSourceBalance: false,
        hasNativeGas: false,
        fundedPreflightReady: false,
        readable: false
      } as const;
    }
  }));
  console.log(JSON.stringify({
    status: observations.some((observation) => observation.fundedPreflightReady)
      ? "funded_source_available"
      : "no_funded_source_available",
    wallet,
    requestedInputAtomic,
    observations,
    transactionAttempted: false
  }, null, 2));
}

void main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : "Across source readiness check failed.");
  process.exitCode = 1;
});
