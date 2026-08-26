import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { sourceCodeForId } from "./compact-storage.js";
import {
  MARKET_INDEXER_CHAIN_ID,
  MARKET_INDEXER_MIGRATION_SCHEMA_VERSION,
  MARKET_INDEXER_SCHEMA_VERSION,
  MARKET_SOURCE_MANIFEST_HASH,
  marketSources
} from "./sources.js";

export const COMPACT_POOL_BYTES_PER_ROW = 268.30848;
export const TEMP_WAL_SAFETY_RESERVE_BYTES = 32 * 1024 * 1024;
export const EMPTY_STAGING_SAFETY_ALLOWANCE_BYTES = 1024 * 1024;
export const MIGRATION_WARNING_BPS = 8_000;
export const REVIEWED_DATABASE_LIMIT_BYTES = 367_001_600;
const COPY_BUILD_ALLOWANCE_BPS = 1_000;
const MIN_SUPPORT_COPY_BYTES = 1024 * 1024;
const MIGRATION_LOCK_A = MARKET_INDEXER_CHAIN_ID;
const MIGRATION_LOCK_B = 421;
const MIGRATION_STATE_TABLE = "market_indexer_compact_migration_state";
const STAGING_RELATIONS = [
  "market_pools_compact_v3",
  "market_pool_state_compact_v3",
  "market_indexer_sync_points_compact_v3"
] as const;
const OLD_RELATIONS = [
  "market_pools_v2_old",
  "market_pool_state_v2_old",
  "market_indexer_sync_points_v2_old"
] as const;
const ARTIFACTS = [
  MIGRATION_STATE_TABLE,
  ...STAGING_RELATIONS,
  ...OLD_RELATIONS
] as const;

export type CompactMigrationPhase =
  | "V2_CLEAN"
  | "V3_STAGING_PREPARED"
  | "V2_INDEXES_PREDROPPED"
  | "V2_ROLLBACK_INDEXES_REQUIRED"
  | "V3_STAGING_POPULATED"
  | "V3_CUTOVER_MARKER_3001"
  | "V3_OLD_RELATIONS_PRESENT"
  | "V3_OLD_RELATIONS_CLEANED"
  | "V3_FINALIZED"
  | "UNKNOWN_UNSAFE";

export type CompactMigrationRecoveryMode =
  | "RESUME_PRE_CUTOVER"
  | "ROLLBACK_TO_V2"
  | "RESUME_VALIDATED_CUTOVER"
  | "FINALIZE_CLEANED_V3";

export type CompactMigrationStatus = Readonly<{
  phase: CompactMigrationPhase;
  schemaVersion: number | null;
  databaseBytes: number;
  poolCount: number;
  oldRelationsPresent: boolean;
  compactRelationsPresent: boolean;
  checkpointEquality: boolean | null;
  restartEligible: boolean;
}>;

export type CompactMigrationSafety = Readonly<{
  writerStopped: true;
  shadowMode: true;
  authoritative: false;
  servingProductionTraffic: false;
  activationLocked: true;
  oldRelationCleanupAuthorized: boolean;
  configuredLimitBytes: number;
}>;

export type CompactMigrationFailurePoint =
  | "after-source-code-addition"
  | "after-empty-stage"
  | "after-predrop"
  | "after-populate"
  | "after-stage"
  | "after-cutover"
  | "after-cutover-validation"
  | "after-old-cleanup";

export type CompactMigrationRunOptions = Readonly<{
  failurePoint?: CompactMigrationFailurePoint;
  abruptLoss?: boolean;
}>;

type SourceSnapshot = {
  sourceId: string;
  startBlock: string;
  nextBlock: string;
  status: string;
  lastSyncAt: string | null;
  manifestHash: string;
  schemaVersion: number;
};

export type CompactMigrationPreflight = Readonly<{
  logicalBytes: number;
  poolCount: number;
  oldPoolIndexBytes: number;
  supportCopyBytes: number;
  projectedCompactBytes: number;
  projectedPeakBytes: number;
  projectedPeakPercent: number;
  projectedMinHeadroomBytes: number;
  warningThresholdBytes: number;
  safe: boolean;
  storageMode: "durable" | "rebuildable";
  checkpoints: readonly SourceSnapshot[];
}>;

export type CompactMigrationResult = Readonly<{
  preflight: CompactMigrationPreflight;
  preparedBytes: number;
  afterPredropBytes: number;
  stagedBytes: number;
  postCleanupBytes: number;
  actualPeakBytes: number;
  reclaimedBytes: number;
  poolCount: number;
  syncPointCount: number;
  stateCount: number;
}>;

type OldConstraintContract = {
  poolPrimary: string;
  poolEvent: string;
  stateForeignKey: string;
};

type PersistedMigrationState = {
  phase: Exclude<CompactMigrationPhase, "V2_CLEAN" | "V3_FINALIZED" | "UNKNOWN_UNSAFE">;
  checkpointDigest: string;
  baselineDatabaseBytes: number;
  baselinePoolCount: number;
  storageMode: "durable" | "rebuildable";
  compactEvidenceFingerprint: string | null;
};

class SyntheticAbruptLoss extends Error {}

function integer(value: string | number | undefined, label: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`PostgreSQL returned invalid ${label}`);
  }
  return parsed;
}

function identifier(value: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(value)) throw new Error("unsafe PostgreSQL identifier");
  return `"${value}"`;
}

async function databaseBytes(client: PoolClient) {
  const result = await client.query<{ bytes: string }>(
    "SELECT pg_database_size(current_database())::text AS bytes"
  );
  return integer(result.rows[0]?.bytes, "database size");
}

async function checkpointSnapshot(client: PoolClient) {
  const result = await client.query<{
    source_id: string;
    start_block: string;
    next_block: string;
    status: string;
    last_sync_at: Date | string | null;
    manifest_hash: string;
    schema_version: number;
  }>(
    `SELECT source_id, start_block::text, next_block::text, status, last_sync_at,
            manifest_hash, schema_version
     FROM market_indexer_source_state WHERE chain_id = $1 ORDER BY source_id`,
    [MARKET_INDEXER_CHAIN_ID]
  );
  return result.rows.map((row): SourceSnapshot => ({
    sourceId: row.source_id,
    startBlock: row.start_block,
    nextBlock: row.next_block,
    status: row.status,
    lastSyncAt: row.last_sync_at === null ? null : new Date(row.last_sync_at).toISOString(),
    manifestHash: row.manifest_hash,
    schemaVersion: row.schema_version
  }));
}

function checkpointIdentity(snapshot: readonly SourceSnapshot[]) {
  return JSON.stringify(snapshot);
}

function checkpointDigest(snapshot: readonly SourceSnapshot[]) {
  const normalized = snapshot.map((row) => ({ ...row, schemaVersion: 2 }));
  return createHash("sha256").update(checkpointIdentity(normalized)).digest("hex");
}

async function relationNames(client: PoolClient, names: readonly string[]) {
  const result = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY($1::text[])
     ORDER BY c.relname`,
    [[...names]]
  );
  return result.rows.map((row) => row.name);
}

async function relationSetIsExact(client: PoolClient, names: readonly string[]) {
  const present = await relationNames(client, names);
  return present.length === names.length && names.every((name) => present.includes(name));
}

async function publicRelationsAreExact(client: PoolClient, names: readonly string[]) {
  const result = await client.query<{ name: string }>(
    `SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`
  );
  const present = result.rows.map((row) => row.name);
  return present.length === names.length && names.every((name) => present.includes(name));
}

const CURRENT_RELATIONS = [
  "market_indexer_source_state",
  "market_indexer_sync_points",
  "market_pools",
  "market_pool_state"
] as const;
const CURRENT_ADDITIVE_RELATIONS = [
  "market_token_identity_catalog_state",
  "market_token_identity_shard"
] as const;

async function finalizedPublicRelationsAreExact(client: PoolClient) {
  return await publicRelationsAreExact(client, CURRENT_RELATIONS) ||
    await publicRelationsAreExact(client, [...CURRENT_RELATIONS, ...CURRENT_ADDITIVE_RELATIONS]);
}

async function sourceCodeColumnPresent(client: PoolClient) {
  const result = await client.query<{ present: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='market_indexer_source_state'
        AND column_name='source_code') AS present`
  );
  return result.rows[0]?.present === true;
}

async function currentPoolLayout(client: PoolClient) {
  const result = await client.query<{ source_code: boolean; source_id: boolean; pool_key_type: string | null }>(
    `SELECT
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='market_pools' AND column_name='source_code') AS source_code,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='market_pools' AND column_name='source_id') AS source_id,
      (SELECT udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name='market_pools' AND column_name='pool_key') AS pool_key_type`
  );
  const row = result.rows[0];
  if (row?.source_code && !row.source_id && row.pool_key_type === "bytea") return "compact" as const;
  if (!row?.source_code && row?.source_id && row.pool_key_type === "text") return "v2" as const;
  return "unknown" as const;
}

async function uniformSchemaVersion(client: PoolClient) {
  const table = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public.market_indexer_source_state') IS NOT NULL AS present"
  );
  if (!table.rows[0]?.present) return null;
  const result = await client.query<{ minimum: number | null; maximum: number | null; count: string }>(
    `SELECT MIN(schema_version) AS minimum,MAX(schema_version) AS maximum,COUNT(*)::text AS count
     FROM market_indexer_source_state WHERE chain_id=$1`,
    [MARKET_INDEXER_CHAIN_ID]
  );
  const row = result.rows[0];
  return row && row.count === String(marketSources.length) && row.minimum === row.maximum
    ? row.minimum
    : null;
}

