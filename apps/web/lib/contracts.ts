import { getAddress, isAddress, type Address } from "viem";

export const publicTestnetFactoryAddress = getAddress("0x2D075c7FC08508A027191A99f146EDD606966fF3");
export const publicTestnetFactoryStartBlock = 89_775_000n;
export const publicMainnetFactoryAddress = getAddress("0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd");
export const publicMainnetVersionRegistryAddress = getAddress("0x4b8b222b5caa7066c02a54e51ec1a674adf5b3a1");

export const versionRegistryAbi = [
  { type: "function", name: "activeFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "activeVersion", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }
] as const;

export const memeLaunchFactoryAbi = [
  { type: "function", name: "launchSimple", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "market", type: "address" }, { name: "rewardVault", type: "address" }] },
  { type: "function", name: "launchCommunity", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "market", type: "address" }, { name: "rewardVault", type: "address" }] },
  { type: "function", name: "isNameUsed", stateMutability: "view", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isSymbolUsed", stateMutability: "view", inputs: [{ name: "symbol", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "launchOfficialSimple", stateMutability: "nonpayable", inputs: [{ name: "metadataURI", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "market", type: "address" }, { name: "rewardVault", type: "address" }] },
  { type: "function", name: "launchOfficialCommunity", stateMutability: "nonpayable", inputs: [{ name: "metadataURI", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "market", type: "address" }, { name: "rewardVault", type: "address" }] },
  { type: "function", name: "officialMigrationAuthority", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "officialMigrationComplete", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
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

const launchPolicyComponents = [
  { name: "policyId", type: "bytes32" },
  { name: "policyVersion", type: "uint32" },
  { name: "enabled", type: "bool" },
  { name: "publiclySelectable", type: "bool" },
  { name: "curveFeeBps", type: "uint16" },
  { name: "creatorFeeShareBps", type: "uint16" },
  { name: "protocolFeeShareBps", type: "uint16" },
  { name: "postGraduationFeeBps", type: "uint16" },
  { name: "graduationTarget", type: "uint256" },
  { name: "fairStartMode", type: "uint8" },
  { name: "fairStartDelayBlocks", type: "uint64" },
  { name: "fairStartDurationBlocks", type: "uint64" },
  { name: "fairStartMaxTxBps", type: "uint16" },
  { name: "fairStartMaxWalletBps", type: "uint16" }
] as const;

export const rmtLaunchFactoryV6Abi = [
  { type: "function", name: "protocolVersion", stateMutability: "pure", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "launchesPaused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "defaultPolicyId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "getPolicy", stateMutability: "view", inputs: [{ name: "policyId", type: "bytes32" }], outputs: [{ name: "policy", type: "tuple", components: launchPolicyComponents }] },
  { type: "function", name: "isNameUsed", stateMutability: "view", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isSymbolUsed", stateMutability: "view", inputs: [{ name: "symbol", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "canMigrateOfficialIdentity", stateMutability: "view", inputs: [{ name: "launcher", type: "address" }, { name: "name", type: "string" }, { name: "symbol", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "launch", stateMutability: "nonpayable", inputs: [{ name: "policyId", type: "bytes32" }, { name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "market", type: "address" }, { name: "rewardVault", type: "address" }] },
  {
    type: "event",
    name: "TokenLaunchedV6",
    anonymous: false,
    inputs: [
      { name: "launchId", type: "uint256", indexed: true },
      { name: "token", type: "address", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "market", type: "address", indexed: false },
      { name: "feeSplitter", type: "address", indexed: false },
      { name: "graduationPoolId", type: "bytes32", indexed: false },
      { name: "policyId", type: "bytes32", indexed: false },
      { name: "policyVersion", type: "uint32", indexed: false },
      { name: "curveFeeBps", type: "uint16", indexed: false },
      { name: "creatorFeeShareBps", type: "uint16", indexed: false },
      { name: "protocolFeeShareBps", type: "uint16", indexed: false },
      { name: "postGraduationFeeBps", type: "uint16", indexed: false },
      { name: "fairStartEnabled", type: "bool", indexed: false },
      { name: "fairStartDelayBlocks", type: "uint64", indexed: false },
      { name: "fairStartDurationBlocks", type: "uint64", indexed: false },
      { name: "fairStartMaxTxBps", type: "uint16", indexed: false },
      { name: "fairStartMaxWalletBps", type: "uint16", indexed: false },
      { name: "graduationTarget", type: "uint256", indexed: false },
      { name: "officialMigration", type: "bool", indexed: false },
      { name: "name", type: "string", indexed: false },
      { name: "symbol", type: "string", indexed: false },
      { name: "metadataURI", type: "string", indexed: false }
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
