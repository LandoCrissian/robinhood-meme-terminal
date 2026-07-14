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
  ? 9_567_266n
  : 89_775_000n;

// Emergency production launch pause. Existing V5 markets remain usable for
// trading and reward claims, but the public launch form must stay disabled
// until the post-graduation economics and pausable V6 factory are activated.
export const settlementBlockedFactoryAddress =
  "0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd";
