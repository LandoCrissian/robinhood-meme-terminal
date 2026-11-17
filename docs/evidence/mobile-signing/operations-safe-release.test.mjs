import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { evaluateOperationsSafeRelease } from "../../../packages/contracts/scripts/evaluate-operations-safe-release.mjs";
import { approvedOperationsFeeCap, operationsFeeApprovalSource, operationsSafeBaseline }
  from "../../../packages/contracts/scripts/prepare-operations-safe.mjs";
import { summarizeGas } from "../../../scripts/production-readiness/safe.mjs";

// Synthetic fixtures based on an expired observation. The live gate always obtains new observations.
const archived = JSON.parse(readFileSync(new URL("sender-delegation-4663.json", import.meta.url)));
const testTime = Date.parse(archived.observedAt);
const cli = fileURLToPath(new URL("../../../packages/contracts/scripts/evaluate-operations-safe-release.mjs", import.meta.url));

function observation({ total = 313391n, baseFee = 20010000n, estimateGas = total } = {}) {
  const proof = structuredClone(archived);
  proof.sender.createDestinations = [];
  for (const provider of proof.sender.providers) provider.pendingSafeVacancy = { code: "0x", nonce: "0" };
  proof.safes.proposals.splice(1);
  const gas = summarizeGas({ total, l1: 25494n, baseFee, l1BaseFee: 17582038n, estimateGas });
  proof.safes.proposals[0].gas = gas;
  proof.safes.estimatedTotalWei = gas.estimatedTotalWei;
  proof.safes.estimatedTotalEth = gas.estimatedTotalEth;
  proof.safes.budgetAtObservation = true;
  return proof;
}

function assertBlocked(report) {
  assert.equal(report.status, "BLOCKED_NO_BROADCAST");
  assert.equal(report.policy.state, "OWNER_ADOPTION_REQUIRED");
  assert.equal(report.policy.conditionalFeeApproval, operationsFeeApprovalSource);
  assert.equal(report.policy.currentSigningDecision, "BLOCKED_RELEASE_GATES");
  assert.equal(report.policy.launchProtocolReleaseEvaluated, false);
  assert.equal(report.transactionApproval, null);
  assert.equal(report.signingReviewEligible, false);
  assert.equal(report.broadcastAuthorized, false);
  assert.doesNotMatch(JSON.stringify(report), /unsignedFields|calldata"|0x1688f0b9|RMT-RESERVE|firstProject|balanceWei/);
}

test("an exact Operations-only technical pass cannot adopt policy or request signing", () => {
  const proof = observation();
  // Inputs from the launch protocol cannot clear or block this decision.
  proof.releaseGate = "FAILED";
  proof.transactionApproval = "IGNORED";
  const report = evaluateOperationsSafeRelease(proof, testTime);
  assertBlocked(report);
  assert.equal(report.technicalStatus, "PASS");
  const { operation, sender, vacancy, gas, feeCap, freshRecommendation, infrastructure, expiresAt } = report.evidence;
  for (const [key, expected] of Object.entries(operationsSafeBaseline)) assert.deepEqual(operation[key], expected);
  assert.equal(operation.action, "createProxyWithNonce(address,bytes,uint256)");
  assert.equal(operation.transactionType, "0x2");
  assert.equal(operation.setupDelegateCall, false);
  assert.equal(operation.initializerPaymentWei, "0");
  assert.equal(operation.fallbackHandler, "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99");
  assert.equal(operation.singleton, "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762");
  assert.equal(sender.pendingNonce, operationsSafeBaseline.nonce);
  assert.equal(sender.confirmedNonce, operationsSafeBaseline.nonce);
  assert.equal(sender.canCoverApprovedMaximumAtAnchor, true);
  assert.equal(sender.delegation.runtimeHash, archived.sender.delegation.runtimeHash);
  assert.deepEqual(vacancy, { anchored: "VACANT", pending: "VACANT", simulatedAddress: operation.predictedAddress });
  assert.deepEqual(feeCap, approvedOperationsFeeCap);
  assert.deepEqual(freshRecommendation, approvedOperationsFeeCap);
  assert.equal(BigInt(gas.estimatedFeeWei), BigInt(gas.estimatedL1FeeWei) + BigInt(gas.estimatedL2FeeWei));
  assert.equal(infrastructure.length, 3);
  assert.ok(infrastructure.every(({ providers }) => providers.includes("official") && providers.length >= 2));
  assert.equal(Date.parse(expiresAt), Date.parse(proof.sender.anchor.blockTimeUtc) + 120_000);
});

test("fresh headroom above any approved dimension blocks the technical gate", () => {
  for (const proof of [observation({ baseFee: 20010001n }), observation({ baseFee: 20000000n, estimateGas: 313392n })]) {
    const report = evaluateOperationsSafeRelease(proof, testTime);
    assertBlocked(report);
    assert.equal(report.technicalStatus, "BLOCKED_FEE_CEILING");
    assert.match(report.evidence.overage, /refreshed headroom does not/);
  }
});

test("rejects stale, mismatched, and contradictory identity, gas, or provider evidence", () => {
  assert.throws(() => evaluateOperationsSafeRelease(observation(), Date.parse(archived.sender.anchor.blockTimeUtc) + 120_000),
    /expired/);
  const wrongChain = (proof) => { proof.chainId = 31337; };
  const wrongInitializer = (proof) => { proof.safes.proposals[0].initializerKeccak256 = operationsSafeBaseline.inputHash; };
  const wrongOwner = (proof) => { proof.safes.owners[0] = operationsSafeBaseline.sender; };
  const wrongSimulation = (proof) => { proof.safes.proposals[0].simulatedAddress = operationsSafeBaseline.destination; };
  const wrongPin = (proof) => { proof.safes.runtimePins[0].witnesses[0].observedHash = operationsSafeBaseline.inputHash; };
  const partialAnchoredConflict = (proof) => { proof.safes.proposals[0].vacancy.push({ name: "pinax", code: "0x01" }); };
  const partialPendingConflict = (proof) => {
    const third = proof.sender.providers[2];
    third.before = third.after = proof.sender.anchor;
    third.pendingSafeVacancy = { nonce: "3" };
  };
  const invalidGas = (proof) => { proof.safes.proposals[0].gas.l1PosterWei = "1"; };
  const changedNonce = (proof) => {
    proof.sender.pendingNonce = proof.sender.confirmedNonce = "477";
    for (const provider of proof.sender.providers) provider.pendingBefore = provider.pendingAfter = provider.confirmedNonce = "477";
  };
  for (const [alter, error] of [
    [wrongChain, /Unrecognized/], [wrongInitializer, /proposal mismatch/], [wrongOwner, /Expected values/],
    [wrongSimulation, /simulation address mismatch/], [wrongPin, /codehash/],
    [partialAnchoredConflict, /Conflicting Safe vacancy/], [partialPendingConflict, /pending nonce vacancy/],
    [invalidGas, /arithmetic/], [changedNonce, /nonce has drifted/],
  ]) {
    const proof = observation();
    alter(proof);
    assert.throws(() => evaluateOperationsSafeRelease(proof, testTime), error, alter.name);
  }
});

test("the CLI exposes no approval or caller-supplied observation override", () => {
  for (const option of ["--approve", "--observation"]) {
    const result = spawnSync(process.execPath, [cli, option], { encoding: "utf8" });
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assertBlocked(output);
    assert.equal(output.technicalStatus, "UNVERIFIED");
    assert.match(output.reason, /Unknown option/);
  }
});
