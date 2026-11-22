import assert from "node:assert/strict";
import type { Client } from "pg";
import { toEventSelector, type PublicClient } from "viem";
import { curveCreationAbi, type BlockEvidence } from "./curve-launch-evidence.js";
import { indexerBirthDeployment, indexerBirthPins, isPrunedIndexerBirthState } from "./curve-production-birth.js";
import type { CurveProductionConfig } from "./curve-production-config.js";
import { productionCurveIdentity, productionCurveScope } from "./curve-production-store.js";

type Database = Pick<Client, "query">;
export const maxScannedActivityBlocks = 2000n;

export async function firstProductionRegistration(db: Database, scope: string) {
  const { rows } = await db.query<{ block_number: string }>(`SELECT block_number FROM rmt_curve_production_launches
    WHERE scope=$1 ORDER BY block_number LIMIT 1`, [scope]);
  return rows.length ? BigInt(rows[0]!.block_number) : null;
}

// Only the prefix before the first creation is eligible. A corrected registration
// inside a durable empty span invalidates that whole span, including its end.
export async function correctedEmptyRangePredecessor(db: Database, scope: string, first: bigint | null, birth: bigint) {
  const { rows } = await db.query<{ before: string; through: string | null; missing_creation: boolean }>(`WITH first_launch AS (
    SELECT coalesce($2::bigint,(SELECT min(block_number) FROM rmt_curve_production_launches WHERE scope=$1)) AS height
  ) SELECT COALESCE((SELECT max(block_number) FROM rmt_curve_activity_checkpoints WHERE scope=$1 AND block_number<height),$3::bigint-1) AS before,
    (SELECT min(block_number) FROM rmt_curve_activity_checkpoints WHERE scope=$1 AND block_number>=height) AS through,
    EXISTS (SELECT 1 FROM rmt_curve_production_launches l WHERE l.scope=$1 AND l.block_number=height AND NOT EXISTS (
      SELECT 1 FROM rmt_curve_activity_events e WHERE e.scope=l.scope AND e.token=l.token AND e.transaction_hash=l.transaction_hash
        AND e.log_index=l.log_index AND e.block_hash=l.block_hash AND e.block_number=l.block_number
        AND e.payload->>'address'=$4 AND e.payload->'topics'->>0=$5)) AS missing_creation FROM first_launch`,
  [scope, first?.toString() ?? null, String(birth), indexerBirthPins.factory[0].toLowerCase(), toEventSelector(curveCreationAbi[5])]);
  const row = rows[0]!;
  if (row.through === null) return null;
  const before = BigInt(row.before);
  return row.missing_creation || BigInt(row.through) - before > maxScannedActivityBlocks ? before : null;
}

const originalScope = [4663, indexerBirthPins.factory[0].toLowerCase(), indexerBirthDeployment.blockHash].join(":");
export async function assertNoCorrectedEmptyRange(db: Database, scope: string) {
  if (scope !== originalScope) return;
  assert.equal(await correctedEmptyRangePredecessor(db, scope, null, indexerBirthDeployment.blockNumber),
    null, "Activity awaits replay of a corrected registration");
}

// The registration writer admits only contiguous transactions starting at its
// durable cursor. It stores the range ends and commits launches in the same
// transaction. Check the entire retained prefix, including deployment and the
// captured registration anchor. Repeat under the writer lease at commit.
export async function assertEmptyCoverage(db: Database, config: CurveProductionConfig, from: bigint,
  end: bigint, anchor: BlockEvidence, previousHash: string | null) {
  const birth = config.binding.deploymentBlock;
  assert.ok(from >= birth && end - from + 1n > maxScannedActivityBlocks && end <= BigInt(anchor.blockNumber));
  const { rows } = await db.query<{ proven: boolean }>(`WITH boundaries AS (
    SELECT block_number,block_hash,observed_at,lag(block_number,1,$2::bigint-1) OVER w AS prior,lag(observed_at) OVER w AS prior_time
    FROM rmt_curve_production_checkpoints WHERE scope=$1 AND block_number<=$3
    WINDOW w AS (ORDER BY block_number)
  ) SELECT EXISTS (SELECT 1 FROM rmt_curve_production_bindings WHERE scope=$1 AND identity=$4::jsonb AND next_block>$3)
    AND EXISTS (SELECT 1 FROM boundaries WHERE block_number=$3 AND block_hash=$5 AND observed_at=$6)
    AND NOT EXISTS (SELECT 1 FROM boundaries WHERE block_number-prior NOT BETWEEN 1 AND 2000
      OR block_hash !~ '^0x[0-9a-f]{64}$' OR block_hash ~ '^0x0+$' OR NOT isfinite(observed_at) OR observed_at<prior_time)
    AND NOT EXISTS (SELECT 1 FROM rmt_curve_production_launches WHERE scope=$1 AND block_number<=$7)
    AND NOT EXISTS (SELECT 1 FROM rmt_curve_activity_events WHERE scope=$1 AND block_number BETWEEN $8 AND $7)
    AND (SELECT max(block_number) FROM rmt_curve_activity_checkpoints WHERE scope=$1)
      IS NOT DISTINCT FROM (CASE WHEN $8::bigint>$2 THEN $8::bigint-1 ELSE NULL END)
    AND ($8::bigint=$2 OR EXISTS (SELECT 1 FROM rmt_curve_activity_checkpoints
      WHERE scope=$1 AND block_number=$8::bigint-1 AND block_hash=$9)) AS proven`,
  [productionCurveScope(config), String(birth), anchor.blockNumber, productionCurveIdentity(config), anchor.blockHash,
    anchor.timestamp, String(end), String(from), previousHash]);
  assert.equal(rows[0]?.proven, true, "Verified-empty registration coverage or activity predecessor is incomplete");
}

// For this exact immutable factory every successful registration deploys two
// children. Nonce one at the end excludes any prior successful creation, even
// if a provider omitted a creation log or a short registration row was lost.
export async function verifyEmptyFactoryNonce(providers: readonly [PublicClient, PublicClient], config: CurveProductionConfig, end: bigint) {
  const results = await Promise.allSettled(providers.map(rpc => rpc.getTransactionCount({
    address: config.binding.factory, blockNumber: end,
  })));
  let pruned = false;
  for (const result of results) {
    if (result.status === "fulfilled") assert.equal(result.value, 1, "Factory nonce contradicts empty registration history");
    else if (isPrunedIndexerBirthState(result.reason)) pruned = true;
    else throw result.reason;
  }
  return !pruned;
}
