import assert from "node:assert/strict";
import { Client } from "pg";
import type { Address, Hash } from "viem";
import { curveFixtureProfile } from "./curve-fixture-config.js";
import { fixtureConfirmations, type CurveFixtureBinding, type CurveLaunchRegistration } from "./curve-launch-evidence.js";
import { commitCurveFixtureRange, curveScope, fixtureCheckpoint, initializeCurveFixtureStore,
  readCurveFixtureEarnings, readCurveFixtureFeeActivity, rollbackCurveFixture } from "./curve-fixture-store.js";
import { syntheticProductionConfig, syntheticProductionRegistration } from "./curve-production-smoke.js";
import type { FixtureFeeActivity } from "./curve-fixture-fee-activity.js";
import { testProjectTreasuryFixturePostgres } from "./project-treasury-fixture-postgres-smoke.js";
import { testReclaimFixturePostgres } from "./reclaim-fixture-postgres-smoke.js";
import { testNftAcquisitionPostgres } from "./nft-acquisition-fixture-postgres-smoke.js";

const address = (id: number): Address => `0x${((1n << 156n) + BigInt(id)).toString(16).padStart(40, "0")}`;
const hash = (id: number): Hash => `0x${id.toString(16).padStart(64, "0")}`;
const text = process.env.RMT_EARNINGS_SMOKE_DATABASE_URL;
if (!text) throw new Error("An explicit isolated earnings smoke database is required");
const url = new URL(text);
if (url.hostname !== "127.0.0.1" || !/^\/rmt_curve_fixture_task074_smoke_[a-z0-9_]+$/.test(url.pathname) || !url.port) {
  throw new Error("Use a new loopback rmt_curve_fixture_task074_smoke_* database only");
}
const writer = new Client({ connectionString: text, connectionTimeoutMillis: 3000 });
const reader = new Client({ connectionString: text, connectionTimeoutMillis: 3000 });
const competing = new Client({ connectionString: text, connectionTimeoutMillis: 3000 });
const binding: CurveFixtureBinding = { ...syntheticProductionConfig.binding, chainId: 31337, confirmations: fixtureConfirmations };
const graduation = { graduationEngine: address(100), graduationHash: hash(101), guard: address(102), guardHash: hash(103) };
const scope = curveScope(binding);
const checkpoint = { blockNumber: "100", blockHash: hash(100), timestamp: "2026-11-18T12:00:00.000Z" };
const creator = address(200), treasury = address(201);
try {
  await writer.connect();
  assert.equal((await writer.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0]?.n, 0,
    "Never initialize or migrate a reused/production database");
  await writer.query("CREATE TABLE rmt_curve_fixture_marker(identity text NOT NULL)");
  await writer.query("INSERT INTO rmt_curve_fixture_marker(identity) VALUES($1)", [curveFixtureProfile]);
  await initializeCurveFixtureStore(writer, url.pathname.slice(1), binding, graduation);
  await competing.connect();
  await assert.rejects(initializeCurveFixtureStore(competing, url.pathname.slice(1), binding, graduation), /database_writer_conflict/);
  const launch = syntheticProductionRegistration();
  const launches: CurveLaunchRegistration[] = Array.from({ length: 53 }, (_, i) => ({ ...launch,
    chainId: 31337, creator, treasury, treasuryShareBps: 4500, token: address(1000 + i), initialCurve: address(2000 + i),
    revenueLedger: address(3000 + i), creation: { ...checkpoint, transactionHash: hash(4000 + i), logIndex: i * 3 + 4 },
    projectRegistrationLogIndex: i * 3 + 3, creationFee: { ...launch.creationFee, logIndex: i * 3 + 5 }, checkpoint: fixtureCheckpoint(checkpoint),
  }));
  const event: FixtureFeeActivity = { ...checkpoint, transactionHash: hash(9000), logIndex: 2, kind: "curve-claim",
    token: launches[0]!.token, ledger: launches[0]!.revenueLedger, account: creator, recipient: creator, nativeWei: "10", tokenWei: "0" };
  const factoryEvent: FixtureFeeActivity = { ...checkpoint, transactionHash: hash(9001), logIndex: 3, kind: "creation-payout", token: null,
    ledger: binding.factory, account: creator, recipient: binding.creationFeeRecipient, nativeWei: "20", tokenWei: "0" };
  const empty = { blocks: [], launches: [], trades: [], graduations: [], postEvents: [], states: [] };
  await commitCurveFixtureRange(writer, scope, { ...empty, blocks: [checkpoint], launches, feeActivity: [event, factoryEvent] });
  await commitCurveFixtureRange(writer, scope, { ...empty, feeActivity: [event, factoryEvent] });
  assert.equal((await writer.query("SELECT count(*)::int AS n FROM rmt_curve_fixture_fee_activity")).rows[0]?.n, 2);
  await assert.rejects(commitCurveFixtureRange(writer, scope, { ...empty, feeActivity: [{ ...event, nativeWei: "999" }] }), /conflicts/);
  assert.equal((await readCurveFixtureFeeActivity(writer, scope, checkpoint, event.transactionHash))[0]?.nativeWei, "10");
  assert.equal((await readCurveFixtureFeeActivity(writer, scope, checkpoint, factoryEvent.transactionHash))[0]?.token, null);
  await assert.rejects(readCurveFixtureFeeActivity(writer, scope, { ...checkpoint, blockHash: hash(999) }, event.transactionHash), /checkpoint unavailable/);
  await testProjectTreasuryFixturePostgres(writer, competing, binding, graduation, checkpoint);
  await testReclaimFixturePostgres(writer, competing, binding, checkpoint);
  await testNftAcquisitionPostgres(writer, competing, binding, checkpoint);
  await reader.connect();
  await reader.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  const options = { recipient: treasury, operatingRecipient: binding.creationFeeRecipient,
    reserveRecipient: syntheticProductionConfig.reserveRecipient, limit: 26 };
  const page = await readCurveFixtureEarnings(reader, scope, checkpoint, options);
  assert.equal(page.launches.length, 26);
  const cursor = { scope: scope.join(":"), recipient: treasury, blockNumber: checkpoint.blockNumber, blockHash: checkpoint.blockHash,
    after: page.launches[24]!.token };
  const second = await readCurveFixtureEarnings(reader, scope, checkpoint, { ...options, cursor });
  const third = await readCurveFixtureEarnings(reader, scope, checkpoint, { ...options, cursor: { ...cursor, after: second.launches[24]!.token } });
  const recovered = [...page.launches.slice(0, 25), ...second.launches.slice(0, 25), ...third.launches];
  assert.equal(recovered.length, 53); assert.equal(new Set(recovered.map(row => row.token)).size, 53);
  assert.deepEqual((await readCurveFixtureEarnings(reader, scope, checkpoint, { ...options, token: launches[52]!.token, limit: 2 })).launches.map(row => row.token), [launches[52]!.token]);
  assert.equal((await readCurveFixtureFeeActivity(reader, scope, checkpoint, event.transactionHash))[0]?.recipient, creator);
  await reader.query("COMMIT");
  await rollbackCurveFixture(writer, scope, 99n);
  assert.equal((await writer.query("SELECT count(*)::int AS n FROM rmt_curve_fixture_fee_activity")).rows[0]?.n, 0, "Reorg removes fee activity atomically with canonical checkpoint");
  await assert.rejects(readCurveFixtureEarnings(reader, scope, checkpoint, { ...options, cursor }), /unavailable or reorged/);
  await assert.rejects(readCurveFixtureFeeActivity(reader, scope, checkpoint, event.transactionHash), /checkpoint unavailable or reorged/);
  assert.equal((await writer.query("SELECT to_regclass('public.indexer_state') AS original")).rows[0]?.original, null);
  console.info("Synthetic fixture earnings PostgreSQL: 53 projects, independent beneficiary paging, exact-token recovery, receipt activity, duplicate/conflict handling, restart reader, one writer and reorg rollback passed.");
} finally {
  await Promise.allSettled([writer.end(), reader.end(), competing.end()]);
}