async function v2ProtectionState(client: PoolClient) {
  if (await currentPoolLayout(client) !== "v2") return "invalid" as const;
  const indexes = await client.query<{ name: string }>(
    `SELECT indexname AS name FROM pg_indexes
     WHERE schemaname='public' AND tablename IN ('market_pools','market_pool_state')
     ORDER BY indexname`
  );
  const names = new Set(indexes.rows.map((row) => row.name));
  const required = [
    "market_pools_pkey",
    "market_pools_chain_id_transaction_hash_log_index_key",
    "market_pools_tokens_idx",
    "market_pools_block_idx",
    "market_pool_state_pkey",
    "market_pool_state_refresh_idx"
  ];
  const foreignKey = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM pg_constraint
     WHERE conrelid='market_pool_state'::regclass AND contype='f'
       AND pg_get_constraintdef(oid) LIKE '%(chain_id, source_id, pool_key)%'`
  );
  const full = names.size === required.length && required.every((name) => names.has(name)) &&
    foreignKey.rows[0]?.count === "1";
  const removed = names.size === 1 && names.has("market_pool_state_pkey") &&
    foreignKey.rows[0]?.count === "0";
  return full ? "full" as const : removed ? "removed" as const : "invalid" as const;
}

async function compactRelationsValid(
  client: PoolClient,
  names: { pools: string; state: string; sync: string }
) {
  if (!await relationSetIsExact(client, [names.pools, names.state, names.sync])) return false;
  const columns = await client.query<{ table_name: string; column_name: string; udt_name: string }>(
    `SELECT table_name,column_name,udt_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=ANY($1::text[])
     ORDER BY table_name,ordinal_position`,
    [[names.pools, names.state, names.sync]]
  );
  const poolColumns = columns.rows.filter((row) => row.table_name === names.pools)
    .map((row) => `${row.column_name}:${row.udt_name}`);
  if (poolColumns.join(",") !== [
    "source_code:int2", "pool_key:bytea", "token0:bytea", "token1:bytea",
    "attributes:bytea", "provenance:bytea", "block_number:int4", "log_index:int4"
  ].join(",")) return false;
  const constraints = await client.query<{ table_name: string; kind: string; definition: string }>(
    `SELECT conrelid::regclass::text AS table_name,contype::text AS kind,
            pg_get_constraintdef(oid) AS definition
     FROM pg_constraint WHERE conrelid IN ($1::regclass,$2::regclass,$3::regclass)`,
    [names.pools, names.state, names.sync]
  );
  const on = (table: string, kind: string, fragments: string[]) => constraints.rows.some((row) =>
    row.table_name === table && row.kind === kind && fragments.every((fragment) => row.definition.includes(fragment))
  );
  return on(names.pools, "p", ["source_code", "pool_key"]) &&
    on(names.pools, "u", ["block_number", "log_index"]) &&
    on(names.pools, "f", ["source_code", "market_indexer_source_state"]) &&
    on(names.state, "p", ["source_code", "pool_key"]) &&
    on(names.state, "f", ["source_code", "pool_key", names.pools]) &&
    on(names.sync, "p", ["source_code", "block_number"]) &&
    on(names.sync, "f", ["source_code", "market_indexer_source_state"]);
}

async function stagingRelationsValid(client: PoolClient) {
  return compactRelationsValid(client, {
    pools: "market_pools_compact_v3",
    state: "market_pool_state_compact_v3",
    sync: "market_indexer_sync_points_compact_v3"
  });
}

async function currentCompactRelationsValid(client: PoolClient) {
  return compactRelationsValid(client, {
    pools: "market_pools",
    state: "market_pool_state",
    sync: "market_indexer_sync_points"
  });
}

async function assertNoArtifacts(client: PoolClient) {
  const result = await client.query<{ name: string }>(
    `SELECT c.relname AS name
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
    [ARTIFACTS]
  );
  if (result.rows.length > 0) {
    throw new Error("compact migration artifacts already exist; writer must remain stopped");
  }
}

async function persistedMigrationState(client: PoolClient): Promise<PersistedMigrationState | null> {
  const present = await relationSetIsExact(client, [MIGRATION_STATE_TABLE]);
  if (!present) return null;
  const result = await client.query<{
    phase: PersistedMigrationState["phase"];
    checkpoint_digest: string;
    baseline_database_bytes: string;
    baseline_pool_count: string;
    storage_mode: "durable" | "rebuildable";
    compact_evidence_fingerprint: string | null;
  }>(`SELECT phase,checkpoint_digest,baseline_database_bytes::text,baseline_pool_count::text,
            storage_mode,compact_evidence_fingerprint
       FROM ${MIGRATION_STATE_TABLE} WHERE singleton=true`);
  if (result.rows.length !== 1) throw new Error("compact migration state is ambiguous");
  const row = result.rows[0]!;
  if (!/^[0-9a-f]{64}$/.test(row.checkpoint_digest) ||
      !["durable", "rebuildable"].includes(row.storage_mode)) {
    throw new Error("compact migration state is malformed");
  }
  return {
    phase: row.phase,
    checkpointDigest: row.checkpoint_digest,
    baselineDatabaseBytes: integer(row.baseline_database_bytes, "migration baseline size"),
    baselinePoolCount: integer(row.baseline_pool_count, "migration baseline pool count"),
    storageMode: row.storage_mode,
    compactEvidenceFingerprint: row.compact_evidence_fingerprint
  };
}

async function setPersistedPhase(
  client: PoolClient,
  expected: PersistedMigrationState["phase"],
  next: PersistedMigrationState["phase"],
  compactEvidenceFingerprint?: string
) {
  const result = await client.query(
    `UPDATE ${MIGRATION_STATE_TABLE}
     SET phase=$1,compact_evidence_fingerprint=COALESCE($2,compact_evidence_fingerprint),updated_at=NOW()
     WHERE singleton=true AND phase=$3`,
    [next, compactEvidenceFingerprint ?? null, expected]
  );
  if (result.rowCount !== 1) throw new Error("compact migration phase changed unexpectedly");
}

async function assertCheckpointEquality(client: PoolClient, state: PersistedMigrationState) {
  if (checkpointDigest(await checkpointSnapshot(client)) !== state.checkpointDigest) {
    throw new Error("source checkpoints moved while writer was required to be stopped");
  }
}

async function compactEvidenceFingerprint(client: PoolClient, tableName: string) {
  identifier(tableName);
  const staging = tableName === "market_pools_compact_v3";
  const stateTable = staging ? "market_pool_state_compact_v3" : "market_pool_state";
  const syncTable = staging ? "market_indexer_sync_points_compact_v3" : "market_indexer_sync_points";
  const result = await client.query<{
    source_code: number;
    count: string;
    first_half: string;
    second_half: string;
  }>(`SELECT source_code,COUNT(*)::text AS count,
      COALESCE(SUM((('x'||substring(md5(
        encode(pool_key,'hex')||encode(token0,'hex')||encode(token1,'hex')||
        COALESCE(encode(attributes,'hex'),'')||encode(provenance,'hex')||
        block_number::text||':'||log_index::text
      ) FROM 1 FOR 16))::bit(64)::bigint)::numeric),0)::text AS first_half,
      COALESCE(SUM((('x'||substring(md5(
        encode(pool_key,'hex')||encode(token0,'hex')||encode(token1,'hex')||
        COALESCE(encode(attributes,'hex'),'')||encode(provenance,'hex')||
        block_number::text||':'||log_index::text
      ) FROM 17 FOR 16))::bit(64)::bigint)::numeric),0)::text AS second_half
    FROM ${identifier(tableName)} GROUP BY source_code ORDER BY source_code`);
  const state = await client.query<{ source_code: number; count: string; digest_sum: string }>(
    `SELECT source_code,COUNT(*)::text AS count,
      COALESCE(SUM((('x'||substring(md5(concat_ws('|',
        encode(pool_key,'hex'),status,COALESCE(live_fee::text,'<null>'),
        COALESCE(fee_denominator::text,'<null>'),COALESCE(encode(gauge_address,'hex'),'<null>'),
        COALESCE(gauge_alive::text,'<null>'),COALESCE(gauge_weight::text,'<null>'),
        COALESCE(gauge_claimable::text,'<null>'),COALESCE(encode(fees_address,'hex'),'<null>'),
        COALESCE(encode(bribe_address,'hex'),'<null>'),COALESCE(last_error,'<null>'),
        observed_block::text,encode(observed_block_hash,'hex'),observed_at::text
      )) FROM 1 FOR 16))::bit(64)::bigint)::numeric),0)::text AS digest_sum
     FROM ${identifier(stateTable)} GROUP BY source_code ORDER BY source_code`
  );
  const sync = await client.query<{ source_code: number; count: string; digest_sum: string }>(
    `SELECT source_code,COUNT(*)::text AS count,
      COALESCE(SUM((('x'||substring(md5(
        block_number::text||':'||encode(provenance,'hex')
      ) FROM 1 FOR 16))::bit(64)::bigint)::numeric),0)::text AS digest_sum
     FROM ${identifier(syncTable)} GROUP BY source_code ORDER BY source_code`
  );
  return createHash("sha256").update(JSON.stringify({
    pools: result.rows,
    state: state.rows,
    sync: sync.rows
  })).digest("hex");
}

async function assertExactV2Sources(client: PoolClient) {
  const snapshot = await checkpointSnapshot(client);
  const expected = [...marketSources].sort((a, b) => a.id.localeCompare(b.id));
  if (
    snapshot.length !== expected.length ||
    snapshot.some((row, index) =>
      row.sourceId !== expected[index]!.id ||
      row.startBlock !== expected[index]!.startBlock.toString() ||
      row.manifestHash !== MARKET_SOURCE_MANIFEST_HASH ||
      row.schemaVersion !== 2
    )
  ) throw new Error("migration requires the exact reviewed seven-source schema v2 snapshot");
  const manifestRows = await client.query<{
    source_id: string;
    protocol: string;
    protocol_version: number;
    source_kind: string;
    contract_address: string;
    runtime_code_hash: string;
    deployment_transaction: string;
  }>(
    `SELECT source_id,protocol,protocol_version,source_kind,contract_address,
            runtime_code_hash,deployment_transaction
     FROM market_indexer_source_state WHERE chain_id=$1 ORDER BY source_id`,
    [MARKET_INDEXER_CHAIN_ID]
  );
  if (manifestRows.rows.some((row, index) => {
    const source = expected[index]!;
    return row.source_id !== source.id || row.protocol !== source.protocol ||
      row.protocol_version !== source.version || row.source_kind !== source.kind ||
      row.contract_address !== source.contract.toLowerCase() ||
      row.runtime_code_hash !== source.runtimeCodeHash ||
      row.deployment_transaction !== source.deploymentTransaction;
  })) throw new Error("migration source/runtime manifest differs from reviewed seven-source contract");
  return snapshot;
}

