export const schemaSql = `
CREATE TABLE IF NOT EXISTS indexer_state (
  chain_id INTEGER PRIMARY KEY,
  next_block BIGINT NOT NULL,
  factory TEXT,
  start_block BIGINT,
  schema_version INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS factory TEXT;
ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS start_block BIGINT;
ALTER TABLE indexer_state ADD COLUMN IF NOT EXISTS schema_version INTEGER;

CREATE TABLE IF NOT EXISTS sync_points (
  chain_id INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  parent_hash TEXT NOT NULL,
  indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chain_id, block_number)
);

CREATE TABLE IF NOT EXISTS launches (
  token TEXT PRIMARY KEY,
  launch_id NUMERIC(78,0) NOT NULL,
  creator TEXT NOT NULL,
  market TEXT NOT NULL UNIQUE,
  reward_vault TEXT NOT NULL,
  graduation_pool_id TEXT NOT NULL,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  supply NUMERIC(78,0) NOT NULL,
  metadata_uri TEXT NOT NULL,
  creator_bps INTEGER NOT NULL,
  community_bps INTEGER NOT NULL,
  trader_bps INTEGER NOT NULL,
  liquidity_bps INTEGER NOT NULL,
  platform_bps INTEGER NOT NULL,
  transaction_hash TEXT NOT NULL,
  block_number BIGINT NOT NULL,
  log_index INTEGER NOT NULL,
  UNIQUE (transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS launches_block_idx ON launches (block_number DESC);

ALTER TABLE launches ADD COLUMN IF NOT EXISTS protocol_version INTEGER NOT NULL DEFAULT 6;
ALTER TABLE launches ALTER COLUMN protocol_version SET DEFAULT 6;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS policy_id TEXT;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS policy_version INTEGER;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS curve_fee_bps INTEGER;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS protocol_fee_share_bps INTEGER;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS post_graduation_fee_bps INTEGER;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS graduation_target NUMERIC(78,0);
ALTER TABLE launches ADD COLUMN IF NOT EXISTS fair_start_enabled BOOLEAN;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS fair_start_delay_blocks BIGINT;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS fair_start_duration_blocks BIGINT;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS fair_start_max_tx_bps INTEGER;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS fair_start_max_wallet_bps INTEGER;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS official_migration BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS original_creator TEXT;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS current_creator_fee_recipient TEXT;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS protocol_treasury TEXT;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS creator_payout_authority TEXT;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS fee_authorized_market TEXT;
ALTER TABLE launches ADD COLUMN IF NOT EXISTS fee_graduation_adapter TEXT;
UPDATE launches
SET original_creator = COALESCE(original_creator, creator),
    current_creator_fee_recipient = COALESCE(current_creator_fee_recipient, original_creator, creator);
ALTER TABLE launches ALTER COLUMN original_creator SET NOT NULL;
ALTER TABLE launches ALTER COLUMN current_creator_fee_recipient SET NOT NULL;

CREATE TABLE IF NOT EXISTS trades (
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  market TEXT NOT NULL,
  trader TEXT NOT NULL,
  recipient TEXT NOT NULL,
  is_buy BOOLEAN NOT NULL,
  token_amount NUMERIC(78,0) NOT NULL,
  eth_amount NUMERIC(78,0) NOT NULL,
  fee_amount NUMERIC(78,0) NOT NULL,
  virtual_eth_reserve NUMERIC(78,0) NOT NULL,
  virtual_token_reserve NUMERIC(78,0) NOT NULL,
  real_eth_reserve NUMERIC(78,0) NOT NULL,
  block_number BIGINT NOT NULL,
  PRIMARY KEY (transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS trades_market_block_idx ON trades (market, block_number DESC);

CREATE TABLE IF NOT EXISTS graduations (
  market TEXT PRIMARY KEY,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  real_eth_reserve NUMERIC(78,0) NOT NULL,
  token_inventory NUMERIC(78,0) NOT NULL,
  block_number BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS liquidity_migrations (
  market TEXT PRIMARY KEY,
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  adapter TEXT NOT NULL,
  pool TEXT NOT NULL,
  eth_amount NUMERIC(78,0) NOT NULL,
  token_amount NUMERIC(78,0) NOT NULL,
  liquidity NUMERIC(78,0) NOT NULL,
  block_number BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_payout_events (
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  transaction_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  fee_splitter TEXT NOT NULL,
  token TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('proposed', 'cancelled', 'changed', 'invalidated')),
  previous_recipient TEXT,
  proposed_recipient TEXT,
  new_recipient TEXT,
  authority TEXT NOT NULL,
  evidence_hash TEXT,
  change_nonce NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (transaction_hash, log_index)
);
ALTER TABLE creator_payout_events ADD COLUMN IF NOT EXISTS change_nonce NUMERIC(78,0) NOT NULL DEFAULT 0;
ALTER TABLE creator_payout_events ALTER COLUMN evidence_hash DROP NOT NULL;
ALTER TABLE creator_payout_events DROP CONSTRAINT IF EXISTS creator_payout_events_event_type_check;
ALTER TABLE creator_payout_events ADD CONSTRAINT creator_payout_events_event_type_check
  CHECK (event_type IN ('proposed', 'cancelled', 'changed', 'invalidated'));
CREATE INDEX IF NOT EXISTS creator_payout_splitter_block_idx
  ON creator_payout_events (fee_splitter, block_number DESC, transaction_index DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS creator_payout_token_block_idx
  ON creator_payout_events (token, block_number DESC, transaction_index DESC, log_index DESC);

CREATE TABLE IF NOT EXISTS graduation_fee_collections (
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  transaction_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  adapter TEXT NOT NULL,
  token TEXT NOT NULL,
  fee_splitter TEXT NOT NULL,
  native_amount NUMERIC(78,0) NOT NULL,
  token_amount NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS graduation_fee_token_block_idx
  ON graduation_fee_collections (token, block_number DESC, transaction_index DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS graduation_fee_splitter_block_idx
  ON graduation_fee_collections (fee_splitter, block_number DESC, transaction_index DESC, log_index DESC);

CREATE TABLE IF NOT EXISTS fee_splitter_events (
  transaction_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  transaction_index INTEGER NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash TEXT NOT NULL,
  fee_splitter TEXT NOT NULL,
  launch_token TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'fee_received',
    'direct_payment',
    'payment_deferred',
    'deferred_payment_claimed',
    'token_fee_received',
    'direct_token_payment',
    'token_payment_deferred',
    'deferred_token_payment_claimed'
  )),
  payer TEXT,
  recipient TEXT,
  currency_token TEXT,
  amount NUMERIC(78,0) NOT NULL,
  PRIMARY KEY (transaction_hash, log_index)
);
CREATE INDEX IF NOT EXISTS fee_splitter_event_splitter_block_idx
  ON fee_splitter_events (fee_splitter, block_number DESC, transaction_index DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS fee_splitter_event_token_block_idx
  ON fee_splitter_events (launch_token, block_number DESC, transaction_index DESC, log_index DESC);
CREATE INDEX IF NOT EXISTS fee_splitter_event_recipient_block_idx
  ON fee_splitter_events (recipient, block_number DESC, transaction_index DESC, log_index DESC);
`;
