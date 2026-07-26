import type { Pool, PoolClient } from "pg";
import {
  MARKET_INDEXER_CHAIN_ID,
  MARKET_INDEXER_SCHEMA_VERSION,
  MARKET_SOURCE_MANIFEST_HASH,
  marketSources
} from "./sources.js";

export type MarketIndexerStorageMode = "durable" | "rebuildable";

export function marketIndexerSchemaSql(storageMode: MarketIndexerStorageMode) {
  const persistence = storageMode === "rebuildable" ? "UNLOGGED " : "";
  return `
CREATE ${persistence}TABLE IF NOT EXISTS market_indexer_source_state (
  chain_id BIGINT NOT NULL,
  source_id TEXT NOT NULL,
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
  CHECK (source_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  CHECK (protocol IN ('sushiswap', 'uniswap')),
  CHECK (protocol_version IN (2, 3, 4)),
  CHECK (source_kind IN ('v2-factory', 'v3-factory', 'v4-manager')),
  CHECK (contract_address ~ '^0x[0-9a-f]{40}$' AND contract_address <> '0x0000000000000000000000000000000000000000'),
  CHECK (start_block >= 0 AND next_block >= start_block),
  CHECK (runtime_code_hash ~ '^0x[0-9a-f]{64}$' AND runtime_code_hash <> ('0x' || repeat('0', 64))),
  CHECK (deployment_transaction ~ '^0x[0-9a-f]{64}$'),
  CHECK (manifest_hash ~ '^0x[0-9a-f]{64}$' AND manifest_hash <> ('0x' || repeat('0', 64))),
  CHECK (schema_version > 0),
  CHECK (status IN ('backfilling', 'shadow-ready', 'error')),
  CHECK (status <> 'shadow-ready' OR (next_block > start_block AND last_sync_at IS NOT NULL AND last_error IS NULL)),
  CHECK (status <> 'error' OR last_error IS NOT NULL),
  CHECK (last_error IS NULL OR (last_error = BTRIM(last_error) AND CHAR_LENGTH(last_error) BETWEEN 1 AND 4096))
);

CREATE ${persistence}TABLE IF NOT EXISTS market_indexer_sync_points (
  chain_id BIGINT NOT NULL,
  source_id TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, source_id, block_number),
  FOREIGN KEY (chain_id, source_id)
    REFERENCES market_indexer_source_state (chain_id, source_id)
    ON DELETE CASCADE,
  CHECK (block_number >= 0),
  CHECK (block_hash ~ '^0x[0-9a-f]{64}$'),
  CHECK (parent_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE ${persistence}TABLE IF NOT EXISTS market_pools (
  chain_id BIGINT NOT NULL,
  source_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  pool_key TEXT NOT NULL,
  pool_address TEXT,
  token0 TEXT NOT NULL,
  token1 TEXT NOT NULL,
  fee INTEGER,
  tick_spacing INTEGER,
  hooks TEXT,
  transaction_hash TEXT NOT NULL,
  transaction_index INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, source_id, pool_key),
  UNIQUE (chain_id, transaction_hash, log_index),
  FOREIGN KEY (chain_id, source_id)
    REFERENCES market_indexer_source_state (chain_id, source_id)
    ON DELETE CASCADE,
  CHECK (chain_id = 4663),
  CHECK (protocol IN ('sushiswap', 'uniswap')),
  CHECK (protocol_version IN (2, 3, 4)),
  CHECK (
    (protocol_version IN (2, 3) AND pool_key ~ '^0x[0-9a-f]{40}$' AND pool_address = pool_key)
    OR
    (protocol_version = 4 AND pool_key ~ '^0x[0-9a-f]{64}$' AND pool_address IS NULL)
  ),
  CHECK (pool_address IS NULL OR (pool_address ~ '^0x[0-9a-f]{40}$' AND pool_address <> '0x0000000000000000000000000000000000000000')),
  CHECK (token0 ~ '^0x[0-9a-f]{40}$' AND token1 ~ '^0x[0-9a-f]{40}$' AND token0 <> token1),
  CHECK (
    (protocol_version = 2 AND fee IS NULL AND tick_spacing IS NULL AND hooks IS NULL)
    OR
    (protocol_version = 3 AND fee BETWEEN 1 AND 1000000 AND tick_spacing BETWEEN 1 AND 16384 AND hooks IS NULL)
    OR
    (protocol_version = 4 AND fee BETWEEN 0 AND 16777215 AND tick_spacing BETWEEN 1 AND 32767 AND hooks ~ '^0x[0-9a-f]{40}$')
  ),
  CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  CHECK (transaction_index >= 0 AND log_index >= 0 AND block_number >= 0),
  CHECK (block_hash ~ '^0x[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS market_pools_tokens_idx
  ON market_pools (chain_id, token0, token1);
CREATE INDEX IF NOT EXISTS market_pools_block_idx
  ON market_pools (chain_id, source_id, block_number DESC, transaction_index DESC, log_index DESC);
`;
}

