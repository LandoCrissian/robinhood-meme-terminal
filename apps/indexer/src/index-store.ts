import type { Client } from "pg";
import { schemaSql } from "./schema.js";

type Database = Pick<Client, "query">;

const writerNamespace = 1_380_805_961;

export class IndexStoreError extends Error {
  constructor(readonly code: "database_writer_conflict" | "database_binding_mismatch" | "database_checkpoint_mismatch" | "database_checkpoint_ahead") {
    super(code);
    this.name = "IndexStoreError";
  }
}

/** Keep this lock and all writes on the same dedicated PostgreSQL connection. */
export async function lockIndexWriter(db: Database, chainId: number) {
  const result = await db.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1::int, $2::int) AS locked", [writerNamespace, chainId]
  );
  if (!result.rows[0]?.locked) throw new IndexStoreError("database_writer_conflict");
}

export async function initializeIndexStore(
  db: Database,
  config: { chainId: number; factory: string; startBlock: bigint; schemaVersion: number },
  refreshCreatorPayoutState: (db: Database) => Promise<void>
) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout = '5s'");
    await db.query("SET LOCAL statement_timeout = '60s'");
    await db.query(schemaSql);
    const state = await db.query<{
      chain_id: number;
      factory: string | null;
      start_block: string | null;
      next_block: string;
      schema_version: number | null;
    }>("SELECT chain_id, factory, start_block, next_block, schema_version FROM indexer_state LIMIT 2");
    const current = state.rows[0];
    if (state.rows.length > 1 || (current &&
      (current.chain_id !== config.chainId || current.factory !== config.factory ||
       current.start_block !== config.startBlock.toString() || current.schema_version !== config.schemaVersion))) {
      throw new IndexStoreError("database_binding_mismatch");
    }

    const nextBlock = current ? BigInt(current.next_block) : config.startBlock;
    if (nextBlock < config.startBlock) throw new IndexStoreError("database_checkpoint_mismatch");
    const consistency = await db.query<{ bad: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM sync_points WHERE chain_id <> $1 OR block_number < $2 OR block_number >= $3)" +
      " OR EXISTS (SELECT 1 FROM launches WHERE block_number < $2 OR block_number >= $3)" +
      " OR EXISTS (SELECT 1 FROM trades WHERE block_number < $2 OR block_number >= $3)" +
      " OR EXISTS (SELECT 1 FROM graduations WHERE block_number < $2 OR block_number >= $3)" +
      " OR EXISTS (SELECT 1 FROM liquidity_migrations WHERE block_number < $2 OR block_number >= $3)" +
      " OR EXISTS (SELECT 1 FROM creator_payout_events WHERE block_number < $2 OR block_number >= $3)" +
      " OR EXISTS (SELECT 1 FROM graduation_fee_collections WHERE block_number < $2 OR block_number >= $3)" +
      " OR EXISTS (SELECT 1 FROM fee_splitter_events WHERE block_number < $2 OR block_number >= $3)" +
      " OR ($3::bigint > $2::bigint AND NOT EXISTS (" +
      "       SELECT 1 FROM sync_points WHERE chain_id = $1 AND block_number = $3::bigint - 1" +
      "         AND block_hash ~* '^0x[0-9a-f]{64}$')) AS bad",
      [config.chainId, config.startBlock.toString(), nextBlock.toString()]
    );
    if (consistency.rows[0]?.bad !== false) throw new IndexStoreError("database_checkpoint_mismatch");

    if (!current) {
      await db.query(
        "INSERT INTO indexer_state (chain_id, next_block, factory, start_block, schema_version) VALUES ($1,$2,$3,$2,$4)",
        [config.chainId, config.startBlock.toString(), config.factory, config.schemaVersion]
      );
    }
    await refreshCreatorPayoutState(db);
    await db.query("COMMIT");
    return nextBlock - 1n;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
