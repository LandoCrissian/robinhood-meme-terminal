import assert from "node:assert/strict";
import { Client } from "pg";
import { curveProductionSchemaSql, initializeProductionCurveStore, commitProductionCurveRange,
  productionCurveScope, readProductionCurveLaunches, rollbackProductionCurve } from "./curve-production-store.js";
import { syntheticProductionConfig as config, syntheticProductionRegistration } from "./curve-production-smoke.js";
import { testCreatorEarningsPostgres } from "./creator-earnings-postgres-smoke.js";
import { testProductionClaimStorePostgres } from "./production-claim-store-smoke.js";

const text = process.env.DATABASE_URL;
if (!text) throw new Error("A dedicated local production-adapter smoke database is required");
const url = new URL(text);
if (!["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/rmt_curve_production_smoke_[a-z0-9_]+$/.test(url.pathname)) {
  throw new Error("Use a fresh loopback rmt_curve_production_smoke_* database only");
}
const first = new Client({ connectionString: text, connectionTimeoutMillis: 3_000 });
const reopened = new Client({ connectionString: text, connectionTimeoutMillis: 3_000 });
const second = new Client({ connectionString: text, connectionTimeoutMillis: 3_000 });
const scope = productionCurveScope(config);
const item = syntheticProductionRegistration();
let firstClosed = false;
let reopenedClosed = false;
try {
  await first.connect();
  assert.equal((await first.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'")).rows[0]?.count, 0,
    "the smoke must never modify a reused database");
  await assert.rejects(initializeProductionCurveStore(first, config), /verified backup and explicit installation/);
  await first.query(curveProductionSchemaSql);
  await initializeProductionCurveStore(first, config);
  await second.connect();
  await assert.rejects(initializeProductionCurveStore(second, config), /database_writer_conflict/);

  // Force a real PostgreSQL failure after registration INSERT and before cursor commit.
  await first.query("ALTER TABLE rmt_curve_production_checkpoints ADD CONSTRAINT synthetic_interruption CHECK (block_number <> 100)");
  await assert.rejects(commitProductionCurveRange(first, config, 100n, item.checkpoint, [item]), /synthetic_interruption/);
  assert.equal((await first.query("SELECT count(*)::int AS count FROM rmt_curve_production_launches")).rows[0]?.count, 0);
  assert.equal((await first.query("SELECT next_block::text FROM rmt_curve_production_bindings")).rows[0]?.next_block, "100");
  await first.query("ALTER TABLE rmt_curve_production_checkpoints DROP CONSTRAINT synthetic_interruption");

  await commitProductionCurveRange(first, config, 100n, item.checkpoint, [item, item]);
  await commitProductionCurveRange(first, config, 100n, item.checkpoint, [item]);
  assert.equal((await first.query("SELECT count(*)::int AS count FROM rmt_curve_production_launches")).rows[0]?.count, 1);
  assert.equal((await readProductionCurveLaunches(first, scope, item.checkpoint, { token: item.token, limit: 1 }))[0]?.token, item.token);
  await first.end();
  firstClosed = true;

  await reopened.connect();
  await initializeProductionCurveStore(reopened, config);
  const recovered = await readProductionCurveLaunches(reopened, scope, item.checkpoint, { limit: 25 });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0]?.creation.transactionHash, item.creation.transactionHash);
  assert.equal(recovered[0]?.chainId, 4663);
  // The original receipt remains exact as the durable cursor advances; a
  // replaced receipt is removed before a canonical replay can republish it.
  const next = { blockNumber: "101", blockHash: "0x" + "a".repeat(64) as `0x${string}`,
    timestamp: "2026-11-17T12:00:01.000Z" };
  await commitProductionCurveRange(reopened, config, 101n, next, []);
  assert.equal((await reopened.query("SELECT next_block::text FROM rmt_curve_production_bindings")).rows[0]?.next_block, "102");
  const advanced = await readProductionCurveLaunches(reopened, scope, next, { limit: 25 });
  assert.deepEqual(advanced[0]?.creation, item.creation);
  await assert.rejects(readProductionCurveLaunches(reopened, scope, item.checkpoint, { limit: 25 }), /checkpoint changed/);
  assert.equal((await readProductionCurveLaunches(reopened, scope, item.checkpoint, { limit: 25 }, true))[0]?.token, item.token,
    "An in-flight discovery request keeps its still-canonical bounded page across normal extension");
  await rollbackProductionCurve(reopened, scope, 99n);
  await assert.rejects(readProductionCurveLaunches(reopened, scope, item.checkpoint, { limit: 25 }, true), /checkpoint changed/);
  const replacementPoint = { ...item.checkpoint, blockHash: "0x" + "b".repeat(64) as `0x${string}` };
  const canonical = { ...item, checkpoint: replacementPoint,
    creation: { ...item.creation, blockHash: replacementPoint.blockHash,
      transactionHash: "0x" + "c".repeat(64) as `0x${string}` } };
  await commitProductionCurveRange(reopened, config, 100n, replacementPoint, [canonical]);
  const replayed = await readProductionCurveLaunches(reopened, scope, replacementPoint, { limit: 25 });
  assert.equal(replayed.length, 1);
  assert.deepEqual(replayed[0]?.creation, canonical.creation);
  await assert.rejects(readProductionCurveLaunches(reopened, scope, item.checkpoint, { limit: 25 }), /checkpoint changed/);
  await rollbackProductionCurve(reopened, scope, 99n);
  assert.equal((await reopened.query("SELECT count(*)::int AS count FROM rmt_curve_production_launches")).rows[0]?.count, 0);
  assert.equal((await reopened.query("SELECT next_block::text FROM rmt_curve_production_bindings")).rows[0]?.next_block, "100");
  await assert.rejects(readProductionCurveLaunches(reopened, scope, item.checkpoint, { limit: 25 }), /checkpoint changed/);
  assert.equal((await reopened.query("SELECT to_regclass('public.indexer_state') AS historical")).rows[0]?.historical, null);
  await testCreatorEarningsPostgres(reopened, text, config, item);
  await testProductionClaimStorePostgres(reopened, text, config, () => { reopenedClosed = true; });
  console.info("Production adapter PostgreSQL atomic rollback, duplicate replay, lease, restart and reorg smoke passed.");
} finally {
  if (!firstClosed) await first.end().catch(() => undefined);
  if (!reopenedClosed) await reopened.end().catch(() => undefined);
  await second.end().catch(() => undefined);
}
