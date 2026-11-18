import assert from "node:assert/strict";
import type { Client } from "pg";
import { keccak256, zeroAddress, zeroHash, type Address, type Hash } from "viem";
import type { BlockEvidence, CurveFixtureBinding } from "./curve-launch-evidence.js";
import type { FixtureGraduationBinding } from "./curve-fixture-lifecycle.js";
import type { FixtureFeeActivity } from "./curve-fixture-fee-activity.js";
import { commitCurveFixtureRange, curveScope, rollbackCurveFixture } from "./curve-fixture-store.js";
import { initializeProjectTreasuryFixtureStore, commitProjectTreasuryFixtureRange, readProjectTreasuryFixture,
  type FixtureTreasuryModule, type FixtureTreasuryBirth, type FixtureTreasuryEvent } from "./project-treasury-fixture-store.js";

const a = (n: number) => `0x${((1n << 156n) + BigInt(n)).toString(16).padStart(40, "0")}` as Address;
const h = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hash;

/** Canonical-shaped persistence only, not blockchain execution evidence. The
 * caller has already proved a fresh loopback fixture DB, marker and writer lease. */
export async function testProjectTreasuryFixturePostgres(writer: Client, competing: Client, binding: CurveFixtureBinding,
  graduation: FixtureGraduationBinding, checkpoint: BlockEvidence) {
  const scope = curveScope(binding), height = BigInt(checkpoint.blockNumber) + 1n;
  const point = { blockNumber: height.toString(), blockHash: h(91200), timestamp: new Date(Date.parse(checkpoint.timestamp) + 1000).toISOString() };
  const m: FixtureTreasuryModule = { schemaVersion: 1, profile: "rmt-project-treasury-v1", chainId: 31337,
    treasuryFactory: a(91001), factoryRuntimeHash: h(91002), coreFactory: binding.factory, coreFactoryRuntimeHash: binding.factoryRuntimeHash,
    graduationEngine: graduation.graduationEngine, graduationRuntimeHash: graduation.graduationHash, tokenRuntimeHash: h(91003),
    treasuryCreationCode: "0x6000", treasuryCreationCodeHash: keccak256("0x6000"), treasuryRuntimeTemplate: `0x${"00".repeat(160)}`,
    treasuryImmutableReferences: {}, treasuryImmutableNames: {}, compilerInputSha256: "a".repeat(64),
    deployment: { transactionHash: h(91004), blockNumber: checkpoint.blockNumber, blockHash: checkpoint.blockHash } };
  await initializeProjectTreasuryFixtureStore(writer, scope, m);
  await assert.rejects(initializeProjectTreasuryFixtureStore(competing, scope, m), /database_writer_conflict/);
  const birth: FixtureTreasuryBirth = { treasury: a(91005), creator: a(91006), controller: a(91006), intentId: h(91007),
    treasuryShareBps: 2250, runtimeHash: h(91008), deployment: { ...point, transactionHash: h(91009), logIndex: 1 } };
  const event: FixtureTreasuryEvent = { ...point, event: "FundingReceived", treasury: birth.treasury,
    transactionHash: h(91010), logIndex: 2, asset: zeroAddress, amountWei: "10", source: zeroHash,
    args: { asset: zeroAddress, sender: birth.creator, kind: 1, amount: "10", source: zeroHash } };
  const fee: FixtureFeeActivity = { ...point, transactionHash: h(91011), logIndex: 0, kind: "creation-payout", token: null,
    ledger: binding.factory, account: birth.creator, recipient: binding.creationFeeRecipient, nativeWei: "5", tokenWei: "0" };
  const range = { blocks: [point], launches: [], trades: [], graduations: [], postEvents: [], states: [], feeActivity: [fee] };
  const invalid = { ...event, transactionHash: h(91012), logIndex: 99 };
  await writer.query("ALTER TABLE rmt_project_treasury_fixture_events ADD CONSTRAINT task076_atomic_module_interruption CHECK(log_index<>99)");
  try {
    await assert.rejects(commitCurveFixtureRange(writer, scope, range, db => commitProjectTreasuryFixtureRange(db, scope, m,
      { births: [birth], events: [event, invalid] })), /task076_atomic_module_interruption/);
  } finally { await writer.query("ALTER TABLE rmt_project_treasury_fixture_events DROP CONSTRAINT task076_atomic_module_interruption"); }
  const count = async (table: string, where = "", args: unknown[] = []) =>
    (await writer.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} ${where}`, args)).rows[0]!.n;
  assert.equal(await count("rmt_curve_fixture_checkpoints", "WHERE block_number=$1", [height.toString()]), 0);
  assert.equal(await count("rmt_curve_fixture_fee_activity", "WHERE transaction_hash=$1", [fee.transactionHash]), 0);
  assert.equal(await count("rmt_project_treasury_fixture_births"), 0); assert.equal(await count("rmt_project_treasury_fixture_events"), 0);
  await commitCurveFixtureRange(writer, scope, range, db => commitProjectTreasuryFixtureRange(db, scope, m, { births: [birth], events: [event] }));
  const replay = { blocks: [], launches: [], trades: [], graduations: [], postEvents: [], states: [] };
  await commitCurveFixtureRange(writer, scope, replay, db => commitProjectTreasuryFixtureRange(db, scope, m, { births: [birth], events: [event, event] }));
  assert.equal(await count("rmt_project_treasury_fixture_births"), 1); assert.equal(await count("rmt_project_treasury_fixture_events"), 1);
  const observed = await readProjectTreasuryFixture(writer, scope, m, point, birth.treasury);
  assert.equal(observed.treasuries.length, 1); assert.equal(observed.events[0]?.amountWei, "10");
  await assert.rejects(commitCurveFixtureRange(writer, scope, replay, db => commitProjectTreasuryFixtureRange(db, scope, m,
    { births: [], events: [{ ...event, amountWei: "999" }] })), /evidence/);
  await rollbackCurveFixture(writer, scope, BigInt(checkpoint.blockNumber));
  assert.equal(await count("rmt_project_treasury_fixture_births"), 0); assert.equal(await count("rmt_project_treasury_fixture_events"), 0);
  assert.equal(await count("rmt_curve_fixture_fee_activity", "WHERE transaction_hash=$1", [fee.transactionHash]), 0);
  await assert.rejects(readProjectTreasuryFixture(writer, scope, m, point, birth.treasury), /evidence/);
  console.info("Project treasury canonical-shaped PostgreSQL: shared transaction interruption rollback, writer lease, duplicate/conflict and checkpoint reorg cascade passed.");
}
