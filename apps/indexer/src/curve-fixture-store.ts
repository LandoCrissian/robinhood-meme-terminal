import type { Client } from "pg";
import { lockIndexWriter } from "./index-store.js";
import { curveFixtureProfile } from "./curve-fixture-config.js";
import { fixtureConfirmations, type BlockEvidence, type CurveFixtureBinding, type CurveLaunchRegistration } from "./curve-launch-evidence.js";

type Database = Pick<Client, "query">;
type Scope = [number, string, string];
const markerTable = "rmt_curve_fixture_marker";
const scopePredicate = "chain_id = $1 AND factory = $2 AND deployment_block_hash = $3";
const approvedTables = new Set([markerTable, "rmt_curve_fixture_binding", "rmt_curve_fixture_checkpoints", "rmt_curve_fixture_launches"]);
const schema = `
  CREATE TABLE IF NOT EXISTS rmt_curve_fixture_binding (
    profile text PRIMARY KEY CHECK (profile = 'task036-local-only'),
    identity jsonb NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rmt_curve_fixture_checkpoints (
    chain_id integer NOT NULL CHECK (chain_id = 31337),
    factory text NOT NULL,
    deployment_block_hash text NOT NULL,
    block_number bigint NOT NULL CHECK (block_number > 0),
    block_hash text NOT NULL,
    observed_at timestamptz NOT NULL,
    PRIMARY KEY (chain_id, factory, deployment_block_hash, block_number),
    UNIQUE (chain_id, factory, deployment_block_hash, block_number, block_hash)
  );
  CREATE TABLE IF NOT EXISTS rmt_curve_fixture_launches (
    chain_id integer NOT NULL CHECK (chain_id = 31337),
    factory text NOT NULL,
    deployment_block_hash text NOT NULL,
    token text NOT NULL,
    block_number bigint NOT NULL,
    block_hash text NOT NULL,
    transaction_hash text NOT NULL,
    log_index integer NOT NULL CHECK (log_index >= 0),
    payload jsonb NOT NULL,
    PRIMARY KEY (chain_id, factory, deployment_block_hash, token),
    UNIQUE (chain_id, factory, deployment_block_hash, transaction_hash, log_index),
    UNIQUE (chain_id, factory, deployment_block_hash, block_number, log_index),
    FOREIGN KEY (chain_id, factory, deployment_block_hash, block_number, block_hash)
      REFERENCES rmt_curve_fixture_checkpoints (chain_id, factory, deployment_block_hash, block_number, block_hash) ON DELETE CASCADE
  );
`;

export function curveScope(binding: CurveFixtureBinding): Scope {
  return [binding.chainId, binding.factory.toLowerCase(), binding.deploymentBlockHash.toLowerCase()];
}

export function fixtureCheckpoint(block: BlockEvidence): CurveLaunchRegistration["checkpoint"] {
  return { ...block, confirmations: fixtureConfirmations, finality: "fixture-confirmed", l1Finality: "unverified" };
}

