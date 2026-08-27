import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { getAddress, zeroAddress, type Hex } from 'viem';
import type { RmtNftActivityEvent, RmtNftTokenMovement } from '@rmt/shared/nft/activity-domain';
import { RMT_NFT_ACTIVITY_SOURCES } from '@rmt/shared/nft/activity-sources';
import { assertDedicatedNftIndexerDatabase, migrateNftIndexer, NFT_INDEXER_TABLES } from './schema.js';
import {
  initializeVerifiedSources,
  persistProcessedRange,
  readCheckpoint,
  readSourceOperationalState,
  recordSourceError,
  recordSourceSuccess,
  rollbackToCommonAncestor
} from './storage.js';
import type { VerifiedNftSource } from './source-verification.js';

const databaseUrl = process.env.NFT_INDEXER_TEST_DATABASE_URL?.trim() ?? process.env.NFT_INDEXER_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('NFT_INDEXER_TEST_DATABASE_URL is required for PostgreSQL storage smoke coverage');
const pool = new Pool({ connectionString: databaseUrl, ssl: false });
const source = { ...RMT_NFT_ACTIVITY_SOURCES[0]!, verifiedAt: '2026-08-26T00:00:00.000Z' } satisfies VerifiedNftSource;
const alice = getAddress('0x1111111111111111111111111111111111111111');
const bob = getAddress('0x2222222222222222222222222222222222222222');
const carol = getAddress('0x3333333333333333333333333333333333333333');
const hash = (character: string) => `0x${character.repeat(64)}` as Hex;
const erc1155Source = {
  chainId: 4663,
  projectId: 'synthetic-erc1155-storage-fixture',
  collectionAddress: getAddress('0x4444444444444444444444444444444444444444'),
  standard: 'ERC1155',
  deploymentTransaction: hash('4'),
  startBlock: 20_000_000n,
  verifiedAt: '2026-08-26T00:00:00.000Z'
} satisfies VerifiedNftSource;
let identity = 1;
function event(
  blockNumber: bigint,
  standard: 'ERC721' | 'ERC1155',
  movements: readonly RmtNftTokenMovement[],
  eventSource: VerifiedNftSource = source
): RmtNftActivityEvent {
  const digit = ((identity++ % 8) + 1).toString();
  return {
    schemaVersion: 1, chainId: 4663, projectId: eventSource.projectId, collectionAddress: eventSource.collectionAddress,
    standard, transactionHash: hash(digit), logIndex: identity, blockNumber, blockHash: hash('a'),
    sourceEvent: standard === 'ERC721' ? 'TRANSFER' : movements.length > 1 ? 'TRANSFER_BATCH' : 'TRANSFER_SINGLE',
    operator: standard === 'ERC1155' ? carol : null, movements, marketMeaning: 'NOT_ESTABLISHED'
  };
}
const move = (tokenId: bigint, amount: bigint, from: `0x${string}`, to: `0x${string}`, kind: RmtNftTokenMovement['kind']): RmtNftTokenMovement => ({ tokenId, amount, from, to, kind });

