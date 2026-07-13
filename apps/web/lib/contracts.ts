import { getAddress, isAddress, type Address } from "viem";

export const publicTestnetFactoryAddress = getAddress("0x2D075c7FC08508A027191A99f146EDD606966fF3");
export const publicTestnetFactoryStartBlock = 89_775_000n;
export const publicMainnetFactoryAddress = getAddress("0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4");
export const publicMainnetVersionRegistryAddress = getAddress("0xfff3f69f473780EA5eA7f5525526986Bb491E00e");

export const versionRegistryAbi = [
  { type: "function", name: "activeFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

export const memeLaunchFactoryAbi = [
  { type: "function", name: "launchSimple", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "market", type: "address" }, { name: "rewardVault", type: "address" }] },
  { type: "function", name: "launchCommunity", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "market", type: "address" }, { name: "rewardVault", type: "address" }] },
  { type: "function", name: "purposeVaultImplementation", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "communityDestinationsForToken", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "community", type: "address" }, { name: "traderRewards", type: "address" }] },
  {
    type: "function",
    name: "launch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "metadataURI", type: "string" },
      { name: "communityRecipients", type: "address[4]" },
      { name: "rewardBps", type: "uint16[5]" }
    ],
    outputs: [
      { name: "token", type: "address" },
      { name: "market", type: "address" },
      { name: "rewardVault", type: "address" }
    ]
  },
  {
    type: "event",
    name: "TokenLaunched",
    anonymous: false,
    inputs: [
      { name: "launchId", type: "uint256", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "market", type: "address", indexed: false },
      { name: "rewardVault", type: "address", indexed: false },
      { name: "graduationPoolId", type: "bytes32", indexed: false },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
      { name: "rewardBps", type: "uint16[5]", indexed: false }
    ]
  }
] as const;

export function getFactoryAddress(): Address | null {
  if (process.env.NEXT_PUBLIC_RMT_NETWORK === "mainnet") return publicMainnetFactoryAddress;
  const configured = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
  if (configured && isAddress(configured)) return getAddress(configured);
  if (typeof window === "undefined") return publicTestnetFactoryAddress;
  const runtime = window.localStorage.getItem("rmt:testnet-factory");
  return runtime && isAddress(runtime) ? getAddress(runtime) : publicTestnetFactoryAddress;
}
