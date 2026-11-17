import assert from "node:assert/strict";
import { Client } from "pg";
import { curveProductionSchemaSql, initializeProductionCurveStore, commitProductionCurveRange,
  productionCurveScope, readProductionCurveLaunches, rollbackProductionCurve } from "./curve-production-store.js";
import { syntheticProductionConfig as config, syntheticProductionRegistration } from "./curve-production-smoke.js";

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
  await rollbackProductionCurve(reopened, scope, 99n);
  assert.equal((await reopened.query("SELECT count(*)::int AS count FROM rmt_curve_production_launches")).rows[0]?.count, 0);
  assert.equal((await reopened.query("SELECT next_block::text FROM rmt_curve_production_bindings")).rows[0]?.next_block, "100");
  await assert.rejects(readProductionCurveLaunches(reopened, scope, item.checkpoint, { limit: 25 }), /checkpoint changed/);
  assert.equal((await reopened.query("SELECT to_regclass('public.indexer_state') AS historical")).rows[0]?.historical, null);
  console.info("Production adapter PostgreSQL atomic rollback, duplicate replay, lease, restart and reorg smoke passed.");
} finally {
  if (!firstClosed) await first.end().catch(() => undefined);
  await reopened.end().catch(() => undefined);
  await second.end().catch(() => undefined);
}
