import type { Client } from "pg";
import type { BlockEvidence, CurveLaunchRegistration } from "./curve-launch-evidence.js";
import type { CurveProductionConfig } from "./curve-production-config.js";
import { lockIndexWriter } from "./index-store.js";
import type { EarningsDiscoveryCursor } from "./creator-earnings.js";

type Database = Pick<Client, "query">;
const encode = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item);

// Apply only after backup verification and explicit production schema approval.
// The runtime checks these tables and never performs DDL against the recovered database.
export const curveProductionSchemaSql = `
  CREATE TABLE IF NOT EXISTS rmt_curve_production_bindings (
    scope TEXT PRIMARY KEY, identity JSONB NOT NULL, next_block BIGINT NOT NULL CHECK (next_block > 0)
  );
  CREATE TABLE IF NOT EXISTS rmt_curve_production_checkpoints (
    scope TEXT NOT NULL REFERENCES rmt_curve_production_bindings(scope),
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(scope, block_number)
  );
  CREATE TABLE IF NOT EXISTS rmt_curve_production_launches (
    scope TEXT NOT NULL REFERENCES rmt_curve_production_bindings(scope),
    token TEXT NOT NULL, transaction_hash TEXT NOT NULL, log_index INTEGER NOT NULL,
    block_number BIGINT NOT NULL, block_hash TEXT NOT NULL, payload JSONB NOT NULL,
    PRIMARY KEY(scope, token), UNIQUE(scope, transaction_hash, log_index)
  );
  CREATE INDEX IF NOT EXISTS rmt_curve_production_launches_block
    ON rmt_curve_production_launches(scope, block_number);
`;

export const productionCurveIdentity = (config: CurveProductionConfig) => encode(config);

export function productionCurveScope(config: CurveProductionConfig) {
  const { binding } = config;
  return [binding.chainId, binding.factory.toLowerCase(), binding.deploymentBlockHash.toLowerCase()].join(":");
}

export async function initializeProductionCurveStore(writer: Database, config: CurveProductionConfig) {
  const present = await writer.query<{ present: boolean }>(`SELECT
    to_regclass('public.rmt_curve_production_bindings') IS NOT NULL
    AND to_regclass('public.rmt_curve_production_checkpoints') IS NOT NULL
    AND to_regclass('public.rmt_curve_production_launches') IS NOT NULL AS present`);
  if (present.rows[0]?.present !== true) {
    throw new Error("Production curve schema requires a verified backup and explicit installation");
  }
  await lockIndexWriter(writer, config.binding.chainId);
  const scope = productionCurveScope(config);
  const identity = productionCurveIdentity(config);
  await writer.query(`INSERT INTO rmt_curve_production_bindings(scope, identity, next_block)
    VALUES ($1,$2,$3) ON CONFLICT(scope) DO NOTHING`, [scope, identity, config.binding.deploymentBlock.toString()]);
  const result = await writer.query<{ matches: boolean; next_block: string }>(
    "SELECT identity = $2::jsonb AS matches, next_block::text FROM rmt_curve_production_bindings WHERE scope = $1", [scope, identity]);
  if (result.rows[0]?.matches !== true || BigInt(result.rows[0].next_block) < config.binding.deploymentBlock) {
    throw new Error("Production curve database binding mismatch");
  }
}

export async function productionCurveCheckpoints(db: Database, scope: string, limit = 25) {
  const result = await db.query<{ block_number: string; block_hash: BlockEvidence["blockHash"]; observed_at: Date }>(
    `SELECT block_number::text, block_hash, observed_at FROM rmt_curve_production_checkpoints c
     WHERE scope = $1 ORDER BY c.block_number DESC LIMIT $2`, [scope, limit]);
  return result.rows.map((row) => ({ blockNumber: row.block_number, blockHash: row.block_hash,
    timestamp: row.observed_at.toISOString() }));
}

