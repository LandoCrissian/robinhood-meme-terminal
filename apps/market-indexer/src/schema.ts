import type { Pool, PoolClient } from "pg";
import { sourceCodeForId } from "./compact-storage.js";
import {
  MARKET_INDEXER_CHAIN_ID,
  MARKET_INDEXER_MIGRATION_SCHEMA_VERSION,
  MARKET_INDEXER_SCHEMA_VERSION,
  MARKET_SOURCE_MANIFEST_HASH,
  MARKET_SOURCE_MANIFEST_V1_HASH,
  marketSources
} from "./sources.js";

export type MarketIndexerStorageMode = "durable" | "rebuildable";

const V2_SCHEMA_VERSION = 2 as const;

export function marketIndexerSchemaSql(storageMode: MarketIndexerStorageMode) {
  const persistence = storageMode === "rebuildable" ? "UNLOGGED " : "";
  return `
CREATE ${persistence}TABLE IF NOT EXISTS market_indexer_source_state (
  chain_id BIGINT NOT NULL,
  source_id TEXT NOT NULL,
  source_code SMALLINT NOT NULL UNIQUE,
  protocol TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  source_kind TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  start_block BIGINT NOT NULL,
  next_block BIGINT NOT NULL,
  runtime_code_hash TEXT NOT NULL,
  deployment_transaction TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, source_id),
  CHECK (chain_id = 4663),
  CHECK (
    (source_code = 1 AND source_id = 'sushiswap-v2' AND protocol = 'sushiswap' AND protocol_version = 2)
    OR (source_code = 2 AND source_id = 'sushiswap-v3' AND protocol = 'sushiswap' AND protocol_version = 3)
    OR (source_code = 3 AND source_id = 'uniswap-v2' AND protocol = 'uniswap' AND protocol_version = 2)
    OR (source_code = 4 AND source_id = 'uniswap-v3' AND protocol = 'uniswap' AND protocol_version = 3)
    OR (source_code = 5 AND source_id = 'uniswap-v4' AND protocol = 'uniswap' AND protocol_version = 4)
    OR (source_code = 6 AND source_id = 'up-v2' AND protocol = 'up' AND protocol_version = 2)
    OR (source_code = 7 AND source_id = 'up-cl' AND protocol = 'up' AND protocol_version = 3)
  ),
  CHECK (source_kind IN ('v2-factory', 'v3-factory', 'v4-manager', 'up-v2-factory', 'up-cl-factory')),
  CHECK (contract_address ~ '^0x[0-9a-f]{40}$' AND contract_address <> '0x0000000000000000000000000000000000000000'),
  CHECK (start_block >= 0 AND next_block >= start_block),
  CHECK (runtime_code_hash ~ '^0x[0-9a-f]{64}$' AND runtime_code_hash <> ('0x' || repeat('0', 64))),
  CHECK (deployment_transaction ~ '^0x[0-9a-f]{64}$'),
  CHECK (manifest_hash ~ '^0x[0-9a-f]{64}$' AND manifest_hash <> ('0x' || repeat('0', 64))),
  CHECK (schema_version = ${MARKET_INDEXER_SCHEMA_VERSION}),
  CHECK (status IN ('backfilling', 'shadow-ready', 'error')),
  CHECK (status <> 'shadow-ready' OR (next_block > start_block AND last_sync_at IS NOT NULL AND last_error IS NULL)),
  CHECK (status <> 'error' OR last_error IS NOT NULL),
  CHECK (last_error IS NULL OR (last_error = BTRIM(last_error) AND CHAR_LENGTH(last_error) BETWEEN 1 AND 4096))
);

CREATE ${persistence}TABLE IF NOT EXISTS market_indexer_sync_points (
  source_code SMALLINT NOT NULL,
  block_number INTEGER NOT NULL CHECK (block_number >= 0),
  provenance BYTEA NOT NULL CHECK (octet_length(provenance) = 64),
  PRIMARY KEY (source_code, block_number),
  FOREIGN KEY (source_code) REFERENCES market_indexer_source_state (source_code) ON DELETE CASCADE
);

CREATE ${persistence}TABLE IF NOT EXISTS market_pools (
  source_code SMALLINT NOT NULL,
  pool_key BYTEA NOT NULL CHECK (octet_length(pool_key) IN (20, 32)),
  token0 BYTEA NOT NULL CHECK (octet_length(token0) = 20),
  token1 BYTEA NOT NULL CHECK (octet_length(token1) = 20 AND token0 <> token1),
  attributes BYTEA,
  provenance BYTEA NOT NULL CHECK (octet_length(provenance) = 64),
  block_number INTEGER NOT NULL CHECK (block_number >= 0),
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  CONSTRAINT market_pools_pkey PRIMARY KEY (source_code, pool_key) WITH (fillfactor = 100),
  CONSTRAINT market_pools_event_key UNIQUE (block_number, log_index) WITH (fillfactor = 100),
  FOREIGN KEY (source_code) REFERENCES market_indexer_source_state (source_code) ON DELETE CASCADE,
  CHECK (
    (source_code IN (1, 2, 3, 4, 6, 7) AND octet_length(pool_key) = 20)
    OR (source_code = 5 AND octet_length(pool_key) = 32)
  ),
  CHECK (
    (source_code IN (1, 3) AND attributes IS NULL)
    OR (source_code IN (2, 4) AND octet_length(attributes) = 5)
    OR (source_code = 5 AND octet_length(attributes) = 25)
    OR (source_code = 6 AND octet_length(attributes) = 1 AND get_byte(attributes, 0) IN (0, 1))
    OR (source_code = 7 AND octet_length(attributes) = 2)
  )
);

CREATE ${persistence}TABLE IF NOT EXISTS market_pool_state (
  source_code SMALLINT NOT NULL,
  pool_key BYTEA NOT NULL,
  status TEXT NOT NULL,
  live_fee INTEGER,
  fee_denominator INTEGER,
  gauge_address BYTEA,
  gauge_alive BOOLEAN,
  gauge_weight NUMERIC(78, 0),
  gauge_claimable NUMERIC(78, 0),
  fees_address BYTEA,
  bribe_address BYTEA,
  last_error TEXT,
  observed_block INTEGER NOT NULL CHECK (observed_block >= 0),
  observed_block_hash BYTEA NOT NULL CHECK (octet_length(observed_block_hash) = 32),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_code, pool_key),
  FOREIGN KEY (source_code, pool_key) REFERENCES market_pools (source_code, pool_key) ON DELETE CASCADE,
  CHECK (status IN ('ready', 'error')),
  CHECK (
    (status = 'ready' AND source_code = 6 AND fee_denominator = 10000 AND live_fee BETWEEN 0 AND 300)
    OR (status = 'ready' AND source_code = 7 AND fee_denominator = 1000000 AND live_fee BETWEEN 0 AND 1000000)
    OR (status = 'error' AND source_code IN (6, 7) AND live_fee IS NULL AND fee_denominator IS NULL)
  ),
  CHECK (
    (status = 'error' AND gauge_address IS NULL AND gauge_alive IS NULL AND gauge_weight IS NULL
      AND gauge_claimable IS NULL AND fees_address IS NULL AND bribe_address IS NULL
      AND last_error = BTRIM(last_error) AND CHAR_LENGTH(last_error) BETWEEN 1 AND 4096)
    OR
    (status = 'ready' AND last_error IS NULL AND gauge_address IS NULL AND gauge_alive IS NULL
      AND gauge_weight IS NULL AND gauge_claimable IS NULL AND fees_address IS NULL AND bribe_address IS NULL)
    OR
    (status = 'ready' AND last_error IS NULL
      AND octet_length(gauge_address) = 20 AND gauge_alive IS NOT NULL
      AND gauge_weight >= 0 AND gauge_claimable >= 0
      AND octet_length(fees_address) = 20 AND octet_length(bribe_address) = 20)
  )
);

CREATE INDEX IF NOT EXISTS market_pool_state_refresh_idx
  ON market_pool_state (observed_block ASC, observed_at ASC);

CREATE ${persistence}TABLE IF NOT EXISTS market_token_identity_shard (
  shard SMALLINT PRIMARY KEY CHECK (shard BETWEEN 0 AND 255),
  payload BYTEA NOT NULL CHECK (octet_length(payload) BETWEEN 2 AND 8388608),
  entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
  verified_count INTEGER NOT NULL CHECK (verified_count BETWEEN 0 AND entry_count),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE ${persistence}TABLE IF NOT EXISTS market_token_identity_catalog_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  total_canonical_markets INTEGER NOT NULL CHECK (total_canonical_markets >= 0),
  total_unique_tokens INTEGER NOT NULL CHECK (total_unique_tokens >= 0),
  evaluated_tokens INTEGER NOT NULL CHECK (evaluated_tokens BETWEEN 0 AND total_unique_tokens),
  verified_tokens INTEGER NOT NULL CHECK (verified_tokens BETWEEN 0 AND evaluated_tokens),
  complete BOOLEAN NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (complete = (evaluated_tokens = total_unique_tokens))
);
`;
}

