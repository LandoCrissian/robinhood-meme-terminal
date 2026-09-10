import assert from "node:assert/strict";
import { Pool } from "pg";
import { readCanonicalTokenCatalog } from "./token-identity-catalog.js";

const connectionString = process.env.MARKET_INDEXER_DATABASE_URL;
assert.ok(connectionString);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname));
const connections = new Pool({ connectionString, ssl: false, max: 1 });
const pool = await connections.connect();
try {
  await pool.query("BEGIN");
  await pool.query(`CREATE TEMP TABLE market_pools(token0 bytea,token1 bytea,
    block_number integer,log_index integer, UNIQUE(block_number,log_index)) ON COMMIT DROP`);
  await pool.query(`INSERT INTO market_pools SELECT decode(lpad(to_hex(n),40,'0'),'hex'),
    decode(lpad(to_hex(n+1),40,'0'),'hex'),n,0 FROM generate_series(1,50000) n`);
  await pool.query("ANALYZE market_pools");
  await pool.query("SET LOCAL work_mem='64kB'");
  await pool.query("SET LOCAL temp_file_limit=0");
  await pool.query("SET LOCAL enable_hashagg=off");
  await pool.query("SAVEPOINT old_query");
  await assert.rejects(pool.query(`SELECT encode(token,'hex') AS token FROM (
    SELECT token0 AS token FROM market_pools WHERE token0 <> $1 UNION
    SELECT token1 AS token FROM market_pools WHERE token1 <> $1
    ) AS canonical_tokens ORDER BY token`, [Buffer.alloc(20)]), /temporary file size exceeds temp_file_limit/);
  await pool.query("ROLLBACK TO SAVEPOINT old_query");
  const started = performance.now();
  const inspected = { query: async (sql: string, values: unknown[]) => {
    const plan = await pool.query(`EXPLAIN (FORMAT JSON) ${sql}`, values);
    try {
      return await pool.query(sql, values);
    } catch (error) {
      console.log(JSON.stringify({ failedCatalogPage: values, plan: plan.rows[0]["QUERY PLAN"] }));
      throw error;
    }
  } } as unknown as Pool;
  const tokens = await readCanonicalTokenCatalog(inspected);
  assert.equal(tokens.size, 50001);
  assert.deepEqual([...tokens], [...tokens].sort());
  assert.equal([...tokens][0], `0x${"1".padStart(40, "0")}`);
  console.log(JSON.stringify({ oldGlobalSortTemporarySpaceFailureReproduced: true,
    boundedCatalogPassWithZeroTemporaryFileBudget: true, pools: 50000,
    tokens: tokens.size, elapsedMs: performance.now() - started }));
} finally {
  try {
    await pool.query("ROLLBACK");
  } finally {
    pool.release();
    await connections.end();
  }
}
