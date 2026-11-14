import type { Client } from "pg";
import { lockIndexWriter } from "./index-store.js";
import { curveFixtureProfile } from "./curve-fixture-config.js";
import { fixtureConfirmations, type BlockEvidence, type CurveFixtureBinding, type CurveLaunchRegistration } from "./curve-launch-evidence.js";
import type { FixtureCursor, FixtureGraduation, FixtureGraduationBinding, FixtureLifecycleState, FixtureTrade } from "./curve-fixture-lifecycle.js";
import type { FixturePostCursor, FixturePostEvent, FixturePostState } from "./curve-fixture-post-graduation.js";

type Database = Pick<Client, "query">;
type Scope = [number, string, string];
const markerTable = "rmt_curve_fixture_marker";
const scopePredicate = "chain_id = $1 AND factory = $2 AND deployment_block_hash = $3";
const scopedTokenMatch = (row: string) => `${row}.chain_id = launch.chain_id AND ${row}.factory = launch.factory
    AND ${row}.deployment_block_hash = launch.deployment_block_hash AND ${row}.token = launch.token`;
const approvedTables = new Set([markerTable, "rmt_curve_fixture_binding", "rmt_curve_fixture_checkpoints", "rmt_curve_fixture_launches",
  "rmt_curve_fixture_trades", "rmt_curve_fixture_graduations", "rmt_curve_fixture_states", "rmt_curve_fixture_post_events"]);
