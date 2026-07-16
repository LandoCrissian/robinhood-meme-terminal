import type { Pool } from "pg";

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
  CONSTRAINT external_origin_adapter_state_factory_key
    UNIQUE (chain_id, factory),
  CONSTRAINT external_origin_adapter_state_claim_parent_key
    UNIQUE (chain_id, adapter_id, source_id, source_name, factory),
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
      factory
    )
    REFERENCES external_origin_adapter_state (
      chain_id,
      adapter_id,
      source_id,
      source_name,
      factory
    )
    ON DELETE RESTRICT,
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

export async function applyExternalOriginSchema(pool: Pool) {
  await pool.query(externalOriginSchemaSql);
}
