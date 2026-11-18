import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi, zeroAddress } from "viem";
import { activeTestCreationKey, archiveCompletedTestCreation, completedTestCreationsKey, currentArchivedCreationEvidence, readActiveTestCreation, readCompletedTestCreations } from "../test-creation-history";
import { testCreationSignature, type TestCreationRequest, type TestCreationVerification } from "../test-creation";
import { ea, eh } from "./earnings-test-fixture";
function memory() { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null,
  setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } }; }
function fixture(n = 1) {
  const request: TestCreationRequest = { from: ea(100001), to: ea(100002), chainId: "0x7a69", intentId: eh(n), deadline: "1795000100", blockNumber: "0xa", blockHash: eh(10),
    value: "0x16bcc41e90000", data: encodeFunctionData({ abi: parseAbi([testCreationSignature]), functionName: "create", args: ["Test", "TEST", "", zeroAddress, 0, eh(n), 1795000100n] }) };
  const journal = { request, transactionHash: eh(1000 + n) }, verification: TestCreationVerification = { status: "confirmed", indexed: true, token: ea(100010 + n), transactionHash: journal.transactionHash };
  return { journal, verification };
}
test("explicit completed-creation archival preserves original identity before releasing the active slot", () => {
  const s = memory(), { journal, verification } = fixture(); s.setItem(activeTestCreationKey, JSON.stringify(journal));
  const history = archiveCompletedTestCreation(s, journal, verification, 1000);
  assert.equal(s.getItem(activeTestCreationKey), null); assert.equal(history.length, 1);
  assert.deepEqual(readCompletedTestCreations(s)[0], { schemaVersion: 1, ...journal, verification, archivedAt: 1000 });
});
test("unknown, unindexed and conflicting evidence cannot clear the original creation", () => {
  const s = memory(), { journal, verification } = fixture(); s.setItem(activeTestCreationKey, JSON.stringify(journal));
  for (const v of [{ ...verification, status: "pending" as const }, { ...verification, indexed: false }, { ...verification, status: "unavailable" as const }, { ...verification, transactionHash: eh(9999) }]) {
    assert.throws(() => archiveCompletedTestCreation(s, journal, v, 1000)); assert.deepEqual(readActiveTestCreation(s), journal); assert.equal(s.getItem(completedTestCreationsKey), null);
  }
  const reverted: TestCreationVerification = { status: "reverted", transactionHash: journal.transactionHash };
  assert.equal(archiveCompletedTestCreation(s, journal, reverted, 1000)[0].verification.status, "reverted");
});
test("archive write failure preserves active recovery; interrupted release is idempotently recoverable", () => {
  const s = memory(), { journal, verification } = fixture(); s.setItem(activeTestCreationKey, JSON.stringify(journal));
  assert.throws(() => archiveCompletedTestCreation({ ...s, setItem: () => { throw Error("Quota unavailable"); } }, journal, verification, 1000));
  assert.deepEqual(readActiveTestCreation(s), journal);
  assert.throws(() => archiveCompletedTestCreation({ ...s, removeItem: () => undefined }, journal, verification, 1000));
  assert.equal(readCompletedTestCreations(s).length, 1); assert.deepEqual(readActiveTestCreation(s), journal);
  assert.equal(archiveCompletedTestCreation(s, journal, verification, 1001).length, 1); assert.equal(readActiveTestCreation(s), undefined);
});
test("bounded completed history never evicts an original transaction to start another launch", () => {
  const s = memory();
  for (let n = 1; n <= 16; n++) { const f = fixture(n); s.setItem(activeTestCreationKey, JSON.stringify(f.journal)); archiveCompletedTestCreation(s, f.journal, f.verification, 1000 + n); }
  const next = fixture(17); s.setItem(activeTestCreationKey, JSON.stringify(next.journal));
  assert.throws(() => archiveCompletedTestCreation(s, next.journal, next.verification, 2000), /history is full/);
  assert.deepEqual(readActiveTestCreation(s), next.journal); assert.equal(readCompletedTestCreations(s).length, 16);
});
test("an asynchronous archive check is never attributed to a newer selection from another tab", () => {
  const a = fixture(1), b = fixture(2), checked = { transactionHash: a.journal.transactionHash, verification: a.verification };
  assert.equal(currentArchivedCreationEvidence(a.journal, checked), a.verification);
  assert.equal(currentArchivedCreationEvidence(b.journal, checked), undefined, "A newly appended/default-selected archive must not inherit an older response");
  assert.equal(currentArchivedCreationEvidence(b.journal, { transactionHash: b.journal.transactionHash, verification: a.verification }), undefined);
  assert.equal(currentArchivedCreationEvidence(b.journal, { transactionHash: b.journal.transactionHash, verification: b.verification }), b.verification);
  const unavailable = { transactionHash: a.journal.transactionHash, verification: { status: "unavailable" as const } };
  assert.equal(currentArchivedCreationEvidence(a.journal, unavailable)?.status, "unavailable");
  assert.equal(currentArchivedCreationEvidence(b.journal, unavailable), undefined);
});
