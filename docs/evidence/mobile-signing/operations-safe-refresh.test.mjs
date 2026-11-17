import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { operationsSafeBaseline, prepareOperationsSafeReview, recommendOperationsFeeCap }
  from "../../../packages/contracts/scripts/prepare-operations-safe.mjs";

// This archived observation provides synthetic test inputs. Its clock is never reused by the live CLI.
const archived = JSON.parse(readFileSync(new URL("sender-delegation-4663.json", import.meta.url)));
const testTime = Date.parse(archived.observedAt);
const proof = () => {
  const report = structuredClone(archived);
  report.sender.createDestinations = [];
  for (const peer of report.sender.providers) peer.pendingSafeVacancy = { code: "0x", nonce: "0" };
  report.safes.proposals.splice(1);
  report.safes.estimatedTotalWei = report.safes.proposals[0].gas.estimatedTotalWei;
  report.safes.budgetAtObservation = true;
  return report;
};

test("Nitro ceiling includes posting gas, uses the larger estimate, and rounds the gas limit up", () => {
  assert.deepEqual(recommendOperationsFeeCap({ nitroGas: "313391", rpcGas: "313392", l2BaseFee: "20000000" }), {
    gasLimit: "391740", maxFeePerGasWei: "40000000", maxPriorityFeePerGasWei: "0", maxNetworkFeeWei: "15669600000000",
  });
  assert.deepEqual(recommendOperationsFeeCap({ nitroGas: "313391", rpcGas: "313390", l2BaseFee: "20100000" }), {
    gasLimit: "391739", maxFeePerGasWei: "40200000", maxPriorityFeePerGasWei: "0", maxNetworkFeeWei: "15747907800000",
  });
  for (const nitroGas of ["0", "01", "-1", "50000000000000000000"]) {
    assert.throws(() => recommendOperationsFeeCap({ nitroGas, rpcGas: "10", l2BaseFee: "20" }));
  }
});

test("reconstructs only the fixed #648 Operations call and keeps exact calldata outside the phone projection", () => {
  const { privateQuote, review } = prepareOperationsSafeReview(proof(), testTime);
  assert.equal(review.schemaVersion, 3);
  assert.equal(review.scope, "RMT_4663_OPERATIONS_SAFE_UNSIGNED_REVIEW");
  for (const key of ["nonce", "sender", "destination", "predictedAddress", "valueWei", "inputHash", "threshold",
    "owners", "initializerHash", "saltNonce", "safeVersion"]) {
    assert.deepEqual(review.operation[key], operationsSafeBaseline[key]);
  }
  assert.equal(privateQuote.unsignedFields.nonce, "0x1dc");
  assert.equal(privateQuote.unsignedFields.value, "0x0");
  assert.equal(privateQuote.unsignedFields.chainId, "0x1237");
  assert.equal(privateQuote.unsignedFields.type, "0x2");
  assert.equal(privateQuote.transactionApproval, null);
  assert.equal(privateQuote.broadcastAuthorized, false);
  assert.ok(privateQuote.unsignedFields.data.startsWith("0x1688f0b9"));
  assert.ok(!JSON.stringify(review).includes(privateQuote.unsignedFields.data));
  assert.ok(!JSON.stringify(review).includes("RMT-RESERVE"));
  assert.equal(Date.parse(review.expiresAt), Date.parse(review.anchor.blockTimeUtc) + 120_000);
});

test("stops on expired blocks, changed nonce, conflicting delegation or factory, and absent Safe vacancy", () => {
  const original = proof();
  assert.throws(() => prepareOperationsSafeReview(original, Date.parse(original.sender.anchor.blockTimeUtc) + 120_000), /expired/);
  const drift = proof();
  drift.sender.pendingNonce = drift.sender.confirmedNonce = "477";
  for (const peer of drift.sender.providers) peer.pendingBefore = peer.pendingAfter = peer.confirmedNonce = "477";
  assert.throws(() => prepareOperationsSafeReview(drift, testTime), /nonce has drifted from #648/);
  for (const [change, message] of [
    [(report) => { report.sender.providers[0].delegate.anchoredRuntimeHash = operationsSafeBaseline.inputHash; }, /pinned delegation/],
    [(report) => { report.safes.runtimePins[1].witnesses[0].observedHash = operationsSafeBaseline.inputHash; }, /codehash/],
    [(report) => { report.sender.providers[0].pendingSafeVacancy = { code: "0x11" }; }, /pending code vacancy/],
    [(report) => { report.sender.providers.forEach((peer) => { peer.pendingSafeVacancy.nonce = undefined; }); }, /pending nonce vacancy/],
    [(report) => { report.safes.proposals[0].vacancy[0].nonce = "1"; }, /CREATE2 vacancy/],
    [(report) => { report.safes.proposals[0].initializerKeccak256 = operationsSafeBaseline.inputHash; }, /proposal mismatch/],
    [(report) => {
      report.sender.balanceWei = "1";
      report.sender.providers.forEach((peer) => { peer.balanceWei = "1"; });
      report.safes.budgetAtObservation = false;
    }, /payer balance is below/],
  ]) {
    const altered = proof();
    change(altered);
    assert.throws(() => prepareOperationsSafeReview(altered, testTime), message);
  }
});
