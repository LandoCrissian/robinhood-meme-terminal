import assert from "node:assert/strict";
import type { Pool, PoolClient } from "pg";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hash } from "viem";
import { marketEvents, tokenLaunchedEvent } from "./abi.js";
import {
  hasHistoricalReadAccess,
  historicalBoundary,
  historicalCommonAncestor,
  historicalFactory,
  historicalStartBlock,
  observeHistoricalCheckpoint,
  parseHistoricalQuery,
  proveHistoricalRows,
  readHistoricalLaunches,
  readWithArchive,
  rollbackIndexRows,
  type HistoricalProofRpc
} from "./historical-launches.js";

const address = (id: number): Address => `0x${id.toString(16).padStart(40, "0")}`;
const hash = (id: number): Hash => `0x${id.toString(16).padStart(64, "0")}`;
const height = historicalStartBlock + 20n;
const previous = height - 10n;
const timestamp = 1_795_000_000n;
const verifiedAt = Number(timestamp + 60n) * 1_000;
const verified = { blockNumber: height, blockHash: hash(92), blockTimestamp: timestamp, proofAt: verifiedAt, verifiedAt };
const olderPoint = { ...verified, blockNumber: previous, blockHash: hash(91) };
const launchBlock = previous - 1n;
const token = address(1);
const creator = address(2);
const market = address(3);
const treasury = address(4);
const adapter = address(5);
const poolSignal = address(6);
const absentReceipt = Object.assign(new Error("Receipt not present"), { name: "TransactionReceiptNotFoundError" });

export async function testHistoricalResilience() {
  assert.deepEqual(parseHistoricalQuery(new URLSearchParams()), { limit: 25 });
  assert.deepEqual(parseHistoricalQuery(new URLSearchParams(`token=${token}`)), { token });
  assert.deepEqual(parseHistoricalQuery(new URLSearchParams(`limit=2&cursor=${height}.1`)),
    { limit: 2, before: { blockNumber: Number(height), logIndex: 1 } });
  for (const query of [
    "unknown=1", "limit=0", "limit=26", "limit=1&limit=2", "cursor=9.3", "limit=1e1", "cursor=9007199254740992.0",
    `token=${token}&limit=1`, "token=not-an-address", `cursor=${height}.2147483648`
  ]) assert.equal(parseHistoricalQuery(new URLSearchParams(query)), null, query);

  assert.equal(hasHistoricalReadAccess(null, undefined), false);
  const tokenForTest = "isolated test token";
  assert.equal(hasHistoricalReadAccess(tokenForTest, undefined), false);
  assert.equal(hasHistoricalReadAccess(tokenForTest, "Bearer incorrect value"), false);
  assert.equal(hasHistoricalReadAccess(tokenForTest, `Bearer ${tokenForTest}`), true);

  let backUpReads = 0;
  const archive = async () => { backUpReads += 1; return hash(92); };
  assert.equal(await readWithArchive(async () => { throw new Error("429 too many requests"); }, archive), hash(92));
  assert.equal(await readWithArchive(async () => { throw absentReceipt; }, archive), hash(92));
  await assert.rejects(readWithArchive(async () => { throw new Error("proof mismatch"); }, archive), /proof mismatch/);
  assert.equal(backUpReads, 2);

  const points = [
    { block_number: height.toString(), block_hash: hash(92) },
    { block_number: previous.toString(), block_hash: hash(91) }
  ];
  const block = (number: bigint, blockHash: Hash) => ({ number, hash: blockHash, timestamp });
  const canonical = async (n: bigint) => block(n, n === height ? hash(93) : hash(91));
  assert.equal((await historicalCommonAncestor(points, canonical, canonical)).blockNumber, previous);
  assert.equal((await historicalCommonAncestor(points, async () => { throw absentReceipt; },
    async (n) => block(n, hash(92)))).blockNumber, height);
  await assert.rejects(historicalCommonAncestor(points, canonical, async (n) => block(n, hash(94))), /both configured providers/);
  await assert.rejects(historicalCommonAncestor(points, canonical), /both configured providers/);
  const noCommonAncestor = async (n: bigint) => block(n, hash(1));
  await assert.rejects(historicalCommonAncestor(points, noCommonAncestor, noCommonAncestor), /retained checkpoint/);
  await assert.rejects(historicalCommonAncestor(points, async (n) => block(n - 1n, hash(92))), /invalid block evidence/);
  let mismatches = 0;
  const pruned = async () => { throw absentReceipt; };
  await assert.rejects(historicalCommonAncestor(points, pruned, canonical, () => { mismatches += 1; }), absentReceipt);
  assert.equal(mismatches, 1);

  let now = verifiedAt;
  let boundaryCalls = 0;
  let registryProofCalls = 0;
  const clock = () => now;
  const prove = async () => {
    registryProofCalls += 1;
    return true;
  };
  const observeBoundary = () => historicalCommonAncestor(points, async (n) => {
    boundaryCalls += 1;
    return block(n, hash(92));
  });
  let checkpoint = await observeHistoricalCheckpoint(await observeBoundary(), null, prove, clock);
  for (let poll = 0; poll < 2; poll += 1) {
    now += 30_000;
    checkpoint = await observeHistoricalCheckpoint(await observeBoundary(), checkpoint, prove, clock);
    assert.equal(checkpoint.verifiedAt, verifiedAt, "reuse does not renew proof freshness");
  }
  assert.deepEqual({ boundaryCalls, registryProofCalls }, { boundaryCalls: 3, registryProofCalls: 1 });
  now += 30_000;
  checkpoint = await observeHistoricalCheckpoint(await observeBoundary(), checkpoint, prove, clock);
  assert.equal(registryProofCalls, 2, "the full proof runs again after 90 seconds");
  assert.equal(checkpoint.verifiedAt, now);
  const advanced = historicalBoundary(block(height + 1n, hash(93)), height + 1n);
  checkpoint = await observeHistoricalCheckpoint(advanced, checkpoint, prove, clock);
  assert.equal(registryProofCalls, 3, "a new block requires a new proof");
  const reorganized = historicalBoundary(block(height + 1n, hash(94)), height + 1n);
  checkpoint = await observeHistoricalCheckpoint(reorganized, checkpoint, prove, clock);
  assert.equal(registryProofCalls, 4, "a changed hash requires a new proof at the same height");
  await observeHistoricalCheckpoint(reorganized, null, prove, clock);
  assert.equal(registryProofCalls, 5, "recovery and restart have no reusable proof");
  await assert.rejects(observeHistoricalCheckpoint(advanced, checkpoint, async () => { throw absentReceipt; }, clock), absentReceipt);
  const incomplete = await observeHistoricalCheckpoint(reorganized, null, async () => false, clock);
  assert.equal(incomplete.proofAt, null);
  await observeHistoricalCheckpoint(reorganized, incomplete, prove, clock);
  assert.equal(registryProofCalls, 6, "proof backfill resumes at an unchanged checkpoint");
}