const EXPECTED_TABLES = [
  "market_indexer_source_state",
  "market_indexer_sync_points",
  "market_pools"
] as const;

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
      "MARKET_INDEXER_DATABASE_URL is not a dedicated database; " +
      "unexpected public tables: " + unexpected.join(", ")
    );
  }
}

async function assertStorageMode(
  client: PoolClient,
  storageMode: MarketIndexerStorageMode
) {
  const result = await client.query<{
    relname: string;
    relpersistence: "p" | "u";
  }>(
    `SELECT c.relname, c.relpersistence
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname = ANY($1::text[])
     ORDER BY c.relname`,
    [EXPECTED_TABLES]
  );
  const expectedPersistence = storageMode === "rebuildable" ? "u" : "p";
  const mismatched = result.rows
    .filter((row) => row.relpersistence !== expectedPersistence)
    .map((row) => row.relname);
  if (mismatched.length > 0) {
    throw new Error(
      `market indexer storage mode drift for ${mismatched.join(", ")}; ` +
        "use a fresh dedicated database or an explicit reviewed migration"
    );
  }
}

export async function migrateMarketIndexer(
  pool: Pool,
  storageMode: MarketIndexerStorageMode = "durable"
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock($1, $2)",
      [MARKET_INDEXER_CHAIN_ID, MARKET_INDEXER_SCHEMA_VERSION]
    );
    await assertDedicatedDatabaseBeforeDdl(client);
    await client.query(marketIndexerSchemaSql(storageMode));
    await assertStorageMode(client, storageMode);
    for (const source of marketSources) {
      const existing = await client.query<{
        contract_address: string;
        start_block: string;
        runtime_code_hash: string;
        deployment_transaction: string;
        manifest_hash: string;
        schema_version: number;
      }>(
        `SELECT contract_address, start_block, runtime_code_hash,
                deployment_transaction, manifest_hash, schema_version
         FROM market_indexer_source_state
         WHERE chain_id = $1 AND source_id = $2
         FOR UPDATE`,
        [MARKET_INDEXER_CHAIN_ID, source.id]
      );
      const row = existing.rows[0];
      if (
        row &&
        (row.contract_address !== source.contract.toLowerCase() ||
          row.start_block !== source.startBlock.toString() ||
          row.runtime_code_hash !== source.runtimeCodeHash ||
          row.deployment_transaction !== source.deploymentTransaction ||
          row.manifest_hash !== MARKET_SOURCE_MANIFEST_HASH ||
          row.schema_version !== MARKET_INDEXER_SCHEMA_VERSION)
      ) {
        throw new Error(
          `source manifest drift for ${source.id}; use an explicit reviewed migration`
        );
      }
      await client.query(
        `INSERT INTO market_indexer_source_state (
           chain_id, source_id, protocol, protocol_version, source_kind,
           contract_address, start_block, next_block, runtime_code_hash,
           deployment_transaction, manifest_hash, schema_version, status
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,'backfilling')
         ON CONFLICT (chain_id, source_id) DO NOTHING`,
        [
          MARKET_INDEXER_CHAIN_ID,
          source.id,
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

export async function rollbackSourceAfter(
  client: PoolClient,
  sourceId: string,
  blockNumber: bigint
) {
  await client.query(
    "DELETE FROM market_pools WHERE chain_id = $1 AND source_id = $2 AND block_number > $3",
    [MARKET_INDEXER_CHAIN_ID, sourceId, blockNumber.toString()]
  );
  await client.query(
    "DELETE FROM market_indexer_sync_points WHERE chain_id = $1 AND source_id = $2 AND block_number > $3",
    [MARKET_INDEXER_CHAIN_ID, sourceId, blockNumber.toString()]
  );
  await client.query(
    `UPDATE market_indexer_source_state
     SET next_block = $3, status = 'backfilling', last_error = NULL, updated_at = NOW()
     WHERE chain_id = $1 AND source_id = $2`,
    [MARKET_INDEXER_CHAIN_ID, sourceId, (blockNumber + 1n).toString()]
  );
}
