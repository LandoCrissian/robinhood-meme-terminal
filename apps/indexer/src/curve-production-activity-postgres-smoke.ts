import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { encodeAbiParameters, encodeEventTopics, parseAbi, zeroAddress, type Address, type Hash, type Hex, type PublicClient } from "viem";
import { syntheticProductionConfig as config, syntheticProductionRegistration } from "./curve-production-smoke.js";
import { curveProductionSchemaSql, initializeProductionCurveStore, commitProductionCurveRange,
  productionCurveScope, rollbackProductionCurve } from "./curve-production-store.js";
import { productionActivitySchemaSql, parseProductionActivityQuery, createProductionActivityIndexer,
  initializeProductionActivityStore, productionActivityCursor, readProductionActivity, commitProductionActivity,
  activityPermit2, activityRouter212, type ProductionActivityEvent } from "./curve-production-activity.js";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/^\/rmt_curve_production_smoke_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Fresh dedicated loopback synthetic database required");
const db = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 3_000 });
const hash = (n: number): Hash => `0x${n.toString(16).padStart(64, "0")}`;
const address = (n: number): Address => `0x${((1n << 156n) + BigInt(n)).toString(16).padStart(40, "0")}`;
const item = syntheticProductionRegistration(), scope = productionCurveScope(config);
const query = { transactionHash: hash(10), token: item.token.toLowerCase() as Address };
let replaced = false, disagree = false, forgedReceipt = false, globalMode = false, permitMode = false;
const permitApprovalAbi = parseAbi(["event Approval(address indexed owner,address indexed token,address indexed spender,uint160 amount,uint48 expiration)"]);
const permitTopics = encodeEventTopics({ abi: permitApprovalAbi, eventName: "Approval", args: { owner: item.creator, token: item.token, spender: activityRouter212 } }) as Hex[];
const permitData = encodeAbiParameters([{ type: "uint160" }, { type: "uint48" }], [123n, 1_795_100_000]);
const creationClaimTopics = encodeEventTopics({ abi: parseAbi(["event CreationFeesClaimed(address indexed recipient,uint256 amount)"]),
  eventName: "CreationFeesClaimed", args: { recipient: item.creator } }) as Hex[];
