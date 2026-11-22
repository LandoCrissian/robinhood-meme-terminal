-- Read-only. A span above the enforced 2,000-block receipt-scan ceiling is
-- reserved for verified-empty commits. Fork rollback removes orphaned spans.
WITH boundaries AS (
  SELECT c.scope,c.block_number,c.block_hash,c.observed_at,
    lag(c.block_number,1,(b.identity->'binding'->>'deploymentBlock')::bigint-1) OVER w AS previous,
    lag(c.block_hash) OVER w AS previous_hash
  FROM rmt_curve_activity_checkpoints c JOIN rmt_curve_production_bindings b USING(scope)
  WHERE c.scope='4663:0x7281e1f9d8764ae6533b374dfd08ab2ecbc273c3:0x4a72961fb6649c1690fe4cf361ae6a6fbbdab39117a85604e2a11ba4646c7639'
  WINDOW w AS (PARTITION BY c.scope ORDER BY c.block_number)
)
SELECT 'verified_empty' AS mode,c.scope,c.previous+1 AS from_block,c.previous_hash,c.block_number AS through_block,
  c.block_hash,c.observed_at,p.block_number AS covering_registration,p.block_hash AS registration_hash,
  EXISTS (SELECT 1 FROM rmt_curve_production_launches WHERE scope=c.scope AND block_number<=c.block_number) AS conflicts_with_registration,
  EXISTS (SELECT 1 FROM rmt_curve_activity_events WHERE scope=c.scope AND block_number BETWEEN c.previous+1 AND c.block_number) AS conflicts_with_events
FROM boundaries c
LEFT JOIN LATERAL (SELECT block_number,block_hash FROM rmt_curve_production_checkpoints
  WHERE scope=c.scope AND block_number>=c.block_number ORDER BY block_number LIMIT 1) p ON true
WHERE c.block_number-c.previous>2000 ORDER BY c.block_number;
