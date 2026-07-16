import type { Pool, PoolClient } from "pg";
import {
  EXTERNAL_ORIGIN_CHAIN_ID,
  EXTERNAL_ORIGIN_SCHEMA_VERSION
} from "./config.js";

export const externalOriginSchemaSql = `
CREATE TABLE IF NOT EXISTS external_origin_adapter_state (
  chain_id BIGINT NOT NULL,
  adapter_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  factory TEXT NOT NULL,
  start_block BIGINT NOT NULL,
  next_block BIGINT NOT NULL,
  manifest_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT external_origin_adapter_state_pkey
    PRIMARY KEY (chain_id, adapter_id),
  CONSTRAINT external_origin_adapter_state_claim_parent_key
    UNIQUE (
      chain_id,
      adapter_id,
      source_id,
      source_name,
      factory,
      start_block,
      manifest_hash,
      schema_version
    ),
  CONSTRAINT external_origin_adapter_state_chain_id_check
    CHECK (chain_id > 0),
  CONSTRAINT external_origin_adapter_state_adapter_id_check
    CHECK (
      adapter_id = LOWER(adapter_id)
      AND CHAR_LENGTH(adapter_id) BETWEEN 1 AND 64
      AND adapter_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
  CONSTRAINT external_origin_adapter_state_source_id_check
    CHECK (
      source_id = LOWER(source_id)
      AND CHAR_LENGTH(source_id) BETWEEN 1 AND 64
      AND source_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'
    ),
  CONSTRAINT external_origin_adapter_state_source_name_check
    CHECK (
      source_name = BTRIM(source_name)
      AND CHAR_LENGTH(source_name) BETWEEN 1 AND 120
    ),
  CONSTRAINT external_origin_adapter_state_factory_check
    CHECK (
      factory ~ '^0x[0-9a-f]{40}$'
      AND factory <> '0x0000000000000000000000000000000000000000'
    ),
  CONSTRAINT external_origin_adapter_state_block_range_check
    CHECK (start_block >= 0 AND next_block >= start_block),
  CONSTRAINT external_origin_adapter_state_manifest_hash_check
    CHECK (
      manifest_hash ~ '^0x[0-9a-f]{64}$'
      AND manifest_hash <>
        '0x0000000000000000000000000000000000000000000000000000000000000000'
    ),
  CONSTRAINT external_origin_adapter_state_schema_version_check
    CHECK (schema_version > 0),
  CONSTRAINT external_origin_adapter_state_status_check
    CHECK (status IN ('backfilling', 'ready', 'error')),
  CONSTRAINT external_origin_adapter_state_ready_check
    CHECK (
      status <> 'ready'
      OR (
        next_block > start_block
        AND last_sync_at IS NOT NULL
        AND last_error IS NULL
      )
    ),
  CONSTRAINT external_origin_adapter_state_error_check
    CHECK (status <> 'error' OR last_error IS NOT NULL),
  CONSTRAINT external_origin_adapter_state_last_error_check
    CHECK (
      last_error IS NULL
      OR (
        last_error = BTRIM(last_error)
        AND CHAR_LENGTH(last_error) BETWEEN 1 AND 4096
      )
    )
);

CREATE TABLE IF NOT EXISTS external_origin_sync_points (
  chain_id BIGINT NOT NULL,
  adapter_id TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT external_origin_sync_points_pkey
    PRIMARY KEY (chain_id, adapter_id, block_number),
  CONSTRAINT external_origin_sync_points_checkpoint_key
    UNIQUE (chain_id, adapter_id, block_number, block_hash),
  CONSTRAINT external_origin_sync_points_adapter_fkey
    FOREIGN KEY (chain_id, adapter_id)
    REFERENCES external_origin_adapter_state (chain_id, adapter_id)
    ON DELETE CASCADE,
  CONSTRAINT external_origin_sync_points_block_number_check
    CHECK (block_number >= 0),
  CONSTRAINT external_origin_sync_points_block_hash_check
    CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT external_origin_sync_points_parent_hash_check
    CHECK (parent_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS external_origin_claims (
  chain_id BIGINT NOT NULL,
  adapter_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  claim_kind TEXT NOT NULL,
  token TEXT NOT NULL,
  factory TEXT NOT NULL,
  start_block BIGINT NOT NULL,
  manifest_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  transaction_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  creator TEXT,
  market TEXT,
  evidence_hash TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT external_origin_claims_pkey
    PRIMARY KEY (chain_id, transaction_hash, log_index),
  CONSTRAINT external_origin_claims_evidence_key
    UNIQUE (chain_id, evidence_hash),
  CONSTRAINT external_origin_claims_adapter_source_fkey
    FOREIGN KEY (
      chain_id,
      adapter_id,
      source_id,
      source_name,
      factory,
      start_block,
      manifest_hash,
      schema_version
    )
    REFERENCES external_origin_adapter_state (
      chain_id,
      adapter_id,
      source_id,
      source_name,
      factory,
      start_block,
      manifest_hash,
      schema_version
    )
    ON DELETE RESTRICT,
  CONSTRAINT external_origin_claims_checkpoint_fkey
    FOREIGN KEY (
      chain_id,
      adapter_id,
      block_number,
      block_hash
    )
    REFERENCES external_origin_sync_points (
      chain_id,
      adapter_id,
      block_number,
      block_hash
    )
    ON DELETE CASCADE,
  CONSTRAINT external_origin_claims_claim_kind_check
    CHECK (claim_kind IN ('token-created', 'source-listed')),
  CONSTRAINT external_origin_claims_token_check
    CHECK (
      token ~ '^0x[0-9a-f]{40}$'
      AND token <> '0x0000000000000000000000000000000000000000'
    ),
  CONSTRAINT external_origin_claims_factory_check
    CHECK (
      factory ~ '^0x[0-9a-f]{40}$'
      AND factory <> '0x0000000000000000000000000000000000000000'
    ),
  CONSTRAINT external_origin_claims_start_block_check
    CHECK (start_block >= 0),
  CONSTRAINT external_origin_claims_manifest_hash_check
    CHECK (
      manifest_hash ~ '^0x[0-9a-f]{64}$'
      AND manifest_hash <>
        '0x0000000000000000000000000000000000000000000000000000000000000000'
    ),
  CONSTRAINT external_origin_claims_schema_version_check
    CHECK (schema_version > 0),
  CONSTRAINT external_origin_claims_block_range_check
    CHECK (block_number >= start_block),
  CONSTRAINT external_origin_claims_transaction_hash_check
    CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT external_origin_claims_log_index_check
    CHECK (log_index >= 0),
  CONSTRAINT external_origin_claims_transaction_index_check
    CHECK (transaction_index >= 0),
  CONSTRAINT external_origin_claims_block_number_check
    CHECK (block_number >= 0),
  CONSTRAINT external_origin_claims_block_hash_check
    CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  CONSTRAINT external_origin_claims_creator_check
    CHECK (
      creator IS NULL
      OR (
        creator ~ '^0x[0-9a-f]{40}$'
        AND creator <> '0x0000000000000000000000000000000000000000'
      )
    ),
  CONSTRAINT external_origin_claims_market_check
    CHECK (
      market IS NULL
      OR (
        market ~ '^0x[0-9a-f]{40}$'
        AND market <> '0x0000000000000000000000000000000000000000'
      )
    ),
  CONSTRAINT external_origin_claims_evidence_hash_check
    CHECK (
      evidence_hash ~ '^0x[0-9a-f]{64}$'
      AND evidence_hash <>
        '0x0000000000000000000000000000000000000000000000000000000000000000'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS external_origin_claims_created_token_key
  ON external_origin_claims (chain_id, token)
  WHERE claim_kind = 'token-created';

CREATE INDEX IF NOT EXISTS external_origin_claims_token_block_log_idx
  ON external_origin_claims (
    chain_id,
    token,
    block_number DESC,
    log_index DESC
  );

CREATE INDEX IF NOT EXISTS external_origin_claims_adapter_block_log_idx
  ON external_origin_claims (
    chain_id,
    adapter_id,
    block_number DESC,
    log_index DESC
  );
`;