const EXPECTED_TABLES = [
  "market_indexer_source_state",
  "market_indexer_sync_points",
  "market_pools",
  "market_pool_state",
  "market_token_identity_shard",
  "market_token_identity_catalog_state"
] as const;

async function assertDedicatedDatabaseBeforeDdl(client: PoolClient) {
  const result = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  const unexpected = result.rows.map((row) => row.tablename).filter(
    (table) => !EXPECTED_TABLES.includes(table as (typeof EXPECTED_TABLES)[number])
  );
  if (unexpected.length > 0) {
    throw new Error(
      "MARKET_INDEXER_DATABASE_URL is not a dedicated database; unexpected public tables: " +
      unexpected.join(", ")
    );
  }
}

async function assertStorageMode(client: PoolClient, storageMode: MarketIndexerStorageMode) {
  const result = await client.query<{ relname: string; relpersistence: "p" | "u" }>(
    `SELECT c.relname, c.relpersistence
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY($1::text[])
     ORDER BY c.relname`,
    [EXPECTED_TABLES]
  );
  const expected = storageMode === "rebuildable" ? "u" : "p";
  const mismatched = result.rows.filter((row) => row.relpersistence !== expected).map((row) => row.relname);
  if (mismatched.length > 0) {
    throw new Error(
      `market indexer storage mode drift for ${mismatched.join(", ")}; use a fresh dedicated database or an explicit reviewed migration`
    );
  }
}

