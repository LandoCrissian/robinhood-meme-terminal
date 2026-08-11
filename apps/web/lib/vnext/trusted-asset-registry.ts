import { getAddress, isAddress, type Address } from "viem";

export const ETHEREUM_MAINNET_CHAIN_ID = 1 as const;
export const ARBITRUM_MAINNET_CHAIN_ID = 42_161 as const;
export const BASE_MAINNET_CHAIN_ID = 8_453 as const;
export const ROBINHOOD_MAINNET_CHAIN_ID = 4_663 as const;

export type TrustedAssetChainId =
  | typeof ETHEREUM_MAINNET_CHAIN_ID
  | typeof ARBITRUM_MAINNET_CHAIN_ID
  | typeof BASE_MAINNET_CHAIN_ID
  | typeof ROBINHOOD_MAINNET_CHAIN_ID;

export type TrustedAssetClassification =
  | "canonical"
  | "issuer_verified"
  | "verified_bridged"
  | "yield_bearing_stable_adjacent";

export type TrustedAssetProvenance = {
  kind: "canonical_issuer" | "issuer_native" | "canonical_gateway" | "layerzero_oft" | "chainlink_ccip";
  provider: string;
  canonicalAsset?: { chainId: TrustedAssetChainId; address: Address };
  evidenceUrls: readonly string[];
};

export type TrustedAssetRisk = {
  cashEquivalent: boolean;
  bridgeRisk: boolean;
  syntheticDollar: boolean;
  yieldBearing: boolean;
  disclosure: string;
};

export type TrustedAsset = {
  id: `eip155:${TrustedAssetChainId}:${string}`;
  chainId: TrustedAssetChainId;
  chainName: "Ethereum" | "Arbitrum" | "Base" | "Robinhood Chain";
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  issuer: string;
  classification: TrustedAssetClassification;
  provenance: TrustedAssetProvenance;
  paymentEligible: boolean;
  settlementEligible: boolean;
  quoteEligible: boolean;
  bridgeEligible: boolean;
  userVisible: boolean;
  risk: TrustedAssetRisk;
};

const ROBINHOOD_USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const ROBINHOOD_WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const ROBINHOOD_USDE = getAddress("0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34");
const ROBINHOOD_SYRUP_USDG = getAddress("0x40858070814a57FdF33a613ae84fE0a8b4a874f7");
const ROBINHOOD_CANONICAL_GATEWAY_USDC = getAddress("0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8");
const ROBINHOOD_CANONICAL_GATEWAY_USDT = getAddress("0xE246BC49b0598d7Cd9f0eAD48B885034f1254380");
const ETHEREUM_USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const ARBITRUM_USDC = getAddress("0xaf88d065e77c8cC2239327C5EDb3A432268e5831");
const BASE_USDC = getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");

export const TRUSTED_ASSET_ADDRESSES = {
  ROBINHOOD_USDG,
  ROBINHOOD_WETH,
  ROBINHOOD_USDE,
  ROBINHOOD_SYRUP_USDG,
  ROBINHOOD_CANONICAL_GATEWAY_USDC,
  ROBINHOOD_CANONICAL_GATEWAY_USDT,
  ETHEREUM_USDC,
  ARBITRUM_USDC,
  BASE_USDC
} as const;

function identity(chainId: TrustedAssetChainId, address: Address): TrustedAsset["id"] {
  return `eip155:${chainId}:${address.toLowerCase()}`;
}

const ROBINHOOD_CONTRACTS = "https://docs.robinhood.com/chain/contracts/";
const ROBINHOOD_BRIDGING = "https://docs.robinhood.com/chain/bridging/";
const CIRCLE_USDC = "https://developers.circle.com/stablecoins/usdc-contract-addresses";

