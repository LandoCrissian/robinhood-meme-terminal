import assert from "node:assert/strict";
import { Pool, type PoolClient } from "pg";
import { launchRowsQuery } from "./launch-rows-query.js";
import { schemaSql } from "./schema.js";

type CandidateRow = {
  token: string;
  volume_wei: string;
  trade_count: number;
  buy_count: number;
  sell_count: number;
  creator_bought_tokens: string;
  creator_sold_tokens: string;
  creator_trade_count: number;
  reserve_wei: string;
};

const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}`;
const hash = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;

async function seedLaunch(
  db: PoolClient,
  input: { token: string; market: string; creator: string; launchId: number; blockNumber: number }
) {
  await db.query(
    `INSERT INTO launches (
      token, launch_id, creator, market, reward_vault, graduation_pool_id,
      name, symbol, supply, metadata_uri, creator_bps, community_bps,
      trader_bps, liquidity_bps, platform_bps, transaction_hash,
      block_number, log_index, protocol_version, original_creator,
      current_creator_fee_recipient
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, 0, 0,
      0, 0, 0, $11,
      $12, 0, 6, $3,
      $3
    )`,
    [
      input.token,
      input.launchId.toString(),
      input.creator,
      input.market,
      address(200 + input.launchId),
      hash(200 + input.launchId),
      `Smoke ${input.launchId}`,
      `S${input.launchId}`,
      "1000000000000000000000000000",
      `ipfs://smoke-${input.launchId}`,
      hash(300 + input.launchId),
      input.blockNumber.toString()
    ]
  );
}

async function seedTrade(
  db: PoolClient,
  input: {
    id: number;
    market: string;
    trader: string;
    isBuy: boolean;
    tokenAmount: number;
    ethAmount: number;
    reserve: number;
    blockNumber: number;
    logIndex?: number;
  }
) {
  await db.query(
    `INSERT INTO trades (
      transaction_hash, log_index, market, trader, recipient, is_buy,
      token_amount, eth_amount, fee_amount, virtual_eth_reserve,
      virtual_token_reserve, real_eth_reserve, block_number
    ) VALUES ($1, $2, $3, $4, $4, $5, $6, $7, 0, 0, 0, $8, $9)`,
    [
      hash(1_000 + input.id),
      input.logIndex ?? 0,
      input.market,
      input.trader,
      input.isBuy,
      input.tokenAmount.toString(),
      input.ethAmount.toString(),
      input.reserve.toString(),
      input.blockNumber.toString()
    ]
  );
}

