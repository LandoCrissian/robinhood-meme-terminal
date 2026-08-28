import assert from 'node:assert/strict';
import { planRmtNftActivityScan, compareRmtNftCheckpointToCanonicalHash } from '@rmt/shared/nft/activity-ingestion';
import { RMT_NFT_ACTIVITY_SOURCES } from '@rmt/shared/nft/activity-sources';
import { NFT_INDEXER_SOURCES } from './sources.js';
import { createNftIndexerServer } from './server.js';
import type { NftIndexerWorker } from './worker.js';
import { activityTopicsForStandard } from './worker.js';
import {
  RMT_ERC1155_TRANSFER_BATCH_TOPIC,
  RMT_ERC1155_TRANSFER_SINGLE_TOPIC,
  RMT_ERC721_TRANSFER_TOPIC
} from '@rmt/shared/nft/activity-domain';

const source = RMT_NFT_ACTIVITY_SOURCES[0]!;
assert.equal(NFT_INDEXER_SOURCES.length, 3);
assert.equal(source.projectId, 'ccff00');
assert.equal(source.startBlock, 10_929_152n);
assert.deepEqual(activityTopicsForStandard('ERC721'), [RMT_ERC721_TRANSFER_TOPIC]);
assert.deepEqual(activityTopicsForStandard('ERC1155'), [
  RMT_ERC1155_TRANSFER_SINGLE_TOPIC,
  RMT_ERC1155_TRANSFER_BATCH_TOPIC
]);
const checkpoint = {
  schemaVersion: 1 as const, chainId: 4663 as const, projectId: source.projectId,
  collectionAddress: source.collectionAddress, standard: source.standard,
  nextBlock: source.startBlock, lastProcessedBlock: null
};
const plan = planRmtNftActivityScan({ checkpoint, chainHead: source.startBlock + 250n, finalityDepth: 50n, maxBlocksPerBatch: 100n, maxBatches: 2 });
assert.deepEqual(plan.ranges, [
  { fromBlock: source.startBlock, toBlock: source.startBlock + 99n },
  { fromBlock: source.startBlock + 100n, toBlock: source.startBlock + 199n }
]);
assert.equal(plan.safeHead, source.startBlock + 200n);
const initialized = { ...checkpoint, nextBlock: source.startBlock + 1n, lastProcessedBlock: { number: source.startBlock, hash: `0x${'1'.repeat(64)}` as const } };
assert.equal(compareRmtNftCheckpointToCanonicalHash(initialized, initialized.lastProcessedBlock.hash), 'CANONICAL');
assert.equal(compareRmtNftCheckpointToCanonicalHash(initialized, `0x${'2'.repeat(64)}`), 'REORG_DETECTED');

const server = createNftIndexerServer({
  status: {
    running: true, verifiedSourceCount: 1, lastCycleStartedAt: null,
    lastCycleCompletedAt: null, lastError: null, reorgsRecovered: 0
  }
} as NftIndexerWorker);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const status = await fetch(`http://127.0.0.1:${address.port}/status`);
assert.equal(status.status, 200);
const body = await status.json() as { servingProductionTraffic: boolean; publicDataApi: boolean };
assert.equal(body.servingProductionTraffic, false);
assert.equal(body.publicDataApi, false);
assert.equal((await fetch(`http://127.0.0.1:${address.port}/nfts`)).status, 404);
await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
console.info('nft-indexer checkpoint and bounded worker smoke: PASS');
