import type { Address, Hex } from "viem";
import type { RmtNftMovementKind } from "./activity-domain.js";
import type {
  RmtNftMarketplaceIdentityScope,
  RmtNftPaymentAsset,
} from "./marketplace-evidence.js";
import type {
  RmtNftCollectionStandard,
  RmtNftProjectStatus,
  RmtNftProjectTokenRegistryEntry,
} from "./project-registry.js";

export type RmtNftProjectMarketAvailability =
  | "AVAILABLE"
  | "PARTIAL"
  | "UNAVAILABLE";

export type RmtNftProjectMarketActivity = {
  transactionHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  logIndex: number;
  movementIndex: number;
  kind: RmtNftMovementKind;
  from: Address;
  to: Address;
  tokenId: string;
  amount: string;
  marketMeaning: "NOT_ESTABLISHED";
};

export type RmtNftProjectOnchainRead = {
  schemaVersion: 1;
  projectId: string;
  chainId: 4663;
  collectionAddress: Address;
  collectionStandard: RmtNftCollectionStandard;
  sourceStatus: "BACKFILLING" | "SYNCED" | "ERROR";
  availability: RmtNftProjectMarketAvailability;
  completeness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE";
  holderCount: string | null;
  circulatingTokenCount: string | null;
  recentActivity: readonly RmtNftProjectMarketActivity[];
  asOf: string;
};

export type RmtLowestNormalizedListingRead = {
  authority: "LOWEST_NORMALIZED_OPENSEA_LISTING";
  rmtExecutable: false;
  orderHash: Hex;
  protocolAddress: Address;
  tokenId: string;
  quantity: string;
  grossAmount: string;
  paymentAsset: RmtNftPaymentAsset;
  maker: Address;
  exactRevalidatedAt: string;
};

export type RmtNftProviderSaleRead = {
  authority: "PROVIDER_REPORTED_SALE";
  settlementVerificationStatus: "NOT_VERIFIED";
  tokenId: string;
  quantity: string;
  seller: Address;
  buyer: Address;
  paymentAsset: RmtNftPaymentAsset | null;
  grossAmount: string | null;
  transactionHash: Hex | null;
  orderHash: Hex | null;
  eventTimestamp: string;
};

export type RmtNftPaymentAssetVolume = {
  authority: "OPENSEA_REPORTED_24H_VOLUME";
  paymentAsset: RmtNftPaymentAsset;
  grossAmount: string;
  saleCount: number;
};

export type RmtNftProjectMarketplaceRead = {
  schemaVersion: 1;
  projectId: string;
  chainId: 4663;
  collectionAddress: Address;
  provider: "OPENSEA";
  protocol: "SEAPORT_1_6";
  availability: RmtNftProjectMarketAvailability;
  availabilityReason: string | null;
  sourceStatus: "BACKFILLING" | "SYNCED" | "ERROR";
  identityScope: RmtNftMarketplaceIdentityScope;
  providerCollectionSlug: string;
  lowestNormalizedListing: RmtLowestNormalizedListingRead | null;
  recentProviderSales: readonly RmtNftProviderSaleRead[];
  volume24hByPaymentAsset: readonly RmtNftPaymentAssetVolume[];
  asOf: string | null;
};

export type RmtNftProjectMarketReadModel = {
  schemaVersion: 1;
  project: {
    projectId: string;
    displayName: string;
    status: RmtNftProjectStatus;
    rmtCurated: true;
    chainId: 4663;
    collections: readonly {
      contractAddress: Address;
      standard: RmtNftCollectionStandard;
    }[];
    links: readonly { label: string; url: string }[];
  };
  onchain: RmtNftProjectOnchainRead | {
    availability: "UNAVAILABLE";
    reason: string;
  };
  marketplace: RmtNftProjectMarketplaceRead | {
    availability: "UNAVAILABLE";
    reason: string;
  };
  projectToken: RmtNftProjectTokenRegistryEntry | null;
};