async function existingSchemaVersion(client: PoolClient) {
  const table = await client.query<{ present: boolean }>(
    "SELECT to_regclass('public.market_indexer_source_state') IS NOT NULL AS present"
  );
  if (!table.rows[0]?.present) return null;
  const hasSourceCode = await client.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'market_indexer_source_state'
         AND column_name = 'source_code'
     ) AS present`
  );
  const rows = hasSourceCode.rows[0]?.present
    ? await client.query<{
        source_id: string;
        source_code: number | null;
        manifest_hash: string;
        schema_version: number;
      }>(
        `SELECT source_id, source_code, manifest_hash, schema_version
         FROM market_indexer_source_state WHERE chain_id = $1 ORDER BY source_id FOR UPDATE`,
        [MARKET_INDEXER_CHAIN_ID]
      )
    : await client.query<{
        source_id: string;
        source_code: null;
        manifest_hash: string;
        schema_version: number;
      }>(
        `SELECT source_id, NULL::smallint AS source_code, manifest_hash, schema_version
         FROM market_indexer_source_state WHERE chain_id = $1 ORDER BY source_id FOR UPDATE`,
        [MARKET_INDEXER_CHAIN_ID]
      );
  if (rows.rows.length === 0) {
    const shape = await client.query<{ compact: boolean; v2: boolean }>(
      `SELECT
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='market_pools' AND column_name='source_code') AS compact,
         EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='market_pools' AND column_name='stable') AS v2`
    );
    return shape.rows[0]?.compact ? MARKET_INDEXER_SCHEMA_VERSION : shape.rows[0]?.v2 ? V2_SCHEMA_VERSION : 1;
  }
  if (rows.rows.some((row) => row.schema_version === MARKET_INDEXER_MIGRATION_SCHEMA_VERSION)) {
    throw new Error("compact schema migration is incomplete; writer must remain stopped");
  }
  const expectedIds = new Set(marketSources.map((source) => source.id));
  if (
    rows.rows.length === marketSources.length &&
    rows.rows.every((row) =>
      expectedIds.has(row.source_id) &&
      row.manifest_hash === MARKET_SOURCE_MANIFEST_HASH &&
      row.schema_version === MARKET_INDEXER_SCHEMA_VERSION &&
      row.source_code === sourceCodeForId(row.source_id)
    )
  ) return MARKET_INDEXER_SCHEMA_VERSION;
  if (
    rows.rows.every((row) =>
      expectedIds.has(row.source_id) &&
      row.manifest_hash === MARKET_SOURCE_MANIFEST_HASH &&
      row.schema_version === V2_SCHEMA_VERSION
    )
  ) return V2_SCHEMA_VERSION;
  const legacyIds = marketSources.slice(0, 5).map((source) => source.id).sort();
  if (
    rows.rows.map((row) => row.source_id).every((id, index) => id === legacyIds[index]) &&
    rows.rows.every((row) => row.schema_version === 1 && row.manifest_hash === MARKET_SOURCE_MANIFEST_V1_HASH)
  ) return 1 as const;
  throw new Error("market indexer schema/manifest drift; use an explicit reviewed migration");
}

export async function migrateMarketIndexer(
  pool: Pool,
  storageMode: MarketIndexerStorageMode = "durable"
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [MARKET_INDEXER_CHAIN_ID, MARKET_INDEXER_SCHEMA_VERSION]);
    await assertDedicatedDatabaseBeforeDdl(client);
    const priorVersion = await existingSchemaVersion(client);
    if (priorVersion !== null && priorVersion !== MARKET_INDEXER_SCHEMA_VERSION) {
      throw new Error(
        `market indexer schema v${priorVersion} requires the reviewed compact preserve-progress migration; writer remains stopped`
      );
    }
    await client.query(marketIndexerSchemaSql(storageMode));
    await assertStorageMode(client, storageMode);
    for (const source of marketSources) {
      const sourceCode = sourceCodeForId(source.id);
      const existing = await client.query<{
        source_code: number;
        contract_address: string;
        start_block: string;
        runtime_code_hash: string;
        deployment_transaction: string;
        manifest_hash: string;
        schema_version: number;
      }>(
        `SELECT source_code, contract_address, start_block, runtime_code_hash,
                deployment_transaction, manifest_hash, schema_version
         FROM market_indexer_source_state WHERE chain_id = $1 AND source_id = $2 FOR UPDATE`,
        [MARKET_INDEXER_CHAIN_ID, source.id]
      );
      const row = existing.rows[0];
      if (row && (
        row.source_code !== sourceCode ||
        row.contract_address !== source.contract.toLowerCase() ||
        row.start_block !== source.startBlock.toString() ||
        row.runtime_code_hash !== source.runtimeCodeHash ||
        row.deployment_transaction !== source.deploymentTransaction ||
        row.manifest_hash !== MARKET_SOURCE_MANIFEST_HASH ||
        row.schema_version !== MARKET_INDEXER_SCHEMA_VERSION
      )) throw new Error(`source manifest drift for ${source.id}; use an explicit reviewed migration`);
      await client.query(
        `INSERT INTO market_indexer_source_state (
           chain_id, source_id, source_code, protocol, protocol_version, source_kind,
           contract_address, start_block, next_block, runtime_code_hash,
           deployment_transaction, manifest_hash, schema_version, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,'backfilling')
         ON CONFLICT (chain_id, source_id) DO NOTHING`,
        [
          MARKET_INDEXER_CHAIN_ID,
          source.id,
          sourceCode,
          source.protocol,
          source.version,
          source.kind,
          source.contract.toLowerCase(),
          source.startBlock.toString(),
          source.runtimeCodeHash,
          source.deploymentTransaction,
          MARKET_SOURCE_MANIFEST_HASH,
          MARKET_INDEXER_SCHEMA_VERSION
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function rollbackSourceAfter(client: PoolClient, sourceId: string, blockNumber: bigint) {
  const sourceCode = sourceCodeForId(sourceId);
  await client.query(
    "DELETE FROM market_pool_state WHERE source_code = $1 AND observed_block > $2",
    [sourceCode, blockNumber.toString()]
  );
  await client.query(
    "DELETE FROM market_pools WHERE source_code = $1 AND block_number > $2",
    [sourceCode, blockNumber.toString()]
  );
  await client.query(
    "DELETE FROM market_indexer_sync_points WHERE source_code = $1 AND block_number > $2",
    [sourceCode, blockNumber.toString()]
  );
  await client.query(
    `UPDATE market_indexer_source_state
     SET next_block = $3, status = 'backfilling', last_error = NULL, updated_at = NOW()
     WHERE chain_id = $1 AND source_id = $2`,
    [MARKET_INDEXER_CHAIN_ID, sourceId, (blockNumber + 1n).toString()]
  );
}

export async function retainLatestSourceSyncPoints(client: PoolClient, sourceId: string) {
  const sourceCode = sourceCodeForId(sourceId);
  await client.query(
    `DELETE FROM market_indexer_sync_points
     WHERE source_code = $1
       AND block_number NOT IN (
         SELECT block_number FROM market_indexer_sync_points
         WHERE source_code = $1
         ORDER BY block_number DESC LIMIT 64
       )`,
    [sourceCode]
  );
}
