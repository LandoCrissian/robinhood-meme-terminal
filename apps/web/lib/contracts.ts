import { getAddress, isAddress, type Address } from "viem";

export const publicTestnetFactoryAddress = getAddress("0x2D075c7FC08508A027191A99f146EDD606966fF3");
export const publicTestnetFactoryStartBlock = 89_775_000n;
export const publicMainnetFactoryAddress = getAddress("0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd");
export const publicMainnetVersionRegistryAddress = getAddress("0x4b8b222b5caa7066c02a54e51ec1a674adf5b3a1");
export const publicMainnetRegistryGovernanceAddress = getAddress("0x13c0a930516fb6bf0d467b38605d9d2a9c4c6953");
export const publicMainnetOperatorAddress = getAddress("0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA");

export const versionRegistryAbi = [
  { type: "function", name: "activeFactory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "activeVersion", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] }
] as const;

export const directLaunchFeeSplitterV6Abi = [
  { type: "function", name: "originalCreator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "creator", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "creatorPayoutAuthority", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "creatorPayoutNonce", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "protocolTreasury", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "launchToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "authorizedMarket", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "graduationAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "creatorShareBps", stateMutability: "view", inputs: [], outputs: [{ type: "uint16" }] },
  { type: "function", name: "pending", stateMutability: "view", inputs: [{ name: "recipient", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingToken", stateMutability: "view", inputs: [{ name: "token", type: "address" }, { name: "recipient", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalReceived", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalPaid", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalTokenReceived", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalTokenPaid", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "claimDeferred", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claimDeferredToken", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }], outputs: [] },
  {
    type: "event",
    name: "CreatorWalletChanged",
    anonymous: false,
    inputs: [
      { name: "previousCreator", type: "address", indexed: true },
      { name: "newCreator", type: "address", indexed: true },
      { name: "authority", type: "address", indexed: true },
      { name: "evidenceHash", type: "bytes32", indexed: false },
      { name: "nonce", type: "uint256", indexed: false }
    ]
  },
  {
    type: "event",
    name: "CreatorPayoutNonceInvalidated",
    anonymous: false,
    inputs: [
      { name: "previousNonce", type: "uint256", indexed: true },
      { name: "newNonce", type: "uint256", indexed: true },
      { name: "protocolTreasury", type: "address", indexed: true }
    ]
  }
] as const;

export const bondingCurveMarketV6FeeAbi = [
  { type: "function", name: "graduated", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "graduationAdapter", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }
] as const;

export const v4GraduationFeeCollectorAbi = [
  { type: "function", name: "factory", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "poolFee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "isGraduated", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "markets", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "feeSplitters", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "address" }] },
  { type: "function", name: "postGraduationFeeBps", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint16" }] },
  { type: "function", name: "lockedLiquidity", stateMutability: "view", inputs: [{ name: "token", type: "address" }], outputs: [{ type: "uint128" }] },
  { type: "function", name: "collectFees", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }], outputs: [{ name: "nativeAmount", type: "uint256" }, { name: "tokenAmount", type: "uint256" }] }
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
  { type: "function", name: "creatorPayoutAuthority", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "defaultPolicyId", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "getPolicy", stateMutability: "view", inputs: [{ name: "policyId", type: "bytes32" }], outputs: [{ name: "policy", type: "tuple", components: launchPolicyComponents }] },
  { type: "function", name: "isNameUsed", stateMutability: "view", inputs: [{ name: "name", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "isSymbolUsed", stateMutability: "view", inputs: [{ name: "symbol", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "canMigrateOfficialIdentity", stateMutability: "view", inputs: [{ name: "launcher", type: "address" }, { name: "policyId", type: "bytes32" }, { name: "name", type: "string" }, { name: "symbol", type: "string" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "launch", stateMutability: "nonpayable", inputs: [{ name: "policyId", type: "bytes32" }, { name: "name", type: "string" }, { name: "symbol", type: "string" }, { name: "metadataURI", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "market", type: "address" }, { name: "rewardVault", type: "address" }] },
  { type: "function", name: "launchOfficialWhilePaused", stateMutability: "nonpayable", inputs: [{ name: "metadataURI", type: "string" }], outputs: [{ name: "token", type: "address" }, { name: "market", type: "address" }, { name: "rewardVault", type: "address" }] },
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
