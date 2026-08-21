import { getAddress, isAddress, type Address, type Hex } from "viem";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID
} from "./trusted-asset-registry";

export const ACROSS_FUNDING_DEPLOYMENT_SCHEMA = "ACROSS_FUNDING_DEPLOYMENT_V1" as const;
export const ACROSS_EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
export const ACROSS_OFFICIAL_CONTRACT_SOURCE = "https://docs.across.to/chains-and-contracts" as const;

export type AcrossFundingDeploymentChainId =
  | typeof ETHEREUM_MAINNET_CHAIN_ID
  | typeof ARBITRUM_MAINNET_CHAIN_ID
  | typeof BASE_MAINNET_CHAIN_ID
  | typeof ROBINHOOD_MAINNET_CHAIN_ID;

export type AcrossFundingDeploymentAdmission = {
  schemaVersion: typeof ACROSS_FUNDING_DEPLOYMENT_SCHEMA;
  chainId: AcrossFundingDeploymentChainId;
  chainName: string;
  proxyAddress: Address;
  proxyRuntimeHash: Hex;
  implementationSlot: typeof ACROSS_EIP1967_IMPLEMENTATION_SLOT;
  implementationAddress: Address;
  implementationRuntimeHash: Hex;
  evidenceBlock: string;
  evidenceBlockHash: Hex;
  observedAt: string;
  officialSource: typeof ACROSS_OFFICIAL_CONTRACT_SOURCE;
};

export const ACROSS_FUNDING_DEPLOYMENT_V1 = {
  [ETHEREUM_MAINNET_CHAIN_ID]: {
    schemaVersion: ACROSS_FUNDING_DEPLOYMENT_SCHEMA,
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    chainName: "Ethereum",
    proxyAddress: getAddress("0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5"),
    proxyRuntimeHash: "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75",
    implementationSlot: ACROSS_EIP1967_IMPLEMENTATION_SLOT,
    implementationAddress: getAddress("0x456ac26e5ec083ee9889eba0d1a0a582502b8e84"),
    implementationRuntimeHash: "0x94cc890a705ae8f4b973b6531b201fcd53c6bcbefba7caa12d1812f6fcede5bf",
    evidenceBlock: "25800117",
    evidenceBlockHash: "0x184b42d83764a82e7b9121faca5e4181335b5f3836fe749a0338dcc540750585",
    observedAt: "2026-08-21T01:07:35.000Z",
    officialSource: ACROSS_OFFICIAL_CONTRACT_SOURCE
  },
  [ARBITRUM_MAINNET_CHAIN_ID]: {
    schemaVersion: ACROSS_FUNDING_DEPLOYMENT_SCHEMA,
    chainId: ARBITRUM_MAINNET_CHAIN_ID,
    chainName: "Arbitrum",
    proxyAddress: getAddress("0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A"),
    proxyRuntimeHash: "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75",
    implementationSlot: ACROSS_EIP1967_IMPLEMENTATION_SLOT,
    implementationAddress: getAddress("0xcfcda84333431bcc9155f2368b8362f0d1dff8c9"),
    implementationRuntimeHash: "0xa860f20748abfdf98f4e55411b5db7630457bec1abfb5d88f1ecd5f25b4ec24b",
    evidenceBlock: "496695413",
    evidenceBlockHash: "0xf7b9419163aa2e6192beef6cfe7c825e3b665f8c364d28f762fc73096e90cc81",
    observedAt: "2026-08-21T01:07:14.000Z",
    officialSource: ACROSS_OFFICIAL_CONTRACT_SOURCE
  },
  [BASE_MAINNET_CHAIN_ID]: {
    schemaVersion: ACROSS_FUNDING_DEPLOYMENT_SCHEMA,
    chainId: BASE_MAINNET_CHAIN_ID,
    chainName: "Base",
    proxyAddress: getAddress("0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64"),
    proxyRuntimeHash: "0x932cddc50793da935ccf915651ad67f6b746e9936fcc5614f0ff492563782c75",
    implementationSlot: ACROSS_EIP1967_IMPLEMENTATION_SLOT,
    implementationAddress: getAddress("0xf23c6c04a2b88e8651fe99bbdccbb5c9d306e6b0"),
    implementationRuntimeHash: "0xb36f3bbdffcc931890a4354aa13c9756f032cf6f968d1d1a9604cb3ece9eb480",
    evidenceBlock: "50242535",
    evidenceBlockHash: "0x173788716d9f7ca55787ae992aea08894aa5e6a3dc7367deb22bde8febf70e90",
    observedAt: "2026-08-21T01:06:57.000Z",
    officialSource: ACROSS_OFFICIAL_CONTRACT_SOURCE
  },
  [ROBINHOOD_MAINNET_CHAIN_ID]: {
    schemaVersion: ACROSS_FUNDING_DEPLOYMENT_SCHEMA,
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    chainName: "Robinhood Chain",
    proxyAddress: getAddress("0xD29C85F15DF544bA632C9E25829fd29d767d7978"),
    proxyRuntimeHash: "0xbad165a67f16d7be75d8197acdecb912517a516ce0ca2249dee18cd643577f61",
    implementationSlot: ACROSS_EIP1967_IMPLEMENTATION_SLOT,
    implementationAddress: getAddress("0x1771c470d41b8c39338450c380bf2c080a2cedd8"),
    implementationRuntimeHash: "0x14f3a4a73c4a0aa5499d7ae7c3a11c0195bc769d46ff8e62b0c614faee8a95ed",
    evidenceBlock: "41884302",
    evidenceBlockHash: "0x71f71f823eab1901185e87595f6d39679e8f167f040c2db7ddf05a077ef08962",
    observedAt: "2026-08-21T01:23:37.000Z",
    officialSource: ACROSS_OFFICIAL_CONTRACT_SOURCE
  }
} as const satisfies Record<AcrossFundingDeploymentChainId, AcrossFundingDeploymentAdmission>;

