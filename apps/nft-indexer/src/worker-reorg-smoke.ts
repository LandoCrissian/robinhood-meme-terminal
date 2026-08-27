import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { encodeEventTopics, getAddress, zeroAddress, type Address, type Hex } from 'viem';
import { RMT_NFT_ACTIVITY_SOURCES } from '@rmt/shared/nft/activity-sources';
import { RMT_ERC721_TRANSFER_TOPIC } from '@rmt/shared/nft/activity-domain';
import type { NftIndexerConfig } from './config.js';
import { migrateNftIndexer, NFT_INDEXER_TABLES } from './schema.js';
import { readCheckpoint, readSourceOperationalState } from './storage.js';
import { NftIndexerWorker, type NftIndexerRpc } from './worker.js';

const databaseUrl = process.env.NFT_INDEXER_TEST_DATABASE_URL?.trim() ?? process.env.NFT_INDEXER_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('NFT_INDEXER_TEST_DATABASE_URL is required for worker reorg smoke coverage');
const pool = new Pool({ connectionString: databaseUrl, ssl: false });
const reviewedSource = RMT_NFT_ACTIVITY_SOURCES[0]!;
const source = { ...reviewedSource, verifiedAt: '2026-08-27T00:00:00.000Z' };
const alice = getAddress('0x1111111111111111111111111111111111111111');
const bob = getAddress('0x2222222222222222222222222222222222222222');
const carol = getAddress('0x3333333333333333333333333333333333333333');
const hash = (character: string) => `0x${character.repeat(64)}` as Hex;
const blockA = source.startBlock;
const blockB = blockA + 1n;
const hashA = hash('a');
const orphanHashB = hash('b');
const replacementHashB = hash('c');
const mintTransaction = hash('1');
const orphanTransaction = hash('2');
const replacementTransaction = hash('3');

const transferAbi = [{ type: 'event', name: 'Transfer', anonymous: false, inputs: [
  { indexed: true, name: 'from', type: 'address' },
  { indexed: true, name: 'to', type: 'address' },
  { indexed: true, name: 'tokenId', type: 'uint256' }
]}] as const;

function transferLog(input: {
  from: Address; to: Address; blockNumber: bigint; blockHash: Hex; transactionHash: Hex; logIndex: number;
}) {
  const topics = encodeEventTopics({
    abi: transferAbi,
    eventName: 'Transfer',
    args: { from: input.from, to: input.to, tokenId: 42n }
  }).filter((topic): topic is Hex => typeof topic === 'string');
  return {
    address: source.collectionAddress,
    topics,
    data: '0x' as Hex,
    transactionHash: input.transactionHash,
    blockHash: input.blockHash,
    blockNumber: `0x${input.blockNumber.toString(16)}` as Hex,
    logIndex: `0x${input.logIndex.toString(16)}` as Hex,
    removed: false
  };
}

let canonicalHashB = orphanHashB;
let replacementActive = false;
const requestedTopics: Hex[][] = [];
const rpc: NftIndexerRpc = {
  getChainId: async () => 4663,
  getTransactionReceipt: async () => ({
    transactionHash: source.deploymentTransaction,
    blockNumber: source.startBlock,
    status: 'success',
    contractAddress: source.collectionAddress,
    to: null
  }),
  getBytecode: async () => '0x6000',
  readContract: async () => true,
  getBlockNumber: async () => blockB,
  getBlock: async ({ blockNumber }) => {
    if (blockNumber === blockA) return { hash: hashA };
    if (blockNumber === blockB) return { hash: canonicalHashB };
    throw new Error(`unexpected block ${blockNumber}`);
  },
  getLogs: async ({ fromBlock, toBlock, topics }) => {
    requestedTopics.push([...topics]);
    assert.equal(fromBlock, toBlock);
    if (fromBlock === blockA) {
      return [transferLog({
        from: zeroAddress, to: alice, blockNumber: blockA, blockHash: hashA,
        transactionHash: mintTransaction, logIndex: 0
      })];
    }
    if (fromBlock === blockB && !replacementActive) {
      return [transferLog({
        from: alice, to: bob, blockNumber: blockB, blockHash: orphanHashB,
        transactionHash: orphanTransaction, logIndex: 0
      })];
    }
    if (fromBlock === blockB) {
      return [transferLog({
        from: alice, to: carol, blockNumber: blockB, blockHash: replacementHashB,
        transactionHash: replacementTransaction, logIndex: 0
      })];
    }
    throw new Error(`unexpected log range ${fromBlock}-${toBlock}`);
  }
};

const config: NftIndexerConfig = {
  databaseUrl, databaseSsl: false, rpcUrl: 'https://rpc.example.test/',
  finalityDepth: 0, batchSize: 1, maxBatchesPerCycle: 1,
  pollIntervalMs: 5_000, databasePoolSize: 2, port: 3_009, readToken: 'a'.repeat(64)
};

try {
  await migrateNftIndexer(pool);
  await pool.query(`TRUNCATE ${[...NFT_INDEXER_TABLES].reverse().join(', ')} CASCADE`);
  const worker = new NftIndexerWorker(pool, config, rpc);
  await worker.verifySources();

  await worker.runCycle();
  let checkpoint = await readCheckpoint(pool, source);
  assert.equal(checkpoint.lastProcessedBlock?.number, blockA);
  assert.equal(checkpoint.lastProcessedBlock?.hash, hashA);
  assert.equal((await pool.query(`SELECT owner_address FROM nft_erc721_ownership WHERE token_id=42`)).rows[0]?.owner_address, alice.toLowerCase());
  assert.equal((await readSourceOperationalState(pool, source)).status, 'BACKFILLING');

  await worker.runCycle();
  checkpoint = await readCheckpoint(pool, source);
  assert.equal(checkpoint.lastProcessedBlock?.number, blockB);
  assert.equal(checkpoint.lastProcessedBlock?.hash, orphanHashB);
  assert.equal((await pool.query(`SELECT owner_address FROM nft_erc721_ownership WHERE token_id=42`)).rows[0]?.owner_address, bob.toLowerCase());
  assert.equal((await readSourceOperationalState(pool, source)).status, 'SYNCED');

  canonicalHashB = replacementHashB;
  replacementActive = true;
  await worker.runCycle();

  checkpoint = await readCheckpoint(pool, source);
  assert.equal(checkpoint.nextBlock, blockB + 1n);
  assert.equal(checkpoint.lastProcessedBlock?.number, blockB);
  assert.equal(checkpoint.lastProcessedBlock?.hash, replacementHashB);
  assert.equal((await pool.query(`SELECT owner_address FROM nft_erc721_ownership WHERE token_id=42`)).rows[0]?.owner_address, carol.toLowerCase());
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_activity_events WHERE transaction_hash=$1`, [orphanTransaction])).rows[0]?.count, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_activity_events WHERE transaction_hash=$1`, [replacementTransaction])).rows[0]?.count, 1);
  assert.equal(worker.status.reorgsRecovered, 1);
  const operational = await readSourceOperationalState(pool, source);
  assert.equal(operational.status, 'SYNCED');
  assert.equal(operational.lastError, null);
  assert.notEqual(operational.lastSyncAt, null);
  assert(requestedTopics.every((topics) => topics.length === 1 && topics[0] === RMT_ERC721_TRANSFER_TOPIC));
  console.info('nft-indexer full worker reorg recovery smoke: PASS');
} finally {
  await pool.end();
}