async function assertLaunchCandidateQuery(db: PoolClient) {
  const creator = address(100);
  const outsider = address(101);
  const newest = { token: address(1), market: address(11) };
  const mover = { token: address(2), market: address(12) };
  const nearGraduation = { token: address(3), market: address(13) };
  const graduated = { token: address(4), market: address(14) };

  await seedLaunch(db, { ...newest, creator: address(102), launchId: 1, blockNumber: 40_000 });
  await seedLaunch(db, { ...mover, creator, launchId: 2, blockNumber: 1_000 });
  await seedLaunch(db, { ...nearGraduation, creator: address(103), launchId: 3, blockNumber: 2_000 });
  await seedLaunch(db, { ...graduated, creator: address(104), launchId: 4, blockNumber: 500 });

  // indexedThrough=50,000 makes block 30,001 the inclusive start of the 20,000-block window.
  await seedTrade(db, {
    id: 1,
    market: mover.market,
    trader: creator,
    isBuy: true,
    tokenAmount: 999,
    ethAmount: 1_000,
    reserve: 500,
    blockNumber: 30_000
  });
  await seedTrade(db, {
    id: 2,
    market: mover.market,
    trader: creator,
    isBuy: true,
    tokenAmount: 100,
    ethAmount: 10,
    reserve: 600,
    blockNumber: 30_001
  });
  await seedTrade(db, {
    id: 3,
    market: mover.market,
    trader: creator,
    isBuy: false,
    tokenAmount: 40,
    ethAmount: 20,
    reserve: 650,
    blockNumber: 30_002
  });
  await seedTrade(db, {
    id: 4,
    market: mover.market,
    trader: outsider,
    isBuy: true,
    tokenAmount: 300,
    ethAmount: 30,
    reserve: 777,
    blockNumber: 30_003
  });
  await seedTrade(db, {
    id: 5,
    market: nearGraduation.market,
    trader: outsider,
    isBuy: true,
    tokenAmount: 1,
    ethAmount: 1,
    reserve: 1_900,
    blockNumber: 30_000
  });
  await seedTrade(db, {
    id: 6,
    market: graduated.market,
    trader: outsider,
    isBuy: true,
    tokenAmount: 1,
    ethAmount: 10_000,
    reserve: 9_999,
    blockNumber: 30_001
  });
  await db.query(
    `INSERT INTO graduations (
      market, transaction_hash, log_index, real_eth_reserve,
      token_inventory, block_number
    ) VALUES ($1, $2, 0, 9999, 1, 30001)`,
    [graduated.market, hash(2_000)]
  );

  const query = launchRowsQuery(50_000n, 3);
  assert.deepEqual(query.values, [3, "30001", 3]);
  const result = await db.query<CandidateRow>(query);
  const rows = new Map(result.rows.map((row) => [row.token, row]));

  assert.deepEqual([...rows.keys()].sort(), [mover.token, nearGraduation.token, newest.token].sort());
  assert.equal(rows.has(graduated.token), false, "graduated launch must not enter the moving or near-graduation buckets");

  const moverRow = rows.get(mover.token);
  assert.ok(moverRow, "recent-volume mover must be selected");
  assert.equal(moverRow.volume_wei, "60");
  assert.equal(moverRow.trade_count, 3);
  assert.equal(moverRow.buy_count, 2);
  assert.equal(moverRow.sell_count, 1);
  assert.equal(moverRow.creator_bought_tokens, "100");
  assert.equal(moverRow.creator_sold_tokens, "40");
  assert.equal(moverRow.creator_trade_count, 2);
  assert.equal(moverRow.reserve_wei, "777");

  const nearRow = rows.get(nearGraduation.token);
  assert.ok(nearRow, "highest non-graduated reserve must be selected");
  assert.equal(nearRow.volume_wei, "0", "pre-window trade must not enter recent volume");
  assert.equal(nearRow.trade_count, 0);
  assert.equal(nearRow.reserve_wei, "1900", "latest reserve must remain all-time");
  assert.ok(rows.has(newest.token), "newest launch must be selected");
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required for the schema smoke test.");

const pool = new Pool({ connectionString: url });
try {
  await pool.query(schemaSql);
  const result = await pool.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [[
      "indexer_state",
      "sync_points",
      "launches",
      "trades",
      "graduations",
      "liquidity_migrations",
      "creator_payout_events",
      "graduation_fee_collections",
      "fee_splitter_events"
    ]]
  );
  if (result.rows.length !== 9) {
    throw new Error(`Expected 9 indexer tables, found ${result.rows.length}`);
  }

  const launchColumns = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'launches'
       AND column_name = ANY($1::text[])`,
    [[
      "original_creator",
      "current_creator_fee_recipient",
      "protocol_treasury",
      "creator_payout_authority",
      "fee_authorized_market",
      "fee_graduation_adapter"
    ]]
  );
  if (launchColumns.rows.length !== 6) {
    throw new Error(`Expected 6 V6 fee-routing launch columns, found ${launchColumns.rows.length}`);
  }

  const payoutColumns = await pool.query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'creator_payout_events'
       AND column_name = 'change_nonce'`
  );
  if (payoutColumns.rows.length !== 1) throw new Error("Missing creator-payout replay nonce column");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const smokeSchema = `schema_smoke_${process.pid}_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${smokeSchema}"`);
    await client.query(`SET LOCAL search_path TO "${smokeSchema}"`);
    await client.query(schemaSql);
    await client.query(
      "INSERT INTO indexer_state (chain_id, next_block, factory, start_block, schema_version) VALUES ($1, $2, $3, $2, $4)",
      [4663, "1", "0x0000000000000000000000000000000000000006", 4]
    );
    await assertLaunchCandidateQuery(client);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  console.info("Indexer schema smoke test passed.");
} finally {
  await pool.end();
}
