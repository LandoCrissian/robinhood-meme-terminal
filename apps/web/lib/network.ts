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

export const publicMainnetV5FactoryStartBlock = 9_567_266n;
const configuredFactoryStartBlock = process.env.NEXT_PUBLIC_FACTORY_START_BLOCK?.trim();
let parsedFactoryStartBlock: bigint | null = null;
if (configuredFactoryStartBlock && /^\d+$/.test(configuredFactoryStartBlock)) {
  const candidate = BigInt(configuredFactoryStartBlock);
  if (candidate > 0n) parsedFactoryStartBlock = candidate;
}
export const isFactoryStartBlockExplicitlyConfigured = Boolean(configuredFactoryStartBlock);
export const isFactoryStartBlockConfigurationValid =
  !configuredFactoryStartBlock || parsedFactoryStartBlock !== null;
export const activeFactoryStartBlock = parsedFactoryStartBlock
  ?? (isMainnetRelease ? publicMainnetV5FactoryStartBlock : 89_775_000n);

// V4 markets remain usable, but its community/protocol reward settlement path
// cannot deliver allocations to purpose vaults. The launch form treats this
// legacy address as blocked while V5 remains the public production factory.
export const settlementBlockedFactoryAddress =
  "0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4";
