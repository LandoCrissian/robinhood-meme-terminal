CREATE TABLE IF NOT EXISTS rmt_curve_activity_bindings (
 scope TEXT PRIMARY KEY REFERENCES rmt_curve_production_bindings(scope), next_block BIGINT NOT NULL CHECK(next_block > 0)
);
CREATE TABLE IF NOT EXISTS rmt_curve_activity_checkpoints (
 scope TEXT NOT NULL REFERENCES rmt_curve_activity_bindings(scope), block_number BIGINT NOT NULL,
 block_hash TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(scope,block_number)
);
CREATE TABLE IF NOT EXISTS rmt_curve_activity_events (
 scope TEXT NOT NULL REFERENCES rmt_curve_activity_bindings(scope), token TEXT NOT NULL,
 transaction_hash TEXT NOT NULL, log_index INTEGER NOT NULL CHECK(log_index >= 0), block_number BIGINT NOT NULL,
 block_hash TEXT NOT NULL, payload JSONB NOT NULL, PRIMARY KEY(scope,token,transaction_hash,log_index)
);
CREATE INDEX IF NOT EXISTS rmt_curve_activity_events_block ON rmt_curve_activity_events(scope,block_number);
