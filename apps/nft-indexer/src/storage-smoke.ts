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
import { readNftProjectInventory, readNftProjectItem, readNftProjectOnchain, readNftProjectWalletOwnership } from './project-read.js';
import { summarizeProjectOwnership } from '@rmt/shared/project-ownership';
import { projectById } from '@rmt/shared/project-identity';
import { createNftIndexerServer } from './server.js';
import type { NftIndexerWorker } from './worker.js';
import type { AddressInfo } from 'node:net';

const databaseUrl = process.env.NFT_INDEXER_TEST_DATABASE_URL?.trim() ?? process.env.NFT_INDEXER_DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('NFT_INDEXER_TEST_DATABASE_URL is required for PostgreSQL storage smoke coverage');
const pool = new Pool({ connectionString: databaseUrl, ssl: false });
const source = { ...RMT_NFT_ACTIVITY_SOURCES[0]!, verifiedAt: '2026-08-26T00:00:00.000Z' } satisfies VerifiedNftSource;
const alice = getAddress('0x1111111111111111111111111111111111111111');
const bob = getAddress('0x2222222222222222222222222222222222222222');
const carol = getAddress('0x3333333333333333333333333333333333333333');
const hash = (character: string) => `0x${character.repeat(64)}` as Hex;
const metadataUri = `data:application/json;base64,${Buffer.from(JSON.stringify({
  name: '#CCFF00', description: 'This is Robin Neon.',
  image: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#CCFF00"/></svg>').toString('base64')}`,
  attributes: [{ trait_type: 'Color', value: '#CCFF00' }]
})).toString('base64')}`;
const erc1155Source = {
  chainId: 4663,
  projectId: 'synthetic-erc1155-storage-fixture',
  collectionAddress: getAddress('0x4444444444444444444444444444444444444444'),
  standard: 'ERC1155',
  deploymentTransaction: hash('4'),
  startBlock: 20_000_000n,
  runtimeBytecodeHash: hash('4'),
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
  const checkedAt = new Date('2026-08-27T01:23:45.000Z');
  const walletFact = async (wallet: string) => {
    await recordSourceSuccess(pool, source, 'SYNCED', checkedAt);
    return readNftProjectWalletOwnership(pool, 'ccff00', wallet, checkedAt);
  };
  assert.equal((await readNftProjectWalletOwnership(pool, 'ccff00', alice, checkedAt)).balance, null, 'Incomplete projection does not fabricate zero');
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
  assert.equal((await walletFact(alice)).balance, '1');
  assert.equal((await walletFact(bob)).balance, '0');
  const walletSummary = summarizeProjectOwnership(projectById('ccff00')!, alice, [await walletFact(alice)]);
  assert.equal(walletSummary.nftCount, '1'); assert.equal(walletSummary.holdsNft, true);

  const transfer = event(start + 1n, 'ERC721', [move(2n ** 255n, 1n, alice, bob, 'TRANSFER')]);
  await persistProcessedRange({ pool, source, expectedNextBlock: start + 1n, toBlock: start + 1n, toBlockHash: hash('c'), events: [transfer] });
  assert.equal((await pool.query(`SELECT owner_address FROM nft_erc721_ownership`)).rows[0]?.owner_address, bob.toLowerCase());
  assert.equal((await walletFact(alice)).balance, '0', 'Transfer out');
  assert.equal((await walletFact(bob)).balance, '1', 'Transfer in');
  const burn = event(start + 2n, 'ERC721', [move(2n ** 255n, 1n, bob, zeroAddress, 'BURN')]);
  await persistProcessedRange({ pool, source, expectedNextBlock: start + 2n, toBlock: start + 2n, toBlockHash: hash('d'), events: [burn] });
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM nft_erc721_ownership`)).rows[0]?.count, 0);
  assert.equal((await walletFact(bob)).balance, '0', 'Burn removes ownership');

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
  assert.equal(errored.lastSyncAt, checkedAt.toISOString(), 'An error preserves the last successfully observed projection timestamp');
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

  await recordSourceSuccess(pool, source, 'SYNCED', syncedAt);
  assert.equal((await walletFact(bob)).balance, '1', 'Reorg rebuild restores canonical owner');
  const restartedPool = new Pool({ connectionString: databaseUrl, ssl: false });
  try { assert.equal((await readNftProjectWalletOwnership(restartedPool, 'ccff00', bob, checkedAt)).balance, '1', 'Restart reads persisted projection, not session memory'); } finally { await restartedPool.end(); }
  const completeRead = await readNftProjectOnchain(pool, 'ccff00', syncedAt);
  assert.equal(completeRead.availability, 'AVAILABLE');
  assert.equal(completeRead.holderCount, '1');
  assert.equal(completeRead.circulatingTokenCount, '1');
  assert.ok(completeRead.recentActivity.length <= 20);
  assert.equal(completeRead.recentActivity[0]?.kind, 'TRANSFER');
  assert.equal(completeRead.recentActivity[0]?.marketMeaning, 'NOT_ESTABLISHED');
  await recordSourceSuccess(pool, source, 'BACKFILLING', syncedAt);
  const partialRead = await readNftProjectOnchain(pool, 'ccff00', syncedAt);
  assert.equal(partialRead.availability, 'PARTIAL');
  assert.equal(partialRead.holderCount, null);
  assert.equal(partialRead.circulatingTokenCount, null);
  await recordSourceError(pool, source, new Error('read unavailable'));
  const unavailableRead = await readNftProjectOnchain(pool, 'ccff00', syncedAt);
  assert.equal(unavailableRead.availability, 'UNAVAILABLE');
  assert.equal(unavailableRead.recentActivity.length, 0);
  await assert.rejects(() => readNftProjectOnchain(pool, 'unknown'), /not publicly admitted/);

  const metadataRpc = {
    readTokenUri: async ({ tokenId }: { tokenId: bigint }) => tokenId === 2n ? 'data:application/json;base64,not-base64' : metadataUri,
    readTokenBoundAccount: async () => carol,
  };
  await assert.rejects(() => readNftProjectInventory({
    pool, rpc: metadataRpc, projectId: 'unknown', pollIntervalMs: 5_000, now: syncedAt
  }), /not publicly admitted/);
  await pool.query(`INSERT INTO nft_erc721_ownership(chain_id,collection_address,token_id,owner_address) VALUES
    (4663,$1,1,$2),(4663,$1,2,$3),(4663,$1,3,$2) ON CONFLICT DO NOTHING`,
  [source.collectionAddress.toLowerCase(), alice.toLowerCase(), bob.toLowerCase()]);
  assert.equal((await walletFact(alice)).balance, '2', 'Multiple NFT count from persisted ownership');
  assert.equal((await readNftProjectWalletOwnership(pool, 'ccff00', alice, new Date(checkedAt.getTime() + 300_001))).state, 'UNAVAILABLE', 'Stale projection is not current ownership authority');
  await recordSourceSuccess(pool, source, 'SYNCED', syncedAt);
  const firstInventory = await readNftProjectInventory({
    pool, rpc: metadataRpc, projectId: 'ccff00', limit: 2, pollIntervalMs: 5_000, now: syncedAt
  });
  assert.equal(firstInventory.availability, 'AVAILABLE');
  assert.deepEqual(firstInventory.items.map((item) => item.tokenId), ['1', '2']);
  assert.equal(firstInventory.items[0]?.metadata.status, 'READY');
  assert.equal(firstInventory.items[1]?.metadata.status, 'INVALID');
  assert.equal(firstInventory.nextCursor, '2');
  assert.equal((await readSourceOperationalState(pool, source)).status, 'SYNCED');
  const secondInventory = await readNftProjectInventory({
    pool, rpc: metadataRpc, projectId: 'ccff00', afterTokenId: firstInventory.nextCursor!, limit: 2,
    pollIntervalMs: 5_000, now: syncedAt
  });
  assert.deepEqual(secondInventory.items.map((item) => item.tokenId), ['3', (2n ** 255n).toString()]);
  assert.equal(new Set([...firstInventory.items, ...secondInventory.items].map((item) => item.tokenId)).size, 4);
  // Real PostgreSQL ordering and cursor coverage: a cast output alias must never
  // turn numeric uint256 ownership IDs into lexicographic inventory pages.
  const numericIds = ['1', '2', '9', '10', '11', '99', '100', '999', '1000', '1001', '9999', '10000',
    '9007199254740992', '9007199254740993', (2n ** 255n).toString(), ((1n << 256n) - 1n).toString()];
  await pool.query(`DELETE FROM nft_erc721_ownership WHERE chain_id=$1 AND collection_address=$2`,
    [source.chainId, source.collectionAddress.toLowerCase()]);
  for (const id of [...numericIds].reverse()) {
    await pool.query(`INSERT INTO nft_erc721_ownership(chain_id,collection_address,token_id,owner_address) VALUES($1,$2,$3,$4)`,
      [source.chainId, source.collectionAddress.toLowerCase(), id, alice.toLowerCase()]);
  }
  const traversed: string[] = [];
  let cursor: string | undefined;
  do {
    const inventory = await readNftProjectInventory({ pool, rpc: metadataRpc, projectId: 'ccff00',
      afterTokenId: cursor, limit: 3, pollIntervalMs: 5_000, now: syncedAt });
    assert.ok(inventory.items.every(item => cursor === undefined || BigInt(item.tokenId) > BigInt(cursor)), 'Exclusive numeric cursor');
    traversed.push(...inventory.items.map(item => item.tokenId));
    assert.equal(inventory.nextCursor, traversed.length < numericIds.length ? inventory.items.at(-1)!.tokenId : null);
    cursor = inventory.nextCursor ?? undefined;
  } while (cursor !== undefined);
  assert.deepEqual(traversed, numericIds, 'Numeric pages have no skips, duplicates, precision loss or textual ordering');
  // Restore the original ownership fixture for the existing item/API checks.
  await pool.query(`DELETE FROM nft_erc721_ownership WHERE chain_id=$1 AND collection_address=$2`,
    [source.chainId, source.collectionAddress.toLowerCase()]);
  await pool.query(`INSERT INTO nft_erc721_ownership(chain_id,collection_address,token_id,owner_address) VALUES
    (4663,$1,1,$2),(4663,$1,2,$3),(4663,$1,3,$2),(4663,$1,$4,$3)`,
    [source.collectionAddress.toLowerCase(), alice.toLowerCase(), bob.toLowerCase(), (2n ** 255n).toString()]);
  await assert.rejects(() => readNftProjectInventory({
    pool, rpc: metadataRpc, projectId: 'ccff00', limit: 49, pollIntervalMs: 5_000, now: syncedAt
  }), /limit must be between/);
  const staleInventory = await readNftProjectInventory({
    pool, rpc: metadataRpc, projectId: 'ccff00', pollIntervalMs: 5_000,
    now: new Date(syncedAt.getTime() + 5 * 60_000 + 1)
  });
  assert.equal(staleInventory.availabilityReason, 'SOURCE_STALE');
  assert.deepEqual(staleInventory.items, []);
  await pool.query(`UPDATE nft_indexer_source_state SET last_sync_at=NULL WHERE chain_id=$1 AND collection_address=$2`,
    [source.chainId, source.collectionAddress.toLowerCase()]);
  const missingObservation = await readNftProjectInventory({
    pool, rpc: metadataRpc, projectId: 'ccff00', pollIntervalMs: 5_000, now: syncedAt
  });
  assert.equal(missingObservation.availabilityReason, 'SOURCE_STALE');
  assert.equal(missingObservation.asOf, null);
  assert.deepEqual(missingObservation.items, []);
  await recordSourceSuccess(pool, source, 'SYNCED', syncedAt);
  const itemRead = await readNftProjectItem({
    pool, rpc: metadataRpc, projectId: 'ccff00', tokenId: '1', pollIntervalMs: 5_000, now: syncedAt
  });
  assert.equal(itemRead.owner, alice);
  assert.equal(itemRead.tokenBoundAccount.authority, 'ONCHAIN_ERC6551_ACCOUNT');
  assert.equal(itemRead.tokenBoundAccount.accountAddress, carol);
  await assert.rejects(() => readNftProjectItem({
    pool, rpc: metadataRpc, projectId: 'ccff00', tokenId: '999', pollIntervalMs: 5_000, now: syncedAt
  }), /absent from current canonical ownership/);
  await recordSourceSuccess(pool, source, 'BACKFILLING', syncedAt);
  assert.deepEqual((await readNftProjectInventory({
    pool, rpc: metadataRpc, projectId: 'ccff00', pollIntervalMs: 5_000, now: syncedAt
  })).items, []);
  await recordSourceError(pool, source, new Error('inventory unavailable'));
  assert.deepEqual((await readNftProjectInventory({
    pool, rpc: metadataRpc, projectId: 'ccff00', pollIntervalMs: 5_000, now: syncedAt
  })).items, []);

  // Complete Project Graph producer -> persisted projection -> authenticated
  // read -> shared ownership summary. All events/wallets are controlled test data.
  await pool.query(`TRUNCATE ${[...NFT_INDEXER_TABLES].reverse().join(', ')} CASCADE`);
  await initializeVerifiedSources(pool, [source]);
  const readToken = 'a'.repeat(64);
  const readServer = createNftIndexerServer({ status: { lastError: null } } as unknown as NftIndexerWorker, pool, readToken);
  await new Promise<void>(resolve => readServer.listen(0, '127.0.0.1', resolve));
  const throughApi = async (wallet: typeof alice) => {
    const response = await fetch(`http://127.0.0.1:${(readServer.address() as AddressInfo).port}/internal/v1/projects/ccff00/ownership/${wallet}`, { headers: { authorization: `Bearer ${readToken}` } });
    assert.equal(response.status, 200);
    return summarizeProjectOwnership(projectById('ccff00')!, wallet, [await response.json() as Awaited<ReturnType<typeof readNftProjectWalletOwnership>>]);
  };
  try {
    assert.equal((await throughApi(alice)).nftCount, null, 'Backfill is unknown, not zero');
    await persistProcessedRange({ pool, source, expectedNextBlock: start, toBlock: start, toBlockHash: hash('b'), events: [event(start, 'ERC721', [move(42n, 1n, zeroAddress, alice, 'MINT')]), event(start, 'ERC721', [move(43n, 1n, zeroAddress, alice, 'MINT')])] });
    await recordSourceSuccess(pool, source, 'SYNCED', new Date());
    assert.equal((await throughApi(alice)).nftCount, '2');
    assert.equal((await throughApi(bob)).nftCount, '0');
    await persistProcessedRange({ pool, source, expectedNextBlock: start + 1n, toBlock: start + 1n, toBlockHash: hash('c'), events: [event(start + 1n, 'ERC721', [move(42n, 1n, alice, bob, 'TRANSFER')])] });
    await recordSourceSuccess(pool, source, 'SYNCED', new Date());
    assert.equal((await throughApi(alice)).nftCount, '1');
    assert.equal((await throughApi(bob)).nftCount, '1');
    await rollbackToCommonAncestor(pool, source, { number: start, hash: hash('b') });
    await persistProcessedRange({ pool, source, expectedNextBlock: start + 1n, toBlock: start + 1n, toBlockHash: hash('d'), events: [event(start + 1n, 'ERC721', [move(43n, 1n, alice, carol, 'TRANSFER')])] });
    await recordSourceSuccess(pool, source, 'SYNCED', new Date());
    assert.equal((await throughApi(bob)).nftCount, '0', 'Orphaned transfer cannot retain ownership');
    assert.equal((await throughApi(carol)).nftCount, '1', 'Replacement rescan retains canonical transfer');
    const restarted = new Pool({ connectionString: databaseUrl, ssl: false });
    try { assert.equal((await readNftProjectWalletOwnership(restarted, 'ccff00', alice)).balance, '1'); } finally { await restarted.end(); }
  } finally { await new Promise<void>(resolve => readServer.close(() => resolve())); }
  console.info('CCFF00 Project ownership: actual event persistence -> authenticated HTTP -> shared facts; 0/1/2, transfer in/out, reorg/rescan and restart PASS');
  console.info('nft-indexer PostgreSQL storage smoke: PASS');
} finally {
  await pool.end();
}
