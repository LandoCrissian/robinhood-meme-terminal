export const schemaSql = `
CREATE TABLE IF NOT EXISTS indexer_state (
  chain_id INTEGER PRIMARY KEY,
  next_block BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
`;
