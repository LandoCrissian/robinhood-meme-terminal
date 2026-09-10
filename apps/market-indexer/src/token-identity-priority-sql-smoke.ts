import assert from "node:assert/strict";
import { Pool } from "pg";
import { PRIORITY_CANDIDATE_SQL } from "./token-identity-priority.js";

const connectionString = process.env.MARKET_INDEXER_DATABASE_URL;
assert.ok(connectionString, "local test PostgreSQL is required");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(connectionString).hostname),
  "query-plan fixture must never use a remote database");
const pool = new Pool({ connectionString, ssl: false, max: 1 });
try {
  await pool.query("BEGIN");
  await pool.query(`CREATE TEMPORARY TABLE market_pools (
    token0 bytea NOT NULL, token1 bytea NOT NULL,
    block_number integer NOT NULL, log_index integer NOT NULL,
    UNIQUE (block_number, log_index)
  ) ON COMMIT DROP`);
  await pool.query(`INSERT INTO market_pools
    SELECT decode(lpad(to_hex(n),40,'0'),'hex'), decode(lpad(to_hex(n+1),40,'0'),'hex'), n, 0
    FROM generate_series(1,50000) n`);
  await pool.query("ANALYZE market_pools");
  const started = performance.now();
  const result = await pool.query(PRIORITY_CANDIDATE_SQL);
  assert.equal(result.rows.length, 2_000);
  assert.equal(new Set(result.rows.map((row) => row.token)).size, 2_000);
  assert.ok(result.rows.every((row) => Number.parseInt(row.token, 16) >= 48_001));
  assert.deepEqual((await pool.query(PRIORITY_CANDIDATE_SQL)).rows, result.rows);
  const explained = await pool.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${PRIORITY_CANDIDATE_SQL}`);
  const nodes: Record<string, unknown>[] = [];
  const walk = (node: Record<string, unknown>) => {
    nodes.push(node);
    for (const child of (node.Plans ?? []) as Record<string, unknown>[]) walk(child);
  };
  walk(explained.rows[0]["QUERY PLAN"][0].Plan);
  assert.ok(nodes.some((node) => node["Node Type"] === "Index Scan" && node["Scan Direction"] === "Backward"));
  assert.ok(nodes.some((node) => node["Node Type"] === "Limit" && node["Actual Rows"] === 2_000));
  console.log(JSON.stringify({ queryPlan: "bounded-backward-event-index-scan", inputPools: 50_000,
    boundedPoolWindow: 2_000, candidates: result.rows.length, selectionMs: performance.now() - started }));
} finally {
  await pool.query("ROLLBACK");
  await pool.end();
}
