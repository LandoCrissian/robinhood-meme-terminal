import { Pool } from "pg";
import { schemaSql } from "./schema.js";

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
      "liquidity_migrations"
    ]]
  );
  if (result.rows.length !== 6) {
    throw new Error(`Expected 6 indexer tables, found ${result.rows.length}`);
  }

  await pool.query("BEGIN");
  await pool.query(
    "INSERT INTO indexer_state (chain_id, next_block) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [4663, "8862129"]
  );
  await pool.query("ROLLBACK");
  console.info("Indexer schema smoke test passed.");
} finally {
  await pool.end();
}
