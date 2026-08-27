import { getAddress } from "viem";
import { RMT_NFT_ACTIVITY_SOURCES } from "@rmt/shared/nft/activity-sources";
import { seaportOrderHash } from "@rmt/shared/nft/seaport-order-hash";
import type {
  RmtNftCollectionMarketplaceIdentity,
  RmtSeaportOrderComponents,
} from "@rmt/shared/nft/marketplace-evidence";
import { evidenceDigest } from "./evidence-utils.js";
import {
  ROBINHOOD_WETH_ADDRESS,
  SEAPORT_1_6_ADDRESS,
  ZERO_ADDRESS,
} from "./constants.js";
export const SOURCE = RMT_NFT_ACTIVITY_SOURCES[0];
export const ALICE = getAddress("0x1111111111111111111111111111111111111111");
export const BOB = getAddress("0x2222222222222222222222222222222222222222");
export const IDENTITY: RmtNftCollectionMarketplaceIdentity = {
  provider: "OPENSEA",
  chainId: 4663,
  projectId: SOURCE.projectId,
  collectionAddress: SOURCE.collectionAddress,
  collectionStandard: SOURCE.standard,
  providerChain: "robinhood",
  providerCollectionSlug: "ccff00-161927574",
  scope: "EXACT_CONTRACT_SCOPE",
  memberContracts: [SOURCE.collectionAddress],
  verifiedAt: "2026-08-27T00:00:00.000Z",
  provenance: {
    provider: "OPENSEA",
    retrievedAt: "2026-08-27T00:00:00.000Z",
    rawEvidenceDigest: evidenceDigest({ fixture: "identity" }),
  },
};
const zone = getAddress("0x3333333333333333333333333333333333333333");
const recipient = getAddress("0x4444444444444444444444444444444444444444");
const bytes = "0x" + "00".repeat(32);
export function listingFixture(overrides: Record<string, unknown> = {}) {
  const parameters: RmtSeaportOrderComponents = {
    offerer: ALICE,
    zone,
    offer: [
      {
        itemType: 2,
        token: SOURCE.collectionAddress,
        identifierOrCriteria: 1n,
        startAmount: 1n,
        endAmount: 1n,
      },
    ],
    consideration: [
      {
        itemType: 0,
        token: ZERO_ADDRESS,
        identifierOrCriteria: 0n,
        startAmount: 100n,
        endAmount: 100n,
        recipient,
      },
    ],
    orderType: 0,
    startTime: 1n,
    endTime: 9999999999n,
    zoneHash: bytes as `0x${string}`,
    salt: 1n,
    conduitKey: bytes as `0x${string}`,
    counter: 0n,
  };
  return {
    order_hash: seaportOrderHash(parameters),
    chain: "robinhood",
    protocol_address: SEAPORT_1_6_ADDRESS,
    protocol_data: { parameters: jsonOrder(parameters) },
    asset: { contract: SOURCE.collectionAddress, identifier: "1" },
    remaining_quantity: 1,
    price: { current: { currency: "ETH", decimals: 18, value: "100" } },
    status: "active",
    ...overrides,
  };
}
export function offerFixture(
  scope: "ITEM" | "COLLECTION" | "TRAIT" = "ITEM",
  overrides: Record<string, unknown> = {},
) {
  const nftType = scope === "ITEM" ? 2 : 4;
  const parameters: RmtSeaportOrderComponents = {
    offerer: BOB,
    zone,
    offer: [
      {
        itemType: 1,
        token: ROBINHOOD_WETH_ADDRESS,
        identifierOrCriteria: 0n,
        startAmount: 50n,
        endAmount: 50n,
      },
    ],
    consideration: [
      {
        itemType: nftType,
        token: SOURCE.collectionAddress,
        identifierOrCriteria: scope === "ITEM" ? 1n : 0n,
        startAmount: 1n,
        endAmount: 1n,
        recipient: BOB,
      },
    ],
    orderType: 0,
    startTime: 1n,
    endTime: 9999999999n,
    zoneHash: bytes as `0x${string}`,
    salt: 2n,
    conduitKey: bytes as `0x${string}`,
    counter: 0n,
  };
  const criteria =
    scope === "ITEM"
      ? undefined
      : scope === "TRAIT"
        ? {
            collection: { slug: IDENTITY.providerCollectionSlug },
            contract: { address: SOURCE.collectionAddress },
            traits: [{ type: "Background", value: "Green" }],
          }
        : {
            collection: { slug: IDENTITY.providerCollectionSlug },
            contract: { address: SOURCE.collectionAddress },
          };
  return {
    order_hash: seaportOrderHash(parameters),
    chain: "robinhood",
    protocol_address: SEAPORT_1_6_ADDRESS,
    protocol_data: { parameters: jsonOrder(parameters) },
    ...(scope === "ITEM"
      ? { asset: { contract: SOURCE.collectionAddress, identifier: "1" } }
      : { criteria }),
    remaining_quantity: 1,
    price: { currency: "WETH", decimals: 18, value: "50" },
    status: "active",
    ...overrides,
  };
}
function jsonOrder(value: RmtSeaportOrderComponents) {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}
export function saleFixture(overrides: Record<string, unknown> = {}) {
  return {
    event_type: "sale",
    event_timestamp: "2026-08-27T01:00:00.000Z",
    chain: "robinhood",
    transaction: { hash: "0x" + "aa".repeat(32) },
    order_hash: "0x" + "bb".repeat(32),
    protocol_address: SEAPORT_1_6_ADDRESS,
    seller: ALICE,
    buyer: BOB,
    quantity: "1",
    nft: { contract: SOURCE.collectionAddress, identifier: "1" },
    payment: {
      quantity: "100",
      token_address: ZERO_ADDRESS,
      decimals: 18,
      symbol: "ETH",
    },
    ...overrides,
  };
}