export async function productionCurveCursor(db: Database, scope: string) {
  const state = await db.query<{ next_block: string }>(
    "SELECT next_block::text FROM rmt_curve_production_bindings WHERE scope = $1", [scope]);
  if (!state.rows[0]) throw new Error("Production curve deployment is not bound to this database");
  return BigInt(state.rows[0].next_block);
}

async function transaction<T>(db: Database, task: () => Promise<T>) {
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL lock_timeout = '2s'");
    await db.query("SET LOCAL statement_timeout = '5s'");
    const result = await task();
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

/** Called serially on the existing indexer's leased writer connection. */
export async function commitProductionCurveRange(db: Database, config: CurveProductionConfig,
  from: bigint, checkpoint: BlockEvidence, launches: CurveLaunchRegistration[]) {
  const scope = productionCurveScope(config);
  await transaction(db, async () => {
    const state = await db.query<{ next_block: string }>(
      "SELECT next_block::text FROM rmt_curve_production_bindings WHERE scope = $1 FOR UPDATE", [scope]);
    if (!state.rows[0]) throw new Error("Production curve cursor missing");
    const next = BigInt(state.rows[0].next_block);
    const to = BigInt(checkpoint.blockNumber);
    if (next > to) {
      const duplicate = await db.query<{ block_hash: string }>(
        "SELECT block_hash FROM rmt_curve_production_checkpoints WHERE scope = $1 AND block_number = $2",
        [scope, checkpoint.blockNumber]);
      if (duplicate.rows[0]?.block_hash !== checkpoint.blockHash) throw new Error("Production replay checkpoint mismatch");
      return;
    }
    if (next !== from || to < from) throw new Error("Production curve cursor changed during ingestion");
    for (const launch of launches) {
      const event = launch.creation;
      if (launch.chainId !== 4663 || launch.factory.toLowerCase() !== config.binding.factory.toLowerCase()
          || launch.projectRegistry.toLowerCase() !== config.binding.projectRegistry.toLowerCase()
          || BigInt(event.blockNumber) < from || BigInt(event.blockNumber) > to) {
        throw new Error("Production registration scope or range mismatch");
      }
      const payload = encode(launch);
      await db.query(`INSERT INTO rmt_curve_production_launches
        (scope,token,transaction_hash,log_index,block_number,block_hash,payload) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT DO NOTHING`, [scope, launch.token.toLowerCase(), event.transactionHash, event.logIndex,
        event.blockNumber, event.blockHash, payload]);
      const exact = await db.query<{ matches: boolean }>(
        "SELECT payload = $3::jsonb AS matches FROM rmt_curve_production_launches WHERE scope = $1 AND token = $2",
        [scope, launch.token.toLowerCase(), payload]);
      if (exact.rows[0]?.matches !== true) throw new Error("Conflicting production registration identity");
    }
    await db.query(`INSERT INTO rmt_curve_production_checkpoints(scope,block_number,block_hash,observed_at)
      VALUES($1,$2,$3,$4)`, [scope, checkpoint.blockNumber, checkpoint.blockHash, checkpoint.timestamp]);
    await db.query("UPDATE rmt_curve_production_bindings SET next_block = $2 WHERE scope = $1",
      [scope, (to + 1n).toString()]);
  });
}

export async function rollbackProductionCurve(db: Database, scope: string, keepThrough: bigint) {
  await transaction(db, async () => {
    await db.query("SELECT scope FROM rmt_curve_production_bindings WHERE scope = $1 FOR UPDATE", [scope]);
    await db.query("DELETE FROM rmt_curve_production_launches WHERE scope = $1 AND block_number > $2", [scope, keepThrough.toString()]);
    await db.query("DELETE FROM rmt_curve_production_checkpoints WHERE scope = $1 AND block_number > $2", [scope, keepThrough.toString()]);
    await db.query("UPDATE rmt_curve_production_bindings SET next_block = $2 WHERE scope = $1", [scope, (keepThrough + 1n).toString()]);
  });
}

export async function readProductionCurveLaunches(db: Database, scope: string, checkpoint: BlockEvidence,
  { token, after, limit }: { token?: string; after?: string; limit: number }, allowNewer = false) {
  const current = await db.query<{ matches: boolean }>(`SELECT
    (b.next_block - 1 = $2::bigint OR ($4 AND b.next_block > $2)) AND c.block_hash = $3 AS matches
    FROM rmt_curve_production_bindings b JOIN rmt_curve_production_checkpoints c
      ON c.scope = b.scope AND c.block_number = $2 WHERE b.scope = $1`,
    [scope, checkpoint.blockNumber, checkpoint.blockHash, allowNewer]);
  if (current.rows[0]?.matches !== true) throw new Error("Production read checkpoint changed or was restored");
  const result = await db.query<{ payload: CurveLaunchRegistration }>(
    `SELECT l.payload FROM rmt_curve_production_launches l
     JOIN rmt_curve_production_bindings b ON b.scope = l.scope
     JOIN rmt_curve_production_checkpoints c ON c.scope = b.scope AND c.block_number = $2
     WHERE l.scope = $1 AND c.block_number = $2 AND c.block_hash = $3
       AND l.block_number <= $2 AND ($4::text IS NULL OR l.token = $4) AND ($5::text IS NULL OR l.token > $5)
     ORDER BY l.token LIMIT $6`, [scope, checkpoint.blockNumber, checkpoint.blockHash,
      token?.toLowerCase() ?? null, after?.toLowerCase() ?? null, limit]);
  return result.rows.map(({ payload }) => payload);
}

/** Uses only the existing namespaced registrations/checkpoints. Pagination
 * stays anchored while new blocks arrive, and fails closed after reorg/restore.
 * Caller supplies a REPEATABLE READ READ ONLY transaction and checks revision. */
export async function readProductionCurveEarnings(db: Database, scope: string, current: BlockEvidence,
  query: { recipient: string; operatingRecipient: string; reserveRecipient: string; limit: number; cursor?: EarningsDiscoveryCursor; token?: string }) {
  if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 51) throw new Error("Earnings page exceeds its bound");
  if (query.cursor && (query.cursor.scope !== scope || query.cursor.recipient !== query.recipient.toLowerCase())) {
    throw new Error("Earnings cursor deployment or beneficiary mismatch");
  }
  const anchor = query.cursor ?? current;
  const anchored = await db.query<{ block_number: string; block_hash: BlockEvidence["blockHash"]; observed_at: Date }>(
    `SELECT c.block_number::text, c.block_hash, c.observed_at
     FROM rmt_curve_production_checkpoints c JOIN rmt_curve_production_bindings b ON b.scope = c.scope
     WHERE c.scope = $1 AND c.block_number = $2 AND c.block_hash = $3 AND b.next_block > c.block_number`,
    [scope, anchor.blockNumber, anchor.blockHash]);
  const point = anchored.rows[0];
  if (!point) throw new Error("Earnings cursor checkpoint is unavailable, reorged or restored");
  const checkpoint = { blockNumber: point.block_number, blockHash: point.block_hash, timestamp: point.observed_at.toISOString() };
  const result = await db.query<{ payload: CurveLaunchRegistration }>(
    `SELECT l.payload FROM rmt_curve_production_launches l
     WHERE l.scope = $1 AND l.block_number <= $2 AND ($3::text IS NULL OR l.token > $3)
       AND (lower(l.payload->>'creator') = $4 OR lower(l.payload->>'treasury') = $4 OR $4 = $5 OR $4 = $6)
       AND ($8::text IS NULL OR l.token = $8)
     ORDER BY l.token LIMIT $7`, [scope, checkpoint.blockNumber, query.cursor?.after ?? null,
      query.recipient.toLowerCase(), query.operatingRecipient.toLowerCase(), query.reserveRecipient.toLowerCase(), query.limit,
      query.token?.toLowerCase() ?? null]);
  return { checkpoint, launches: result.rows.map(row => row.payload) };
}
