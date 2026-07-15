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

  await pool.query("BEGIN");
  await pool.query(
    "INSERT INTO indexer_state (chain_id, next_block, factory, start_block, schema_version) VALUES ($1, $2, $3, $2, $4) ON CONFLICT DO NOTHING",
    [4663, "1", "0x0000000000000000000000000000000000000006", 4]
  );
  await pool.query("ROLLBACK");
  console.info("Indexer schema smoke test passed.");
} finally {
  await pool.end();
}