async function inTransaction<T>(db: Database, task: () => Promise<T>) {
  await db.query("BEGIN");
  try {
    const result = await task();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** The expendable named database must explicitly opt in before any DDL. */
export async function initializeCurveFixtureStore(writer: Database, databaseName: string, binding: CurveFixtureBinding) {
  const identity = await writer.query<{ name: string; host: string; relations: { name: string; kind: string }[] }>(
    `SELECT current_database() AS name, host(inet_server_addr()) AS host,
            coalesce((SELECT json_agg(json_build_object('name', c.relname, 'kind', c.relkind))
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relkind NOT IN ('i', 'I')), '[]'::json) AS relations`,
  );
  const db = identity.rows[0];
  if (!db || db.name !== databaseName || db.host !== "127.0.0.1" || !db.relations.some(({ name }) => name === markerTable)
      || db.relations.some(({ name, kind }) => kind !== "r" || !approvedTables.has(name))) throw new Error("Fixture database identity mismatch");
  const legacy = await writer.query<{ present: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') AND c.relname IN ('indexer_state','sync_points','launches')) AS present`,
  );
  if (legacy.rows[0]?.present !== false) throw new Error("Fixture database contains legacy indexer relations");
  const marker = await writer.query<{ identity: string }>("SELECT identity FROM public.rmt_curve_fixture_marker LIMIT 2");
  if (marker.rows.length !== 1 || marker.rows[0]?.identity !== curveFixtureProfile) throw new Error("Fixture database marker mismatch");

  await lockIndexWriter(writer, binding.chainId);
  await writer.query("SET search_path TO public, pg_catalog");
  await writer.query("SET statement_timeout = '5s'");
  const snapshot = JSON.stringify({ ...binding, factory: binding.factory.toLowerCase(), projectRegistry: binding.projectRegistry.toLowerCase(),
    creationFeeRecipient: binding.creationFeeRecipient.toLowerCase(), deploymentBlock: binding.deploymentBlock.toString(),
    deploymentBlockHash: binding.deploymentBlockHash.toLowerCase(), factoryRuntimeHash: binding.factoryRuntimeHash.toLowerCase(),
    projectRegistryRuntimeHash: binding.projectRegistryRuntimeHash.toLowerCase(), creationFeeWei: binding.creationFeeWei.toString() });
  await inTransaction(writer, async () => {
    await writer.query(schema);
    await writer.query("INSERT INTO rmt_curve_fixture_binding (profile, identity) VALUES ($1, $2) ON CONFLICT (profile) DO NOTHING",
      [curveFixtureProfile, snapshot]);
    const bound = await writer.query<{ matches: boolean }>("SELECT identity = $1::jsonb AS matches FROM rmt_curve_fixture_binding WHERE profile = $2",
      [snapshot, curveFixtureProfile]);
    const boundaries = await writer.query<{ first_block: string | null; last_block: string | null; consistent: boolean }>(
      `SELECT min(block_number) AS first_block, max(block_number) AS last_block,
         count(*) = coalesce(max(block_number) - min(block_number) + 1, 0)
         AND coalesce(bool_and(${scopePredicate}), true) AS consistent
       FROM rmt_curve_fixture_checkpoints`, curveScope(binding));
    const summary = boundaries.rows[0];
    if (bound.rows[0]?.matches !== true || !summary?.consistent
        || (summary.first_block !== null && BigInt(summary.first_block) !== binding.deploymentBlock)) {
      throw new Error("Fixture database checkpoint or deployment mismatch");
    }
  });
}

export async function storedCurveCheckpoints(db: Database, scope: Scope, limit: number) {
  const result = await db.query<{ block_number: string; block_hash: BlockEvidence["blockHash"]; observed_at: Date }>(
    `SELECT block_number, block_hash, observed_at FROM rmt_curve_fixture_checkpoints
     WHERE ${scopePredicate} ORDER BY block_number DESC LIMIT $4`, [...scope, limit]);
  return result.rows.map(({ block_number, block_hash, observed_at }) => ({
    blockNumber: block_number, blockHash: block_hash, timestamp: observed_at.toISOString(),
  }));
}

export async function rollbackCurveFixture(db: Database, scope: Scope, keepThrough: bigint) {
  // Foreign keys remove receipts for reorganized blocks in the same statement.
  await db.query(`DELETE FROM rmt_curve_fixture_checkpoints WHERE ${scopePredicate} AND block_number > $4`, [...scope, keepThrough.toString()]);
}

export async function commitCurveFixtureRange(db: Database, scope: Scope, blocks: readonly BlockEvidence[], launches: readonly CurveLaunchRegistration[]) {
  await inTransaction(db, async () => {
    for (const block of blocks) {
      await db.query(`INSERT INTO rmt_curve_fixture_checkpoints
        (chain_id, factory, deployment_block_hash, block_number, block_hash, observed_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [...scope, block.blockNumber, block.blockHash.toLowerCase(), block.timestamp]);
    }
    for (const launch of launches) {
      const { blockNumber, blockHash, transactionHash, logIndex } = launch.creation;
      await db.query(`INSERT INTO rmt_curve_fixture_launches
        (chain_id, factory, deployment_block_hash, token, block_number, block_hash, transaction_hash, log_index, payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [...scope, launch.token.toLowerCase(), blockNumber, blockHash.toLowerCase(),
        transactionHash.toLowerCase(), logIndex, JSON.stringify(launch)]);
    }
  });
}

export async function readCurveFixtureRows(db: Database, scope: Scope, checkpoint: BlockEvidence, token?: string) {
  const result = await db.query<{ payload: CurveLaunchRegistration; token: string; block_number: string; block_hash: string;
    transaction_hash: string; log_index: number }>(
    `SELECT payload, token, block_number, block_hash, transaction_hash, log_index FROM rmt_curve_fixture_launches
     WHERE ${scopePredicate} AND block_number <= $4 AND ($5::text IS NULL OR token = $5)
     ORDER BY block_number DESC, log_index DESC LIMIT 25`, [...scope, checkpoint.blockNumber, token ?? null]);
  return result.rows.map(({ payload, token, block_number, block_hash, transaction_hash, log_index }) => {
    if (payload.chainId !== scope[0] || payload.factory.toLowerCase() !== scope[1] || payload.token.toLowerCase() !== token
        || payload.creation.blockNumber !== block_number || payload.creation.blockHash.toLowerCase() !== block_hash
        || payload.creation.transactionHash.toLowerCase() !== transaction_hash || payload.creation.logIndex !== log_index) {
      throw new Error("Fixture row identity mismatch");
    }
    return payload;
  });
}
