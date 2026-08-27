import assert from "node:assert/strict";
import { getAddress } from "viem";
import {
  parseSeaportOrderComponents,
  seaportOrderHash,
} from "@rmt/shared/nft/seaport-order-hash";
import {
  IDENTITY,
  listingFixture,
  offerFixture,
  saleFixture,
  SOURCE,
} from "./fixtures.js";
import {
  normalizeListing,
  normalizeOffer,
  normalizeSale,
  lowestNormalizedOpenSeaListing,
  openSeaReportedFloor,
} from "./normalization.js";
const now = "2026-08-27T02:00:00Z";
const listing = normalizeListing(IDENTITY, listingFixture(), now);
assert.equal(listing.tokenId, 1n);
assert.equal(listing.grossAmount, 100n);
assert.equal(listing.orderIdentityStatus, "ORDER_IDENTITY_VERIFIED");
assert.equal(
  normalizeListing(IDENTITY, listingFixture({ status: "cancelled" }), now)
    .status,
  "CANCELLED",
);
assert.equal(
  normalizeListing(IDENTITY, listingFixture({ status: "expired" }), now).status,
  "EXPIRED",
);
assert.throws(
  () => normalizeListing(IDENTITY, listingFixture({ chain: "ethereum" }), now),
  /wrong chain/,
);
assert.throws(
  () =>
    normalizeListing(
      IDENTITY,
      listingFixture({
        protocol_address: "0x9999999999999999999999999999999999999999",
      }),
      now,
    ),
  /Seaport/,
);
assert.throws(
  () =>
    normalizeListing(
      IDENTITY,
      listingFixture({
        asset: {
          contract: "0x9999999999999999999999999999999999999999",
          identifier: "1",
        },
      }),
      now,
    ),
  /admitted contract/,
);
assert.throws(
  () =>
    normalizeListing(
      IDENTITY,
      listingFixture({ order_hash: "0x" + "ff".repeat(32) }),
      now,
    ),
  /does not match/,
);
assert.throws(
  () =>
    normalizeListing(
      IDENTITY,
      listingFixture({ protocol_data: { parameters: {} } }),
      now,
    ),
  /ORDER_IDENTITY_UNVERIFIED/,
);
const erc1155 = listingFixture();
const erc1155Record = erc1155 as Record<string, any>;
erc1155Record.protocol_data.parameters.offer[0].itemType = 3;
erc1155Record.protocol_data.parameters.offer[0].startAmount = "2";
erc1155Record.protocol_data.parameters.offer[0].endAmount = "2";
erc1155Record.remaining_quantity = 2;
erc1155Record.order_hash = seaportOrderHash(
  parseSeaportOrderComponents(erc1155Record.protocol_data.parameters),
);
assert.equal(
  normalizeListing({ ...IDENTITY, collectionStandard: "ERC1155" }, erc1155, now)
    .quantity,
  2n,
);
for (const scope of ["ITEM", "COLLECTION", "TRAIT"] as const)
  assert.equal(normalizeOffer(IDENTITY, offerFixture(scope), now).scope, scope);
assert.throws(
  () =>
    normalizeOffer(
      IDENTITY,
      offerFixture("ITEM", { criteria: { collection: { slug: "x" } } }),
      now,
    ),
  /ambiguous/,
);
const sale = normalizeSale(IDENTITY, saleFixture(), now)!;
assert.equal(sale.authority, "PROVIDER_REPORTED_SALE");
assert.equal(sale.settlementVerificationStatus, "NOT_VERIFIED");
assert.equal(normalizeSale(IDENTITY, { event_type: "transfer" }, now), null);
const missing = normalizeSale(
  IDENTITY,
  saleFixture({ transaction: null, order_hash: null, payment: null }),
  now,
)!;
assert.equal(missing.transactionHash, null);
assert.equal(missing.orderHash, null);
assert.equal(missing.paymentAsset, null);
assert.equal(
  lowestNormalizedOpenSeaListing([
    listing,
    { ...listing, grossAmount: 90n, orderHash: `0x${"12".repeat(32)}` },
  ])?.grossAmount,
  90n,
);
assert.equal(
  openSeaReportedFloor(IDENTITY, { total: { floor_price: 0.25 } })?.authority,
  "OPENSEA_REPORTED_FLOOR",
);
assert.equal(
  openSeaReportedFloor(
    { ...IDENTITY, scope: "MULTI_CONTRACT_COLLECTION_SCOPE" },
    { total: { floor_price: 0.25 } },
  ),
  null,
);
assert.equal("marketMeaning" in sale, false);
assert.equal(
  SOURCE.collectionAddress,
  getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146"),
);
console.info("nft-marketplace normalization smoke: PASS");
