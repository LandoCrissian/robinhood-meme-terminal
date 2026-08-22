import assert from "node:assert/strict";
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
export const MIGRATION_WARNING_BPS = 8_000;
export const REVIEWED_DATABASE_LIMIT_BYTES = 367_001_600;
const COPY_BUILD_ALLOWANCE_BPS = 1_000;
const MIN_SUPPORT_COPY_BYTES = 1024 * 1024;
const MIGRATION_LOCK_A = MARKET_INDEXER_CHAIN_ID;
const MIGRATION_LOCK_B = 421;
const ARTIFACTS = [
  "market_pools_compact_v3",
  "market_pool_state_compact_v3",
  "market_indexer_sync_points_compact_v3",
  "market_pools_v2_old",
  "market_pool_state_v2_old",
  "market_indexer_sync_points_v2_old"
] as const;

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
  | "after-predrop"
  | "after-stage"
  | "after-cutover";

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
  const projectedPeakBytes = logicalBytes - indexBytes + projectedCompactBytes +
    supportCopyBytes + TEMP_WAL_SAFETY_RESERVE_BYTES;
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
    await client.query(`ALTER TABLE market_pool_state DROP CONSTRAINT ${identifier(contract.stateForeignKey)}`);
    await client.query("DROP INDEX market_pool_state_refresh_idx");
    await client.query(`ALTER TABLE market_pools DROP CONSTRAINT ${identifier(contract.poolPrimary)}`);
    await client.query(`ALTER TABLE market_pools DROP CONSTRAINT ${identifier(contract.poolEvent)}`);
    await client.query("DROP INDEX market_pools_tokens_idx");
    await client.query("DROP INDEX market_pools_block_idx");
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
CREATE INDEX market_pool_state_refresh_idx ON market_pool_state_compact_v3(observed_block,observed_at);`;
}

const feeBytes = "substring(int4send(p.fee) FROM 2 FOR 3)";
const tickBytes = "int2send(p.tick_spacing::smallint)";

async function stageCompactRelations(client: PoolClient, mode: "durable" | "rebuildable") {
  await addSourceCodes(client);
  await client.query(stagingSql(mode));
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
}

async function scalarCount(client: PoolClient, sql: string) {
  const result = await client.query<{ count: string }>(sql);
  return integer(result.rows[0]?.count, "validation count");
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
  await client.query("DROP TABLE IF EXISTS market_pool_state_compact_v3, market_indexer_sync_points_compact_v3, market_pools_compact_v3 CASCADE");
  const hasSourceCode = await client.query<{ present: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='market_indexer_source_state' AND column_name='source_code') AS present"
  );
  if (hasSourceCode.rows[0]?.present) await removeSourceCodes(client);
  const indexes = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM pg_indexes WHERE tablename='market_pools'");
  if (integer(indexes.rows[0]?.count, "v2 index count") === 0) await recreateV2Indexes(client);
}

async function rollbackAfterCutover(client: PoolClient) {
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

async function cleanupAndFinalize(client: PoolClient, safety: CompactMigrationSafety, beforeBytes: number) {
  await client.query("DROP TABLE market_pool_state_v2_old, market_pools_v2_old, market_indexer_sync_points_v2_old");
  const oldRemaining = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname = ANY($1::text[])`,
    [["market_pool_state_v2_old", "market_pools_v2_old", "market_indexer_sync_points_v2_old"]]
  );
  if (integer(oldRemaining.rows[0]?.count, "old relation count") !== 0) {
    throw new Error("old full relations remain after cleanup");
  }
  const postCleanupBytes = await databaseBytes(client);
  if (postCleanupBytes >= beforeBytes || postCleanupBytes + TEMP_WAL_SAFETY_RESERVE_BYTES >= safety.configuredLimitBytes) {
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
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return postCleanupBytes;
}

export async function runCompactPreserveProgressMigration(
  pool: pg.Pool,
  safety: CompactMigrationSafety,
  failurePoint?: CompactMigrationFailurePoint
): Promise<CompactMigrationResult> {
  assert.equal(
    safety.oldRelationCleanupAuthorized,
    true,
    "old-relation cleanup authorization is required before migration"
  );
  const client = await pool.connect();
  let cutoverComplete = false;
  let cleanupStarted = false;
  try {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1,$2) AS locked",
      [MIGRATION_LOCK_A, MIGRATION_LOCK_B]
    );
    if (!lock.rows[0]?.locked) throw new Error("another compact migration holds the lock");
    const preflight = await preflightCompactMigration(client, safety);
    if (!preflight.safe) {
      throw new Error("fresh compact migration preflight exceeds the reviewed peak/headroom rule");
    }
    const contract = await oldConstraintContract(client);
    await predropOldIndexes(client, contract);
    const afterPredropBytes = await databaseBytes(client);
    if (failurePoint === "after-predrop") throw new Error("synthetic failure after predrop");
    await stageCompactRelations(client, preflight.storageMode);
    await validateEquivalence(client, preflight.checkpoints);
    const stagedBytes = await databaseBytes(client);
    if (stagedBytes + TEMP_WAL_SAFETY_RESERVE_BYTES > preflight.warningThresholdBytes) {
      throw new Error("measured staging peak plus reserve exceeds warning threshold");
    }
    if (failurePoint === "after-stage") throw new Error("synthetic failure after stage");
    await cutover(client, preflight.checkpoints);
    cutoverComplete = true;
    if (failurePoint === "after-cutover") throw new Error("synthetic failure after cutover");
    await validateEquivalence(
      client,
      preflight.checkpoints,
      "market_pools_v2_old",
      "market_pools"
    );
    const currentCount = await scalarCount(client, "SELECT COUNT(*)::text AS count FROM market_pools");
    if (currentCount !== preflight.poolCount) throw new Error("post-cutover compact count mismatch");
    await assertCleanupGate(client);
    cleanupStarted = true;
    const postCleanupBytes = await cleanupAndFinalize(client, safety, preflight.logicalBytes);
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
      afterPredropBytes,
      stagedBytes,
      postCleanupBytes,
      actualPeakBytes: Math.max(preflight.logicalBytes, stagedBytes),
      reclaimedBytes: preflight.logicalBytes - postCleanupBytes,
      poolCount: currentCount,
      syncPointCount,
      stateCount
    });
  } catch (error) {
    if (!cleanupStarted) {
      if (cutoverComplete) await rollbackAfterCutover(client);
      else await rollbackBeforeCutover(client);
    }
    throw error;
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