const receiptEmitter = {
  status: "success",
  transactionHash: hash(21),
  blockNumber: launchBlock,
  blockHash: hash(90),
  logs: [{
    address: historicalFactory,
    transactionHash: hash(21),
    blockNumber: launchBlock,
    blockHash: hash(90),
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({ abi: [tokenLaunchedEvent], args: { launchId: 0n, token, creator } }),
    data: encodeAbiParameters(tokenLaunchedEvent.inputs.filter((argument) => !("indexed" in argument)), [
      market, treasury, hash(30), hash(31), 1, 100, 7000, 3000, 50, false, 0n, 0n, 0, 0, 2n, false,
      "Historical", "HST", ""
    ])
  }]
};
const receiptMigration = {
  status: "success",
  transactionHash: hash(22),
  blockNumber: height - 1n,
  blockHash: hash(95),
  logs: [{
    address: market,
    transactionHash: hash(22),
    blockNumber: height - 1n,
    blockHash: hash(95),
    logIndex: 1,
    removed: false,
    topics: encodeEventTopics({ abi: [marketEvents[2]], args: { adapter, pool: poolSignal } }),
    data: encodeAbiParameters(marketEvents[2].inputs.filter((argument) => !("indexed" in argument)), [2n, 3n, 4n])
  }]
};

const providers = {
  getTransactionReceipt: async ({ hash: tx }: { hash: Hash }) => {
    if (tx === hash(21)) return receiptEmitter;
    if (tx === hash(22)) return receiptMigration;
    throw absentReceipt;
  },
  getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
    blockNumber,
    number: blockNumber,
    hash: blockNumber === launchBlock ? hash(90) : hash(95),
    timestamp: timestamp - 10n
  })
} as unknown as HistoricalProofRpc;

async function lookup(db: PoolClient, details = verified) {
  return readHistoricalLaunches(db, { limit: 25 }, details, false, details.verifiedAt);
}

