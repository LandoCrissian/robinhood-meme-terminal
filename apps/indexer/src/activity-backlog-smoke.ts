import assert from "node:assert/strict";
import { Client } from "pg";
import { toHex, type PublicClient } from "viem";
import { syntheticProductionConfig as config } from "./curve-production-smoke.js";
import {
  curveProductionSchemaSql,
  initializeProductionCurveStore,
  commitProductionCurveRange,
} from "./curve-production-store.js";
import {
  productionActivitySchemaSql,
  createProductionActivityIndexer,
} from "./curve-production-activity.js";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
    /^\/rmt_curve_production_smoke_[a-z0-9_]+$/.test(url.pathname),
);
const db = new Client({ connectionString: url.toString() });
const first = config.binding.deploymentBlock,
  count = 3_841_624n,
  last = first + count - 1n;
const lastSeen = [first - 1n, first - 1n],
  queries = [0, 0];
function rpc(peer: number) {
  return {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
      number: blockNumber,
      hash: toHex(blockNumber, { size: 32 }),
      timestamp: 1_795_000_000n + blockNumber,
    }),
    getLogs: async ({
      fromBlock,
      toBlock,
    }: {
      fromBlock: bigint;
      toBlock: bigint;
    }) => {
      assert.equal(fromBlock, lastSeen[peer]! + 1n);
      assert.ok(toBlock - fromBlock < 1000n);
      lastSeen[peer] = toBlock;
      queries[peer]!++;
      return [];
    },
  } as unknown as PublicClient;
}
await db.connect();
try {
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'",
      )
    ).rows[0].n,
    0,
  );
  await db.query(curveProductionSchemaSql + productionActivitySchemaSql);
  await initializeProductionCurveStore(db, config);
  const target = {
    blockNumber: String(last),
    blockHash: toHex(last, { size: 32 }),
    timestamp: new Date(Number(1_795_000_000n + last) * 1000).toISOString(),
  };
  await commitProductionCurveRange(db, config, first, target, []);
  const started = Date.now();
  const primary = rpc(0),
    archive = rpc(1);
  let worker = createProductionActivityIndexer(config, db, primary, archive);
  const expected = Number((count + 999n) / 1000n);
  for (let i = 0; i < expected; i++) {
    if (i === Math.floor(expected / 2))
      worker = createProductionActivityIndexer(config, db, primary, archive);
    await worker.sync(target);
    assert.equal(worker.ready(target), i === expected - 1);
  }
  const verified = await db.query(
    "SELECT count(*)::int AS n,min(block_number)::text AS first,max(block_number)::text AS last FROM rmt_curve_activity_checkpoints",
  );
  assert.equal(verified.rows[0].n, expected);
  assert.equal(verified.rows[0].last, String(last));
  assert.equal(verified.rows[0].first, String(first + 999n));
  assert.deepEqual(queries, [expected, expected]);
  assert.deepEqual(lastSeen, [last, last]);
  assert.equal(worker.height(), String(last));
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM rmt_curve_activity_events"))
      .rows[0].n,
    0,
  );
  console.log(
    JSON.stringify({
      blocks: String(count),
      batchLimit: 1000,
      committedCheckpoints: expected,
      providerLogRequests: queries,
      restarts: 1,
      events: 0,
      elapsedMs: Date.now() - started,
      clock: "unpaced deterministic RPC, actual PostgreSQL commits",
    }),
  );
} finally {
  await db.end();
}
