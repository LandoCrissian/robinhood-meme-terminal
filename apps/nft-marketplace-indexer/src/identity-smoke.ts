import assert from "node:assert/strict";
import { SOURCE, IDENTITY } from "./fixtures.js";
import {
  assertRobinhoodChainSupported,
  resolveOpenSeaIdentity,
  assertSlugReplacement,
} from "./identity.js";
import { assertMarketplaceSourceSet } from "./sources.js";
assert.doesNotThrow(() =>
  assertRobinhoodChainSupported({ chains: [{ identifier: "robinhood" }] }),
);
assert.throws(
  () => assertRobinhoodChainSupported({ chains: [{ identifier: "ethereum" }] }),
  /does not report Robinhood/,
);
const contract = {
  address: SOURCE.collectionAddress,
  chain: "robinhood",
  collection: "ccff00",
};
const collection = {
  collection: "ccff00",
  contracts: [{ address: SOURCE.collectionAddress, chain: "robinhood" }],
};
assert.equal(
  resolveOpenSeaIdentity(SOURCE, contract, collection, "2026-08-27T00:00:00Z")
    .scope,
  "EXACT_CONTRACT_SCOPE",
);
assert.equal(
  resolveOpenSeaIdentity(
    SOURCE,
    contract,
    {
      ...collection,
      contracts: [
        ...collection.contracts,
        {
          address: "0x9999999999999999999999999999999999999999",
          chain: "robinhood",
        },
      ],
    },
    "2026-08-27T00:00:00Z",
  ).scope,
  "MULTI_CONTRACT_COLLECTION_SCOPE",
);
assert.throws(
  () =>
    resolveOpenSeaIdentity(
      SOURCE,
      { ...contract, chain: "ethereum" },
      collection,
      "2026-08-27T00:00:00Z",
    ),
  /wrong chain/,
);
assert.throws(
  () =>
    resolveOpenSeaIdentity(
      SOURCE,
      { ...contract, address: "0x9999999999999999999999999999999999999999" },
      collection,
      "2026-08-27T00:00:00Z",
    ),
  /wrong address/,
);
assert.throws(
  () =>
    resolveOpenSeaIdentity(
      SOURCE,
      { ...contract, collection: null },
      collection,
      "2026-08-27T00:00:00Z",
    ),
  /UNAVAILABLE/,
);
assert.throws(
  () =>
    resolveOpenSeaIdentity(
      SOURCE,
      contract,
      { ...collection, contracts: [] },
      "2026-08-27T00:00:00Z",
    ),
  /omits/,
);
assert.throws(
  () =>
    assertSlugReplacement(
      IDENTITY,
      { ...IDENTITY, providerCollectionSlug: "new-slug" },
      false,
    ),
  /revalidation/,
);
assert.doesNotThrow(() =>
  assertSlugReplacement(
    IDENTITY,
    { ...IDENTITY, providerCollectionSlug: "new-slug" },
    true,
  ),
);
assert.doesNotThrow(() => assertMarketplaceSourceSet([SOURCE]));
assert.throws(() => assertMarketplaceSourceSet([]), /omits/);
assert.throws(() => assertMarketplaceSourceSet([SOURCE, SOURCE]), /duplicate/);
assert.throws(
  () =>
    assertMarketplaceSourceSet([
      { ...SOURCE, projectId: "unreviewed-project" },
    ]),
  /not in RMT_NFT_ACTIVITY_SOURCES/,
);
console.info("nft-marketplace identity smoke: PASS");
