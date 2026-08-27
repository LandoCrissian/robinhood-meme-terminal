import type { Address, Hex } from "viem";
import type { RmtNftCollectionStandard } from "./project-registry.js";

export const RMT_NFT_MARKETPLACE_PROVIDER = "OPENSEA" as const;
export const RMT_NFT_MARKETPLACE_PROTOCOL = "SEAPORT_1_6" as const;
export const RMT_SEAPORT_1_6_ADDRESS =
  "0x0000000000000068F116a894984e2DB1123eB395" as Address;
export const RMT_NFT_MARKETPLACE_ORDER_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "FULFILLED",
  "EXPIRED",
  "CANCELLED",
  "UNKNOWN",
] as const;
export type RmtNftMarketplaceProvider = typeof RMT_NFT_MARKETPLACE_PROVIDER;
export type RmtNftMarketplaceProtocol = typeof RMT_NFT_MARKETPLACE_PROTOCOL;
export type RmtNftMarketplaceOrderStatus =
  (typeof RMT_NFT_MARKETPLACE_ORDER_STATUSES)[number];
export type RmtNftMarketplaceIdentityScope =
  | "EXACT_CONTRACT_SCOPE"
  | "MULTI_CONTRACT_COLLECTION_SCOPE";
export type RmtNftMarketplaceOrderScope = "ITEM" | "COLLECTION" | "TRAIT";
export type RmtNftOrderIdentityStatus =
  | "ORDER_IDENTITY_VERIFIED"
  | "ORDER_IDENTITY_UNVERIFIED";
export type RmtNftPaymentAsset = {
  kind: "NATIVE" | "ERC20";
  chainId: 4663;
  address: Address | null;
  symbol: string;
  decimals: number;
};
export type RmtNftMarketplaceProvenance = {
  provider: RmtNftMarketplaceProvider;
  retrievedAt: string;
  rawEvidenceDigest: Hex;
};
export type RmtNftMarketplaceCollectionMember = {
  chain: string;
  address: Address;
};
export type RmtNftCollectionMarketplaceIdentity = {
  provider: RmtNftMarketplaceProvider;
  chainId: 4663;
  projectId: string;
  collectionAddress: Address;
  collectionStandard: RmtNftCollectionStandard;
  providerChain: "robinhood";
  providerCollectionSlug: string;
  scope: RmtNftMarketplaceIdentityScope;
  providerMembers: readonly RmtNftMarketplaceCollectionMember[];
  verifiedAt: string;
  provenance: RmtNftMarketplaceProvenance;
};
export type RmtSeaportItem = {
  itemType: number;
  token: Address;
  identifierOrCriteria: bigint;
  startAmount: bigint;
  endAmount: bigint;
};
export type RmtSeaportConsiderationItem = RmtSeaportItem & {
  recipient: Address;
};
export type RmtSeaportOrderComponents = {
  offerer: Address;
  zone: Address;
  offer: readonly RmtSeaportItem[];
  consideration: readonly RmtSeaportConsiderationItem[];
  orderType: number;
  startTime: bigint;
  endTime: bigint;
  zoneHash: Hex;
  salt: bigint;
  conduitKey: Hex;
  counter: bigint;
};
type OrderBase = {
  provider: RmtNftMarketplaceProvider;
  protocol: RmtNftMarketplaceProtocol;
  chainId: 4663;
  projectId: string;
  collectionAddress: Address;
  collectionStandard: RmtNftCollectionStandard;
  tokenId: bigint | null;
  quantity: bigint;
  maker: Address;
  paymentAsset: RmtNftPaymentAsset;
  grossAmount: bigint;
  startTime: bigint;
  endTime: bigint;
  orderHash: Hex;
  protocolAddress: Address;
  providerStatus: string;
  status: RmtNftMarketplaceOrderStatus;
  remainingQuantity: bigint;
  orderIdentityStatus: RmtNftOrderIdentityStatus;
  protocolData: RmtSeaportOrderComponents | null;
  provenance: RmtNftMarketplaceProvenance;
};
export type RmtNftListingEvidence = OrderBase & {
  evidenceKind: "LISTING";
  scope: "ITEM";
};
export type RmtNftOfferEvidence = OrderBase & {
  evidenceKind: "OFFER";
  scope: RmtNftMarketplaceOrderScope;
  criteria: Readonly<Record<string, unknown>> | null;
};
export type RmtNftSaleEvidence = {
  evidenceKind: "SALE";
  authority: "PROVIDER_REPORTED_SALE";
  settlementVerificationStatus: "NOT_VERIFIED";
  provider: RmtNftMarketplaceProvider;
  protocol: RmtNftMarketplaceProtocol | null;
  chainId: 4663;
  projectId: string;
  collectionAddress: Address;
  tokenId: bigint;
  quantity: bigint;
  seller: Address;
  buyer: Address;
  paymentAsset: RmtNftPaymentAsset | null;
  grossAmount: bigint | null;
  transactionHash: Hex | null;
  orderHash: Hex | null;
  protocolAddress: Address | null;
  eventTimestamp: string;
  provenance: RmtNftMarketplaceProvenance;
};
export type RmtLowestNormalizedOpenSeaListing = {
  authority: "LOWEST_NORMALIZED_OPENSEA_LISTING";
  rmtVerifiedFloor: false;
  collectionAddress: Address;
  paymentAsset: RmtNftPaymentAsset;
  grossAmount: bigint;
  orderHash: Hex;
};
