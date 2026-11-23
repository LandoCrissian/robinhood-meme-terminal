import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { encodeAbiParameters, encodeEventTopics, toHex, zeroAddress, type Address, type PublicClient } from "viem";
import { curveCreationAbi } from "./curve-launch-evidence.js";
import { readCurveMarket } from "./curve-market.js";
import { activityPermit2, commitProductionActivity, createProductionActivityIndexer, productionActivityCursor,
  productionActivitySchemaSql, readProductionActivity, rollbackProductionActivity } from "./curve-production-activity.js";
import { indexerBirthDeployment as deployment, indexerBirthPins as pins } from "./curve-production-birth.js";
import { syntheticProductionConfig, syntheticProductionRegistration } from "./curve-production-smoke.js";
import { commitProductionCurveRange, curveProductionSchemaSql, initializeProductionCurveStore,
  productionCurveScope, rollbackProductionCurve } from "./curve-production-store.js";
import { backingTarget, saleTarget, tradeEvent } from "./market-candles.js";

const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/rmt_curve_production_smoke_verified_empty");
const db = new Client({ connectionString: url.href });
const config = { ...syntheticProductionConfig, deploymentTransactionHash: deployment.transactionHash, reserveRecipient: deployment.reserve,
  binding: { ...syntheticProductionConfig.binding, factory: pins.factory[0], factoryRuntimeHash: pins.factory[1],
    projectRegistry: pins.registry[0], projectRegistryRuntimeHash: pins.registry[1], creationFeeRecipient: deployment.operating,
    deploymentBlock: deployment.blockNumber, deploymentBlockHash: deployment.blockHash } };