const lifecycleColumns = `
    chain_id integer NOT NULL CHECK (chain_id = 31337),
    factory text NOT NULL,
    deployment_block_hash text NOT NULL,
    token text NOT NULL,
    block_number bigint NOT NULL,
    block_hash text NOT NULL,
    payload jsonb NOT NULL,
    FOREIGN KEY (chain_id, factory, deployment_block_hash, token)
      REFERENCES rmt_curve_fixture_launches (chain_id, factory, deployment_block_hash, token) ON DELETE CASCADE,
    FOREIGN KEY (chain_id, factory, deployment_block_hash, block_number, block_hash)
      REFERENCES rmt_curve_fixture_checkpoints (chain_id, factory, deployment_block_hash, block_number, block_hash) ON DELETE CASCADE
`;
const eventColumns = `
    transaction_hash text NOT NULL,
    log_index integer NOT NULL CHECK (log_index >= 0),
    UNIQUE (chain_id, factory, deployment_block_hash, transaction_hash, log_index),
    UNIQUE (chain_id, factory, deployment_block_hash, block_number, log_index)
`;
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
  CREATE TABLE IF NOT EXISTS rmt_curve_fixture_trades (
    ${lifecycleColumns}, ${eventColumns},
    PRIMARY KEY (chain_id, factory, deployment_block_hash, token, block_number, log_index)
  );
  CREATE TABLE IF NOT EXISTS rmt_curve_fixture_graduations (
    ${lifecycleColumns}, ${eventColumns},
    PRIMARY KEY (chain_id, factory, deployment_block_hash, token)
  );
  CREATE TABLE IF NOT EXISTS rmt_curve_fixture_states (
    ${lifecycleColumns},
    PRIMARY KEY (chain_id, factory, deployment_block_hash, token, block_number)
  );
  CREATE TABLE IF NOT EXISTS rmt_curve_fixture_post_events (
    ${lifecycleColumns}, ${eventColumns},
    PRIMARY KEY (chain_id, factory, deployment_block_hash, token, block_number, log_index)
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
export async function initializeCurveFixtureStore(writer: Database, databaseName: string, binding: CurveFixtureBinding, graduation: FixtureGraduationBinding) {
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
  const snapshot = JSON.stringify({ ...binding, schemaRevision: 38, graduationEngine: graduation.graduationEngine.toLowerCase(),
    graduationHash: graduation.graduationHash.toLowerCase(), guard: graduation.guard.toLowerCase(), guardHash: graduation.guardHash.toLowerCase(),
    factory: binding.factory.toLowerCase(), projectRegistry: binding.projectRegistry.toLowerCase(),
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

type ScopedEvent<T> = { token: string; evidence: T };
export type CurveFixtureRange = {
  blocks: BlockEvidence[];
  launches: CurveLaunchRegistration[];
  trades: ScopedEvent<FixtureTrade>[];
  graduations: ScopedEvent<FixtureGraduation>[];
  postEvents: ScopedEvent<FixturePostEvent>[];
  states: ScopedEvent<FixtureLifecycleState & { postGraduation?: FixturePostState }>[];
};

export async function loadCurveFixtureCursors(db: Database, scope: Scope): Promise<FixturePostCursor[]> {
  const result = await db.query<{ payload: CurveLaunchRegistration; gross_fees: string; latest: FixtureTrade | null;
    graduation: FixtureGraduation | null; post_events: FixturePostEvent[] }>(
    `SELECT launch.payload,
      coalesce((SELECT sum((trade.payload->>'feeWei')::numeric) FROM rmt_curve_fixture_trades AS trade
       WHERE ${scopedTokenMatch("trade")}), 0)::text AS gross_fees,
      (SELECT trade.payload FROM rmt_curve_fixture_trades AS trade WHERE ${scopedTokenMatch("trade")}
       ORDER BY trade.block_number DESC, trade.log_index DESC LIMIT 1) AS latest,
      (SELECT g.payload FROM rmt_curve_fixture_graduations AS g WHERE ${scopedTokenMatch("g")}) AS graduation,
      coalesce((SELECT json_agg(recent.payload ORDER BY recent.block_number, recent.log_index)
        FROM (SELECT event.payload, event.block_number, event.log_index FROM rmt_curve_fixture_post_events AS event
          WHERE ${scopedTokenMatch("event")} ORDER BY event.block_number, event.log_index LIMIT 257) AS recent), '[]'::json) AS post_events
     FROM rmt_curve_fixture_launches AS launch WHERE ${scopePredicate} LIMIT 26`, scope);
  if (result.rows.length > 25) throw new Error("Fixture lifecycle launch bound exceeded");
  return result.rows.map(({ payload, gross_fees, latest, graduation, post_events }) => {
    if (post_events.length > 256 || (!graduation && post_events.length !== 0)) throw new Error("Fixture post-graduation event history invalid");
    return { launch: payload, grossFees: BigInt(gross_fees), latestTrade: latest ?? undefined,
      graduation: graduation ?? undefined, postEvents: post_events };
  });
}

export async function commitCurveFixtureRange(db: Database, scope: Scope, range: CurveFixtureRange) {
  await inTransaction(db, async () => {
    for (const block of range.blocks) {
      await db.query(`INSERT INTO rmt_curve_fixture_checkpoints
        (chain_id, factory, deployment_block_hash, block_number, block_hash, observed_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      [...scope, block.blockNumber, block.blockHash.toLowerCase(), block.timestamp]);
    }
    for (const launch of range.launches) {
      const { blockNumber, blockHash, transactionHash, logIndex } = launch.creation;
      await db.query(`INSERT INTO rmt_curve_fixture_launches
        (chain_id, factory, deployment_block_hash, token, block_number, block_hash, transaction_hash, log_index, payload)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [...scope, launch.token.toLowerCase(), blockNumber, blockHash.toLowerCase(),
        transactionHash.toLowerCase(), logIndex, JSON.stringify(launch)]);
    }
    const eventGroups = [
      ["rmt_curve_fixture_trades", range.trades],
      ["rmt_curve_fixture_graduations", range.graduations],
      ["rmt_curve_fixture_post_events", range.postEvents],
    ] as const;
    for (const [table, events] of eventGroups) {
      for (const { token, evidence } of events) {
        const { blockNumber, blockHash, transactionHash, logIndex } = evidence;
        await db.query(`INSERT INTO ${table}
          (chain_id, factory, deployment_block_hash, token, block_number, block_hash, transaction_hash, log_index, payload)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [...scope, token.toLowerCase(), blockNumber, blockHash.toLowerCase(), transactionHash.toLowerCase(), logIndex, JSON.stringify(evidence)]);
      }
    }
    for (const { token, evidence } of range.states) {
      const { blockNumber, blockHash } = evidence.observed;
      const stored = await db.query(`INSERT INTO rmt_curve_fixture_states
        (chain_id, factory, deployment_block_hash, token, block_number, block_hash, payload) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (chain_id, factory, deployment_block_hash, token, block_number) DO UPDATE SET block_hash = EXCLUDED.block_hash
        WHERE rmt_curve_fixture_states.block_hash = EXCLUDED.block_hash AND rmt_curve_fixture_states.payload = EXCLUDED.payload`,
      [...scope, token.toLowerCase(), blockNumber, blockHash.toLowerCase(), JSON.stringify(evidence)]);
      if (stored.rowCount !== 1) throw new Error("Fixture snapshot conflicts with canonical checkpoint");
    }
  });
}

export async function readCurveFixtureRows(db: Database, scope: Scope, checkpoint: BlockEvidence, token?: string) {
  const result = await db.query<{ payload: CurveLaunchRegistration; token: string; block_number: string; block_hash: string;
    transaction_hash: string; log_index: number; state: FixtureLifecycleState & { postGraduation?: FixturePostState } | null;
    trades: FixtureTrade[]; post_events: FixturePostEvent[] }>(
    `SELECT launch.payload, token, block_number, block_hash, transaction_hash, log_index,
      (SELECT state.payload FROM rmt_curve_fixture_states AS state
       WHERE ${scopedTokenMatch("state")} AND state.block_number = $4 AND state.block_hash = $6) AS state,
      CASE WHEN $5::text IS NULL THEN '[]'::json ELSE coalesce((SELECT json_agg(recent.payload ORDER BY recent.block_number DESC, recent.log_index DESC)
        FROM (SELECT trade.payload, trade.block_number, trade.log_index FROM rmt_curve_fixture_trades AS trade
          WHERE ${scopedTokenMatch("trade")} AND trade.block_number <= $4
          ORDER BY trade.block_number DESC, trade.log_index DESC LIMIT 25) AS recent), '[]'::json) END AS trades,
      CASE WHEN $5::text IS NULL THEN '[]'::json ELSE coalesce((SELECT json_agg(recent.payload ORDER BY recent.block_number DESC, recent.log_index DESC)
        FROM (SELECT event.payload, event.block_number, event.log_index FROM rmt_curve_fixture_post_events AS event
          WHERE ${scopedTokenMatch("event")} AND event.block_number <= $4
          ORDER BY event.block_number DESC, event.log_index DESC LIMIT 20) AS recent), '[]'::json) END AS post_events
     FROM rmt_curve_fixture_launches AS launch
     WHERE ${scopePredicate} AND block_number <= $4 AND ($5::text IS NULL OR token = $5)
     ORDER BY block_number DESC, log_index DESC LIMIT 25`, [...scope, checkpoint.blockNumber, token ?? null, checkpoint.blockHash.toLowerCase()]);
  return result.rows.map(({ payload, token: rowToken, block_number, block_hash, transaction_hash, log_index, state, trades, post_events }) => {
    if (payload.chainId !== scope[0] || payload.factory.toLowerCase() !== scope[1] || payload.token.toLowerCase() !== rowToken
        || payload.creation.blockNumber !== block_number || payload.creation.blockHash.toLowerCase() !== block_hash
        || payload.creation.transactionHash.toLowerCase() !== transaction_hash || payload.creation.logIndex !== log_index
        || !state || (state.phase === "graduated") !== Boolean(state.postGraduation) || state.observed.blockNumber !== checkpoint.blockNumber
        || state.observed.blockHash.toLowerCase() !== checkpoint.blockHash.toLowerCase()) {
      throw new Error("Fixture row identity mismatch");
    }
    const { postGraduation, ...lifecycle } = state;
    return { ...payload, lifecycle: { ...lifecycle, trades,
      ...(token && postGraduation ? { postGraduation: { ...postGraduation, events: post_events } } : {}) } };
  });
}