const environmentPrefixes = {
  [ETHEREUM_MAINNET_CHAIN_ID]: "RMT_ACROSS_ETHEREUM_SPOKE_POOL",
  [ARBITRUM_MAINNET_CHAIN_ID]: "RMT_ACROSS_ARBITRUM_SPOKE_POOL",
  [BASE_MAINNET_CHAIN_ID]: "RMT_ACROSS_BASE_SPOKE_POOL",
  [ROBINHOOD_MAINNET_CHAIN_ID]: "RMT_ACROSS_ROBINHOOD_SPOKE_POOL"
} as const;

export function acrossReviewedDeploymentPins(env: Record<string, string | undefined>) {
  const pins = {} as Record<AcrossFundingDeploymentChainId, {
    proxyRuntimeHash: Hex;
    implementationAddress: Address;
    implementationRuntimeHash: Hex;
  }>;
  for (const chainId of Object.keys(environmentPrefixes).map(Number) as AcrossFundingDeploymentChainId[]) {
    const prefix = environmentPrefixes[chainId];
    const admitted = ACROSS_FUNDING_DEPLOYMENT_V1[chainId];
    const proxyRuntimeHash = env[`${prefix}_PROXY_CODE_HASH`]?.trim().toLowerCase();
    const implementationAddress = env[`${prefix}_IMPLEMENTATION_ADDRESS`]?.trim();
    const implementationRuntimeHash = env[`${prefix}_IMPLEMENTATION_CODE_HASH`]?.trim().toLowerCase();
    if (
      proxyRuntimeHash !== admitted.proxyRuntimeHash
      || !implementationAddress || !isAddress(implementationAddress, { strict: false })
      || getAddress(implementationAddress) !== admitted.implementationAddress
      || implementationRuntimeHash !== admitted.implementationRuntimeHash
    ) return null;
    pins[chainId] = {
      proxyRuntimeHash: admitted.proxyRuntimeHash,
      implementationAddress: admitted.implementationAddress,
      implementationRuntimeHash: admitted.implementationRuntimeHash
    };
  }
  return pins;
}

export function verifyAcrossFundingDeploymentAdmission(value: AcrossFundingDeploymentAdmission) {
  const admitted = ACROSS_FUNDING_DEPLOYMENT_V1[value.chainId];
  return Boolean(admitted)
    && value.schemaVersion === ACROSS_FUNDING_DEPLOYMENT_SCHEMA
    && value.chainId === admitted.chainId
    && value.proxyAddress === admitted.proxyAddress
    && value.proxyRuntimeHash === admitted.proxyRuntimeHash
    && value.implementationSlot === admitted.implementationSlot
    && value.implementationAddress === admitted.implementationAddress
    && value.implementationRuntimeHash === admitted.implementationRuntimeHash
    && value.evidenceBlock === admitted.evidenceBlock
    && value.evidenceBlockHash === admitted.evidenceBlockHash
    && value.observedAt === admitted.observedAt
    && value.officialSource === admitted.officialSource;
}
