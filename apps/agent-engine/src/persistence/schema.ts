export const agentEngineSchemaSql = `
CREATE TABLE IF NOT EXISTS agent_engine_state (
  stream_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  revision BIGINT NOT NULL CHECK (revision >= 0),
  state_json JSONB NOT NULL,
  state_hash TEXT NOT NULL CHECK (state_hash ~ '^0x[0-9a-f]{64}$'),
  updated_at_ms BIGINT NOT NULL CHECK (updated_at_ms >= 0)
);

CREATE TABLE IF NOT EXISTS agent_engine_mutations (
  stream_id TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision > 0),
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^0x[0-9a-f]{64}$'),
  result_json JSONB NOT NULL,
  state_hash TEXT NOT NULL CHECK (state_hash ~ '^0x[0-9a-f]{64}$'),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (stream_id, revision),
  UNIQUE (stream_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS agent_engine_mutation_request_idx
  ON agent_engine_mutations (stream_id, request_hash);

CREATE TABLE IF NOT EXISTS agent_seasons (
  stream_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_at_ms BIGINT NOT NULL CHECK (starts_at_ms >= 0),
  ends_at_ms BIGINT CHECK (ends_at_ms IS NULL OR ends_at_ms > starts_at_ms),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (stream_id, season_id)
);

CREATE TABLE IF NOT EXISTS agents (
  stream_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  owner_address TEXT NOT NULL CHECK (owner_address ~ '^0x[0-9a-f]{40}$'),
  name TEXT NOT NULL,
  thesis TEXT NOT NULL,
  performance_state TEXT NOT NULL CHECK (performance_state IN ('INCUBATING','PAPER_ACTIVE','QUALIFIED','ELITE','RETIRED')),
  execution_mode TEXT NOT NULL CHECK (execution_mode = 'PAPER_ONLY'),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (stream_id, agent_id)
);
CREATE INDEX IF NOT EXISTS agents_owner_idx ON agents (stream_id, owner_address, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS strategy_versions (
  stream_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  spec_json JSONB NOT NULL,
  strategy_hash TEXT NOT NULL CHECK (strategy_hash ~ '^0x[0-9a-f]{64}$'),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (stream_id, strategy_id),
  UNIQUE (stream_id, agent_id, version),
  FOREIGN KEY (stream_id, agent_id) REFERENCES agents (stream_id, agent_id)
);

CREATE TABLE IF NOT EXISTS agent_decisions (
  stream_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL CHECK (strategy_version > 0),
  market_snapshot_id TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  action TEXT NOT NULL CHECK (action IN ('NO_ACTION','PREDICTION','OPEN_POSITION','CLOSE_POSITION')),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  reasoning_summary TEXT NOT NULL,
  model_identity TEXT NOT NULL,
  compiler_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  decision_hash TEXT NOT NULL CHECK (decision_hash ~ '^0x[0-9a-f]{64}$'),
  PRIMARY KEY (stream_id, decision_id),
  FOREIGN KEY (stream_id, agent_id, strategy_version) REFERENCES strategy_versions (stream_id, agent_id, version)
);
CREATE INDEX IF NOT EXISTS agent_decisions_agent_time_idx ON agent_decisions (stream_id, agent_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS predictions (
  stream_id TEXT NOT NULL,
  prediction_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL CHECK (strategy_version > 0),
  asset_id TEXT NOT NULL,
  condition TEXT NOT NULL,
  forecast_probability DOUBLE PRECISION NOT NULL CHECK (forecast_probability >= 0 AND forecast_probability <= 1),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  resolves_at_ms BIGINT NOT NULL CHECK (resolves_at_ms > created_at_ms),
  resolved_outcome SMALLINT CHECK (resolved_outcome IN (0,1)),
  resolved_at_ms BIGINT,
  PRIMARY KEY (stream_id, prediction_id),
  CHECK ((resolved_outcome IS NULL AND resolved_at_ms IS NULL) OR (resolved_outcome IS NOT NULL AND resolved_at_ms >= resolves_at_ms)),
  FOREIGN KEY (stream_id, agent_id, strategy_version) REFERENCES strategy_versions (stream_id, agent_id, version)
);
CREATE INDEX IF NOT EXISTS predictions_agent_resolution_idx ON predictions (stream_id, agent_id, resolves_at_ms DESC);

CREATE TABLE IF NOT EXISTS paper_accounts (
  stream_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  participant_type TEXT NOT NULL CONSTRAINT paper_accounts_participant_type_check CHECK (participant_type IN ('AGENT','HUMAN')),
  participant_id TEXT NOT NULL,
  balances_json JSONB NOT NULL,
  opened_at_ms BIGINT NOT NULL CHECK (opened_at_ms >= 0),
  PRIMARY KEY (stream_id, account_id),
  CONSTRAINT paper_accounts_participant_identity_key UNIQUE (stream_id, season_id, participant_type, participant_id),
  FOREIGN KEY (stream_id, season_id) REFERENCES agent_seasons (stream_id, season_id)
);

-- Development migration from the original AGENT-only projection. The canonical
-- engine snapshot remains the authority for validating that AGENT participant
-- IDs actually reference registered agents; HUMAN IDs are canonical wallet addresses.
ALTER TABLE paper_accounts DROP CONSTRAINT IF EXISTS paper_accounts_participant_type_check;
ALTER TABLE paper_accounts ADD CONSTRAINT paper_accounts_participant_type_check CHECK (participant_type IN ('AGENT','HUMAN'));
ALTER TABLE paper_accounts DROP CONSTRAINT IF EXISTS paper_accounts_stream_id_participant_id_fkey;
ALTER TABLE paper_accounts DROP CONSTRAINT IF EXISTS paper_accounts_stream_id_season_id_participant_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'paper_accounts_participant_identity_key'
      AND conrelid = 'paper_accounts'::regclass
  ) THEN
    ALTER TABLE paper_accounts
      ADD CONSTRAINT paper_accounts_participant_identity_key
      UNIQUE (stream_id, season_id, participant_type, participant_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS paper_orders (
  stream_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL CHECK (strategy_version > 0),
  account_id TEXT NOT NULL,
  input_asset_id TEXT NOT NULL,
  output_asset_id TEXT NOT NULL,
  input_amount_atomic NUMERIC(78,0) NOT NULL CHECK (input_amount_atomic > 0),
  maximum_slippage_bps INTEGER NOT NULL CHECK (maximum_slippage_bps BETWEEN 0 AND 10000),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING','FILLED','CANCELLED')),
  PRIMARY KEY (stream_id, order_id),
  FOREIGN KEY (stream_id, agent_id, strategy_version) REFERENCES strategy_versions (stream_id, agent_id, version),
  FOREIGN KEY (stream_id, account_id) REFERENCES paper_accounts (stream_id, account_id),
  CHECK (input_asset_id <> output_asset_id)
);
CREATE INDEX IF NOT EXISTS paper_orders_account_time_idx ON paper_orders (stream_id, account_id, created_at_ms DESC);

CREATE TABLE IF NOT EXISTS paper_fills (
  stream_id TEXT NOT NULL,
  fill_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  input_asset_id TEXT NOT NULL,
  output_asset_id TEXT NOT NULL,
  input_amount_atomic NUMERIC(78,0) NOT NULL CHECK (input_amount_atomic > 0),
  output_amount_atomic NUMERIC(78,0) NOT NULL CHECK (output_amount_atomic > 0),
  provider_id TEXT NOT NULL,
  fee_asset_id TEXT,
  fee_amount_atomic NUMERIC(78,0) NOT NULL CHECK (fee_amount_atomic >= 0),
  gas_asset_id TEXT,
  gas_cost_atomic NUMERIC(78,0) NOT NULL CHECK (gas_cost_atomic >= 0),
  filled_at_ms BIGINT NOT NULL CHECK (filled_at_ms >= 0),
  evidence_hash TEXT NOT NULL CHECK (evidence_hash ~ '^0x[0-9a-f]{64}$'),
  quote_evidence_json JSONB NOT NULL,
  PRIMARY KEY (stream_id, fill_id),
  UNIQUE (stream_id, order_id),
  FOREIGN KEY (stream_id, order_id) REFERENCES paper_orders (stream_id, order_id),
  FOREIGN KEY (stream_id, account_id) REFERENCES paper_accounts (stream_id, account_id)
);
CREATE INDEX IF NOT EXISTS paper_fills_agent_time_idx ON paper_fills (stream_id, agent_id, filled_at_ms DESC);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  stream_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  captured_at_ms BIGINT NOT NULL CHECK (captured_at_ms >= 0),
  quote_asset_id TEXT NOT NULL,
  mark_nav_atomic NUMERIC(78,0) NOT NULL CHECK (mark_nav_atomic > 0),
  liquidation_nav_atomic NUMERIC(78,0) NOT NULL CHECK (liquidation_nav_atomic > 0),
  PRIMARY KEY (stream_id, account_id, captured_at_ms),
  FOREIGN KEY (stream_id, account_id) REFERENCES paper_accounts (stream_id, account_id)
);

CREATE TABLE IF NOT EXISTS risk_events (
  stream_id TEXT NOT NULL,
  risk_event_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  account_id TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  detail TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  occurred_at_ms BIGINT NOT NULL CHECK (occurred_at_ms >= 0),
  PRIMARY KEY (stream_id, risk_event_id),
  FOREIGN KEY (stream_id, agent_id) REFERENCES agents (stream_id, agent_id),
  FOREIGN KEY (stream_id, account_id) REFERENCES paper_accounts (stream_id, account_id)
);
CREATE INDEX IF NOT EXISTS risk_events_agent_time_idx ON risk_events (stream_id, agent_id, occurred_at_ms DESC);

CREATE TABLE IF NOT EXISTS score_snapshots (
  stream_id TEXT NOT NULL,
  score_snapshot_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  brier_score DOUBLE PRECISION NOT NULL CHECK (brier_score >= 0 AND brier_score <= 1),
  prediction_count INTEGER NOT NULL CHECK (prediction_count >= 0),
  resolved_prediction_count INTEGER NOT NULL CHECK (resolved_prediction_count >= 0 AND resolved_prediction_count <= prediction_count),
  paper_fill_count INTEGER NOT NULL CHECK (paper_fill_count >= 0),
  captured_at_ms BIGINT NOT NULL CHECK (captured_at_ms >= 0),
  PRIMARY KEY (stream_id, score_snapshot_id),
  FOREIGN KEY (stream_id, agent_id) REFERENCES agents (stream_id, agent_id),
  FOREIGN KEY (stream_id, season_id) REFERENCES agent_seasons (stream_id, season_id)
);
CREATE INDEX IF NOT EXISTS score_snapshots_agent_season_idx ON score_snapshots (stream_id, season_id, agent_id, captured_at_ms DESC);
`;