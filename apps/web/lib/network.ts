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

export const publicMainnetV6FactoryStartBlock = 10_248_855n;
const configuredFactoryStartBlock = process.env.NEXT_PUBLIC_FACTORY_START_BLOCK?.trim();
let parsedFactoryStartBlock: bigint | null = null;
if (configuredFactoryStartBlock && /^\d+$/.test(configuredFactoryStartBlock)) {
  const candidate = BigInt(configuredFactoryStartBlock);
  if (candidate > 0n) parsedFactoryStartBlock = candidate;
}
export const isFactoryStartBlockExplicitlyConfigured = Boolean(configuredFactoryStartBlock);
export const isFactoryStartBlockConfigurationValid =
  !configuredFactoryStartBlock
    || (parsedFactoryStartBlock !== null
      && (!isMainnetRelease || parsedFactoryStartBlock === publicMainnetV6FactoryStartBlock));
export const activeFactoryStartBlock = parsedFactoryStartBlock
  ?? (isMainnetRelease ? publicMainnetV6FactoryStartBlock : 89_775_000n);

// V4 markets remain readable, but their community/protocol reward settlement
// path cannot deliver allocations to purpose vaults. New launches are V6 only.
export const settlementBlockedFactoryAddress =
  "0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4";
