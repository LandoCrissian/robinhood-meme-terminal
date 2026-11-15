import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { normalizeOwnerSheet } from "../rmt-task041-closeout/owner-inputs.mjs";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import { buildTreasurySafeInitializers } from "./treasury-safe-initializers.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const viem = webTools(process.env.RMT_DEPLOYMENT_TEST_CHECKOUT ?? fileURLToPath(new URL("../../../", import.meta.url)));
const operationsPolicy = read("../rmt-task045/operations-safe-policy.json");
const reservePolicy = read("./reserve-safe-policy.json");
const evidence = read("./treasury-safe-initializers.json");

test("the exact three existing owners use independently scoped 2-of-3 preparation policies", () => {
  const { operations } = operationsPolicy;
  const { reserve } = reservePolicy;
  const result = buildTreasurySafeInitializers(viem);
  assert.deepEqual(result.proposals.map(({ role }) => role), ["RMT-OPERATIONS", "RMT-RESERVE"]);
  assert.deepEqual({ ...reserve, name: operations.name, creationFeeShareBps: 10_000 }, operations);
  assert.equal(new Set(reserve.owners.map((address) => viem.getAddress(address))).size, 3);
  assert.deepEqual([operations.creationFeeShareBps, reserve.creationFeeShareBps], [10_000, 0]);
  assert.deepEqual([operations.eligibleCurveAndOriginalLpFeeShareBps, reserve.eligibleCurveAndOriginalLpFeeShareBps], [500, 500]);
  for (const policy of [operationsPolicy, reservePolicy, result]) {
    assert.equal(policy.broadcastAuthorized, false);
    assert.equal(policy.state, "BLOCKED_NO_BROADCAST");
    assert.equal(policy.chainId, 4663);
  }
});

test("the full Safe setup has a shared initializer and two distinct unapproved CREATE2 derivations", () => {
  const result = buildTreasurySafeInitializers(viem);
  const { observation, ...recorded } = evidence;
  assert.deepEqual(result, recorded);
  const [operations, reserve] = result.proposals;
  assert.equal(operations.initializerKeccak256, reserve.initializerKeccak256);
  assert.equal(operations.initializerBytes, 420);
  assert.notEqual(operations.saltNonce, reserve.saltNonce);
  assert.notEqual(operations.create2Salt, reserve.create2Salt);
  assert.notEqual(operations.counterfactualAddress, reserve.counterfactualAddress);
  assert.equal(observation.writeMethodsCalled, false);
  for (const [index, proposal] of result.proposals.entries()) {
    assert.equal(proposal.status, "SALT_PROPOSED_UNAPPROVED");
    assert.equal(proposal.approvedDeploymentSaltNonce, null);
    assert.equal(proposal.verifiedBeneficiary, null);
    assert.deepEqual(observation.proposals[index], {
      role: proposal.role, code: "0x", nonce: 0, simulatedAddress: proposal.counterfactualAddress,
    });
  }
});

test("Reserve cannot substitute different accounts, a new threshold, chain, or setup permissions", () => {
  const owner = operationsPolicy.operations.owners[0];
  const changes = [
    (policy) => { policy.reserve.owners[0] = policy.reserve.owners[1]; },
    (policy) => { policy.reserve.owners.reverse(); },
    (policy) => { policy.reserve.threshold = 3; },
    (policy) => { policy.chainId = 1; },
    (policy) => { policy.reserve.safeProfile = "SafeL2 1.5.0"; },
    (policy) => { policy.reserve.setup.to = owner; },
    (policy) => { policy.reserve.setup.paymentReceiver = owner; },
    (policy) => { policy.reserve.setup.enabledModules = [owner]; },
    (policy) => { policy.reserve.setup.guard = owner; },
  ];
  for (const change of changes) {
    const policy = structuredClone(reservePolicy);
    change(policy);
    assert.throws(() => buildTreasurySafeInitializers(viem, policy), /exact preparation-only approval/);
  }
});

test("preparation keeps canonical inputs unassigned and rejects attaching previews, salt decisions or broadcast approval", () => {
  const proposal = evidence.proposals[1];
  const changes = [
    (policy) => { policy.reserve.safeAddress = proposal.counterfactualAddress; },
    (policy) => { policy.reserve.deploymentSaltNonce = proposal.saltNonce; },
    (policy) => { policy.reserve.gasPayer = policy.reserve.owners[0]; },
    (policy) => { policy.reserve.creationFeeShareBps = 1; },
    (policy) => { policy.broadcastAuthorized = true; },
    (policy) => { policy.economicsApprovalReference = policy.approvalReference; },
  ];
  for (const change of changes) {
    const policy = structuredClone(reservePolicy);
    change(policy);
    assert.throws(() => buildTreasurySafeInitializers(viem, policy), /exact preparation-only approval/);
  }
  const ownerSheet = read("../rmt-task041-closeout/owner-inputs.json");
  assert.deepEqual([ownerSheet.operatingTreasury, ownerSheet.futureReserve, ownerSheet.deployer, ownerSheet.economics.approvalReference],
    [null, null, null, null]);
  assert.throws(() => normalizeOwnerSheet(reservePolicy, viem.getAddress), /Unexpected owner sheet fields/);
  assert.throws(() => normalizeOwnerSheet(operationsPolicy, viem.getAddress), /Unexpected owner sheet fields/);
  assert.equal(normalizeOwnerSheet(ownerSheet, viem.getAddress).deploymentInput, null);
});