const EXPECTED_TABLES = [
  "external_origin_adapter_state",
  "external_origin_claims",
  "external_origin_sync_points"
] as const;

const EXPECTED_COLUMNS = [
  "external_origin_adapter_state.chain_id:int8:NO",
  "external_origin_adapter_state.adapter_id:text:NO",
  "external_origin_adapter_state.source_id:text:NO",
  "external_origin_adapter_state.source_name:text:NO",
  "external_origin_adapter_state.factory:text:NO",
  "external_origin_adapter_state.start_block:int8:NO",
  "external_origin_adapter_state.next_block:int8:NO",
  "external_origin_adapter_state.manifest_hash:text:NO",
  "external_origin_adapter_state.schema_version:int4:NO",
  "external_origin_adapter_state.status:text:NO",
  "external_origin_adapter_state.last_sync_at:timestamptz:YES",
  "external_origin_adapter_state.last_error:text:YES",
  "external_origin_adapter_state.updated_at:timestamptz:NO",
  "external_origin_sync_points.chain_id:int8:NO",
  "external_origin_sync_points.adapter_id:text:NO",
  "external_origin_sync_points.block_number:int8:NO",
  "external_origin_sync_points.block_hash:text:NO",
  "external_origin_sync_points.parent_hash:text:NO",
  "external_origin_sync_points.indexed_at:timestamptz:NO",
  "external_origin_claims.chain_id:int8:NO",
  "external_origin_claims.adapter_id:text:NO",
  "external_origin_claims.source_id:text:NO",
  "external_origin_claims.source_name:text:NO",
  "external_origin_claims.claim_kind:text:NO",
  "external_origin_claims.token:text:NO",
  "external_origin_claims.factory:text:NO",
  "external_origin_claims.start_block:int8:NO",
  "external_origin_claims.manifest_hash:text:NO",
  "external_origin_claims.schema_version:int4:NO",
  "external_origin_claims.transaction_hash:text:NO",
  "external_origin_claims.log_index:int4:NO",
  "external_origin_claims.transaction_index:int4:NO",
  "external_origin_claims.block_number:int8:NO",
  "external_origin_claims.block_hash:text:NO",
  "external_origin_claims.creator:text:YES",
  "external_origin_claims.market:text:YES",
  "external_origin_claims.evidence_hash:text:NO",
  "external_origin_claims.observed_at:timestamptz:NO"
] as const;