export async function testHistoricalSchema(db: PoolClient, pool: Pool, schema: string) {
  await db.query(
    `UPDATE indexer_state SET factory = $1, start_block = $2, next_block = $3 WHERE chain_id = 4663`,
    [historicalFactory, historicalStartBlock.toString(), (height + 1n).toString()]
  );
  await db.query(`INSERT INTO sync_points (chain_id, block_number, block_hash, parent_hash, block_timestamp)
    VALUES (4663,$1,$2,$3,to_timestamp($4)), (4663,$5,$6,$7,to_timestamp($4))`,
  [height.toString(), hash(92), hash(95), timestamp.toString(), previous.toString(), hash(91), hash(90)]);
  const insert = `INSERT INTO launches
    (token, launch_id, creator, market, reward_vault, graduation_pool_id, name, symbol, supply, metadata_uri,
    creator_bps, community_bps, trader_bps, liquidity_bps, platform_bps, transaction_hash, block_number,
    log_index, protocol_version, original_creator, current_creator_fee_recipient)
    VALUES ($1,0,$2,$3,$4,$5,'Historical','HST',1000,'',7000,0,0,0,3000,$6,$7,0,6,$2,$2)
    ON CONFLICT (transaction_hash, log_index) DO NOTHING`;
  const values = [token, creator, market, treasury, hash(30), hash(21), launchBlock.toString()];
  await db.query(insert, values);
  assert.equal((await db.query(insert, values)).rowCount, 0);
  await db.query(`INSERT INTO liquidity_migrations (market, transaction_hash, log_index, adapter, pool,
    eth_amount, token_amount, liquidity, block_number) VALUES ($1,$2,1,$3,$4,2,3,4,$5)`,
  [market, hash(22), adapter, poolSignal, (height - 1n).toString()]);

  assert.equal(await lookup(db), null);
  await assert.rejects(proveHistoricalRows(db, {
    ...providers, getTransactionReceipt: async () => { throw absentReceipt; }
  }), absentReceipt);
  await assert.rejects(proveHistoricalRows(db, {
    ...providers, getBlock: async (args) => ({ ...await providers.getBlock(args), hash: hash(200) })
  }), /canonical block disagree/);
  const badReceipt = { ...receiptEmitter, logs: [{ ...receiptEmitter.logs[0]!, address: address(9) }] };
  await assert.rejects(proveHistoricalRows(db, {
    ...providers, getTransactionReceipt: async () => badReceipt as unknown as Awaited<ReturnType<typeof providers.getTransactionReceipt>>
  }), /did not prove the indexed event/);
  assert.equal(await lookup(db), null);

  await proveHistoricalRows(db, {
    ...providers, getTransactionReceipt: async () => { throw absentReceipt; }
  }, providers);
  await proveHistoricalRows(db, {
    ...providers, getTransactionReceipt: async () => { throw new Error("proven rows must not be re-read"); }
  });
  const first = await lookup(db);
  assert.equal(first?.checkpoint.observedAt, new Date(verified.verifiedAt).toISOString());
  assert.equal(first?.checkpoint.finality, "l2-confirmed");
  assert.equal(first?.checkpoint.stale, false);
  assert.equal(first?.launches[0]?.lifecycle, "graduated");
  assert.equal(first?.launches[0]?.lifecycleEvidence?.transactionHash, hash(22));
  assert.equal(first?.launches[0]?.pool, null);
  assert.equal(first?.launches[0]?.custody, null);
  assert.equal(await lookup(db, { ...verified, blockTimestamp: verified.blockTimestamp - 1n }), null);
  assert.equal((await lookup(db, { ...verified, verifiedAt: verified.verifiedAt + 301_000 }))?.checkpoint.stale, true);
  assert.equal((await readHistoricalLaunches(db, { limit: 25 }, verified, false, verified.verifiedAt + 241_000))?.checkpoint.stale, true,
    "serving time can make the block stale while the observation time stays fixed");
  assert.deepEqual((await readHistoricalLaunches(db, { token: address(500) }, verified, false))?.launches, []);

  // A persisted reader on a different PostgreSQL connection simulates process restart.
  await db.query("COMMIT");
  const restarted = await pool.connect();
  try {
    await restarted.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await restarted.query(`SET LOCAL search_path TO "${schema}"`);
    assert.deepEqual(await lookup(restarted), first);
    await db.query("BEGIN");
    await db.query(`SET LOCAL search_path TO "${schema}"`);
    await rollbackIndexRows(db, 4663, previous);
    assert.equal(await lookup(db), null);
    assert.equal((await lookup(db, olderPoint))?.launches[0]?.lifecycle, "unknown");
    await db.query("COMMIT");
    assert.deepEqual(await lookup(restarted), first, "repeatable read cannot mix rollback with the old snapshot");
    await restarted.query("COMMIT");
    await restarted.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await restarted.query(`SET LOCAL search_path TO "${schema}"`);
    assert.equal(await lookup(restarted), null);
    assert.equal((await lookup(restarted, olderPoint))?.launches[0]?.token, token);
  } finally {
    await restarted.query("ROLLBACK");
    restarted.release();
  }
}
