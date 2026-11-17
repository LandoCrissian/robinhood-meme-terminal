import assert from "node:assert/strict";
import test from "node:test";
import { prepareGovernanceTransaction, observeCanonicalGovernanceSchedule, recoverScheduleAuthorization } from "./prepare-governance-transaction.mjs";
import { makeGovernanceTransactionFixture } from "./governance-transaction.fixture.mjs";

test("schedule preparation verifies two signatures and exact call with bounded live fees", async () => {
  const f = await makeGovernanceTransactionFixture();
  const result = await prepareGovernanceTransaction({ publication: f.publication, phase: "schedule", verifiedAuthorization: f.verifiedAuthorization,
    readers: f.readers, costReaders: f.costReaders, now: f.now, allowTestFixture: true });
  assert.equal(result.data, f.verifiedAuthorization.scheduleCalldata); assert.equal(result.valueWei, "0"); assert.equal(result.request.nonce, "0x1e3");
  assert.equal(result.cost.gasLimit, "250000"); assert.equal(result.cost.maximumWei, "10000000000000"); assert.equal(result.broadcastAuthorized, false);
  assert.equal(f.simulations.length, 2); assert.equal(f.calls.some((c) => /send|signTyped|personal_sign/i.test(c.method)), false);
});

test("forged signature metadata, changed authority, runtime and pending nonce block before simulation", async () => {
  const f = await makeGovernanceTransactionFixture();
  const forged = { ...f.verifiedAuthorization, scheduleCalldata: "0x1234" };
  await assert.rejects(recoverScheduleAuthorization(f.publication, forged, f.now()));
  for (const flag of ["badAuthority", "badRuntime", "pendingNonceDrift"]) {
    f.clock[flag] = true;
    await assert.rejects(prepareGovernanceTransaction({ publication: f.publication, verifiedAuthorization: f.verifiedAuthorization,
      readers: f.readers, costReaders: f.costReaders, now: f.now, allowTestFixture: true }));
    f.clock[flag] = false;
  }
  assert.equal(f.simulations.length, 0);
});

test("canonical schedule fixes exact real two-day and bounded expiry times", async () => {
  const f = await makeGovernanceTransactionFixture();
  const proof = await observeCanonicalGovernanceSchedule(f.publication, f.scheduleHash, f.readers);
  assert.equal(proof.executeAfter, f.executeAfter.toString()); assert.equal(proof.executeBy, f.executeBy.toString());
  f.clock.badScheduleEvent = true; await assert.rejects(observeCanonicalGovernanceSchedule(f.publication, f.scheduleHash, f.readers)); f.clock.badScheduleEvent = false;
  f.clock.scheduleReorg = true; await assert.rejects(observeCanonicalGovernanceSchedule(f.publication, f.scheduleHash, f.readers));
});

test("execute has no simulation before real maturity, rejects expiry, and accepts the exact canonical window", async () => {
  const f = await makeGovernanceTransactionFixture(); f.clock.phase = "execute"; f.clock.nonce = 484n;
  f.clock.time = Number(f.executeAfter) - 1;
  const options = { publication: f.publication, phase: "execute", scheduleHash: f.scheduleHash,
    readers: f.readers, costReaders: f.costReaders, now: f.now, allowTestFixture: true };
  await assert.rejects(prepareGovernanceTransaction(options), /real two-day notice/); assert.equal(f.simulations.length, 0);
  f.clock.time = Number(f.executeBy) + 1; await assert.rejects(prepareGovernanceTransaction(options), /real two-day notice/); assert.equal(f.simulations.length, 0);
  f.clock.time = Number(f.executeAfter);
  const result = await prepareGovernanceTransaction(options); assert.equal(result.data, f.executionData); assert.equal(result.request.nonce, "0x1e4");
  assert.equal(result.governance.executeAfter, f.executeAfter.toString()); assert.equal(f.simulations.length, 2);
});