async function storageMode(client: PoolClient) {
  const result = await client.query<{ relname: string; relpersistence: string }>(
    `SELECT c.relname, c.relpersistence FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname = ANY($1::text[]) ORDER BY c.relname`,
    [["market_indexer_source_state", "market_indexer_sync_points", "market_pools", "market_pool_state"]]
  );
  if (result.rows.length !== 4 || new Set(result.rows.map((row) => row.relpersistence)).size !== 1) {
    throw new Error("market indexer v2 storage mode is incomplete or mixed");
  }
  return result.rows[0]!.relpersistence === "u" ? "rebuildable" as const : "durable" as const;
}

async function oldConstraintContract(client: PoolClient): Promise<OldConstraintContract> {
  const result = await client.query<{ table_name: string; name: string; kind: string; definition: string }>(
    `SELECT con.conrelid::regclass::text AS table_name, con.conname AS name,
            con.contype::text AS kind, pg_get_constraintdef(con.oid) AS definition
     FROM pg_constraint con
     WHERE con.conrelid IN ('market_pools'::regclass, 'market_pool_state'::regclass)
     ORDER BY table_name, name`
  );
  const find = (tableName: string, kind: string, fragments: string[]) => {
    const rows = result.rows.filter((row) =>
      row.table_name === tableName && row.kind === kind && fragments.every((fragment) => row.definition.includes(fragment))
    );
    if (rows.length !== 1) throw new Error(`reviewed v2 constraint not found for ${tableName}`);
    identifier(rows[0]!.name);
    return rows[0]!.name;
  };
  return {
    poolPrimary: find("market_pools", "p", ["PRIMARY KEY", "chain_id", "source_id", "pool_key"]),
    poolEvent: find("market_pools", "u", ["UNIQUE", "chain_id", "transaction_hash", "log_index"]),
    stateForeignKey: find("market_pool_state", "f", ["FOREIGN KEY", "chain_id", "source_id", "pool_key", "market_pools"])
  };
}

async function oldIndexBytes(client: PoolClient) {
  const result = await client.query<{ name: string; bytes: string; definition: string }>(
    `SELECT indexrelid::regclass::text AS name,
            pg_relation_size(indexrelid)::text AS bytes,
            pg_get_indexdef(indexrelid) AS definition
     FROM pg_index WHERE indrelid = 'market_pools'::regclass ORDER BY name`
  );
  const names = new Set(result.rows.map((row) => row.name));
  for (const required of [
    "market_pools_pkey",
    "market_pools_chain_id_transaction_hash_log_index_key",
    "market_pools_tokens_idx",
    "market_pools_block_idx"
  ]) if (!names.has(required)) throw new Error(`reviewed v2 index ${required} is missing`);
  if (result.rows.length !== 4) throw new Error("unexpected market_pools index set");
  const tokens = result.rows.find((row) => row.name === "market_pools_tokens_idx")!;
  const blocks = result.rows.find((row) => row.name === "market_pools_block_idx")!;
  if (!tokens.definition.includes("(chain_id, token0, token1)")) throw new Error("v2 token index drift");
  if (!blocks.definition.includes("block_number DESC, transaction_index DESC, log_index DESC")) {
    throw new Error("v2 block index drift");
  }
  return result.rows.reduce((total, row) => total + integer(row.bytes, "pool index size"), 0);
}

async function relationBytes(client: PoolClient, names: string[]) {
  const result = await client.query<{ bytes: string }>(
    `SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::text AS bytes
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])`,
    [names]
  );
  return integer(result.rows[0]?.bytes, "relation size");
}

export async function preflightCompactMigration(
  client: PoolClient,
  safety: CompactMigrationSafety
): Promise<CompactMigrationPreflight> {
  assert.equal(safety.writerStopped, true, "writer-stop acknowledgement is required");
  assert.equal(safety.shadowMode, true, "migration requires shadow mode");
  assert.equal(safety.authoritative, false, "authoritative mode must remain false");
  assert.equal(safety.servingProductionTraffic, false, "production traffic must remain disabled");
  assert.equal(safety.activationLocked, true, "activation lock must remain enabled");
  if (!Number.isSafeInteger(safety.configuredLimitBytes) || safety.configuredLimitBytes <= 0) {
    throw new Error("configured logical database limit is required");
  }
  if (safety.configuredLimitBytes > REVIEWED_DATABASE_LIMIT_BYTES) {
    throw new Error("compact migration cannot raise the reviewed logical database limit");
  }
  await assertNoArtifacts(client);
  const checkpoints = await assertExactV2Sources(client);
  const mode = await storageMode(client);
  await oldConstraintContract(client);
  const logicalBytes = await databaseBytes(client);
  const poolResult = await client.query<{ count: string; max_block: string }>(
    "SELECT COUNT(*)::text AS count, COALESCE(MAX(block_number), 0)::text AS max_block FROM market_pools"
  );
  const indexBytes = await oldIndexBytes(client);
  const supportBytes = await relationBytes(client, ["market_indexer_sync_points", "market_pool_state"]);
  const poolCount = integer(poolResult.rows[0]?.count, "pool count");
  if (BigInt(poolResult.rows[0]?.max_block ?? "0") > 2_147_483_647n) {
    throw new Error("v2 pool block number exceeds compact schema v3");
  }
  const projectedCompactBytes = Math.ceil(
    poolCount * COMPACT_POOL_BYTES_PER_ROW * (10_000 + COPY_BUILD_ALLOWANCE_BPS) / 10_000
  );
  const supportCopyBytes = Math.max(supportBytes, MIN_SUPPORT_COPY_BYTES);
  const projectedCopyPeakBytes = logicalBytes - indexBytes + projectedCompactBytes +
    supportCopyBytes + TEMP_WAL_SAFETY_RESERVE_BYTES;
  const projectedPreparedPeakBytes = logicalBytes + EMPTY_STAGING_SAFETY_ALLOWANCE_BYTES;
  const projectedPeakBytes = Math.max(projectedCopyPeakBytes, projectedPreparedPeakBytes);
  const warningThresholdBytes = Math.floor(safety.configuredLimitBytes * MIGRATION_WARNING_BPS / 10_000);
  const projectedMinHeadroomBytes = safety.configuredLimitBytes - projectedPeakBytes;
  return Object.freeze({
    logicalBytes,
    poolCount,
    oldPoolIndexBytes: indexBytes,
    supportCopyBytes,
    projectedCompactBytes,
    projectedPeakBytes,
    projectedPeakPercent: Number((projectedPeakBytes / safety.configuredLimitBytes * 100).toFixed(2)),
    projectedMinHeadroomBytes,
    warningThresholdBytes,
    safe: projectedPeakBytes <= warningThresholdBytes && projectedMinHeadroomBytes >= TEMP_WAL_SAFETY_RESERVE_BYTES,
    storageMode: mode,
    checkpoints
  });
}

