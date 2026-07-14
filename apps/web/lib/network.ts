import { robinhoodChain, robinhoodChainTestnet } from "@rmt/shared/chains";

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

// V4 markets remain usable, but its community/protocol reward settlement path
// cannot deliver allocations to purpose vaults. Keep new public launches closed
// until the version registry activates the corrected factory.
export const settlementBlockedFactoryAddress =
  "0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4";
