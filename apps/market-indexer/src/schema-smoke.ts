import assert from "node:assert/strict";
import { Pool } from "pg";
import { migrateMarketIndexer } from "./schema.js";
import { MARKET_INDEXER_CHAIN_ID, marketSources } from "./sources.js";

const databaseUrl = process.env.MARKET_INDEXER_DATABASE_URL;
if (!databaseUrl) throw new Error("MARKET_INDEXER_DATABASE_URL is required");
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true }
});

try {
  await pool.query("DROP TABLE IF EXISTS market_pools CASCADE");
  await pool.query("DROP TABLE IF EXISTS market_indexer_sync_points CASCADE");
  await pool.query("DROP TABLE IF EXISTS market_indexer_source_state CASCADE");
  await pool.query("DROP TABLE IF EXISTS canonical_launches CASCADE");
  await pool.query("CREATE TABLE canonical_launches (id BIGINT PRIMARY KEY)");
  await assert.rejects(
    migrateMarketIndexer(pool),
    /not a dedicated database; unexpected public tables: canonical_launches/
  );
  const refusedDdl = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename = ANY($1::text[])`,
    [[
      "market_indexer_source_state",
      "market_indexer_sync_points",
      "market_pools"
    ]]
  );
  assert.equal(refusedDdl.rows[0]?.count, "0");
  await pool.query("DROP TABLE canonical_launches");
  await migrateMarketIndexer(pool);

  const source = marketSources.find((candidate) => candidate.id === "uniswap-v3")!;
  await pool.query(
    `INSERT INTO market_pools (
       chain_id, source_id, protocol, protocol_version, pool_key, pool_address,
       token0, token1, fee, tick_spacing, hooks, transaction_hash,
       transaction_index, log_index, block_number, block_hash
     ) VALUES ($1,$2,'uniswap',3,$3,$3,$4,$5,3000,60,NULL,$6,0,0,$7,$8)`,
    [
      MARKET_INDEXER_CHAIN_ID,
      source.id,
      "0x0000000000000000000000000000000000000003",
      "0x0000000000000000000000000000000000000001",
      "0x0000000000000000000000000000000000000002",
      `0x${"1".repeat(64)}`,
      source.startBlock.toString(),
      `0x${"2".repeat(64)}`
    ]
  );
  await assert.rejects(
    pool.query(
      `INSERT INTO market_pools (
         chain_id, source_id, protocol, protocol_version, pool_key, pool_address,
         token0, token1, fee, tick_spacing, hooks, transaction_hash,
         transaction_index, log_index, block_number, block_hash
       ) VALUES ($1,$2,'uniswap',3,$3,$3,$4,$4,3000,60,NULL,$5,0,1,$6,$7)`,
      [
        MARKET_INDEXER_CHAIN_ID,
        source.id,
        "0x0000000000000000000000000000000000000004",
        "0x0000000000000000000000000000000000000001",
        `0x${"3".repeat(64)}`,
        source.startBlock.toString(),
        `0x${"4".repeat(64)}`
      ]
    ),
    /market_pools_token0_check|check constraint/
  );
  const count = await pool.query<{ count: string }>("SELECT COUNT(*) FROM market_pools");
  assert.equal(count.rows[0]?.count, "1");

  await pool.query(
    "DELETE FROM market_indexer_source_state WHERE chain_id = $1 AND source_id = $2",
    [MARKET_INDEXER_CHAIN_ID, source.id]
  );
  const cascaded = await pool.query<{ count: string }>(
    "SELECT COUNT(*) FROM market_pools WHERE source_id = $1",
    [source.id]
  );
  assert.equal(cascaded.rows[0]?.count, "0");
  console.info("market indexer schema smoke passed");
} finally {
  await pool.end();
}