const EXPECTED_CONSTRAINTS = [
  "external_origin_adapter_state_pkey:PRIMARY KEY",
  "external_origin_adapter_state_claim_parent_key:UNIQUE",
  "external_origin_adapter_state_chain_id_check:CHECK",
  "external_origin_adapter_state_adapter_id_check:CHECK",
  "external_origin_adapter_state_source_id_check:CHECK",
  "external_origin_adapter_state_source_name_check:CHECK",
  "external_origin_adapter_state_factory_check:CHECK",
  "external_origin_adapter_state_block_range_check:CHECK",
  "external_origin_adapter_state_manifest_hash_check:CHECK",
  "external_origin_adapter_state_schema_version_check:CHECK",
  "external_origin_adapter_state_status_check:CHECK",
  "external_origin_adapter_state_ready_check:CHECK",
  "external_origin_adapter_state_error_check:CHECK",
  "external_origin_adapter_state_last_error_check:CHECK",
  "external_origin_sync_points_pkey:PRIMARY KEY",
  "external_origin_sync_points_checkpoint_key:UNIQUE",
  "external_origin_sync_points_adapter_fkey:FOREIGN KEY",
  "external_origin_sync_points_block_number_check:CHECK",
  "external_origin_sync_points_block_hash_check:CHECK",
  "external_origin_sync_points_parent_hash_check:CHECK",
  "external_origin_claims_pkey:PRIMARY KEY",
  "external_origin_claims_evidence_key:UNIQUE",
  "external_origin_claims_adapter_source_fkey:FOREIGN KEY",
  "external_origin_claims_checkpoint_fkey:FOREIGN KEY",
  "external_origin_claims_claim_kind_check:CHECK",
  "external_origin_claims_token_check:CHECK",
  "external_origin_claims_factory_check:CHECK",
  "external_origin_claims_start_block_check:CHECK",
  "external_origin_claims_manifest_hash_check:CHECK",
  "external_origin_claims_schema_version_check:CHECK",
  "external_origin_claims_block_range_check:CHECK",
  "external_origin_claims_transaction_hash_check:CHECK",
  "external_origin_claims_log_index_check:CHECK",
  "external_origin_claims_transaction_index_check:CHECK",
  "external_origin_claims_block_number_check:CHECK",
  "external_origin_claims_block_hash_check:CHECK",
  "external_origin_claims_creator_check:CHECK",
  "external_origin_claims_market_check:CHECK",
  "external_origin_claims_evidence_hash_check:CHECK"
] as const;