async function predropOldIndexes(client: PoolClient, contract: OldConstraintContract) {
  await client.query("BEGIN");
  try {
    await assertEmptyStaging(client);
    await client.query(`ALTER TABLE market_pool_state DROP CONSTRAINT ${identifier(contract.stateForeignKey)}`);
    await client.query("DROP INDEX market_pool_state_refresh_idx");
    await client.query(`ALTER TABLE market_pools DROP CONSTRAINT ${identifier(contract.poolPrimary)}`);
    await client.query(`ALTER TABLE market_pools DROP CONSTRAINT ${identifier(contract.poolEvent)}`);
    await client.query("DROP INDEX market_pools_tokens_idx");
    await client.query("DROP INDEX market_pools_block_idx");
    await setPersistedPhase(client, "V3_STAGING_PREPARED", "V2_INDEXES_PREDROPPED");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function addSourceCodes(client: PoolClient) {
  await client.query("ALTER TABLE market_indexer_source_state ADD COLUMN source_code SMALLINT");
  for (const source of marketSources) {
    await client.query(
      "UPDATE market_indexer_source_state SET source_code = $1 WHERE chain_id = $2 AND source_id = $3",
      [sourceCodeForId(source.id), MARKET_INDEXER_CHAIN_ID, source.id]
    );
  }
  await client.query("ALTER TABLE market_indexer_source_state ALTER COLUMN source_code SET NOT NULL");
  await client.query("ALTER TABLE market_indexer_source_state ADD CONSTRAINT market_indexer_source_state_source_code_key UNIQUE (source_code)");
  await client.query(`ALTER TABLE market_indexer_source_state
    ADD CONSTRAINT market_indexer_source_state_source_code_v3_check CHECK (
      (source_code = 1 AND source_id = 'sushiswap-v2' AND protocol = 'sushiswap' AND protocol_version = 2)
      OR (source_code = 2 AND source_id = 'sushiswap-v3' AND protocol = 'sushiswap' AND protocol_version = 3)
      OR (source_code = 3 AND source_id = 'uniswap-v2' AND protocol = 'uniswap' AND protocol_version = 2)
      OR (source_code = 4 AND source_id = 'uniswap-v3' AND protocol = 'uniswap' AND protocol_version = 3)
      OR (source_code = 5 AND source_id = 'uniswap-v4' AND protocol = 'uniswap' AND protocol_version = 4)
      OR (source_code = 6 AND source_id = 'up-v2' AND protocol = 'up' AND protocol_version = 2)
      OR (source_code = 7 AND source_id = 'up-cl' AND protocol = 'up' AND protocol_version = 3)
    )`);
}

function migrationStateSql() {
  return `CREATE TABLE ${MIGRATION_STATE_TABLE} (
    singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton),
    migration_version INTEGER NOT NULL CHECK(migration_version=3),
    phase TEXT NOT NULL CHECK(phase IN (
      'V3_STAGING_PREPARED','V2_INDEXES_PREDROPPED','V3_STAGING_POPULATED',
      'V2_ROLLBACK_INDEXES_REQUIRED','V3_CUTOVER_MARKER_3001',
      'V3_OLD_RELATIONS_PRESENT','V3_OLD_RELATIONS_CLEANED'
    )),
    checkpoint_digest TEXT NOT NULL CHECK(checkpoint_digest ~ '^[0-9a-f]{64}$'),
    baseline_database_bytes BIGINT NOT NULL CHECK(baseline_database_bytes>0),
    baseline_pool_count BIGINT NOT NULL CHECK(baseline_pool_count>=0),
    storage_mode TEXT NOT NULL CHECK(storage_mode IN ('durable','rebuildable')),
    compact_evidence_fingerprint TEXT CHECK(compact_evidence_fingerprint ~ '^[0-9a-f]{64}$'),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
}

function stagingSql(storageModeValue: "durable" | "rebuildable") {
  const p = storageModeValue === "rebuildable" ? "UNLOGGED " : "";
  return `
CREATE ${p}TABLE market_pools_compact_v3 (
  source_code SMALLINT NOT NULL REFERENCES market_indexer_source_state(source_code),
  pool_key BYTEA NOT NULL CHECK (octet_length(pool_key) IN (20,32)),
  token0 BYTEA NOT NULL CHECK (octet_length(token0)=20),
  token1 BYTEA NOT NULL CHECK (octet_length(token1)=20 AND token0<>token1),
  attributes BYTEA,
  provenance BYTEA NOT NULL CHECK (octet_length(provenance)=64),
  block_number INTEGER NOT NULL CHECK (block_number>=0),
  log_index INTEGER NOT NULL CHECK (log_index>=0),
  CONSTRAINT market_pools_compact_v3_pkey PRIMARY KEY(source_code,pool_key) WITH (fillfactor=100),
  CONSTRAINT market_pools_compact_v3_event_key UNIQUE(block_number,log_index) WITH (fillfactor=100),
  CHECK ((source_code IN (1,2,3,4,6,7) AND octet_length(pool_key)=20) OR (source_code=5 AND octet_length(pool_key)=32)),
  CHECK ((source_code IN (1,3) AND attributes IS NULL)
    OR (source_code IN (2,4) AND octet_length(attributes)=5)
    OR (source_code=5 AND octet_length(attributes)=25)
    OR (source_code=6 AND octet_length(attributes)=1 AND get_byte(attributes,0) IN (0,1))
    OR (source_code=7 AND octet_length(attributes)=2))
);
CREATE ${p}TABLE market_indexer_sync_points_compact_v3 (
  source_code SMALLINT NOT NULL REFERENCES market_indexer_source_state(source_code) ON DELETE CASCADE,
  block_number INTEGER NOT NULL CHECK(block_number>=0),
  provenance BYTEA NOT NULL CHECK(octet_length(provenance)=64),
  PRIMARY KEY(source_code,block_number)
);
CREATE ${p}TABLE market_pool_state_compact_v3 (
  source_code SMALLINT NOT NULL,
  pool_key BYTEA NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready','error')),
  live_fee INTEGER, fee_denominator INTEGER,
  gauge_address BYTEA, gauge_alive BOOLEAN, gauge_weight NUMERIC(78,0), gauge_claimable NUMERIC(78,0),
  fees_address BYTEA, bribe_address BYTEA, last_error TEXT,
  observed_block INTEGER NOT NULL CHECK(observed_block>=0),
  observed_block_hash BYTEA NOT NULL CHECK(octet_length(observed_block_hash)=32),
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(source_code,pool_key),
  FOREIGN KEY(source_code,pool_key) REFERENCES market_pools_compact_v3(source_code,pool_key) ON DELETE CASCADE,
  CHECK ((status='ready' AND source_code=6 AND fee_denominator=10000 AND live_fee BETWEEN 0 AND 300)
    OR (status='ready' AND source_code=7 AND fee_denominator=1000000 AND live_fee BETWEEN 0 AND 1000000)
    OR (status='error' AND source_code IN(6,7) AND live_fee IS NULL AND fee_denominator IS NULL)),
  CHECK ((status='error' AND gauge_address IS NULL AND gauge_alive IS NULL AND gauge_weight IS NULL
      AND gauge_claimable IS NULL AND fees_address IS NULL AND bribe_address IS NULL
      AND last_error=BTRIM(last_error) AND char_length(last_error) BETWEEN 1 AND 4096)
    OR (status='ready' AND last_error IS NULL AND gauge_address IS NULL AND gauge_alive IS NULL
      AND gauge_weight IS NULL AND gauge_claimable IS NULL AND fees_address IS NULL AND bribe_address IS NULL)
    OR (status='ready' AND last_error IS NULL AND octet_length(gauge_address)=20 AND gauge_alive IS NOT NULL
      AND gauge_weight>=0 AND gauge_claimable>=0 AND octet_length(fees_address)=20 AND octet_length(bribe_address)=20))
);
CREATE INDEX market_pool_state_compact_v3_refresh_idx ON market_pool_state_compact_v3(observed_block,observed_at);`;
}

const feeBytes = "substring(int4send(p.fee) FROM 2 FOR 3)";
const tickBytes = "int2send(p.tick_spacing::smallint)";

async function assertEmptyStaging(client: PoolClient) {
  if (!await stagingRelationsValid(client)) throw new Error("compact empty staging contract is invalid");
  const counts: number[] = [];
  for (const name of STAGING_RELATIONS) {
    counts.push(await scalarCount(client, `SELECT COUNT(*)::text AS count FROM ${identifier(name)}`));
  }
  if (counts.some((count) => count !== 0)) throw new Error("compact staging must be empty before old protections are removed");
}

async function prepareEmptyCompactRelations(
  client: PoolClient,
  preflight: CompactMigrationPreflight,
  options?: CompactMigrationRunOptions
) {
  await client.query("BEGIN");
  try {
    await addSourceCodes(client);
    maybeFail(options, "after-source-code-addition");
    await client.query(migrationStateSql());
    await client.query(
      `INSERT INTO ${MIGRATION_STATE_TABLE}(
        singleton,migration_version,phase,checkpoint_digest,baseline_database_bytes,
        baseline_pool_count,storage_mode)
       VALUES(true,3,'V3_STAGING_PREPARED',$1,$2,$3,$4)`,
      [checkpointDigest(preflight.checkpoints), preflight.logicalBytes, preflight.poolCount, preflight.storageMode]
    );
    await client.query(stagingSql(preflight.storageMode));
    await assertEmptyStaging(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function populateCompactRelations(client: PoolClient) {
  await client.query("BEGIN");
  try {
  await client.query(`INSERT INTO market_pools_compact_v3(
      source_code,pool_key,token0,token1,attributes,provenance,block_number,log_index)
    SELECT s.source_code, decode(substring(p.pool_key FROM 3),'hex'),
      decode(substring(p.token0 FROM 3),'hex'), decode(substring(p.token1 FROM 3),'hex'),
      CASE
        WHEN s.source_code IN (1,3) THEN NULL
        WHEN s.source_code IN (2,4) THEN ${feeBytes} || ${tickBytes}
        WHEN s.source_code=5 THEN ${feeBytes} || ${tickBytes} || decode(substring(p.hooks FROM 3),'hex')
        WHEN s.source_code=6 THEN decode(CASE WHEN p.stable THEN '01' ELSE '00' END,'hex')
        ELSE ${tickBytes}
      END,
      decode(substring(p.transaction_hash FROM 3),'hex') || decode(substring(p.block_hash FROM 3),'hex'),
      p.block_number::integer,p.log_index
    FROM market_pools p JOIN market_indexer_source_state s
      ON s.chain_id=p.chain_id AND s.source_id=p.source_id`);
  await client.query(`INSERT INTO market_indexer_sync_points_compact_v3(source_code,block_number,provenance)
    SELECT source_code,block_number::integer,
      decode(substring(block_hash FROM 3),'hex') || decode(substring(parent_hash FROM 3),'hex')
    FROM (
      SELECT s.source_code,sp.block_number,sp.block_hash,sp.parent_hash,
        row_number() OVER(PARTITION BY s.source_code ORDER BY sp.block_number DESC) AS retained
      FROM market_indexer_sync_points sp JOIN market_indexer_source_state s
        ON s.chain_id=sp.chain_id AND s.source_id=sp.source_id
    ) points WHERE retained<=64`);
  await client.query(`INSERT INTO market_pool_state_compact_v3(
      source_code,pool_key,status,live_fee,fee_denominator,gauge_address,gauge_alive,
      gauge_weight,gauge_claimable,fees_address,bribe_address,last_error,
      observed_block,observed_block_hash,observed_at)
    SELECT s.source_code,decode(substring(st.pool_key FROM 3),'hex'),st.status,st.live_fee,st.fee_denominator,
      CASE WHEN st.gauge_address IS NULL THEN NULL ELSE decode(substring(st.gauge_address FROM 3),'hex') END,
      st.gauge_alive,st.gauge_weight,st.gauge_claimable,
      CASE WHEN st.fees_address IS NULL THEN NULL ELSE decode(substring(st.fees_address FROM 3),'hex') END,
      CASE WHEN st.bribe_address IS NULL THEN NULL ELSE decode(substring(st.bribe_address FROM 3),'hex') END,
      st.last_error,st.observed_block::integer,decode(substring(st.observed_block_hash FROM 3),'hex'),st.observed_at
    FROM market_pool_state st JOIN market_indexer_source_state s
      ON s.chain_id=st.chain_id AND s.source_id=st.source_id`);
    await setPersistedPhase(client, "V2_INDEXES_PREDROPPED", "V3_STAGING_POPULATED");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function scalarCount(client: PoolClient, sql: string) {
  const result = await client.query<{ count: string }>(sql);
  return integer(result.rows[0]?.count, "validation count");
}

async function assertExactSourceManifest(
  client: PoolClient,
  expectedVersion: number,
  requireSourceCodes: boolean
) {
  const hasCodes = await sourceCodeColumnPresent(client);
  if (hasCodes !== requireSourceCodes) throw new Error("source-code binding does not match migration phase");
  const result = await client.query<{
    source_id: string;
    source_code: number | null;
    protocol: string;
    protocol_version: number;
    source_kind: string;
    contract_address: string;
    start_block: string;
    runtime_code_hash: string;
    deployment_transaction: string;
    manifest_hash: string;
    schema_version: number;
  }>(`SELECT source_id,${hasCodes ? "source_code" : "NULL::smallint AS source_code"},protocol,
      protocol_version,source_kind,contract_address,start_block::text,runtime_code_hash,
      deployment_transaction,manifest_hash,schema_version
    FROM market_indexer_source_state WHERE chain_id=$1 ORDER BY source_id`, [MARKET_INDEXER_CHAIN_ID]);
  const expected = [...marketSources].sort((a, b) => a.id.localeCompare(b.id));
  if (result.rows.length !== expected.length || result.rows.some((row, index) => {
    const source = expected[index]!;
    return row.source_id !== source.id ||
      row.source_code !== (requireSourceCodes ? sourceCodeForId(source.id) : null) ||
      row.protocol !== source.protocol || row.protocol_version !== source.version ||
      row.source_kind !== source.kind || row.contract_address !== source.contract.toLowerCase() ||
      row.start_block !== source.startBlock.toString() || row.runtime_code_hash !== source.runtimeCodeHash ||
      row.deployment_transaction !== source.deploymentTransaction ||
      row.manifest_hash !== MARKET_SOURCE_MANIFEST_HASH || row.schema_version !== expectedVersion;
  })) throw new Error("source/runtime manifest differs from reviewed migration phase");
}

async function stagingCounts(client: PoolClient) {
  const counts: number[] = [];
  for (const name of STAGING_RELATIONS) {
    counts.push(await scalarCount(client, `SELECT COUNT(*)::text AS count FROM ${identifier(name)}`));
  }
  return counts;
}

async function detectedPhase(client: PoolClient): Promise<{
  phase: CompactMigrationPhase;
  state: PersistedMigrationState | null;
  checkpointEquality: boolean | null;
}> {
  try {
    const state = await persistedMigrationState(client);
    const schemaVersion = await uniformSchemaVersion(client);
    const layout = await currentPoolLayout(client);
    const sourceCodes = await sourceCodeColumnPresent(client);
    const stagingPresent = await relationNames(client, STAGING_RELATIONS);
    const oldPresent = await relationNames(client, OLD_RELATIONS);
    const artifactNames = await relationNames(client, ARTIFACTS);
    const checkpointEquality = state === null
      ? null
      : checkpointDigest(await checkpointSnapshot(client)) === state.checkpointDigest;

    if (state === null) {
      if (schemaVersion === 2 && layout === "v2" && !sourceCodes && artifactNames.length === 0 &&
          await v2ProtectionState(client) === "full" && await publicRelationsAreExact(client, CURRENT_RELATIONS)) {
        await assertExactSourceManifest(client, 2, false);
        return { phase: "V2_CLEAN", state, checkpointEquality: true };
      }
      if (schemaVersion === MARKET_INDEXER_SCHEMA_VERSION && layout === "compact" && sourceCodes &&
          artifactNames.length === 0 && await currentCompactRelationsValid(client) &&
          await finalizedPublicRelationsAreExact(client)) {
        await assertExactSourceManifest(client, MARKET_INDEXER_SCHEMA_VERSION, true);
        return { phase: "V3_FINALIZED", state, checkpointEquality: true };
      }
      return { phase: "UNKNOWN_UNSAFE", state, checkpointEquality };
    }

    if (!checkpointEquality) return { phase: "UNKNOWN_UNSAFE", state, checkpointEquality };
    const noOld = oldPresent.length === 0;
    const exactOld = oldPresent.length === OLD_RELATIONS.length;
    const noStaging = stagingPresent.length === 0;
    const exactStaging = stagingPresent.length === STAGING_RELATIONS.length && await stagingRelationsValid(client);

    if (["V3_STAGING_PREPARED", "V2_INDEXES_PREDROPPED", "V3_STAGING_POPULATED"].includes(state.phase)) {
      await assertExactSourceManifest(client, 2, true);
      if (schemaVersion !== 2 || layout !== "v2" || !noOld || !exactStaging) {
        return { phase: "UNKNOWN_UNSAFE", state, checkpointEquality };
      }
      const counts = await stagingCounts(client);
      const protection = await v2ProtectionState(client);
      if (!await publicRelationsAreExact(client, [...CURRENT_RELATIONS, MIGRATION_STATE_TABLE, ...STAGING_RELATIONS])) {
        return { phase: "UNKNOWN_UNSAFE", state, checkpointEquality };
      }
      if (state.phase === "V3_STAGING_PREPARED" && protection === "full" && counts.every((count) => count === 0)) {
        return { phase: state.phase, state, checkpointEquality };
      }
      if (state.phase === "V2_INDEXES_PREDROPPED" && protection === "removed" && counts.every((count) => count === 0)) {
        return { phase: state.phase, state, checkpointEquality };
      }
      if (state.phase === "V3_STAGING_POPULATED" && protection === "removed" &&
          counts[0] === state.baselinePoolCount) {
        return { phase: state.phase, state, checkpointEquality };
      }
      return { phase: "UNKNOWN_UNSAFE", state, checkpointEquality };
    }

    if (state.phase === "V2_ROLLBACK_INDEXES_REQUIRED") {
      await assertExactSourceManifest(client, 2, true);
      if (schemaVersion === 2 && layout === "v2" && noOld && noStaging &&
          await v2ProtectionState(client) === "removed" &&
          await publicRelationsAreExact(client, [...CURRENT_RELATIONS, MIGRATION_STATE_TABLE])) {
        return { phase: state.phase, state, checkpointEquality };
      }
      return { phase: "UNKNOWN_UNSAFE", state, checkpointEquality };
    }

    if (["V3_CUTOVER_MARKER_3001", "V3_OLD_RELATIONS_PRESENT"].includes(state.phase)) {
      await assertExactSourceManifest(client, MARKET_INDEXER_MIGRATION_SCHEMA_VERSION, true);
      if (schemaVersion === MARKET_INDEXER_MIGRATION_SCHEMA_VERSION && layout === "compact" && exactOld &&
          noStaging && await currentCompactRelationsValid(client) &&
          await publicRelationsAreExact(client, [...CURRENT_RELATIONS, MIGRATION_STATE_TABLE, ...OLD_RELATIONS])) {
        return { phase: state.phase, state, checkpointEquality };
      }
      return { phase: "UNKNOWN_UNSAFE", state, checkpointEquality };
    }

    if (state.phase === "V3_OLD_RELATIONS_CLEANED") {
      await assertExactSourceManifest(client, MARKET_INDEXER_MIGRATION_SCHEMA_VERSION, true);
      if (schemaVersion === MARKET_INDEXER_MIGRATION_SCHEMA_VERSION && layout === "compact" && noOld &&
          noStaging && await currentCompactRelationsValid(client) &&
          await publicRelationsAreExact(client, [...CURRENT_RELATIONS, MIGRATION_STATE_TABLE])) {
        return { phase: state.phase, state, checkpointEquality };
      }
    }
    return { phase: "UNKNOWN_UNSAFE", state, checkpointEquality };
  } catch {
    return { phase: "UNKNOWN_UNSAFE", state: null, checkpointEquality: false };
  }
}

export async function inspectCompactMigrationStatus(client: PoolClient): Promise<CompactMigrationStatus> {
  const detection = await detectedPhase(client);
  const oldRelations = await relationNames(client, OLD_RELATIONS).catch(() => []);
  const stagingRelations = await relationNames(client, STAGING_RELATIONS).catch(() => []);
  const layout = await currentPoolLayout(client).catch(() => "unknown" as const);
  const poolCount = layout === "unknown" ? 0 : await scalarCount(
    client,
    "SELECT COUNT(*)::text AS count FROM market_pools"
  ).catch(() => 0);
  const schemaVersion = await uniformSchemaVersion(client).catch(() => null);
  return Object.freeze({
    phase: detection.phase,
    schemaVersion,
    databaseBytes: await databaseBytes(client),
    poolCount,
    oldRelationsPresent: oldRelations.length > 0,
    compactRelationsPresent: stagingRelations.length > 0 || layout === "compact",
    checkpointEquality: detection.checkpointEquality,
    restartEligible: detection.phase === "V2_CLEAN" || detection.phase === "V3_FINALIZED"
  });
}

async function validateEquivalence(
  client: PoolClient,
  checkpoints: readonly SourceSnapshot[],
  oldName = "market_pools",
  compactName = "market_pools_compact_v3"
) {
  const currentCheckpoints = (await checkpointSnapshot(client)).map((row) => ({
    ...row,
    schemaVersion: 2
  }));
  if (checkpointIdentity(currentCheckpoints) !== checkpointIdentity(checkpoints)) {
    throw new Error("source checkpoints moved while writer was required to be stopped");
  }
  const oldCount = await scalarCount(client, `SELECT COUNT(*)::text AS count FROM ${oldName}`);
  const newCount = await scalarCount(client, `SELECT COUNT(*)::text AS count FROM ${compactName}`);
  if (oldCount !== newCount) throw new Error("compact pool row count mismatch");
  const difference = await scalarCount(client, `WITH expected AS (
      SELECT s.source_code,decode(substring(p.pool_key FROM 3),'hex') pool_key,
        decode(substring(p.token0 FROM 3),'hex') token0,decode(substring(p.token1 FROM 3),'hex') token1,
        CASE WHEN s.source_code IN(1,3) THEN NULL
          WHEN s.source_code IN(2,4) THEN ${feeBytes} || ${tickBytes}
          WHEN s.source_code=5 THEN ${feeBytes} || ${tickBytes} || decode(substring(p.hooks FROM 3),'hex')
          WHEN s.source_code=6 THEN decode(CASE WHEN p.stable THEN '01' ELSE '00' END,'hex')
          ELSE ${tickBytes} END attributes,
        decode(substring(p.transaction_hash FROM 3),'hex') || decode(substring(p.block_hash FROM 3),'hex') provenance,
        p.block_number::integer block_number,p.log_index
      FROM ${oldName} p JOIN market_indexer_source_state s ON s.chain_id=p.chain_id AND s.source_id=p.source_id
    ), differences AS (
      (SELECT * FROM expected EXCEPT SELECT source_code,pool_key,token0,token1,attributes,provenance,block_number,log_index FROM ${compactName})
      UNION ALL
      (SELECT source_code,pool_key,token0,token1,attributes,provenance,block_number,log_index FROM ${compactName} EXCEPT SELECT * FROM expected)
    ) SELECT COUNT(*)::text AS count FROM differences`);
  if (difference !== 0) throw new Error("compact canonical evidence differs from v2");
  const sourceDifference = await scalarCount(client, `WITH old_counts AS (
      SELECT s.source_code,COUNT(*)::bigint count FROM ${oldName} p JOIN market_indexer_source_state s
        ON s.chain_id=p.chain_id AND s.source_id=p.source_id GROUP BY s.source_code),
      new_counts AS (SELECT source_code,COUNT(*)::bigint count FROM ${compactName} GROUP BY source_code),
      differences AS ((SELECT * FROM old_counts EXCEPT SELECT * FROM new_counts)
        UNION ALL (SELECT * FROM new_counts EXCEPT SELECT * FROM old_counts))
      SELECT COUNT(*)::text AS count FROM differences`);
  if (sourceDifference !== 0) throw new Error("compact per-source counts differ from v2");
  const oldStateName = oldName === "market_pools_v2_old" ? "market_pool_state_v2_old" : "market_pool_state";
  const compactStateName = compactName === "market_pools" ? "market_pool_state" : "market_pool_state_compact_v3";
  const stateDifference = await scalarCount(client, `WITH expected AS (
      SELECT s.source_code,decode(substring(st.pool_key FROM 3),'hex') pool_key,st.status,
        st.live_fee,st.fee_denominator,
        CASE WHEN st.gauge_address IS NULL THEN NULL ELSE decode(substring(st.gauge_address FROM 3),'hex') END gauge_address,
        st.gauge_alive,st.gauge_weight,st.gauge_claimable,
        CASE WHEN st.fees_address IS NULL THEN NULL ELSE decode(substring(st.fees_address FROM 3),'hex') END fees_address,
        CASE WHEN st.bribe_address IS NULL THEN NULL ELSE decode(substring(st.bribe_address FROM 3),'hex') END bribe_address,
        st.last_error,st.observed_block::integer observed_block,
        decode(substring(st.observed_block_hash FROM 3),'hex') observed_block_hash,st.observed_at
      FROM ${oldStateName} st JOIN market_indexer_source_state s
        ON s.chain_id=st.chain_id AND s.source_id=st.source_id
    ), differences AS (
      (SELECT * FROM expected EXCEPT SELECT source_code,pool_key,status,live_fee,fee_denominator,
        gauge_address,gauge_alive,gauge_weight,gauge_claimable,fees_address,bribe_address,last_error,
        observed_block,observed_block_hash,observed_at FROM ${compactStateName})
      UNION ALL
      (SELECT source_code,pool_key,status,live_fee,fee_denominator,gauge_address,gauge_alive,
        gauge_weight,gauge_claimable,fees_address,bribe_address,last_error,observed_block,
        observed_block_hash,observed_at FROM ${compactStateName} EXCEPT SELECT * FROM expected)
    ) SELECT COUNT(*)::text AS count FROM differences`);
  if (stateDifference !== 0) throw new Error("compact pool state differs from v2");
  const oldSyncName = oldName === "market_pools_v2_old" ? "market_indexer_sync_points_v2_old" : "market_indexer_sync_points";
  const compactSyncName = compactName === "market_pools" ? "market_indexer_sync_points" : "market_indexer_sync_points_compact_v3";
  const syncDifference = await scalarCount(client, `WITH expected AS (
      SELECT source_code,block_number::integer block_number,
        decode(substring(block_hash FROM 3),'hex') || decode(substring(parent_hash FROM 3),'hex') provenance
      FROM (
        SELECT s.source_code,sp.block_number,sp.block_hash,sp.parent_hash,
          row_number() OVER(PARTITION BY s.source_code ORDER BY sp.block_number DESC) retained
        FROM ${oldSyncName} sp JOIN market_indexer_source_state s
          ON s.chain_id=sp.chain_id AND s.source_id=sp.source_id
      ) points WHERE retained<=64
    ), differences AS (
      (SELECT * FROM expected EXCEPT SELECT source_code,block_number,provenance FROM ${compactSyncName})
      UNION ALL
      (SELECT source_code,block_number,provenance FROM ${compactSyncName} EXCEPT SELECT * FROM expected)
    ) SELECT COUNT(*)::text AS count FROM differences`);
  if (syncDifference !== 0) throw new Error("compact sync points differ from bounded v2 evidence");
  const paginationInversion = await scalarCount(client, `SELECT COUNT(*)::text AS count
    FROM ${oldName} a JOIN ${oldName} b ON a.block_number=b.block_number
    WHERE a.log_index<b.log_index AND a.transaction_index>b.transaction_index`);
  if (paginationInversion !== 0) throw new Error("v2 transaction/log ordering is not compact-equivalent");
  const oldStonk = await scalarCount(client, `SELECT COUNT(*)::text AS count FROM ${oldName}
    WHERE source_id='uniswap-v4'
      AND ('0xe934e36a439c94017b64a3fece66af12099abf50'=token0
        OR '0xe934e36a439c94017b64a3fece66af12099abf50'=token1)`);
  const newStonk = await scalarCount(client, `SELECT COUNT(*)::text AS count FROM ${compactName}
    WHERE source_code=5 AND (decode('e934e36a439c94017b64a3fece66af12099abf50','hex')=token0
      OR decode('e934e36a439c94017b64a3fece66af12099abf50','hex')=token1)
      AND octet_length(pool_key)=32`);
  if (oldStonk !== newStonk) throw new Error("STONKBROKER V4 evidence differs from v2");
}

async function cutover(client: PoolClient, checkpoints: readonly SourceSnapshot[]) {
  await client.query("BEGIN");
  try {
    await client.query("LOCK TABLE market_indexer_source_state, market_pools, market_pool_state, market_indexer_sync_points, market_pools_compact_v3, market_pool_state_compact_v3, market_indexer_sync_points_compact_v3 IN ACCESS EXCLUSIVE MODE");
    if (checkpointIdentity(await checkpointSnapshot(client)) !== checkpointIdentity(checkpoints)) {
      throw new Error("source checkpoints moved before cutover");
    }
    await client.query("ALTER TABLE market_pool_state RENAME TO market_pool_state_v2_old");
    await client.query("ALTER TABLE market_pools RENAME TO market_pools_v2_old");
    await client.query("ALTER TABLE market_indexer_sync_points RENAME TO market_indexer_sync_points_v2_old");
    await client.query("ALTER TABLE market_pools_compact_v3 RENAME TO market_pools");
    await client.query("ALTER TABLE market_pool_state_compact_v3 RENAME TO market_pool_state");
    await client.query("ALTER TABLE market_indexer_sync_points_compact_v3 RENAME TO market_indexer_sync_points");
    await client.query(
      "UPDATE market_indexer_source_state SET schema_version=$1 WHERE chain_id=$2",
      [MARKET_INDEXER_MIGRATION_SCHEMA_VERSION, MARKET_INDEXER_CHAIN_ID]
    );
    await setPersistedPhase(client, "V3_STAGING_POPULATED", "V3_CUTOVER_MARKER_3001");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function recreateV2Indexes(client: PoolClient) {
  await client.query("ALTER TABLE market_pools ADD CONSTRAINT market_pools_pkey PRIMARY KEY(chain_id,source_id,pool_key)");
  await client.query("ALTER TABLE market_pools ADD CONSTRAINT market_pools_chain_id_transaction_hash_log_index_key UNIQUE(chain_id,transaction_hash,log_index)");
  await client.query("ALTER TABLE market_pool_state ADD CONSTRAINT market_pool_state_chain_id_source_id_pool_key_fkey FOREIGN KEY(chain_id,source_id,pool_key) REFERENCES market_pools(chain_id,source_id,pool_key) ON DELETE CASCADE");
  await client.query("CREATE INDEX market_pools_tokens_idx ON market_pools(chain_id,token0,token1)");
  await client.query("CREATE INDEX market_pools_block_idx ON market_pools(chain_id,source_id,block_number DESC,transaction_index DESC,log_index DESC)");
  await client.query("CREATE INDEX market_pool_state_refresh_idx ON market_pool_state(observed_block,observed_at)");
}

async function removeSourceCodes(client: PoolClient) {
  await client.query("ALTER TABLE market_indexer_source_state DROP CONSTRAINT market_indexer_source_state_source_code_v3_check");
  await client.query("ALTER TABLE market_indexer_source_state DROP CONSTRAINT market_indexer_source_state_source_code_key");
  await client.query("ALTER TABLE market_indexer_source_state DROP COLUMN source_code");
}

async function rollbackBeforeCutover(client: PoolClient) {
  const protection = await v2ProtectionState(client);
  if (protection === "invalid") throw new Error("v2 protections are ambiguous; rollback refused");
  await client.query("BEGIN");
  try {
    await client.query("DROP TABLE IF EXISTS market_pool_state_compact_v3, market_indexer_sync_points_compact_v3, market_pools_compact_v3 CASCADE");
    if (protection === "removed") await recreateV2Indexes(client);
    if (await sourceCodeColumnPresent(client)) await removeSourceCodes(client);
    await client.query(`DROP TABLE IF EXISTS ${MIGRATION_STATE_TABLE}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function rollbackAfterCutover(
  client: PoolClient,
  expectedPhase: "V3_CUTOVER_MARKER_3001" | "V3_OLD_RELATIONS_PRESENT"
) {
  await client.query("BEGIN");
  try {
    await client.query("LOCK TABLE market_indexer_source_state, market_pools, market_pool_state, market_indexer_sync_points, market_pools_v2_old, market_pool_state_v2_old, market_indexer_sync_points_v2_old IN ACCESS EXCLUSIVE MODE");
    await client.query("ALTER TABLE market_pool_state RENAME TO market_pool_state_compact_v3");
    await client.query("ALTER TABLE market_pools RENAME TO market_pools_compact_v3");
    await client.query("ALTER TABLE market_indexer_sync_points RENAME TO market_indexer_sync_points_compact_v3");
    await client.query("ALTER TABLE market_pool_state_v2_old RENAME TO market_pool_state");
    await client.query("ALTER TABLE market_pools_v2_old RENAME TO market_pools");
    await client.query("ALTER TABLE market_indexer_sync_points_v2_old RENAME TO market_indexer_sync_points");
    await client.query("UPDATE market_indexer_source_state SET schema_version=2 WHERE chain_id=$1", [MARKET_INDEXER_CHAIN_ID]);
    await client.query("DROP TABLE market_pool_state_compact_v3, market_pools_compact_v3, market_indexer_sync_points_compact_v3 CASCADE");
    await setPersistedPhase(client, expectedPhase, "V2_ROLLBACK_INDEXES_REQUIRED");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  await rollbackBeforeCutover(client);
}

async function assertCleanupGate(client: PoolClient) {
  const marker = await scalarCount(client, `SELECT COUNT(*)::text AS count FROM market_indexer_source_state
    WHERE chain_id=${MARKET_INDEXER_CHAIN_ID} AND schema_version=${MARKET_INDEXER_MIGRATION_SCHEMA_VERSION}`);
  if (marker !== marketSources.length) throw new Error("migration marker is absent; writer must remain stopped");
}

async function validatePersistedCompactEvidence(client: PoolClient, state: PersistedMigrationState) {
  await assertCheckpointEquality(client, state);
  if (!await currentCompactRelationsValid(client)) throw new Error("current compact relation contract is invalid");
  const currentCount = await scalarCount(client, "SELECT COUNT(*)::text AS count FROM market_pools");
  if (currentCount !== state.baselinePoolCount) throw new Error("compact pool count differs from migration baseline");
  if (!state.compactEvidenceFingerprint ||
      await compactEvidenceFingerprint(client, "market_pools") !== state.compactEvidenceFingerprint) {
    throw new Error("compact evidence fingerprint differs from validated staging");
  }
}

async function validateAndMarkCutover(client: PoolClient, state: PersistedMigrationState) {
  const checkpoints = (await checkpointSnapshot(client)).map((row) => ({ ...row, schemaVersion: 2 }));
  await validateEquivalence(client, checkpoints, "market_pools_v2_old", "market_pools");
  await validatePersistedCompactEvidence(client, state);
  await client.query("BEGIN");
  try {
    await setPersistedPhase(client, "V3_CUTOVER_MARKER_3001", "V3_OLD_RELATIONS_PRESENT");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function cleanupOldRelations(client: PoolClient) {
  await client.query("BEGIN");
  try {
    await client.query("DROP TABLE market_pool_state_v2_old, market_pools_v2_old, market_indexer_sync_points_v2_old");
    await setPersistedPhase(client, "V3_OLD_RELATIONS_PRESENT", "V3_OLD_RELATIONS_CLEANED");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  const oldRemaining = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname = ANY($1::text[])`,
    [["market_pool_state_v2_old", "market_pools_v2_old", "market_indexer_sync_points_v2_old"]]
  );
  if (integer(oldRemaining.rows[0]?.count, "old relation count") !== 0) {
    throw new Error("old full relations remain after cleanup");
  }
}

async function finalizeCleanedCompactRelations(
  client: PoolClient,
  safety: CompactMigrationSafety,
  state: PersistedMigrationState
) {
  await validatePersistedCompactEvidence(client, state);
  const postCleanupBytes = await databaseBytes(client);
  if (postCleanupBytes >= state.baselineDatabaseBytes ||
      postCleanupBytes + TEMP_WAL_SAFETY_RESERVE_BYTES >= safety.configuredLimitBytes) {
    throw new Error("compact storage reclamation did not satisfy the reviewed guard reserve");
  }
  await client.query("BEGIN");
  try {
    await client.query(
      "UPDATE market_indexer_source_state SET schema_version=$1 WHERE chain_id=$2 AND schema_version=$3",
      [MARKET_INDEXER_SCHEMA_VERSION, MARKET_INDEXER_CHAIN_ID, MARKET_INDEXER_MIGRATION_SCHEMA_VERSION]
    );
    await client.query(`ALTER TABLE market_indexer_source_state
      ADD CONSTRAINT market_indexer_source_state_schema_v3_check CHECK(schema_version=${MARKET_INDEXER_SCHEMA_VERSION})`);
    await client.query("ALTER INDEX market_pool_state_compact_v3_refresh_idx RENAME TO market_pool_state_refresh_idx");
    await client.query(`DROP TABLE ${MIGRATION_STATE_TABLE}`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return postCleanupBytes;
}

function assertMigrationSafety(safety: CompactMigrationSafety) {
  assert.equal(safety.writerStopped, true, "writer-stop acknowledgement is required");
  assert.equal(safety.shadowMode, true, "migration requires shadow mode");
  assert.equal(safety.authoritative, false, "authoritative mode must remain false");
  assert.equal(safety.servingProductionTraffic, false, "production traffic must remain disabled");
  assert.equal(safety.activationLocked, true, "activation lock must remain enabled");
  if (safety.configuredLimitBytes !== REVIEWED_DATABASE_LIMIT_BYTES) {
    throw new Error("compact migration requires the unchanged reviewed logical database limit");
  }
}

async function validatePopulatedStaging(client: PoolClient, state: PersistedMigrationState) {
  await assertCheckpointEquality(client, state);
  const checkpoints = await checkpointSnapshot(client);
  await validateEquivalence(client, checkpoints);
  const fingerprint = await compactEvidenceFingerprint(client, "market_pools_compact_v3");
  await client.query("BEGIN");
  try {
    await setPersistedPhase(
      client,
      "V3_STAGING_POPULATED",
      "V3_STAGING_POPULATED",
      fingerprint
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return checkpoints;
}

function maybeFail(options: CompactMigrationRunOptions | undefined, point: CompactMigrationFailurePoint) {
  if (options?.failurePoint !== point) return;
  const label = point.replaceAll("-", " ");
  if (options.abruptLoss) throw new SyntheticAbruptLoss(`synthetic abrupt loss ${label}`);
  throw new Error(`synthetic failure ${label}`);
}

async function acquireMigrationLock(client: PoolClient) {
  const lock = await client.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock($1,$2) AS locked",
    [MIGRATION_LOCK_A, MIGRATION_LOCK_B]
  );
  if (!lock.rows[0]?.locked) throw new Error("another compact migration holds the lock");
}

async function rollbackCaughtFailure(client: PoolClient) {
  const detection = await detectedPhase(client);
  if (["V3_STAGING_PREPARED", "V2_INDEXES_PREDROPPED", "V3_STAGING_POPULATED"].includes(detection.phase)) {
    await rollbackBeforeCutover(client);
  } else if (detection.phase === "V3_CUTOVER_MARKER_3001" || detection.phase === "V3_OLD_RELATIONS_PRESENT") {
    const state = detection.state;
    if (!state) throw new Error("post-cutover migration state is absent");
    await assertCheckpointEquality(client, state);
    await validateEquivalence(
      client,
      (await checkpointSnapshot(client)).map((row) => ({ ...row, schemaVersion: 2 })),
      "market_pools_v2_old",
      "market_pools"
    );
    await rollbackAfterCutover(client, detection.phase);
  }
}

export async function runCompactPreserveProgressMigration(
  pool: pg.Pool,
  safety: CompactMigrationSafety,
  options?: CompactMigrationRunOptions | CompactMigrationFailurePoint
): Promise<CompactMigrationResult> {
  const normalizedOptions = typeof options === "string" ? { failurePoint: options } : options;
  assert.equal(
    safety.oldRelationCleanupAuthorized,
    true,
    "old-relation cleanup authorization is required before migration"
  );
  assertMigrationSafety(safety);
  const client = await pool.connect();
  try {
    await acquireMigrationLock(client);
    const initialStatus = await inspectCompactMigrationStatus(client);
    if (initialStatus.phase !== "V2_CLEAN") {
      throw new Error(`new compact migration requires V2_CLEAN; detected ${initialStatus.phase}`);
    }
    const preflight = await preflightCompactMigration(client, safety);
    if (!preflight.safe) {
      throw new Error("fresh compact migration preflight exceeds the reviewed peak/headroom rule");
    }
    await prepareEmptyCompactRelations(client, preflight, normalizedOptions);
    const preparedBytes = await databaseBytes(client);
    if (preparedBytes > preflight.logicalBytes + EMPTY_STAGING_SAFETY_ALLOWANCE_BYTES ||
        preparedBytes > preflight.warningThresholdBytes) {
      throw new Error("empty constrained staging exceeds the reviewed low-peak allowance");
    }
    maybeFail(normalizedOptions, "after-empty-stage");
    const contract = await oldConstraintContract(client);
    await predropOldIndexes(client, contract);
    const afterPredropBytes = await databaseBytes(client);
    maybeFail(normalizedOptions, "after-predrop");
    await populateCompactRelations(client);
    maybeFail(normalizedOptions, "after-populate");
    const populatedState = await persistedMigrationState(client);
    if (!populatedState || populatedState.phase !== "V3_STAGING_POPULATED") {
      throw new Error("populated migration state is absent");
    }
    const checkpoints = await validatePopulatedStaging(client, populatedState);
    const stagedBytes = await databaseBytes(client);
    if (stagedBytes + TEMP_WAL_SAFETY_RESERVE_BYTES > preflight.warningThresholdBytes) {
      throw new Error("measured staging peak plus reserve exceeds warning threshold");
    }
    maybeFail(normalizedOptions, "after-stage");
    await cutover(client, checkpoints);
    maybeFail(normalizedOptions, "after-cutover");
    const cutoverState = await persistedMigrationState(client);
    if (!cutoverState || cutoverState.phase !== "V3_CUTOVER_MARKER_3001") {
      throw new Error("cutover migration state is absent");
    }
    await validateAndMarkCutover(client, cutoverState);
    maybeFail(normalizedOptions, "after-cutover-validation");
    await assertCleanupGate(client);
    await cleanupOldRelations(client);
    maybeFail(normalizedOptions, "after-old-cleanup");
    const cleanedState = await persistedMigrationState(client);
    if (!cleanedState || cleanedState.phase !== "V3_OLD_RELATIONS_CLEANED") {
      throw new Error("cleaned migration state is absent");
    }
    const postCleanupBytes = await finalizeCleanedCompactRelations(client, safety, cleanedState);
    const currentCount = await scalarCount(client, "SELECT COUNT(*)::text AS count FROM market_pools");
    const syncPointCount = await scalarCount(
      client,
      "SELECT COUNT(*)::text AS count FROM market_indexer_sync_points"
    );
    const stateCount = await scalarCount(
      client,
      "SELECT COUNT(*)::text AS count FROM market_pool_state"
    );
    const finalCheckpoints = await checkpointSnapshot(client);
    const normalizedInitial = preflight.checkpoints.map((row) => ({ ...row, schemaVersion: MARKET_INDEXER_SCHEMA_VERSION }));
    if (checkpointIdentity(finalCheckpoints) !== checkpointIdentity(normalizedInitial)) {
      throw new Error("source checkpoints changed across compact migration");
    }
    return Object.freeze({
      preflight,
      preparedBytes,
      afterPredropBytes,
      stagedBytes,
      postCleanupBytes,
      actualPeakBytes: Math.max(preflight.logicalBytes, preparedBytes, stagedBytes),
      reclaimedBytes: preflight.logicalBytes - postCleanupBytes,
      poolCount: currentCount,
      syncPointCount,
      stateCount
    });
  } catch (error) {
    if (!(error instanceof SyntheticAbruptLoss)) {
      await rollbackCaughtFailure(client);
    }
    throw error;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1,$2)", [MIGRATION_LOCK_A, MIGRATION_LOCK_B]).catch(() => undefined);
    client.release();
  }
}

export async function runCompactMigrationRecovery(
  pool: pg.Pool,
  safety: CompactMigrationSafety,
  mode: CompactMigrationRecoveryMode
): Promise<CompactMigrationStatus> {
  assertMigrationSafety(safety);
  const client = await pool.connect();
  try {
    await acquireMigrationLock(client);
    let detection = await detectedPhase(client);
    if (detection.phase === "UNKNOWN_UNSAFE") {
      throw new Error("compact migration catalog is UNKNOWN_UNSAFE; recovery refused");
    }
    if (detection.phase === "V3_FINALIZED") {
      if (mode !== "FINALIZE_CLEANED_V3" && mode !== "RESUME_VALIDATED_CUTOVER") {
        throw new Error("requested recovery mode does not apply to finalized schema v3");
      }
      return inspectCompactMigrationStatus(client);
    }
    if (detection.phase === "V2_CLEAN") {
      if (mode !== "ROLLBACK_TO_V2") {
        throw new Error("requested recovery mode does not apply to clean schema v2");
      }
      return inspectCompactMigrationStatus(client);
    }
    const state = detection.state;
    if (!state) throw new Error("persisted compact migration state is absent");
    await assertCheckpointEquality(client, state);

    if (mode === "ROLLBACK_TO_V2") {
      if (detection.phase === "V3_OLD_RELATIONS_CLEANED") {
        throw new Error("rollback to v2 is impossible after old-relation cleanup");
      }
      if (detection.phase === "V3_CUTOVER_MARKER_3001" || detection.phase === "V3_OLD_RELATIONS_PRESENT") {
        await validateEquivalence(
          client,
          (await checkpointSnapshot(client)).map((row) => ({ ...row, schemaVersion: 2 })),
          "market_pools_v2_old",
          "market_pools"
        );
        await validatePersistedCompactEvidence(client, state);
        await rollbackAfterCutover(client, detection.phase);
      } else {
        await rollbackBeforeCutover(client);
      }
      return inspectCompactMigrationStatus(client);
    }

    if (mode === "RESUME_PRE_CUTOVER") {
      if (!["V3_STAGING_PREPARED", "V2_INDEXES_PREDROPPED", "V3_STAGING_POPULATED"].includes(detection.phase)) {
        throw new Error("pre-cutover resume requires a recognized pre-cutover phase");
      }
      if (detection.phase === "V3_STAGING_PREPARED") {
        const preparedBytes = await databaseBytes(client);
        if (preparedBytes > detection.state!.baselineDatabaseBytes + EMPTY_STAGING_SAFETY_ALLOWANCE_BYTES ||
            preparedBytes > Math.floor(safety.configuredLimitBytes * MIGRATION_WARNING_BPS / 10_000)) {
          throw new Error("recovered empty staging exceeds the reviewed low-peak allowance");
        }
        await predropOldIndexes(client, await oldConstraintContract(client));
        detection = await detectedPhase(client);
      }
      if (detection.phase === "V2_INDEXES_PREDROPPED") {
        await populateCompactRelations(client);
        detection = await detectedPhase(client);
      }
      if (detection.phase !== "V3_STAGING_POPULATED" || !detection.state) {
        throw new Error("pre-cutover recovery did not reach populated staging");
      }
      const checkpoints = await validatePopulatedStaging(client, detection.state);
      const stagedBytes = await databaseBytes(client);
      const warning = Math.floor(safety.configuredLimitBytes * MIGRATION_WARNING_BPS / 10_000);
      if (stagedBytes + TEMP_WAL_SAFETY_RESERVE_BYTES > warning) {
        throw new Error("resumed staging peak plus reserve exceeds warning threshold");
      }
      await cutover(client, checkpoints);
      detection = await detectedPhase(client);
    }

    if (mode === "RESUME_VALIDATED_CUTOVER" || mode === "RESUME_PRE_CUTOVER") {
      if (detection.phase === "V3_CUTOVER_MARKER_3001") {
        if (!detection.state) throw new Error("cutover state is absent");
        await validateAndMarkCutover(client, detection.state);
        detection = await detectedPhase(client);
      }
      if (detection.phase !== "V3_OLD_RELATIONS_PRESENT" || !detection.state) {
        throw new Error("validated cutover recovery requires old relations");
      }
      await validatePersistedCompactEvidence(client, detection.state);
      await validateEquivalence(
        client,
        (await checkpointSnapshot(client)).map((row) => ({ ...row, schemaVersion: 2 })),
        "market_pools_v2_old",
        "market_pools"
      );
      await cleanupOldRelations(client);
      detection = await detectedPhase(client);
    }

    if (mode === "FINALIZE_CLEANED_V3" || mode === "RESUME_VALIDATED_CUTOVER" || mode === "RESUME_PRE_CUTOVER") {
      if (detection.phase !== "V3_OLD_RELATIONS_CLEANED" || !detection.state) {
        throw new Error("finalization requires validated compact relations after old cleanup");
      }
      await finalizeCleanedCompactRelations(client, safety, detection.state);
      const finalized = await inspectCompactMigrationStatus(client);
      if (finalized.phase !== "V3_FINALIZED" || !finalized.restartEligible) {
        throw new Error("compact schema v3 finalization did not become restart eligible");
      }
      return finalized;
    }
    throw new Error("unsupported compact migration recovery transition");
  } finally {
    await client.query("SELECT pg_advisory_unlock($1,$2)", [MIGRATION_LOCK_A, MIGRATION_LOCK_B]).catch(() => undefined);
    client.release();
  }
}

export function migrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const value = env.MARKET_INDEXER_COMPACT_MIGRATION_DATABASE_URL?.trim();
  if (!value) throw new Error("MARKET_INDEXER_COMPACT_MIGRATION_DATABASE_URL is required");
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === "/") {
    throw new Error("compact migration database URL is invalid");
  }
  return value;
}

export function localMigrationTestDatabaseUrl(env: NodeJS.ProcessEnv = process.env) {
  const value = env.MARKET_INDEXER_MIGRATION_TEST_DATABASE_URL?.trim();
  if (!value) throw new Error("MARKET_INDEXER_MIGRATION_TEST_DATABASE_URL is required");
  const parsed = new URL(value);
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(parsed.hostname)) {
    throw new Error("compact migration test tooling permits loopback PostgreSQL only");
  }
  if (env.MARKET_INDEXER_MIGRATION_TEST_ALLOW_LOCAL !== "1") {
    throw new Error("MARKET_INDEXER_MIGRATION_TEST_ALLOW_LOCAL=1 is required");
  }
  return value;
}
