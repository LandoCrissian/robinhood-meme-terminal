import type { Pool, PoolClient } from 'pg';

export const NFT_INDEXER_TABLES = [
  'nft_indexer_source_state',
  'nft_indexer_sync_points',
  'nft_activity_events',
  'nft_activity_movements',
  'nft_erc721_ownership',
  'nft_erc1155_balances'
] as const;

export async function assertDedicatedNftIndexerDatabase(client: Pick<PoolClient, 'query'>) {
  const result = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename`
  );
  const allowed = new Set<string>(NFT_INDEXER_TABLES);
  const unrelated = result.rows.map((row) => row.tablename).filter((table) => !allowed.has(table));
  if (unrelated.length > 0) throw new Error(`NFT indexer database contains unrelated public tables: ${unrelated.join(', ')}`);
}

export async function migrateNftIndexer(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(4663, 721)`);
    await assertDedicatedNftIndexerDatabase(client);
    await client.query(`
      CREATE TABLE IF NOT EXISTS nft_indexer_source_state (
        chain_id integer NOT NULL CHECK (chain_id = 4663),
        project_id text NOT NULL CHECK (project_id <> ''),
        collection_address text NOT NULL CHECK (collection_address ~ '^0x[0-9A-Fa-f]{40}$'),
        standard text NOT NULL CHECK (standard IN ('ERC721','ERC1155')),
        start_block numeric(78,0) NOT NULL CHECK (start_block >= 0),
        next_block numeric(78,0) NOT NULL CHECK (next_block >= start_block),
        last_processed_block numeric(78,0),
        last_processed_hash text CHECK (last_processed_hash IS NULL OR last_processed_hash ~ '^0x[0-9A-Fa-f]{64}$'),
        deployment_transaction text NOT NULL CHECK (deployment_transaction ~ '^0x[0-9A-Fa-f]{64}$'),
        verified_at timestamptz NOT NULL,
        status text NOT NULL DEFAULT 'BACKFILLING' CHECK (status IN ('BACKFILLING','SYNCED','ERROR')),
        last_sync_at timestamptz,
        last_error text CHECK (last_error IS NULL OR (length(last_error) BETWEEN 1 AND 4096)),
        CHECK ((last_processed_block IS NULL) = (last_processed_hash IS NULL)),
        CONSTRAINT nft_indexer_source_state_error_consistency
          CHECK ((status = 'ERROR') = (last_error IS NOT NULL)),
        PRIMARY KEY (chain_id, collection_address)
      );
      ALTER TABLE nft_indexer_source_state
        ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'BACKFILLING'
          CHECK (status IN ('BACKFILLING','SYNCED','ERROR')),
        ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
        ADD COLUMN IF NOT EXISTS last_error text
          CHECK (last_error IS NULL OR (length(last_error) BETWEEN 1 AND 4096));
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'nft_indexer_source_state_error_consistency'
        ) THEN
          ALTER TABLE nft_indexer_source_state ADD CONSTRAINT nft_indexer_source_state_error_consistency
            CHECK ((status = 'ERROR') = (last_error IS NOT NULL));
        END IF;
      END $$;
      CREATE TABLE IF NOT EXISTS nft_indexer_sync_points (
        chain_id integer NOT NULL CHECK (chain_id = 4663),
        collection_address text NOT NULL,
        block_number numeric(78,0) NOT NULL CHECK (block_number >= 0),
        block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9A-Fa-f]{64}$'),
        PRIMARY KEY (chain_id, collection_address, block_number),
        FOREIGN KEY (chain_id, collection_address) REFERENCES nft_indexer_source_state(chain_id, collection_address) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS nft_activity_events (
        chain_id integer NOT NULL CHECK (chain_id = 4663), project_id text NOT NULL,
        collection_address text NOT NULL, standard text NOT NULL CHECK (standard IN ('ERC721','ERC1155')),
        transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9A-Fa-f]{64}$'),
        log_index integer NOT NULL CHECK (log_index >= 0), block_number numeric(78,0) NOT NULL,
        block_hash text NOT NULL CHECK (block_hash ~ '^0x[0-9A-Fa-f]{64}$'),
        source_event text NOT NULL CHECK (source_event IN ('TRANSFER','TRANSFER_SINGLE','TRANSFER_BATCH')),
        operator text, market_meaning text NOT NULL CHECK (market_meaning = 'NOT_ESTABLISHED'),
        PRIMARY KEY (chain_id, collection_address, transaction_hash, log_index)
      );
      CREATE INDEX IF NOT EXISTS nft_activity_events_block_idx ON nft_activity_events(chain_id, collection_address, block_number, log_index);
      CREATE TABLE IF NOT EXISTS nft_activity_movements (
        chain_id integer NOT NULL, collection_address text NOT NULL, transaction_hash text NOT NULL,
        log_index integer NOT NULL, movement_index integer NOT NULL CHECK (movement_index >= 0),
        token_id numeric(78,0) NOT NULL CHECK (token_id >= 0), amount numeric(78,0) NOT NULL CHECK (amount >= 0),
        from_address text NOT NULL, to_address text NOT NULL, kind text NOT NULL CHECK (kind IN ('MINT','TRANSFER','BURN')),
        PRIMARY KEY (chain_id, collection_address, transaction_hash, log_index, movement_index),
        FOREIGN KEY (chain_id, collection_address, transaction_hash, log_index)
          REFERENCES nft_activity_events(chain_id, collection_address, transaction_hash, log_index) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS nft_erc721_ownership (
        chain_id integer NOT NULL CHECK (chain_id = 4663), collection_address text NOT NULL,
        token_id numeric(78,0) NOT NULL CHECK (token_id >= 0), owner_address text NOT NULL,
        PRIMARY KEY (chain_id, collection_address, token_id)
      );
      CREATE TABLE IF NOT EXISTS nft_erc1155_balances (
        chain_id integer NOT NULL CHECK (chain_id = 4663), collection_address text NOT NULL,
        token_id numeric(78,0) NOT NULL CHECK (token_id >= 0), account_address text NOT NULL,
        balance numeric(78,0) NOT NULL CHECK (balance > 0),
        PRIMARY KEY (chain_id, collection_address, token_id, account_address)
      );
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
