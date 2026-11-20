-- Run only in the existing authorized private PostgreSQL console/session.
-- No credentials belong in a terminal argument, report, screenshot or Git.
-- This observes locks; it never calls pg_advisory_lock/pg_try_advisory_lock.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';

SELECT now() AS observed_at,
       current_setting('transaction_read_only') AS read_only,
       current_setting('server_version') AS postgres_version;

SELECT count(*) AS current_writer_holders,
       COALESCE(json_agg(json_build_object('pid', pid, 'granted', granted))
                FILTER (WHERE pid IS NOT NULL), '[]'::json) AS holders
FROM pg_locks
WHERE locktype = 'advisory'
  AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
  AND classid = 1380805961::oid
  AND objid = 4663::oid
  AND objsubid = 2
  AND granted;

SELECT scope, next_block::text
FROM rmt_curve_production_bindings
WHERE scope = '4663:0x7281e1f9d8764ae6533b374dfd08ab2ecbc273c3:0x4a72961fb6649c1690fe4cf361ae6a6fbbdab39117a85604e2a11ba4646c7639';

SELECT block_number::text, block_hash, observed_at
FROM rmt_curve_production_checkpoints
WHERE scope = '4663:0x7281e1f9d8764ae6533b374dfd08ab2ecbc273c3:0x4a72961fb6649c1690fe4cf361ae6a6fbbdab39117a85604e2a11ba4646c7639'
ORDER BY block_number DESC LIMIT 1;
ROLLBACK;