const registry = [
  {
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    chainName: "Robinhood Chain",
    address: ROBINHOOD_USDG,
    symbol: "USDG",
    name: "Global Dollar",
    decimals: 6,
    issuer: "Paxos / Global Dollar Network",
    classification: "canonical",
    provenance: { kind: "canonical_issuer", provider: "Robinhood", evidenceUrls: [ROBINHOOD_CONTRACTS] },
    paymentEligible: true,
    settlementEligible: true,
    quoteEligible: true,
    bridgeEligible: true,
    userVisible: true,
    risk: {
      cashEquivalent: true,
      bridgeRisk: false,
      syntheticDollar: false,
      yieldBearing: false,
      disclosure: "Canonical USDG on Robinhood Chain."
    }
  },
  {
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    chainName: "Robinhood Chain",
    address: ROBINHOOD_WETH,
    symbol: "WETH",
    name: "Wrapped Ether",
    decimals: 18,
    issuer: "Robinhood Chain",
    classification: "canonical",
    provenance: { kind: "canonical_issuer", provider: "Robinhood", evidenceUrls: [ROBINHOOD_CONTRACTS] },
    paymentEligible: true,
    settlementEligible: true,
    quoteEligible: true,
    bridgeEligible: true,
    userVisible: true,
    risk: {
      cashEquivalent: false,
      bridgeRisk: false,
      syntheticDollar: false,
      yieldBearing: false,
      disclosure: "Canonical wrapped native asset on Robinhood Chain."
    }
  },
  {
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    chainName: "Robinhood Chain",
    address: ROBINHOOD_USDE,
    symbol: "USDe",
    name: "USDe",
    decimals: 18,
    issuer: "Ethena",
    classification: "verified_bridged",
    provenance: {
      kind: "layerzero_oft",
      provider: "LayerZero / Ethena",
      canonicalAsset: { chainId: ETHEREUM_MAINNET_CHAIN_ID, address: getAddress("0x4c9EDD5852cd905f086c759e8383e09bff1e68B3") },
      evidenceUrls: ["https://docs.ethena.fi/solution-design/key-addresses", "https://metadata.layerzero-api.com/v1/metadata"]
    },
    paymentEligible: false,
    settlementEligible: false,
    quoteEligible: true,
    bridgeEligible: true,
    userVisible: false,
    risk: {
      cashEquivalent: false,
      bridgeRisk: true,
      syntheticDollar: true,
      yieldBearing: false,
      disclosure: "Ethena synthetic dollar bridged through LayerZero; not native fiat cash."
    }
  },
  {
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    chainName: "Robinhood Chain",
    address: ROBINHOOD_SYRUP_USDG,
    symbol: "syrupUSDG",
    name: "Syrup USDG",
    decimals: 6,
    issuer: "Maple Finance",
    classification: "yield_bearing_stable_adjacent",
    provenance: {
      kind: "chainlink_ccip",
      provider: "Chainlink CCIP / Maple",
      canonicalAsset: { chainId: ETHEREUM_MAINNET_CHAIN_ID, address: getAddress("0x87b65c4aaffa76881f9e96f3e7ed945ddfc3cd7a") },
      evidenceUrls: ["https://maple.finance/insights/syrupusdg", "https://docs.chain.link/ccip/directory/mainnet/chain/robinhood-mainnet"]
    },
    paymentEligible: false,
    settlementEligible: false,
    quoteEligible: true,
    bridgeEligible: true,
    userVisible: false,
    risk: {
      cashEquivalent: false,
      bridgeRisk: true,
      syntheticDollar: false,
      yieldBearing: true,
      disclosure: "Yield-bearing Maple credit exposure bridged through CCIP; value is not fixed at one dollar."
    }
  },
  {
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    chainName: "Robinhood Chain",
    address: ROBINHOOD_CANONICAL_GATEWAY_USDC,
    symbol: "USDC",
    name: "USD Coin (Canonical Gateway)",
    decimals: 6,
    issuer: "Circle representation via Robinhood canonical gateway",
    classification: "verified_bridged",
    provenance: {
      kind: "canonical_gateway",
      provider: "Robinhood canonical bridge",
      canonicalAsset: { chainId: ETHEREUM_MAINNET_CHAIN_ID, address: ETHEREUM_USDC },
      evidenceUrls: [ROBINHOOD_BRIDGING, CIRCLE_USDC]
    },
    paymentEligible: false,
    settlementEligible: false,
    quoteEligible: false,
    bridgeEligible: true,
    userVisible: false,
    risk: {
      cashEquivalent: false,
      bridgeRisk: true,
      syntheticDollar: false,
      yieldBearing: false,
      disclosure: "Canonical-gateway representation of Ethereum USDC; not Circle-native USDC on Robinhood Chain."
    }
  },
  {
    chainId: ROBINHOOD_MAINNET_CHAIN_ID,
    chainName: "Robinhood Chain",
    address: ROBINHOOD_CANONICAL_GATEWAY_USDT,
    symbol: "USDT",
    name: "Tether USD (Canonical Gateway)",
    decimals: 6,
    issuer: "Tether representation via Robinhood canonical gateway",
    classification: "verified_bridged",
    provenance: {
      kind: "canonical_gateway",
      provider: "Robinhood canonical bridge",
      canonicalAsset: { chainId: ETHEREUM_MAINNET_CHAIN_ID, address: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7") },
      evidenceUrls: [ROBINHOOD_BRIDGING]
    },
    paymentEligible: false,
    settlementEligible: false,
    quoteEligible: false,
    bridgeEligible: true,
    userVisible: false,
    risk: {
      cashEquivalent: false,
      bridgeRisk: true,
      syntheticDollar: false,
      yieldBearing: false,
      disclosure: "Canonical-gateway representation of Ethereum USDT with limited Robinhood liquidity."
    }
  },
  ...([
    [ETHEREUM_MAINNET_CHAIN_ID, "Ethereum", ETHEREUM_USDC],
    [ARBITRUM_MAINNET_CHAIN_ID, "Arbitrum", ARBITRUM_USDC],
    [BASE_MAINNET_CHAIN_ID, "Base", BASE_USDC]
  ] as const).map(([chainId, chainName, address]) => ({
    chainId,
    chainName,
    address,
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    issuer: "Circle",
    classification: "issuer_verified" as const,
    provenance: { kind: "issuer_native" as const, provider: "Circle", evidenceUrls: [CIRCLE_USDC] },
    paymentEligible: true,
    settlementEligible: false,
    quoteEligible: false,
    bridgeEligible: true,
    userVisible: false,
    risk: {
      cashEquivalent: true,
      bridgeRisk: false,
      syntheticDollar: false,
      yieldBearing: false,
      disclosure: `Circle-issued native USDC on ${chainName}; cross-chain settlement is asynchronous.`
    }
  }))
] satisfies readonly Omit<TrustedAsset, "id">[];

export const TRUSTED_ASSETS: readonly TrustedAsset[] = Object.freeze(registry.map((asset) => Object.freeze({
  ...asset,
  id: identity(asset.chainId, asset.address)
})));

const byIdentity = new Map(TRUSTED_ASSETS.map((asset) => [asset.id, asset]));

export function trustedAssetId(chainId: number, address: string) {
  if (!Number.isSafeInteger(chainId) || !isAddress(address, { strict: false })) return null;
  return `eip155:${chainId}:${getAddress(address).toLowerCase()}`;
}

export function trustedAsset(chainId: number, address: string) {
  const id = trustedAssetId(chainId, address);
  return id ? byIdentity.get(id as TrustedAsset["id"]) ?? null : null;
}

export function requireTrustedAsset(chainId: number, address: string) {
  const asset = trustedAsset(chainId, address);
  if (!asset) throw new Error("RMT rejected an asset that is not in the trusted chain-qualified registry.");
  return asset;
}

export function trustedPaymentAsset(chainId: number, address: string) {
  const asset = trustedAsset(chainId, address);
  return asset?.paymentEligible ? asset : null;
}

export function trustedSettlementAsset(chainId: number, address: string) {
  const asset = trustedAsset(chainId, address);
  return asset?.settlementEligible ? asset : null;
}
