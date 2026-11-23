import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import type { Address, PublicClient } from "viem";
import { curveProductionSchemaSql, productionCurveIdentity, productionCurveScope } from "./curve-production-store.js";
import { productionActivitySchemaSql } from "./curve-production-activity.js";
import { readCurveMarket, parseMarketQuery } from "./curve-market.js";
import {
  marketIntervals,
  saleTarget,
  backingTarget,
} from "./market-candles.js";
import { syntheticProductionConfig } from "./curve-production-smoke.js";
const read = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL("../../../docs/evidence/token-market/" + name, import.meta.url),
      "utf8",
    ),
  );
const replay = read("market-replay.json"),
  archive = read("receipts.json");
const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(
  url.hostname === "127.0.0.1" &&
    url.pathname === "/rmt_curve_production_smoke_task092_market",
);
const db = new Client({ connectionString: url.href });
const factory = replay.frames[0].factory,
  token = replay.token as Address;
const config = { ...syntheticProductionConfig, binding: { ...syntheticProductionConfig.binding, factory } };
const scope = productionCurveScope(config);
let frame = replay.frames[0];
const recorded = new Map<string, any>(
  [...archive.primary, ...archive.orphanedBranch].map((r) => [r.blockHash, r]),
);
const rpc = {
  readContract: async ({ functionName }: { functionName: string }) => {
    const values: Record<string, unknown> = {
      curveForToken: replay.curve,
      token,
      factory,
      executionVersion: 1,
      graduated: frame.phase === "graduated",
      sold: BigInt(frame.soldWei),
      backingReserve: BigInt(frame.backingWei),
      poolId: frame.graduation?.poolId ?? "0x" + "0".repeat(64),
      graduationSold: saleTarget,
      GRADUATION_BACKING: backingTarget,
    };
    assert.ok(Object.hasOwn(values, functionName));
    return values[functionName];
  },
  getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
    if (blockNumber === BigInt(frame.checkpoint.blockNumber)) {
      const record = recorded.get(frame.checkpoint.blockHash);
      assert.ok(record);
      return { number: blockNumber, hash: record.blockHash, timestamp: BigInt(record.time) };
    }
    const record = [...recorded.values()].find(
      (r) =>
        BigInt(r.block) === blockNumber &&
        (r.blockHash === frame.checkpoint.blockHash ||
          archive.primary.some((p: any) => p.blockHash === r.blockHash)),
    );
    assert.ok(record);
    return { number: blockNumber, hash: record.blockHash, timestamp: BigInt(record.time) };
  },
} as unknown as PublicClient;
async function checkpoint(f: any) {
  frame = f;
  const p = f.checkpoint;
  for (const prefix of ["production", "activity"]) {
    await db.query(
      "UPDATE rmt_curve_" +
        prefix +
        "_bindings SET next_block=$1 WHERE scope=$2",
      [BigInt(p.blockNumber) + 1n, scope],
    );
    await db.query(
      "INSERT INTO rmt_curve_" +
        prefix +
        "_checkpoints VALUES($1,$2,$3,$4) ON CONFLICT(scope,block_number) DO UPDATE SET block_hash=EXCLUDED.block_hash",
      [scope, p.blockNumber, p.blockHash, p.timestamp],
    );
  }
}
async function insert(r: any) {
  for (const l of r.logs)
    await db.query(
      "INSERT INTO rmt_curve_activity_events VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        scope,
        token,
        r.hash,
        l.ordinal,
        r.block,
        r.blockHash,
        {
          ...l,
          address: l.address.toLowerCase(),
          ...(l.ordinal % 2 === 0 && { marketTime: r.time }),
        },
      ],
    );
}
try {
  await db.connect();
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
      )
    ).rows[0].n,
    0,
  );
  await db.query(curveProductionSchemaSql);
  await db.query(productionActivitySchemaSql);
  await db.query(
    "INSERT INTO rmt_curve_production_bindings VALUES($1,$2::jsonb,1)",
    [scope, productionCurveIdentity(config)],
  );
  await db.query("INSERT INTO rmt_curve_activity_bindings VALUES($1,1)", [
    scope,
  ]);
  const first = archive.primary[0];
  await db.query(
    "INSERT INTO rmt_curve_production_launches VALUES($1,$2,$3,0,$4,$5,$6)",
    [
      scope,
      token,
      first.hash,
      first.block,
      first.blockHash,
      { token, chainId: 4663, factory, projectRegistry: config.binding.projectRegistry, initialCurve: replay.curve },
    ],
  );
  for (const r of archive.primary) await insert(r);
  for (const f of replay.frames) {
    await checkpoint(f);
    for (const interval of marketIntervals) {
      const market = await readCurveMarket(
        db,
        scope,
        config,
        [rpc, rpc],
        frame.checkpoint,
        { token, interval },
      );
      assert.equal(market.status, "ready");
      assert.deepEqual(market.candles, frame.charts[interval]);
      assert.equal(market.soldWei, frame.soldWei);
      assert.deepEqual(market.graduation, frame.graduation);
    }
  }
  const q = { token, interval: 60 },
    current = frame;
  const before = frame.charts[60][3].time;
  const older = await readCurveMarket(
    db,
    scope,
    config,
    [rpc, rpc],
    frame.checkpoint,
    { ...q, before },
  );
  assert.equal(older.status, "ready");
  assert.deepEqual(
    older.candles,
    current.charts[60].filter((r: any) => r.time < before),
  );
  // Advancing the registration head preserves the completed registered-token window.
  await db.query("UPDATE rmt_curve_production_bindings SET next_block=next_block+1 WHERE scope=$1", [scope]);
  assert.equal((await readCurveMarket(db, scope, config, [rpc, rpc], frame.checkpoint, q)).status, "ready");
  await assert.rejects(readCurveMarket(db, scope, config, [rpc, rpc], frame.checkpoint, { ...q, token: factory }), {message: "absence_cursor_alignment"});
  await db.query("UPDATE rmt_curve_production_bindings SET next_block=next_block-1 WHERE scope=$1", [scope]);
  await db.query(
    "UPDATE rmt_curve_activity_bindings SET next_block=next_block-1 WHERE scope=$1",
    [scope],
  );
  await assert.rejects(
    readCurveMarket(db, scope, config, [rpc, rpc], frame.checkpoint, q), {message: "checkpoint_binding"},
  );
  await checkpoint(current);
  await assert.rejects(
    readCurveMarket(
      db,
      scope,
      config,
      [
        rpc,
        {
          ...rpc,
          getBlock: async () => ({ hash: "0x0", timestamp: 0n }),
        } as unknown as PublicClient,
      ],
      frame.checkpoint,
      q,
    ),
  );
  assert.equal(
    parseMarketQuery(
      new URL("http://local/curve-market/" + token + "?interval=0"),
    ),
    null,
  );
  // Replace the orphaned branch inside a rollback-only database transaction, then restore canonical output.
  await db.query("BEGIN");
  await db.query(
    "DELETE FROM rmt_curve_activity_events WHERE block_number>=$1",
    [archive.orphanedBranch[0].block],
  );
  await insert(archive.orphanedBranch[0]);
  await checkpoint(replay.pending);
  const branch = await readCurveMarket(
    db,
    scope,
    config,
    [rpc, rpc],
    frame.checkpoint,
    q,
  );
  assert.equal(branch.status, "ready");
  assert.equal(branch.phase, "eligible");
  assert.deepEqual(branch.candles, replay.pending.charts[60]);
  await db.query("ROLLBACK");
  frame = current;
  const restored = await readCurveMarket(
    db,
    scope,
    config,
    [rpc, rpc],
    frame.checkpoint,
    q,
  );
  assert.equal(restored.status, "ready");
  assert.deepEqual(restored.candles, current.charts[60]);
  console.log(
    "Fork receipts matched PostgreSQL in all recorded checkpoint/interval combinations; old rows, sellbacks, branch replacement, pending graduation, pagination and disconnected checkpoints passed.",
  );
} finally {
  await db.end();
}
