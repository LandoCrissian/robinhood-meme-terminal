import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertCurrentNotice, checkGovernanceNotice, noticeReadOnly } from "./check-governance-notice.mjs";

const scheduled = JSON.parse(readFileSync(new URL("../../docs/evidence/mobile-signing/factory-publication-scheduled.json", import.meta.url)));
const zeroHash = "0x" + "0".repeat(64), zeroAddress = "0x" + "0".repeat(40);
const seconds = (iso) => String(Date.parse(iso) / 1000);
const schedule = { executeAfter: seconds(scheduled.noticeCompletesUtc), executeBy: seconds(scheduled.executeBeforeUtc), scheduleBlockTime: seconds(scheduled.noticeStartsUtc) };
const state = () => ({ ...structuredClone(scheduled.currentDirectory[0].state), pendingRotation: [zeroHash, "0", "0"],
  factoryMapping: [zeroAddress, zeroHash], v3Mapping: [zeroAddress, zeroHash], actionDigest: scheduled.digest });
const at = (timestamp) => ({ block: { timestamp: String(timestamp) }, now: Number(timestamp) * 1000 });

test("real notice timing and inclusive expiry never imply owner signing or broadcast approval", () => {
  for (const [timestamp, status, eligible] of [
    [BigInt(schedule.executeAfter) - 1n, "SCHEDULE_VERIFIED_NOTICE_PENDING", false],
    [BigInt(schedule.executeAfter), "SCHEDULE_VERIFIED_SEPARATE_OWNER_APPROVAL_REQUIRED", true],
    [BigInt(schedule.executeBy), "SCHEDULE_VERIFIED_SEPARATE_OWNER_APPROVAL_REQUIRED", true],
    [BigInt(schedule.executeBy) + 1n, "SCHEDULE_EXPIRED_REQUIRES_AUTHORIZED_RECOVERY", false],
  ]) {
    const sample = at(timestamp), result = assertCurrentNotice(state(), sample.block, schedule, sample.now);
    assert.equal(result.status, status); assert.equal(result.timeEligible, eligible);
    assert.equal(result.signingAuthorized, false); assert.equal(result.broadcastAuthorized, false);
  }
});

test("changed authority, notice, suspension or publication state fails closed", () => {
  const sample = at(BigInt(schedule.executeAfter) - 100n);
  for (const patch of [
    { signerA: zeroAddress }, { signerSetEpoch: "2" }, { nonce: "1" }, { latestVersion: "1" }, { suspended: true },
    { pending: [zeroHash, schedule.executeAfter, schedule.executeBy] },
    { pendingRotation: [scheduled.digest, "1", "2"] }, { publicationDelay: "0" }, { executionWindow: "9999999" },
    { factoryMapping: [scheduled.action.factory, scheduled.action.runtimeHash] },
    { v3Mapping: [scheduled.action.factory, scheduled.action.runtimeHash] }, { actionDigest: zeroHash },
  ]) assert.throws(() => assertCurrentNotice({ ...state(), ...patch }, sample.block, schedule, sample.now));
  assert.throws(() => assertCurrentNotice(state(), sample.block, { ...schedule, executeAfter: String(BigInt(schedule.executeAfter) - 1n) }, sample.now));
  assert.throws(() => assertCurrentNotice(state(), sample.block, { ...schedule, executeBy: String(BigInt(schedule.executeBy) + 1n) }, sample.now));
  assert.throws(() => assertCurrentNotice(state(), sample.block, schedule, sample.now + 180_001));
  assert.throws(() => assertCurrentNotice(state(), sample.block, schedule, sample.now - 10_001));
});

test("RPC wrapper rejects signing, writes, gas simulation and arbitrary call data before provider access", async () => {
  let count = 0;
  const reader = noticeReadOnly(async () => { count++; return { status: "observed", value: "0x1237" }; });
  for (const method of ["eth_sendTransaction", "eth_sendRawTransaction", "eth_sign", "personal_sign", "eth_signTypedData_v4", "eth_estimateGas", "debug_traceTransaction"]) {
    await assert.rejects(reader(method, []), /read-only scope/);
  }
  await assert.rejects(reader("eth_call", [{ to: scheduled.directory, data: "0x12345678" }, "pending"]), /fixed governance view getters/);
  assert.equal(count, 0);
  assert.equal((await reader("eth_chainId", [])).value, "0x1237"); assert.equal(count, 1);
});

test("provider failure remains unavailable and wrong chain is invalid without any transaction preparation", async () => {
  const missing = Object.fromEntries(["official", "pocket"].map((name) => [name, async () => ({ status: "unavailable", reason: "timeout" })]));
  const unavailable = await checkGovernanceNotice({ readers: missing });
  assert.equal(unavailable.status, "PENDING_EVIDENCE_UNAVAILABLE"); assert.equal(unavailable.signingAuthorized, false);
  const wrong = Object.fromEntries(["official", "pocket"].map((name) => [name, async () => ({ status: "observed", value: "0x1" })]));
  const invalid = await checkGovernanceNotice({ readers: wrong });
  assert.equal(invalid.status, "EVIDENCE_INVALID"); assert.equal(invalid.broadcastAuthorized, false);
});
