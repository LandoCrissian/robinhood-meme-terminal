import assert from "node:assert/strict";
import { Pool } from "pg";
import { hexBytes, packPoolProvenance, sourceCodeForId } from "./compact-storage.js";
import { migrateMarketIndexer } from "./schema.js";
import { MARKET_INDEXER_CHAIN_ID, marketSources } from "./sources.js";

const databaseUrl = process.env.MARKET_INDEXER_DATABASE_URL;
if (!databaseUrl) throw new Error("MARKET_INDEXER_DATABASE_URL is required");
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true }
});

async function dropIndexerTables() {
  await pool.query("DROP TABLE IF EXISTS market_pool_state CASCADE");
  await pool.query("DROP TABLE IF EXISTS market_pools CASCADE");
  await pool.query("DROP TABLE IF EXISTS market_indexer_sync_points CASCADE");
  await pool.query("DROP TABLE IF EXISTS market_indexer_source_state CASCADE");
}

try {
  await dropIndexerTables();
  await pool.query("DROP TABLE IF EXISTS canonical_launches CASCADE");
  await pool.query("CREATE TABLE canonical_launches (id BIGINT PRIMARY KEY)");
  await assert.rejects(migrateMarketIndexer(pool), /not a dedicated database/);
  await pool.query("DROP TABLE canonical_launches");
  await migrateMarketIndexer(pool);

  const durable = await pool.query<{ relname: string; relpersistence: string }>(
    `SELECT c.relname,c.relpersistence FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
    [["market_indexer_source_state", "market_indexer_sync_points", "market_pools", "market_pool_state"]]
  );
  assert(durable.rows.every((row) => row.relpersistence === "p"), JSON.stringify(durable.rows));
  await assert.rejects(migrateMarketIndexer(pool, "rebuildable"), /storage mode drift/);

  const source = marketSources.find((candidate) => candidate.id === "uniswap-v3")!;
  const poolKey = "0x0000000000000000000000000000000000000003";
  await pool.query(
    `INSERT INTO market_pools(source_code,pool_key,token0,token1,attributes,provenance,block_number,log_index)
     VALUES($1,$2,$3,$4,$5,$6,$7,0)`,
    [
      sourceCodeForId(source.id),
      hexBytes(poolKey, 20, "pool key"),
      hexBytes("0x0000000000000000000000000000000000000001", 20, "token0"),
      hexBytes("0x0000000000000000000000000000000000000002", 20, "token1"),
      Buffer.from("000bb8003c", "hex"),
      packPoolProvenance(`0x${"1".repeat(64)}`, `0x${"2".repeat(64)}`),
      Number(source.startBlock)
    ]
  );

  const upV2 = marketSources.find((candidate) => candidate.id === "up-v2")!;
  const upPool = "0x0000000000000000000000000000000000000005";
  await pool.query(
    `INSERT INTO market_pools(source_code,pool_key,token0,token1,attributes,provenance,block_number,log_index)
     VALUES($1,$2,$3,$4,$5,$6,$7,2)`,
    [
      sourceCodeForId(upV2.id),
      hexBytes(upPool, 20, "up pool"),
      hexBytes("0x0000000000000000000000000000000000000001", 20, "token0"),
      hexBytes("0x0000000000000000000000000000000000000002", 20, "token1"),
      Buffer.from([1]),
      packPoolProvenance(`0x${"5".repeat(64)}`, `0x${"6".repeat(64)}`),
      Number(upV2.startBlock)
    ]
  );
  await pool.query(
    `INSERT INTO market_pool_state(source_code,pool_key,status,live_fee,fee_denominator,observed_block,observed_block_hash)
     VALUES($1,$2,'ready',30,10000,$3,$4)`,
    [
      sourceCodeForId(upV2.id),
      hexBytes(upPool, 20, "up pool"),
      Number(upV2.startBlock),
      hexBytes(`0x${"7".repeat(64)}`, 32, "observed block hash")
    ]
  );

  await assert.rejects(
    pool.query(
      `INSERT INTO market_pools(source_code,pool_key,token0,token1,attributes,provenance,block_number,log_index)
       VALUES($1,$2,$3,$3,$4,$5,$6,1)`,
      [
        sourceCodeForId(source.id),
        hexBytes("0x0000000000000000000000000000000000000004", 20, "invalid pool"),
        hexBytes("0x0000000000000000000000000000000000000001", 20, "duplicate token"),
        Buffer.from("000bb8003c", "hex"),
        packPoolProvenance(`0x${"3".repeat(64)}`, `0x${"4".repeat(64)}`),
        Number(source.startBlock)
      ]
    ),
    /check constraint/
  );

  await pool.query(
    "DELETE FROM market_indexer_source_state WHERE chain_id=$1 AND source_id=$2",
    [MARKET_INDEXER_CHAIN_ID, source.id]
  );
  const cascaded = await pool.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM market_pools WHERE source_code=$1",
    [sourceCodeForId(source.id)]
  );
  assert.equal(cascaded.rows[0]?.count, "0");

  await dropIndexerTables();
  await migrateMarketIndexer(pool, "rebuildable");
  const rebuildable = await pool.query<{ relname: string; relpersistence: string }>(
    `SELECT c.relname,c.relpersistence FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,
    [["market_indexer_source_state", "market_indexer_sync_points", "market_pools", "market_pool_state"]]
  );
  assert.equal(rebuildable.rows.length, 4);
  assert(rebuildable.rows.every((row) => row.relpersistence === "u"));
  console.info("market indexer compact schema smoke passed");
} finally {
  await pool.end();
}
