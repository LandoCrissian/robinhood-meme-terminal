import assert from "node:assert/strict";
import { getAddress } from "viem";
import {
  RMT_NFT_ACTIVITY_SOURCES,
  rmtNftActivitySource
} from "@rmt/shared/nft/activity-sources";

const CCFF00_COLLECTION = getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146");
const CCFF00_DEPLOYMENT_TX = "0x46b097f55f69ee1005f0e04bc6501e632ba4145355361498a156f8f401a5c96b";

assert.deepEqual(RMT_NFT_ACTIVITY_SOURCES.map((item) => item.projectId), [
  "ccff00", "robin-rabbits", "gogh-punks"
], "Only independently verified top-level-creation collections belong in the NFT activity manifest.");

const source = rmtNftActivitySource(CCFF00_COLLECTION);
assert.ok(source, "CCFF00 must have reviewed deployment provenance before complete-history indexing.");
assert.equal(source.projectId, "ccff00");
assert.equal(source.chainId, 4_663);
assert.equal(source.standard, "ERC721");
assert.equal(source.deploymentTransaction, CCFF00_DEPLOYMENT_TX);
assert.equal(source.startBlock, 10_929_152n);
assert.equal(source.runtimeBytecodeHash, "0x9172fab56f52887b2b271fa9c2fd9fa857edd79a39cf3f72513f1c343558fab1");

assert.equal(
  rmtNftActivitySource(getAddress("0x7777777777777777777777777777777777777777")),
  null,
  "Unreviewed contracts must never acquire an NFT indexing start block by inference."
);

console.log("RMT NFT activity source manifest pins reviewed deployment provenance independently from project admission.");
