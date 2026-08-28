import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { encodeEventTopics, getAddress, keccak256, zeroAddress, type Hex } from 'viem';
import { RMT_NFT_ACTIVITY_SOURCES } from '@rmt/shared/nft/activity-sources';
import { RMT_ERC721_TRANSFER_TOPIC } from '@rmt/shared/nft/activity-domain';
import type { NftIndexerConfig } from './config.js';
import { migrateNftIndexer, NFT_INDEXER_TABLES } from './schema.js';
import { readCheckpoint, readSourceOperationalState } from './storage.js';
import { NftIndexerWorker, type NftIndexerRpc } from './worker.js';

const databaseUrl = process.env.NFT_INDEXER_TEST_DATABASE_URL?.trim() ?? process.env.NFT_INDEXER_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('NFT_INDEXER_TEST_DATABASE_URL is required for worker range consistency coverage');
const pool = new Pool({ connectionString: databaseUrl, ssl: false });
const testBytecode = '0x6000' as Hex;
// This smoke runs in its own process. Rebind every reviewed source to the same
// deterministic fixture bytecode so worker startup still verifies the exact set.
for (const item of RMT_NFT_ACTIVITY_SOURCES) {
  (item as { runtimeBytecodeHash: Hex }).runtimeBytecodeHash = keccak256(testBytecode);
}
const reviewed = RMT_NFT_ACTIVITY_SOURCES[0]!;
const source = { ...reviewed, verifiedAt: '2026-08-27T00:00:00.000Z' };
const alice = getAddress('0x1111111111111111111111111111111111111111');
const hash = (character: string) => `0x${character.repeat(64)}` as Hex;
const stableHash = hash('a');
const replacementHash = hash('b');
const transactionHash = hash('1');
const transferAbi = [{ type: 'event', name: 'Transfer', anonymous: false, inputs: [
  { indexed: true, name: 'from', type: 'address' },
  { indexed: true, name: 'to', type: 'address' },
  { indexed: true, name: 'tokenId', type: 'uint256' }
]}] as const;
const topics = encodeEventTopics({
  abi: transferAbi,
  eventName: 'Transfer',
  args: { from: zeroAddress, to: alice, tokenId: 7n }
}).filter((topic): topic is Hex => typeof topic === 'string');

let changeHashDuringLogs = false;
let rangeHashReads = 0;
const rpc: NftIndexerRpc = {
  getChainId: async () => 4663,
  getTransactionReceipt: async ({ hash: deploymentTransaction }) => {
    const requestedSource = RMT_NFT_ACTIVITY_SOURCES.find((item) => item.deploymentTransaction === deploymentTransaction);
    if (!requestedSource) throw new Error('unexpected deployment transaction');
    return {
    transactionHash: requestedSource.deploymentTransaction,
    blockNumber: requestedSource.startBlock,
    status: 'success',
    contractAddress: requestedSource.collectionAddress,
    to: null
  }; },
  getBytecode: async () => testBytecode,
  readContract: async ({ args }) => args[0] !== '0xffffffff',
  getBlockNumber: async () => source.startBlock,
  getBlock: async ({ blockNumber }) => {
    assert.equal(blockNumber, source.startBlock);
    rangeHashReads += 1;
    return { hash: changeHashDuringLogs && rangeHashReads > 1 ? replacementHash : stableHash };
  },
  getLogs: async ({ address, fromBlock, toBlock, topics: requestedTopics }) => {
    assert.equal(address, source.collectionAddress);
    assert.equal(fromBlock, source.startBlock);
    assert.equal(toBlock, source.startBlock);
    assert.deepEqual(requestedTopics, [RMT_ERC721_TRANSFER_TOPIC]);
    return [{
      address: source.collectionAddress,
      topics,
      data: '0x',
      transactionHash,
      blockHash: stableHash,
      blockNumber: `0x${source.startBlock.toString(16)}`,
      logIndex: '0x0',
      removed: false
    }];
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

  const stableWorker = new NftIndexerWorker(pool, config, rpc);
  await stableWorker.verifySources();
  await stableWorker.runCycle();
  let checkpoint = await readCheckpoint(pool, source);
  assert.equal(checkpoint.nextBlock, source.startBlock + 1n);
  assert.equal(checkpoint.lastProcessedBlock?.hash, stableHash);
  assert.equal((await pool.query(`SELECT owner_address FROM nft_erc721_ownership WHERE token_id=7`)).rows[0]?.owner_address, alice.toLowerCase());

  await pool.query(`TRUNCATE ${[...NFT_INDEXER_TABLES].reverse().join(', ')} CASCADE`);
  changeHashDuringLogs = true;
  rangeHashReads = 0;
  const changingWorker = new NftIndexerWorker(pool, config, rpc);
  await changingWorker.verifySources();
  await assert.rejects(changingWorker.runCycle(), /RANGE_REORG_DETECTED/);

  checkpoint = await readCheckpoint(pool, source);
  assert.equal(checkpoint.nextBlock, source.startBlock);
  assert.equal(checkpoint.lastProcessedBlock, null);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_activity_events`)).rows[0]?.count, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_erc721_ownership`)).rows[0]?.count, 0);
  const operational = await readSourceOperationalState(pool, source);
  assert.equal(operational.status, 'ERROR');
  assert.match(operational.lastError ?? '', /RANGE_REORG_DETECTED/);
  assert.equal(operational.lastSyncAt, null);
  console.info('nft-indexer range pre/post hash consistency smoke: PASS');
} finally {
  await pool.end();
}
