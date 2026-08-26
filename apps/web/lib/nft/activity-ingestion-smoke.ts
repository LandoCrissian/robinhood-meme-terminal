import assert from "node:assert/strict";
import { getAddress, type Hex } from "viem";
import {
  advanceRmtNftActivityCheckpoint,
  compareRmtNftCheckpointToCanonicalHash,
  createRmtNftActivityCheckpoint,
  planRmtNftActivityScan,
  rewindRmtNftActivityCheckpoint
} from "./activity-ingestion";

const collection = {
  projectId: "ccff00",
  collectionAddress: getAddress("0x505A22Ffed8d37ebE580FfD98d2Cdb0021189146"),
  standard: "ERC721" as const
};

function hash(byte: string): Hex {
  return `0x${byte.repeat(64)}` as Hex;
}

const initial = createRmtNftActivityCheckpoint(collection, 100n);
assert.equal(initial.chainId, 4_663);
assert.equal(initial.nextBlock, 100n);
assert.equal(initial.lastProcessedBlock, null);

const plan = planRmtNftActivityScan({
  checkpoint: initial,
  chainHead: 250n,
  finalityDepth: 10n,
  maxBlocksPerBatch: 50n
});
assert.equal(plan.safeHead, 240n);
assert.deepEqual(plan.ranges, [
  { fromBlock: 100n, toBlock: 149n },
  { fromBlock: 150n, toBlock: 199n },
  { fromBlock: 200n, toBlock: 240n }
]);

const boundedPlan = planRmtNftActivityScan({
  checkpoint: initial,
  chainHead: 1_000n,
  finalityDepth: 10n,
  maxBlocksPerBatch: 50n,
  maxBatches: 2
});
assert.deepEqual(boundedPlan.ranges, [
  { fromBlock: 100n, toBlock: 149n },
  { fromBlock: 150n, toBlock: 199n }
], "Each ingestion iteration must be bounded even during a large backfill.");

const immatureHead = planRmtNftActivityScan({
  checkpoint: initial,
  chainHead: 5n,
  finalityDepth: 10n,
  maxBlocksPerBatch: 50n
});
assert.equal(immatureHead.safeHead, null);
assert.deepEqual(immatureHead.ranges, []);

const advanced = advanceRmtNftActivityCheckpoint(initial, 149n, hash("a"));
assert.equal(advanced.nextBlock, 150n);
assert.deepEqual(advanced.lastProcessedBlock, { number: 149n, hash: hash("a") });
assert.equal(compareRmtNftCheckpointToCanonicalHash(advanced, hash("a")), "CANONICAL");
assert.equal(compareRmtNftCheckpointToCanonicalHash(advanced, hash("b")), "REORG_DETECTED");
assert.equal(compareRmtNftCheckpointToCanonicalHash(advanced, null), "REORG_DETECTED");
assert.equal(compareRmtNftCheckpointToCanonicalHash(initial, hash("a")), "UNINITIALIZED");

const rewound = rewindRmtNftActivityCheckpoint(advanced, 100n);
assert.equal(rewound.nextBlock, 100n);
assert.equal(rewound.lastProcessedBlock, null,
  "A rewound cursor must be replayed before it becomes anchored to a canonical block again.");

assert.throws(() => createRmtNftActivityCheckpoint(collection, -1n), /cannot be negative/);
assert.throws(() => planRmtNftActivityScan({
  checkpoint: initial,
  chainHead: 250n,
  finalityDepth: 10n,
  maxBlocksPerBatch: 0n
}), /greater than zero/);
assert.throws(() => advanceRmtNftActivityCheckpoint(advanced, 149n, hash("c")), /cannot move backwards/);
assert.throws(() => rewindRmtNftActivityCheckpoint(initial, 101n), /cannot be ahead/);

console.log("RMT NFT ingestion planning is bounded, finality-aware, and checkpoint hashes expose reorgs before advancement.");