const EXPECTED_INDEXES = [
  "external_origin_adapter_state_claim_parent_key",
  "external_origin_adapter_state_pkey",
  "external_origin_claims_adapter_block_log_idx",
  "external_origin_claims_created_token_key",
  "external_origin_claims_evidence_key",
  "external_origin_claims_pkey",
  "external_origin_claims_token_block_log_idx",
  "external_origin_sync_points_checkpoint_key",
  "external_origin_sync_points_pkey"
] as const;

function assertExactSet(
  label: string,
  actualValues: readonly string[],
  expectedValues: readonly string[]
) {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      label + " mismatch. Expected " + expected.join(", ") +
      "; received " + actual.join(", ")
    );
  }
}

function normalizeSql(value: string) {
  return value
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function assertExternalOriginSchema(
  client: PoolClient,
  schemaName = "public"
) {
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schemaName]
  );
  assertExactSet(
    "External-origin database tables",
    tables.rows.map((row) => row.table_name),
    EXPECTED_TABLES
  );

  const columns = await client.query<{
    table_name: string;
    column_name: string;
    udt_name: string;
    is_nullable: string;
  }>(
    `SELECT table_name, column_name, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = ANY($2::text[])
     ORDER BY table_name, ordinal_position`,
    [schemaName, EXPECTED_TABLES]
  );
  assertExactSet(
    "External-origin column contract",
    columns.rows.map(
      (row) =>
        row.table_name + "." + row.column_name + ":" +
        row.udt_name + ":" + row.is_nullable
    ),
    EXPECTED_COLUMNS
  );

  const defaults = await client.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = ANY($2::text[])
       AND column_default IS NOT NULL`,
    [schemaName, EXPECTED_TABLES]
  );
  assertExactSet(
    "External-origin defaults",
    defaults.rows.map(
      (row) => row.table_name + "." + row.column_name
    ),
    [
      "external_origin_adapter_state.updated_at",
      "external_origin_claims.observed_at",
      "external_origin_sync_points.indexed_at"
    ]
  );

  const constraints = await client.query<{
    constraint_name: string;
    constraint_type: string;
  }>(
    `SELECT constraint.conname AS constraint_name,
            CASE constraint.contype
              WHEN 'p' THEN 'PRIMARY KEY'
              WHEN 'u' THEN 'UNIQUE'
              WHEN 'f' THEN 'FOREIGN KEY'
              WHEN 'c' THEN 'CHECK'
              ELSE constraint.contype::TEXT
            END AS constraint_type
     FROM pg_constraint AS constraint
     JOIN pg_class AS relation
       ON relation.oid = constraint.conrelid
     JOIN pg_namespace AS namespace
       ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1
       AND relation.relname = ANY($2::text[])
       AND constraint.contype IN ('p', 'u', 'f', 'c')`,
    [schemaName, EXPECTED_TABLES]
  );
  assertExactSet(
    "External-origin constraints",
    constraints.rows.map(
      (row) => row.constraint_name + ":" + row.constraint_type
    ),
    EXPECTED_CONSTRAINTS
  );

  const definitions = await client.query<{
    constraint_name: string;
    definition: string;
  }>(
    `SELECT constraint.conname AS constraint_name,
            pg_get_constraintdef(constraint.oid, true) AS definition
     FROM pg_constraint AS constraint
     JOIN pg_class AS relation
       ON relation.oid = constraint.conrelid
     JOIN pg_namespace AS namespace
       ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = $1
       AND relation.relname = ANY($2::text[])`,
    [schemaName, EXPECTED_TABLES]
  );
  const definitionByName = new Map(
    definitions.rows.map((row) => [
      row.constraint_name,
      normalizeSql(row.definition)
    ])
  );
  const requiredConstraintFragments: Record<string, readonly string[]> = {
    external_origin_adapter_state_claim_parent_key: [
      "chain_id",
      "adapter_id",
      "source_id",
      "source_name",
      "factory",
      "start_block",
      "manifest_hash",
      "schema_version"
    ],
    external_origin_adapter_state_status_check: [
      "backfilling",
      "ready",
      "error"
    ],
    external_origin_adapter_state_ready_check: [
      "next_block",
      "start_block",
      "last_sync_at is not null",
      "last_error is null"
    ],
    external_origin_sync_points_checkpoint_key: [
      "chain_id",
      "adapter_id",
      "block_number",
      "block_hash"
    ],
    external_origin_claims_adapter_source_fkey: [
      "foreign key",
      "manifest_hash",
      "schema_version",
      "references external_origin_adapter_state",
      "on delete restrict"
    ],
    external_origin_claims_checkpoint_fkey: [
      "foreign key",
      "block_number",
      "block_hash",
      "references external_origin_sync_points",
      "on delete cascade"
    ],
    external_origin_claims_claim_kind_check: [
      "token-created",
      "source-listed"
    ],
    external_origin_claims_block_range_check: [
      "block_number",
      "start_block"
    ]
  };
  for (const [name, fragments] of Object.entries(
    requiredConstraintFragments
  )) {
    const definition = definitionByName.get(name);
    if (!definition) throw new Error("Missing definition for " + name);
    for (const fragment of fragments) {
      if (!definition.includes(normalizeSql(fragment))) {
        throw new Error(
          name + " is missing schema fragment " + fragment
        );
      }
    }
  }

  const indexes = await client.query<{
    indexname: string;
    indexdef: string;
  }>(
    `SELECT indexname, indexdef
     FROM pg_indexes
     WHERE schemaname = $1
       AND tablename = ANY($2::text[])`,
    [schemaName, EXPECTED_TABLES]
  );
  assertExactSet(
    "External-origin indexes",
    indexes.rows.map((row) => row.indexname),
    EXPECTED_INDEXES
  );
  const indexByName = new Map(
    indexes.rows.map((row) => [
      row.indexname,
      normalizeSql(row.indexdef)
    ])
  );
  const createdTokenIndex = indexByName.get(
    "external_origin_claims_created_token_key"
  );
  if (
    !createdTokenIndex?.includes("unique") ||
    !createdTokenIndex.includes("chain_id, token") ||
    !createdTokenIndex.includes("where") ||
    !createdTokenIndex.includes("token-created")
  ) {
    throw new Error("Created-token uniqueness index drifted");
  }
  const tokenIndex = indexByName.get(
    "external_origin_claims_token_block_log_idx"
  );
  if (
    !tokenIndex?.includes(
      "chain_id, token, block_number desc, log_index desc"
    )
  ) {
    throw new Error("Token lookup index drifted");
  }
  const adapterIndex = indexByName.get(
    "external_origin_claims_adapter_block_log_idx"
  );
  if (
    !adapterIndex?.includes(
      "chain_id, adapter_id, block_number desc, log_index desc"
    )
  ) {
    throw new Error("Adapter lookup index drifted");
  }
}

async function assertDedicatedDatabaseBeforeDdl(client: PoolClient) {
  const result = await client.query<{ tablename: string }>(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`
  );
  const unexpected = result.rows
    .map((row) => row.tablename)
    .filter(
      (table) =>
        !EXPECTED_TABLES.includes(
          table as (typeof EXPECTED_TABLES)[number]
        )
    );
  if (unexpected.length > 0) {
    throw new Error(
      "EXTERNAL_ORIGIN_DATABASE_URL is not a dedicated database; " +
      "unexpected public tables: " + unexpected.join(", ")
    );
  }
}

export async function applyExternalOriginSchema(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock($1, $2)",
      [EXTERNAL_ORIGIN_CHAIN_ID, EXTERNAL_ORIGIN_SCHEMA_VERSION]
    );
    await assertDedicatedDatabaseBeforeDdl(client);
    await client.query(externalOriginSchemaSql);
    await assertExternalOriginSchema(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