const scope = productionCurveScope(config), birth = deployment.blockNumber, blocks = 3_841_624n, last = birth + blocks - 1n;
const originalCreation = last - 211n, tx = toHex(9123, { size: 32 });
const tradeTx = toHex(9124, { size: 32 });
let creation = originalCreation;
const item = { ...syntheticProductionRegistration(), factory: config.binding.factory, projectRegistry: config.binding.projectRegistry };
const token = item.token.toLowerCase() as Address;
let registered = false, traded = false, branch = 0n;
let fault: "none" | "nonce" | "split" | "pruned" | "absent-logs" = "none";
const scans: [bigint, bigint][] = [], nonceReads: bigint[] = [];
const timestamp = (n: bigint) => 1_795_000_000n + n - birth;
const hash = (n: bigint) => n === birth ? deployment.blockHash : toHex(n + (n >= originalCreation ? branch : 0n), { size: 32 });
const point = (n: bigint) => ({ blockNumber: String(n), blockHash: hash(n), timestamp: new Date(Number(timestamp(n)) * 1000).toISOString() });
const sold = 10n ** 18n, virtual = 18n * 10n ** 26n;
const backing = (4n * 10n ** 18n * sold + virtual - sold - 1n) / (virtual - sold);
const fee = (backing + 98n) / 99n;
function logs() {
  const base = { blockNumber: creation, blockHash: hash(creation), transactionHash: tx, transactionIndex: 0, removed: false };
  const created = { ...base, address: config.binding.factory, logIndex: 4, topics: encodeEventTopics({
    abi: curveCreationAbi, eventName: "CurveCreated", args: { token, curve: item.initialCurve, creator: item.creator } }),
    data: encodeAbiParameters(curveCreationAbi[5].inputs.filter(input => !("indexed" in input)),
      [item.intentId, BigInt(item.totalSupplyWei), item.revenueLedger, zeroAddress, 0, item.name, item.symbol, ""]) };
  const trade = { ...base, transactionHash: tradeTx, transactionIndex: 1, address: item.initialCurve, logIndex: 5, topics: encodeEventTopics({
    abi: [tradeEvent], eventName: "CurveTrade", args: { account: item.creator, isBuy: true } }),
    data: encodeAbiParameters(tradeEvent.inputs.filter(input => !("indexed" in input)), [sold, backing + fee, fee, 0n, sold, backing]) };
  return traded ? [created, trade] : [created];
}
function provider(second: boolean): PublicClient {
  return {
    getBlock: async ({ blockNumber: n }: { blockNumber: bigint }) => ({ number: n,
      hash: second && fault === "split" && n === last ? hash(n + 1n) : hash(n), timestamp: timestamp(n),
      transactions: n === creation ? (traded ? [tx, tradeTx] : [tx]) : [] }),
    getTransactionCount: async ({ address, blockNumber }: { address: Address; blockNumber: bigint }) => {
      assert.equal(address, config.binding.factory); nonceReads.push(blockNumber);
      if (fault === "pruned") throw Object.assign(new Error("historical state " + hash(blockNumber) + " is not available"), { code: -32000 });
      return (second && fault === "nonce") || (registered && blockNumber >= creation) ? 3 : 1;
    },
    getLogs: async ({ fromBlock, toBlock, address }: { fromBlock: bigint; toBlock: bigint; address: Address | Address[] }) => {
      assert.ok(toBlock - fromBlock < 1000n);
      scans.push([fromBlock, toBlock]);
      if (fault === "absent-logs" || !registered || fromBlock > creation || toBlock < creation || !Array.isArray(address)) return [];
      return logs().filter(log => address.includes(log.address.toLowerCase() as Address));
    },
    readContract: async ({ functionName }: { functionName: string }) => ({
      graduationEngine: pins.engine[0], poolManager: pins.guard[0], permit2: activityPermit2, lpFeeLedger: zeroAddress,
      curveForToken: registered ? item.initialCurve : zeroAddress, migrationCandidate: zeroAddress, poolId: toHex(0, { size: 32 }),
      token, factory: config.binding.factory, executionVersion: 1, graduated: false, sold: traded ? sold : 0n,
      backingReserve: traded ? backing : 0n, graduationSold: saleTarget, GRADUATION_BACKING: backingTarget,
    })[functionName],
    getTransactionReceipt: async ({ hash: id }: { hash: string }) => {
      assert.ok(id === tx || (traded && id === tradeTx));
      return { status: "success", blockNumber: creation, blockHash: hash(creation), transactionIndex: id === tx ? 0 : 1,
        transactionHash: id, logs: logs().filter(event => event.transactionHash === id) };
    },
  } as unknown as PublicClient;
}
const peers: [PublicClient, PublicClient] = [provider(false), provider(true)];
const cursor = () => productionActivityCursor(db, scope);
const market = () => readCurveMarket(db, scope, config, peers, point(last), { token, interval: 60 });
const activity = () => readProductionActivity(db, scope, point(last), { transactionHash: tx, ...(registered && { token }) });
const startWorker = () => createProductionActivityIndexer(config, db, ...peers);
const auditSql = readFileSync(new URL("../../../docs/evidence/verified-empty-activity/ranges.sql", import.meta.url), "utf8");
async function registerLastRange() {
  const start = last - blocks % 2000n + 1n;
  await rollbackProductionCurve(db, scope, start - 1n);
  await commitProductionCurveRange(db, config, start, point(last), [{ ...item,
    creation: { ...item.creation, ...point(creation), transactionHash: tx } }]);
}
try {
  await db.connect();
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
  await db.query(curveProductionSchemaSql + productionActivitySchemaSql);
  await initializeProductionCurveStore(db, config);
  // Use the real writer for every registration interval, from deployment, including the short tail.
  for (let start = birth; start <= last; start += 2000n) {
    await commitProductionCurveRange(db, config, start, point(start + 1999n < last ? start + 1999n : last), []);
  }
  let worker = startWorker();
  for (const mode of ["nonce", "split"] as const) {
    fault = mode;
    await assert.rejects(worker.sync(point(last)), mode === "nonce" ? /nonce contradicts/ : /providers disagree/);
    assert.equal(await cursor(), birth); assert.ok(!worker.ready(point(last)));
  }
  fault = "none";
  for (const n of [birth + 1999n, birth + 3999n, last]) {
    const sql = "DELETE FROM rmt_curve_production_checkpoints WHERE scope=$1 AND block_number=$2 RETURNING *";
    const deleted = (await db.query(sql, [scope, String(n)])).rows[0];
    await assert.rejects(worker.sync(point(last)), /coverage/);
    assert.equal(await cursor(), birth);
    await db.query("INSERT INTO rmt_curve_production_checkpoints VALUES($1,$2,$3,$4)",
      [scope, deleted.block_number, deleted.block_hash, deleted.observed_at]);
  }
  const other = new Client({ connectionString: url.href }); await other.connect();
  try { await assert.rejects(createProductionActivityIndexer(config, other, ...peers).sync(point(last)), /database_writer_conflict/); }
  finally { await other.end(); }
  await assert.rejects(commitProductionActivity(db, config, birth, point(last), []), /exceeds its bound/);
  await assert.rejects(market(), {message: "checkpoint_binding"});
  assert.equal(scans.length, 0);
  const race = createProductionActivityIndexer(config, db, ...peers, { write: async task => {
    if (nonceReads.length) await db.query("UPDATE rmt_curve_production_checkpoints SET block_hash=$2 WHERE scope=$1 AND block_number=$3",
      [scope, hash(last + 1n), String(last)]);
    await task();
  } });
  nonceReads.length = 0;
  await assert.rejects(race.sync(point(last)), /coverage/);
  assert.equal(await cursor(), birth);
  await db.query("UPDATE rmt_curve_production_checkpoints SET block_hash=$2 WHERE scope=$1 AND block_number=$3", [scope, hash(last), String(last)]);
  nonceReads.length = 0;
  await worker.sync(point(last));
  assert.ok(worker.ready(point(last))); assert.equal(await cursor(), last + 1n);
  assert.deepEqual(nonceReads, [last, last]); assert.equal(scans.length, 0);
  assert.deepEqual(await activity(), []); assert.equal((await market()).status, "not_found");
  assert.equal((await db.query("SELECT count(*)::int n FROM rmt_curve_activity_checkpoints")).rows[0].n, 1);
  const [range] = (await db.query(auditSql)).rows;
  assert.deepEqual([range.mode, range.from_block, range.through_block, range.block_hash, range.registration_hash,
    range.conflicts_with_registration, range.conflicts_with_events], ["verified_empty", String(birth), String(last), hash(last), hash(last), false, false]);
  worker = startWorker(); await worker.sync(point(last)); assert.ok(worker.ready(point(last)));
  assert.deepEqual(nonceReads, [last, last]);

  // Correct historical registration inside the old empty span, even without a hash change.
  registered = true; await registerLastRange();
  assert.equal((await db.query(auditSql)).rows[0].conflicts_with_registration, true);
  await assert.rejects(market(), /awaits replay/); await assert.rejects(activity(), /awaits replay/);
  await worker.sync(point(last));
  assert.equal(await cursor(), creation); assert.ok(!worker.ready(point(last))); await assert.rejects(market(), {message: "checkpoint_binding"});
  assert.deepEqual(nonceReads.slice(-2), [creation - 1n, creation - 1n]); assert.equal(scans.length, 0);
  fault = "absent-logs"; await assert.rejects(worker.sync(point(last)), /omitted a verified factory creation/);
  assert.equal(await cursor(), creation); fault = "none";
  await worker.sync(point(last)); assert.ok(worker.ready(point(last)));
  const empty = await market(); assert.equal(empty.status, "ready"); assert.deepEqual(empty.candles, []);
  assert.equal((await activity()).length, 1);

  // Reorg at creation, keeping the verified-empty predecessor. A trade in the
  // creation block must survive receipt membership checks and form the first candle.
  traded = true; branch = 97_000_000n; await registerLastRange();
  worker = startWorker(); await worker.sync(point(last)); assert.ok(worker.ready(point(last)));
  const filled = await market(); assert.equal(filled.status, "ready");
  assert.equal(filled.candles.length, 1); assert.equal(filled.candles[0]!.count, 1);
  assert.equal(filled.candles[0]!.volumeWei, String(backing + fee));
  assert.equal((await activity()).length, 1);
  const firstBuy = await readProductionActivity(db, scope, point(last), { token, transactionHash: tradeTx });
  assert.equal(firstBuy.length, 1); assert.equal(firstBuy[0]!.transactionIndex, 1);
  assert.ok(scans.every(([start, end]) => start === creation && end === last));
  // Rewind the isolated fixture, replay an archive-pruned batch, and restart
  // with a non-birth cursor like the currently running worker.
  await rollbackProductionActivity(db, scope, birth - 1n);
  const lastRange = last - blocks % 2000n + 1n;
  await rollbackProductionCurve(db, scope, lastRange - 1n);
  registered = false; traded = false;
  await commitProductionCurveRange(db, config, lastRange, point(last), []);
  fault = "pruned"; scans.length = 0;
  worker = startWorker(); await worker.sync(point(last));
  assert.deepEqual(scans, [[birth, birth + 999n], [birth, birth + 999n]]);
  assert.equal(await cursor(), birth + 1000n); assert.ok(!worker.ready(point(last)));
  // A cursor alone cannot prove its predecessor.
  const prior = point(birth + 999n);
  await db.query("DELETE FROM rmt_curve_activity_checkpoints WHERE scope=$1 AND block_number=$2", [scope, prior.blockNumber]);
  fault = "none"; await assert.rejects(worker.sync(point(last)), /coverage/);
  await db.query("INSERT INTO rmt_curve_activity_checkpoints VALUES($1,$2,$3,$4)", [scope, prior.blockNumber, prior.blockHash, prior.timestamp]);
  worker = startWorker(); await worker.sync(point(last));
  assert.equal(await cursor(), last + 1n); assert.equal(scans.length, 2); assert.deepEqual(await activity(), []);
  assert.equal((await db.query(auditSql)).rows[0].previous_hash, prior.blockHash);
  // A correction can also precede a fast range, in its ordinarily scanned predecessor.
  // Replaying only the large span would miss this first creation.
  creation = birth + 500n; registered = true;
  await rollbackProductionCurve(db, scope, birth - 1n);
  for (let start = birth; start <= last; start += 2000n) {
    const registrations = start === birth ? [{ ...item, creation: { ...item.creation, ...point(creation), transactionHash: tx } }] : [];
    await commitProductionCurveRange(db, config, start, point(start + 1999n < last ? start + 1999n : last), registrations);
  }
  await assert.rejects(market(), /awaits replay/);
  await worker.sync(point(last)); assert.equal(await cursor(), birth + 1000n);
  assert.equal((await db.query(auditSql)).rowCount, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM rmt_curve_activity_events WHERE token=$1 AND transaction_hash=$2", [token, tx])).rows[0].n, 1);
  console.log(JSON.stringify({ blocks: String(blocks), registrationIntervals: Number((blocks + 1999n) / 2000n),
    emptyLogRequests: 0, activityCommitsForEmptyPrefix: 1, firstCreation: String(originalCreation),
    sameBlockFillCount: filled.candles[0]!.count, volumeWei: filled.candles[0]!.volumeWei }));
} finally { await db.end(); }