try {
  // This test is authorized only against the explicitly configured dedicated test database.
  await pool.query(`DROP TABLE IF EXISTS market_indexer_source_state`);
  await pool.query(`CREATE TABLE market_indexer_source_state(id integer)`);
  await assert.rejects(assertDedicatedNftIndexerDatabase(pool as never), /unrelated public tables/);
  await pool.query(`DROP TABLE market_indexer_source_state`);
  await migrateNftIndexer(pool);
  await pool.query(`TRUNCATE ${[...NFT_INDEXER_TABLES].reverse().join(', ')} CASCADE`);
  await initializeVerifiedSources(pool, [source, erc1155Source]);
  const start = source.startBlock;
  assert.deepEqual(await readSourceOperationalState(pool, source), {
    status: 'BACKFILLING', lastSyncAt: null, lastError: null
  });

  const mint = event(start, 'ERC721', [move(2n ** 255n, 1n, zeroAddress, alice, 'MINT')]);
  await assert.rejects(persistProcessedRange({
    pool, source, expectedNextBlock: start, toBlock: start, toBlockHash: hash('b'), events: [mint],
    beforeCheckpoint: async () => { throw new Error('injected range failure'); }
  }), /injected range failure/);
  assert.equal((await readCheckpoint(pool, source)).nextBlock, start);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_activity_events`)).rows[0]?.count, 0);

  // A duplicate canonical observation in one range is idempotent and does not apply ownership twice.
  await persistProcessedRange({ pool, source, expectedNextBlock: start, toBlock: start, toBlockHash: hash('b'), events: [mint, mint] });
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_activity_events`)).rows[0]?.count, 1);
  assert.equal((await pool.query(`SELECT owner_address FROM nft_erc721_ownership`)).rows[0]?.owner_address, alice.toLowerCase());
  assert.equal((await pool.query(`SELECT token_id::text FROM nft_activity_movements`)).rows[0]?.token_id, (2n ** 255n).toString());

  const transfer = event(start + 1n, 'ERC721', [move(2n ** 255n, 1n, alice, bob, 'TRANSFER')]);
  await persistProcessedRange({ pool, source, expectedNextBlock: start + 1n, toBlock: start + 1n, toBlockHash: hash('c'), events: [transfer] });
  assert.equal((await pool.query(`SELECT owner_address FROM nft_erc721_ownership`)).rows[0]?.owner_address, bob.toLowerCase());
  const burn = event(start + 2n, 'ERC721', [move(2n ** 255n, 1n, bob, zeroAddress, 'BURN')]);
  await persistProcessedRange({ pool, source, expectedNextBlock: start + 2n, toBlock: start + 2n, toBlockHash: hash('d'), events: [burn] });
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_erc721_ownership`)).rows[0]?.count, 0);

  const badSender = event(start + 3n, 'ERC721', [move(7n, 1n, carol, bob, 'TRANSFER')]);
  await assert.rejects(persistProcessedRange({ pool, source, expectedNextBlock: start + 3n, toBlock: start + 3n, toBlockHash: hash('e'), events: [badSender] }), /current owner/);
  assert.equal((await readCheckpoint(pool, source)).nextBlock, start + 3n);

  const invariantMint = event(start + 3n, 'ERC721', [move(99n, 1n, zeroAddress, alice, 'MINT')]);
  const rejectionCases: Array<[RmtNftActivityEvent, RegExp]> = [
    [event(start + 3n, 'ERC1155', [move(1n, 1n, zeroAddress, alice, 'MINT')], source), /standard does not match/],
    [{ ...invariantMint, collectionAddress: erc1155Source.collectionAddress }, /collection does not match/],
    [{ ...invariantMint, projectId: 'wrong-project' }, /project does not match/],
    [{ ...invariantMint, chainId: 1 as 4663 }, /chain does not match/],
    [{ ...invariantMint, movements: [move(99n, 2n, zeroAddress, alice, 'MINT')] }, /exactly one/],
    [{ ...invariantMint, movements: [move(99n, 1n, alice, bob, 'MINT')] }, /Invalid MINT/],
    [{ ...invariantMint, movements: [move(99n, 1n, zeroAddress, bob, 'TRANSFER')] }, /Invalid TRANSFER/],
    [{ ...invariantMint, movements: [move(99n, 1n, alice, bob, 'BURN')] }, /Invalid BURN/],
    [{ ...invariantMint, movements: [move(99n, 1n, zeroAddress, zeroAddress, 'MINT')] }, /Invalid MINT/]
  ];
  const eventCountBeforeRejections = (await pool.query(`SELECT count(*)::int AS count FROM nft_activity_events`)).rows[0]?.count;
  for (const [rejected, pattern] of rejectionCases) {
    await assert.rejects(persistProcessedRange({
      pool, source, expectedNextBlock: start + 3n, toBlock: start + 3n, toBlockHash: hash('e'), events: [rejected]
    }), pattern);
    assert.equal((await readCheckpoint(pool, source)).nextBlock, start + 3n);
  }
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_activity_events`)).rows[0]?.count, eventCountBeforeRejections);

  const conflict = { ...mint, blockNumber: start + 3n, blockHash: hash('9') };
  await assert.rejects(persistProcessedRange({ pool, source, expectedNextBlock: start + 3n, toBlock: start + 3n, toBlockHash: hash('8'), events: [conflict] }), /Conflicting NFT event provenance/);
  assert.equal((await readCheckpoint(pool, source)).nextBlock, start + 3n);

  const maximum = 2n ** 256n - 1n;
  const erc1155Start = erc1155Source.startBlock;
  const negativeAmount = event(erc1155Start, 'ERC1155', [move(8n, -1n, zeroAddress, alice, 'MINT')], erc1155Source);
  await assert.rejects(persistProcessedRange({
    pool, source: erc1155Source, expectedNextBlock: erc1155Start,
    toBlock: erc1155Start, toBlockHash: hash('e'), events: [negativeAmount]
  }), /amount cannot be negative/);
  assert.equal((await readCheckpoint(pool, erc1155Source)).nextBlock, erc1155Start);
  const batchMint = event(erc1155Start, 'ERC1155', [
    move(maximum, maximum, zeroAddress, alice, 'MINT'), move(8n, 20n, zeroAddress, alice, 'MINT')
  ], erc1155Source);
  await persistProcessedRange({ pool, source: erc1155Source, expectedNextBlock: erc1155Start, toBlock: erc1155Start, toBlockHash: hash('e'), events: [batchMint] });
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_activity_movements WHERE transaction_hash=$1`, [batchMint.transactionHash.toLowerCase()])).rows[0]?.count, 2);
  assert.equal((await pool.query(`SELECT balance::text FROM nft_erc1155_balances WHERE token_id=$1`, [maximum.toString()])).rows[0]?.balance, maximum.toString());

  const singleTransfer = event(erc1155Start + 1n, 'ERC1155', [move(8n, 7n, alice, bob, 'TRANSFER')], erc1155Source);
  await persistProcessedRange({ pool, source: erc1155Source, expectedNextBlock: erc1155Start + 1n, toBlock: erc1155Start + 1n, toBlockHash: hash('f'), events: [singleTransfer] });
  const singleBurn = event(erc1155Start + 2n, 'ERC1155', [move(8n, 3n, bob, zeroAddress, 'BURN')], erc1155Source);
  await persistProcessedRange({ pool, source: erc1155Source, expectedNextBlock: erc1155Start + 2n, toBlock: erc1155Start + 2n, toBlockHash: hash('7'), events: [singleBurn] });
  assert.equal((await pool.query(`SELECT balance::text FROM nft_erc1155_balances WHERE token_id=8 AND account_address=$1`, [bob.toLowerCase()])).rows[0]?.balance, '4');
  const underflow = event(erc1155Start + 3n, 'ERC1155', [move(8n, 5n, bob, carol, 'TRANSFER')], erc1155Source);
  await assert.rejects(persistProcessedRange({ pool, source: erc1155Source, expectedNextBlock: erc1155Start + 3n, toBlock: erc1155Start + 3n, toBlockHash: hash('8'), events: [underflow] }), /underflow/);

  await recordSourceError(pool, source, new Error(`  ${'x'.repeat(5_000)}  `));
  const errored = await readSourceOperationalState(pool, source);
  assert.equal(errored.status, 'ERROR');
  assert.equal(errored.lastError?.length, 4_096);
  assert.equal(errored.lastSyncAt, null);
  assert.equal((await readCheckpoint(pool, source)).nextBlock, start + 3n);
  const syncedAt = new Date('2026-08-27T01:23:45.000Z');
  await recordSourceSuccess(pool, source, 'SYNCED', syncedAt);
  assert.deepEqual(await readSourceOperationalState(pool, source), {
    status: 'SYNCED', lastSyncAt: syncedAt.toISOString(), lastError: null
  });

  // Rewind to the retained transfer sync point: orphaned activity is deleted and ownership is rebuilt from canonical rows.
  await rollbackToCommonAncestor(pool, source, { number: start + 1n, hash: hash('c') });
  const rewound = await readCheckpoint(pool, source);
  assert.equal(rewound.nextBlock, start + 2n);
  assert.equal(rewound.lastProcessedBlock?.hash, hash('c'));
  assert.equal((await pool.query(`SELECT owner_address FROM nft_erc721_ownership`)).rows[0]?.owner_address, bob.toLowerCase());
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_erc1155_balances WHERE collection_address=$1`, [source.collectionAddress.toLowerCase()])).rows[0]?.count, 0);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_erc1155_balances WHERE collection_address=$1`, [erc1155Source.collectionAddress.toLowerCase()])).rows[0]?.count, 3);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_activity_events WHERE collection_address=$1 AND block_number>$2`, [source.collectionAddress.toLowerCase(), (start + 1n).toString()])).rows[0]?.count, 0);

  console.info('nft-indexer PostgreSQL storage smoke: PASS');
} finally {
  await pool.end();
}
