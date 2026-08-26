import {
  getAddress,
  type Address,
  type Hex
} from "viem";
import { RMT_NFT_CHAIN_ID, type RmtNftCollectionStandard } from "./project-registry";
import type { RmtNftActivityCollectionContext } from "./activity-domain";

export type RmtNftActivityCheckpoint = {
  schemaVersion: 1;
  chainId: typeof RMT_NFT_CHAIN_ID;
  projectId: string;
  collectionAddress: Address;
  standard: RmtNftCollectionStandard;
  nextBlock: bigint;
  lastProcessedBlock: null | {
    number: bigint;
    hash: Hex;
  };
};

export type RmtNftActivityScanRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export type RmtNftActivityScanPlan = {
  chainHead: bigint;
  safeHead: bigint | null;
  finalityDepth: bigint;
  maxBlocksPerBatch: bigint;
  ranges: readonly RmtNftActivityScanRange[];
};

export type RmtNftCheckpointCanonicality =
  | "UNINITIALIZED"
  | "CANONICAL"
  | "REORG_DETECTED";

function nonNegative(value: bigint, label: string) {
  if (value < 0n) throw new Error(`${label} cannot be negative.`);
  return value;
}

function positive(value: bigint, label: string) {
  if (value <= 0n) throw new Error(`${label} must be greater than zero.`);
  return value;
}

export function createRmtNftActivityCheckpoint(
  collection: RmtNftActivityCollectionContext,
  startBlock: bigint
): RmtNftActivityCheckpoint {
  return {
    schemaVersion: 1,
    chainId: RMT_NFT_CHAIN_ID,
    projectId: collection.projectId,
    collectionAddress: getAddress(collection.collectionAddress),
    standard: collection.standard,
    nextBlock: nonNegative(startBlock, "RMT NFT activity start block"),
    lastProcessedBlock: null
  };
}

export function planRmtNftActivityScan(input: {
  checkpoint: RmtNftActivityCheckpoint;
  chainHead: bigint;
  finalityDepth: bigint;
  maxBlocksPerBatch: bigint;
  maxBatches?: number;
}): RmtNftActivityScanPlan {
  const chainHead = nonNegative(input.chainHead, "RMT NFT chain head");
  const finalityDepth = nonNegative(input.finalityDepth, "RMT NFT finality depth");
  const maxBlocksPerBatch = positive(input.maxBlocksPerBatch, "RMT NFT scan batch size");
  const maxBatches = input.maxBatches ?? 32;
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 512) {
    throw new Error("RMT NFT scan max batches must be an integer between 1 and 512.");
  }

  const safeHead = chainHead >= finalityDepth ? chainHead - finalityDepth : null;
  if (safeHead === null || input.checkpoint.nextBlock > safeHead) {
    return { chainHead, safeHead, finalityDepth, maxBlocksPerBatch, ranges: [] };
  }

  const ranges: RmtNftActivityScanRange[] = [];
  let fromBlock = input.checkpoint.nextBlock;
  while (fromBlock <= safeHead && ranges.length < maxBatches) {
    const candidateTo = fromBlock + maxBlocksPerBatch - 1n;
    const toBlock = candidateTo < safeHead ? candidateTo : safeHead;
    ranges.push({ fromBlock, toBlock });
    fromBlock = toBlock + 1n;
  }

  return { chainHead, safeHead, finalityDepth, maxBlocksPerBatch, ranges };
}

export function advanceRmtNftActivityCheckpoint(
  checkpoint: RmtNftActivityCheckpoint,
  processedThroughBlock: bigint,
  processedThroughBlockHash: Hex
): RmtNftActivityCheckpoint {
  const block = nonNegative(processedThroughBlock, "RMT NFT processed block");
  if (block < checkpoint.nextBlock) {
    throw new Error("RMT NFT checkpoint cannot move backwards while advancing.");
  }
  return {
    ...checkpoint,
    nextBlock: block + 1n,
    lastProcessedBlock: {
      number: block,
      hash: processedThroughBlockHash
    }
  };
}

export function compareRmtNftCheckpointToCanonicalHash(
  checkpoint: RmtNftActivityCheckpoint,
  canonicalBlockHash: Hex | null
): RmtNftCheckpointCanonicality {
  if (!checkpoint.lastProcessedBlock) return "UNINITIALIZED";
  if (!canonicalBlockHash) return "REORG_DETECTED";
  return checkpoint.lastProcessedBlock.hash.toLowerCase() === canonicalBlockHash.toLowerCase()
    ? "CANONICAL"
    : "REORG_DETECTED";
}

export function rewindRmtNftActivityCheckpoint(
  checkpoint: RmtNftActivityCheckpoint,
  rewindToBlock: bigint
): RmtNftActivityCheckpoint {
  const nextBlock = nonNegative(rewindToBlock, "RMT NFT rewind block");
  if (nextBlock > checkpoint.nextBlock) {
    throw new Error("RMT NFT checkpoint rewind target cannot be ahead of the current cursor.");
  }
  return {
    ...checkpoint,
    nextBlock,
    // A rewound cursor is intentionally unanchored until the replayed range is
    // processed and a fresh canonical block hash is recorded.
    lastProcessedBlock: null
  };
}
