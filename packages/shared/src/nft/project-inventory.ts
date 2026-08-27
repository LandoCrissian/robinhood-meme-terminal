import type { Address } from "viem";
import type { RmtNftCollectionStandard } from "./project-registry.js";

export type RmtNftInventoryAvailability = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";
export type RmtNftInventoryAvailabilityReason =
  | "SOURCE_BACKFILLING"
  | "SOURCE_ERROR"
  | "SOURCE_STALE"
  | null;

export type RmtNftTokenUriKind = "DATA_JSON_BASE64" | "IPFS" | "HTTPS" | "OTHER";

export type RmtNftItemAttribute = {
  traitType: string;
  value: string;
};

export type RmtNftItemMetadata = {
  authority: "ONCHAIN_TOKEN_URI";
  status: "READY" | "UNAVAILABLE" | "INVALID" | "UNSUPPORTED";
  tokenUriKind: RmtNftTokenUriKind;
  name: string | null;
  description: string | null;
  image: string | null;
  attributes: readonly RmtNftItemAttribute[];
  metadataDigest: `0x${string}` | null;
};

export type RmtNftInventoryItem = {
  tokenId: string;
  owner: Address;
  metadata: RmtNftItemMetadata;
};

export type RmtNftProjectInventoryRead = {
  schemaVersion: 1;
  projectId: string;
  chainId: 4663;
  collectionAddress: Address;
  collectionStandard: RmtNftCollectionStandard;
  availability: RmtNftInventoryAvailability;
  availabilityReason: RmtNftInventoryAvailabilityReason;
  asOf: string | null;
  items: readonly RmtNftInventoryItem[];
  nextCursor: string | null;
};

export type RmtNftTokenBoundAccountEvidence = {
  authority: "ONCHAIN_ERC6551_ACCOUNT";
  chainId: 4663;
  collectionAddress: Address;
  tokenId: string;
  accountAddress: Address;
};

export type RmtNftItemRead = {
  schemaVersion: 1;
  projectId: string;
  chainId: 4663;
  collectionAddress: Address;
  collectionStandard: "ERC721";
  tokenId: string;
  owner: Address;
  metadata: RmtNftItemMetadata;
  tokenBoundAccount: RmtNftTokenBoundAccountEvidence;
  asOf: string;
};