function event(): ProductionActivityEvent {
  if (permitMode) return { address: activityPermit2, logIndex: 9, blockNumber: "102", blockHash: hash(102), transactionHash: hash(66),
    transactionIndex: 0, topics: permitTopics, data: permitData };
  return { address: (globalMode ? config.binding.factory : item.initialCurve).toLowerCase() as Address, logIndex: 7,
    blockNumber: globalMode ? "101" : "100", blockHash: globalMode ? hash(101) : replaced ? hash(900) : hash(100),
    transactionHash: globalMode ? hash(55) : replaced ? hash(910) : hash(10), transactionIndex: 0,
    topics: globalMode ? creationClaimTopics : [hash(123)], data: "0x0011" };
}
function rpc(peer: boolean): PublicClient {
  return {
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, hash: replaced && blockNumber === 100n ? hash(900) : hash(Number(blockNumber)),
      timestamp: 1_795_000_000n + blockNumber, transactions: [permitMode ? hash(66) : globalMode ? hash(55) : replaced ? hash(910) : hash(10)] }),
    getLogs: async ({ address: selected, args }: { address: Address | Address[]; args?: { token: Address[]; spender: Address } }) => {
      if (selected === activityPermit2) {
        assert.ok(args?.token.includes(item.token.toLowerCase() as Address)); assert.ok(args!.token.length <= 32);
        assert.equal(args!.spender, activityRouter212, "No global Permit2 scan");
        return permitMode ? [{ ...event(), blockNumber: 102n, removed: false }] : [];
      }
      if (permitMode) return [];
      if (!Array.isArray(selected) || !selected.includes(item.initialCurve.toLowerCase() as Address)) return [];
      return [{ ...event(), blockNumber: globalMode ? 101n : 100n, data: peer && disagree ? "0x9999" : "0x0011", removed: false }];
    },
    readContract: async ({ functionName }: { functionName: string }) => ({ graduationEngine: address(91), poolManager: address(92),
      curveForToken: item.initialCurve, migrationCandidate: zeroAddress, poolId: hash(0), lpFeeLedger: zeroAddress, permit2: activityPermit2 })[functionName],
    getTransactionReceipt: async () => permitMode ? ({ status: "success", blockNumber: 102n, blockHash: hash(102), transactionHash: hash(66), transactionIndex: 0,
      logs: [{ ...event(), blockNumber: 102n, removed: false }] }) : ({ status: "success", blockNumber: globalMode ? 101n : 100n, blockHash: globalMode ? hash(101) : replaced ? hash(900) : hash(100),
      transactionHash: globalMode ? hash(55) : replaced ? hash(910) : hash(10), transactionIndex: 0, logs: [
        { ...event(), blockNumber: globalMode ? 101n : 100n, data: forgedReceipt ? "0xffff" : "0x0011", removed: false },
        { ...event(), address: item.token, logIndex: 8, topics: [hash(456)], blockNumber: globalMode ? 101n : 100n, data: "0xaabb", removed: false },
      ] }),
  } as unknown as PublicClient;
}
try {
  await db.connect();
  assert.equal((await db.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'")).rows[0]?.count, 0, "Never reuse a database");
  const path = `http://test/curve-activity?transactionHash=${hash(10)}&token=${item.token}`;
  assert.deepEqual(parseProductionActivityQuery(new URL(path)), query);
  assert.equal(parseProductionActivityQuery(new URL(`http://test/curve-activity?transactionHash=${hash(10)}`))?.token, undefined);
  for (const suffix of ["&token=bad", "&other=x", `&transactionHash=${hash(11)}`]) assert.equal(parseProductionActivityQuery(new URL(path + suffix)), null);
  assert.equal(parseProductionActivityQuery(new URL(`http://test/curve-activity?transactionHash=${hash(10)}&token=${zeroAddress}`)), null);
  await assert.rejects(initializeProductionActivityStore(db, config), /explicitly approved schema/);
  assert.equal((await db.query("SELECT to_regclass('public.rmt_curve_activity_events') AS t")).rows[0]?.t, null, "No runtime DDL");
  assert.equal(readFileSync(new URL("../migrations/092-production-activity.sql", import.meta.url), "utf8").trim(), productionActivitySchemaSql.trim());
  await db.query(curveProductionSchemaSql); await initializeProductionCurveStore(db, config);
  await commitProductionCurveRange(db, config, 100n, item.checkpoint, [item]);
  await db.query(productionActivitySchemaSql);
  const primary = rpc(false), secondary = rpc(true);
  let indexer = createProductionActivityIndexer(config, db, primary, secondary);
  disagree = true;
  await assert.rejects(indexer.sync(item.checkpoint), /providers disagree on event discovery/);
  assert.equal(await productionActivityCursor(db, scope), 100n);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM rmt_curve_activity_events")).rows[0]?.n, 0);
  disagree = false; forgedReceipt = true;
  await assert.rejects(indexer.sync(item.checkpoint), /absent from canonical receipt/);
  assert.equal(await productionActivityCursor(db, scope), 100n);
  forgedReceipt = false;
  // Synthetic checkpoint timestamp is independent from a receipt's emitted logs.
  const canonicalPoint = { blockNumber: "100", blockHash: hash(100), timestamp: new Date(Number(1_795_000_100n) * 1_000).toISOString() };
  await indexer.sync(canonicalPoint);
  assert.equal(indexer.ready(canonicalPoint), true);
  const observed = await readProductionActivity(db, scope, canonicalPoint, query);
  assert.equal(observed.length, 2, "Receipt-only Approval/Transfer rows persist with discovered trade");
  assert.deepEqual(observed[0], event());
  const reopened = new Client({ connectionString: url.toString() }); await reopened.connect();
  try {
    assert.deepEqual(await readProductionActivity(reopened, scope, canonicalPoint, query), observed);
    await assert.rejects(initializeProductionActivityStore(reopened, config), /database_writer_conflict/, "A second connection cannot ingest activity under another session's lease");
  } finally { await reopened.end(); }
  indexer = createProductionActivityIndexer(config, db, primary, secondary);
  await indexer.sync(canonicalPoint); assert.equal(indexer.ready(canonicalPoint), true, "Restart resumes exact durable cursor");
  assert.deepEqual(await readProductionActivity(db, scope, canonicalPoint, query), observed);
  await assert.rejects(readProductionActivity(db, scope, { ...canonicalPoint, blockHash: hash(999) }, query), /not caught up/);
  await assert.rejects(readProductionActivity(db, scope, canonicalPoint, { ...query, token: address(999) }), /not registered/);
  const next = { blockNumber: "101", blockHash: hash(101), timestamp: new Date(Number(1_795_000_101n) * 1_000).toISOString() };
  await assert.rejects(commitProductionActivity(db, config, 101n, next, [{ token: item.token, event: { ...event(), blockNumber: "101", blockHash: hash(101), data: "0x9999" } }]), /Conflicting durable activity/);
  assert.equal(await productionActivityCursor(db, scope), 101n);
  await db.query("ALTER TABLE rmt_curve_activity_checkpoints ADD CONSTRAINT synthetic_failure CHECK(block_number<>101)");
  await assert.rejects(commitProductionActivity(db, config, 101n, next, [{ token: item.token, event: { ...event(), blockNumber: "101", blockHash: hash(101), transactionHash: hash(55) } }]), /synthetic_failure/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM rmt_curve_activity_events WHERE transaction_hash=$1", [hash(55)])).rows[0]?.n, 0, "Atomic checkpoint failure rolls back event insert");
  assert.equal(await productionActivityCursor(db, scope), 101n);
  await db.query("ALTER TABLE rmt_curve_activity_checkpoints DROP CONSTRAINT synthetic_failure");
  await commitProductionCurveRange(db, config, 101n, next, []);
  await assert.rejects(readProductionActivity(db, scope, next, query), /not caught up/, "An advancing main checkpoint never makes old activity current");
  globalMode = true;
  await indexer.sync(next);
  assert.equal((await readProductionActivity(db, scope, next, { transactionHash: hash(55) })).length, 2, "Factory-global payout persists without inventing a token");
  assert.deepEqual(await readProductionActivity(db, scope, next, { ...query, transactionHash: hash(55) }), [], "A factory-global payout is not broadcast into project histories");
  assert.equal((await readProductionActivity(db, scope, next, { transactionHash: hash(10) })).length, 0, "Curve-only activity never enters factory-global namespace");
  globalMode = false;
  const permitPoint = { blockNumber: "102", blockHash: hash(102), timestamp: new Date(Number(1_795_000_102n) * 1_000).toISOString() };
  await commitProductionCurveRange(db, config, 102n, permitPoint, []); permitMode = true;
  await indexer.sync(permitPoint);
  const permitRows = await readProductionActivity(db, scope, permitPoint, { ...query, transactionHash: hash(66) });
  assert.deepEqual(permitRows, [event()], "A Permit2-only receipt becomes durable indexed evidence");
  assert.deepEqual(await readProductionActivity(db, scope, permitPoint, { transactionHash: hash(66) }), [], "Permit2 receipt is token scoped, not factory global");
  permitMode = false;
  // Reorg both creation and activity, then replay the replacement receipt.
  await rollbackProductionCurve(db, scope, 99n); replaced = true;
  const replacement = { ...canonicalPoint, blockHash: hash(900) };
  await commitProductionCurveRange(db, config, 100n, replacement, [{ ...item, creation: { ...item.creation, blockHash: hash(900), transactionHash: hash(910) } }]);
  await indexer.sync(replacement);
  assert.deepEqual(await readProductionActivity(db, scope, replacement, query), [], "Orphaned transaction removed");
  const replayed = await readProductionActivity(db, scope, replacement, { ...query, transactionHash: hash(910) });
  assert.equal(replayed.length, 2); assert.equal(replayed[0]?.blockHash, hash(900));
  assert.equal((await db.query("SELECT to_regclass('public.indexer_state') AS legacy")).rows[0]?.legacy, null);
  console.info("Task092 production activity PostgreSQL: strict parser, explicit schema, two-provider mismatch, forged receipt, complete receipt rows, factory-global payouts, bounded Permit2-only approval discovery, restart, stale/backfill gate, conflict, atomic rollback and reorg replay passed.");
} finally { await db.end().catch(() => undefined); }
