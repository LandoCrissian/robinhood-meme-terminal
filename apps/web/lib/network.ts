import { robinhoodChain, robinhoodChainTestnet } from "@rmt/chain";

export const isMainnetRelease =
  process.env.NEXT_PUBLIC_RMT_NETWORK === "mainnet";

export const activeChain = isMainnetRelease
  ? robinhoodChain
  : robinhoodChainTestnet;

export const activeNetworkLabel = isMainnetRelease
  ? "Robinhood Chain Mainnet"
  : "Robinhood Chain Testnet";

export const activeReleaseBadge = isMainnetRelease
  ? "LIVE MAINNET"
  : "LIVE TESTNET";

export const activeFactoryStartBlock = isMainnetRelease
  ? 8_862_129n
  : 89_775_000n;