test("the fork receipts bind independent proxy domains and owner rotations to each 2-of-3 Safe", () => {
  const report = read("./4663-shared-owner-safe-rehearsal.json");
  assert.equal(report.report.execution.host, "127.0.0.1");
  assert.equal(report.report.execution.chainId, 4663);
  assert.equal(report.report.network.blockNumber, 114549452);
  assert.equal(report.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
  const [operations, reserve] = report.platformSafes;
  assert.deepEqual([operations.role, reserve.role], ["operations", "reserve"]);
  assert.deepEqual([operations.threshold, reserve.threshold], ["2", "2"]);
  assert.deepEqual(operations.ownerAddresses, reserve.ownerAddresses);
  assert.equal(new Set([...operations.ownerAddresses, ...operationsPolicy.operations.owners]).size, 6);
  assert.equal(operations.initializerHash, reserve.initializerHash);
  assert.notEqual(operations.saltNonce, reserve.saltNonce);
  assert.notEqual(operations.proxy, reserve.proxy);
  for (const safe of [operations, reserve]) assert.equal(viem.getAddress(safe.predictedProxy), viem.getAddress(safe.proxy));
  assert.equal(report.creationFeeClaim.recipient, operations.proxy);
  assert.equal(report.creationFeeClaim.nativeAmount, "400000000000000");
  assert.equal(report.creationFeeClaim.reserveUnaffected, true);

  const [lifecycle] = report.cases;
  assert.deepEqual(lifecycle.platformDomainIsolation.map(({ sourceRole, targetRole }) => [sourceRole, targetRole]),
    [["reserve", "operations"], ["operations", "reserve"]]);
  for (const proof of lifecycle.platformDomainIsolation) {
    assert.equal(proof.signedNonce, "0");
    assert.notEqual(proof.sourceDigest, proof.targetDigest);
    assert.equal(proof.rejected.reason, "GS026");
    assert.equal(proof.balancesAndCreditsUnchanged, true);
  }
  assert.deepEqual(lifecycle.platformRotations.map(({ role }) => role), ["operations", "reserve"]);
  for (const rotation of lifecycle.platformRotations) {
    const { before, afterRotation, afterRehearsal, incoming, departing } = rotation;
    assert.deepEqual(new Set(before.linkedOwners), new Set(operations.ownerAddresses));
    assert.ok(afterRotation.linkedOwners.includes(incoming));
    assert.ok(!afterRotation.linkedOwners.includes(departing));
    assert.deepEqual(afterRehearsal.linkedOwners, afterRotation.linkedOwners);
    assert.equal(BigInt(afterRotation.nonce), BigInt(before.nonce) + 1n);
    assert.equal(BigInt(afterRehearsal.nonce), BigInt(afterRotation.nonce) + 1n);
    assert.equal(rotation.formerOwnerRejected.reason, "GS026");
    assert.equal(rotation.otherSafeUnchanged, true);
    assert.equal(rotation.treasuryBalancesAndPrincipalUnchanged, true);
  }
  const [projectCut, treasuryCut, operationsCut, reserveCut] = lifecycle.curve.buckets.map(BigInt);
  assert.deepEqual(lifecycle.recipients.slice(2), [operations.proxy, reserve.proxy]);
  const platform = BigInt(lifecycle.curve.accrued) / 10n;
  assert.equal(projectCut + treasuryCut, BigInt(lifecycle.curve.accrued) - platform);
  assert.equal(operationsCut, platform / 2n);
  assert.equal(reserveCut, platform - operationsCut);
  for (const safe of [operations, reserve]) {
    const claims = lifecycle.lp.claims.filter(({ beneficiary }) => beneficiary === safe.proxy);
    assert.deepEqual(claims.map(({ mode }) => mode), ["combined", "native", "token"]);
    const curveClaim = lifecycle.curve.claims.find(({ beneficiary }) => beneficiary === safe.proxy);
    const { payments } = lifecycle.platformSpending.find(({ beneficiary }) => beneficiary === safe.proxy);
    for (const authorization of [curveClaim.safeAuthorization, payments]) {
      assert.equal(authorization.insufficient.reason, "GS020");
      assert.equal(authorization.replay.reason, "GS026");
    }
    assert.equal(payments.native.innerCallVerified, true);
    assert.equal(payments.projectAsset.innerCallVerified, true);
  }
  assert.equal(lifecycle.graduation.custody.liquidity, lifecycle.graduation.liquidity);
});
