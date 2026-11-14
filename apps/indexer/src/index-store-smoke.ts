import assert from "node:assert/strict";
import { Client, type Pool } from "pg";
import { IndexStoreError, initializeIndexStore, lockIndexWriter } from "./index-store.js";
import { schemaSql } from "./schema.js";

export async function testIndexStoreRecovery(databaseUrl: string, pool: Pool) {
  const schema = "writer_smoke_" + process.pid + "_" + Date.now();
  const config = { chainId: 4663, startBlock: 100n, factory: "0x" + "1".repeat(40), schemaVersion: 5 };
  const first = new Client({ connectionString: databaseUrl });
  const second = new Client({ connectionString: databaseUrl });
  const disconnected = new Promise<void>((resolve) => first.on("error", () => resolve()));
  const initialize = (db: Client) => initializeIndexStore(db, config, async () => undefined);
  try {
    await Promise.all([first.connect(), second.connect()]);
    await first.query('CREATE SCHEMA "' + schema + '"');
    for (const db of [first, second]) await db.query('SET search_path TO "' + schema + '"');

    await lockIndexWriter(first, config.chainId);
    await assert.rejects(lockIndexWriter(second, config.chainId), {
      name: "IndexStoreError", code: "database_writer_conflict"
    });

    await first.query(schemaSql);
    const priorHash = "0x" + "2".repeat(64);
    await first.query("INSERT INTO indexer_state (chain_id, next_block, factory, start_block, schema_version) VALUES ($1, 101, $2, 100, 4)", [
      config.chainId, config.factory
    ]);
    await first.query("INSERT INTO sync_points (chain_id, block_number, block_hash, parent_hash) VALUES ($1, 100, $2, $2)", [
      config.chainId, priorHash
    ]);
    await first.query("ALTER TABLE sync_points DROP COLUMN block_timestamp");
    await assert.rejects(initialize(first), { name: "IndexStoreError", code: "database_binding_mismatch" });
    const frozen = await first.query("SELECT schema_version FROM indexer_state");
    assert.equal(frozen.rows[0]?.schema_version, 4);
    const column = await first.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'sync_points' AND column_name = 'block_timestamp'",
      [schema]
    );
    assert.equal(column.rowCount, 0, "rejected recovery leaves schema and data intact");

    await first.query("DELETE FROM indexer_state");
    await assert.rejects(initialize(first), { name: "IndexStoreError", code: "database_checkpoint_mismatch" });
    assert.equal((await first.query("SELECT block_hash FROM sync_points")).rows[0]?.block_hash, priorHash);
    await first.query("INSERT INTO indexer_state (chain_id, next_block, factory, start_block, schema_version) VALUES ($1, 102, $2, 100, 5)", [
      config.chainId, config.factory
    ]);
    await assert.rejects(initialize(first), IndexStoreError);
    assert.equal((await first.query("SELECT next_block FROM indexer_state")).rows[0]?.next_block, "102");

    await first.query("UPDATE indexer_state SET next_block = 101");
    assert.equal(await initialize(first), 100n);
    const pid = (await first.query<{ id: number }>("SELECT pg_backend_pid() AS id")).rows[0]!.id;
    await first.query("BEGIN");
    await first.query("UPDATE indexer_state SET next_block = 999");
    assert.equal((await second.query("SELECT pg_terminate_backend($1, 1000) AS terminated", [pid])).rows[0]?.terminated, true);
    await disconnected;
    await assert.rejects(first.query("UPDATE indexer_state SET next_block = 900"));
    await lockIndexWriter(second, config.chainId);
    assert.equal(await initialize(second), 100n, "restart resumes committed checkpoint after writer failure");
    assert.equal((await second.query("SELECT block_hash FROM sync_points")).rows[0]?.block_hash, priorHash);
  } finally {
    await Promise.allSettled([first.end(), second.end()]);
    await pool.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  }
}
