import { getAddress, isAddress, type Address } from "viem";

export const memeLaunchFactoryAbi = [
  {
    type: "function",
    name: "launch",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "symbol", type: "string" },
      { name: "supply", type: "uint256" },
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
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "supply", type: "uint256", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
      { name: "creatorBps", type: "uint16", indexed: false },
      { name: "communityBps", type: "uint16", indexed: false },
      { name: "traderBps", type: "uint16", indexed: false },
      { name: "liquidityBps", type: "uint16", indexed: false },
      { name: "platformBps", type: "uint16", indexed: false }
    ]
  }
] as const;

export function getFactoryAddress(): Address | null {
  const configured = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
  return configured && isAddress(configured) ? getAddress(configured) : null;
}
