import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { normalizeOwnerSheet } from "../rmt-task041-closeout/owner-inputs.mjs";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import { buildOperationsSafeInitializer } from "./operations-safe-initializer.mjs";

const read = (name) => JSON.parse(readFileSync(new URL(name, import.meta.url), "utf8"));
const viem = webTools(process.env.RMT_DEPLOYMENT_TEST_CHECKOUT ?? fileURLToPath(new URL("../../../", import.meta.url)));
const policy = read("./operations-safe-policy.json");
const observed = read("./operations-safe-initializer.json");

function assertFixtureSplit(total, amounts) {
  const accrued = BigInt(total);
  const platform = accrued / 10n;
  const operations = platform / 2n;
  assert.deepEqual(amounts.map(BigInt), [accrued - platform, 0n, operations, platform - operations]);
}

test("the exact owner policy produces a deterministic setup digest and leaves the destination and salt unassigned", () => {
  const { approved, fixture } = buildOperationsSafeInitializer(viem);
  assert.deepEqual(approved, observed.approved);
  assert.deepEqual(buildOperationsSafeInitializer(viem, structuredClone(policy)), { approved, fixture });
  assert.equal(approved.initializerKeccak256, "0x151a0612bf013560eaf16129615ae6262a6889db13410623ddcb49f2a8506ac2");
  assert.equal(approved.initializerBytes, 420);
  assert.equal(approved.safeAddress, null);
  assert.equal(approved.deploymentSaltNonce, null);
  assert.equal(approved.broadcastAuthorized, false);
});

test("unsigned Operations preparation remains outside the canonical approval input", () => {
  const ownerSheet = read("../rmt-task041-closeout/owner-inputs.json");
  assert.deepEqual([ownerSheet.operatingTreasury, ownerSheet.futureReserve, ownerSheet.deployer, ownerSheet.economics.approvalReference],
    [null, null, null, null]);
  assert.throws(() => normalizeOwnerSheet(policy, viem.getAddress), /Unexpected owner sheet fields/);
  assert.equal(normalizeOwnerSheet(ownerSheet, viem.getAddress).deploymentInput, null);
});

test("changed owners, threshold, profile, chain, or approval fail the policy check", () => {
  const rejected = [
    (value) => { value.operations.owners.reverse(); },
    (value) => { value.operations.owners[2] = value.operations.owners[0]; },
    (value) => { value.operations.owners[0] = value.operations.owners[0].toLowerCase(); },
    (value) => { value.operations.threshold = 1; },
    (value) => { value.operations.safeProfile = "SafeL2 1.5.0"; },
    (value) => { value.chainId = 1; },
    (value) => { value.approval = "APPROVED"; },
    (value) => { value.broadcastAuthorized = true; },
  ];
  for (const change of rejected) {
    const value = structuredClone(policy);
    change(value);
    assert.throws(() => buildOperationsSafeInitializer(viem, value), /exact preparation-only approval/);
  }
});

test("setup cannot add a delegatecall, different handler, payment, module, or guard", () => {
  const address = policy.operations.owners[0];
  const changes = { to: address, data: "0x12", fallbackHandler: address,
    paymentToken: address, paymentWei: "1", paymentReceiver: address, enabledModules: [address], guard: address };
  for (const [field, next] of Object.entries(changes)) {
    const value = structuredClone(policy);
    value.operations.setup[field] = next;
    assert.throws(() => buildOperationsSafeInitializer(viem, value), /exact preparation-only approval/);
  }
});

test("fixture data cannot populate either treasury, assign Reserve, or change the economics", () => {
  const fixture = observed.fixture;
  const rejected = [
    (value) => { value.operations.safeAddress = fixture.fixtureAddress; },
    (value) => { value.operations.deploymentSaltNonce = fixture.saltNonce; },
    (value) => { value.operations.gasPayer = fixture.ownerAddresses[0]; },
    (value) => { value.reserve.safeAddress = fixture.fixtureAddress; },
    (value) => { value.reserve.owners = value.operations.owners; },
    (value) => { value.reserve.threshold = 3; },
    (value) => { value.reserve.approval = value.approval; },
    (value) => { value.reserve.eligibleCurveAndOriginalLpFeeShareBps = 0; },
    (value) => { value.operations.creationFeeShareBps = 9500; },
    (value) => { value.economicsApprovalReference = value.approvalReference; },
  ];
  for (const change of rejected) {
    const value = structuredClone(policy);
    change(value);
    assert.throws(() => buildOperationsSafeInitializer(viem, value), /exact preparation-only approval/);
  }
});

test("illustrative CREATE2 derivation matches the read-only 4663 simulation and vacant address", () => {
  const { fixture } = buildOperationsSafeInitializer(viem);
  assert.deepEqual(fixture, observed.fixture);
  const observation = observed.fixtureObservation;
  assert.equal(observation.chainId, 4663);
  assert.equal(observation.scope, "ILLUSTRATIVE_SYNTHETIC_ONLY");
  assert.equal(observation.simulatedAddress, fixture.fixtureAddress);
  assert.equal(observation.fixtureCode, "0x");
  assert.equal(observation.fixtureNonce, 0);
  assert.equal(observation.writeMethodsCalled, false);
  assert.equal(observation.broadcastAuthorized, false);
  assert.deepEqual(observation.runtimePins.map(({ address }) => address),
    [policy.operations.singleton, policy.operations.factory, policy.operations.setup.fallbackHandler]);
});

test("synthetic fork receipts preserve the fee allocations, independent spending, and signature rejection", () => {
  const report = read("./4663-operations-safe-rehearsal.json");
  assert.equal(report.report.execution.host, "127.0.0.1");
  assert.equal(report.report.execution.chainId, policy.chainId);
  assert.equal(report.report.network.blockNumber, 114549452);
  assert.equal(report.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
  const [operations, reserve] = report.platformSafes;
  assert.deepEqual([operations.role, operations.threshold, reserve.role], ["operations", "2", "reserve"]);
  assert.notEqual(operations.proxy, reserve.proxy);
  assert.equal(new Set([...policy.operations.owners, ...operations.ownerAddresses, ...reserve.ownerAddresses]).size, 9);
  assert.equal(report.creationFeeClaim.recipient, operations.proxy);
  assert.equal(report.creationFeeClaim.reserveUnaffected, true);
  assert.equal(report.creationFeeClaim.nativeAmount, "400000000000000");

  const [lifecycle] = report.cases;
  assert.equal(lifecycle.bps, 0);
  assertFixtureSplit(lifecycle.curve.accrued, lifecycle.curve.buckets);
  for (const collection of lifecycle.lp.collections) {
    const [nativeTotal, tokenTotal] = collection.cumulative;
    const [nativeBuckets, tokenBuckets] = collection.buckets;
    assertFixtureSplit(nativeTotal, nativeBuckets);
    assertFixtureSplit(tokenTotal, tokenBuckets);
  }
  const claims = lifecycle.lp.claims.filter(({ beneficiary }) => beneficiary === operations.proxy);
  assert.deepEqual(claims.map(({ mode }) => mode), ["combined", "native", "token"]);
  assert.ok(claims.every(({ safeAttribution }) => safeAttribution.innerCallVerified));
  const curveClaim = lifecycle.curve.claims.find(({ beneficiary }) => beneficiary === operations.proxy);
  const { payments } = lifecycle.platformSpending.find(({ beneficiary }) => beneficiary === operations.proxy);
  for (const authorization of [curveClaim.safeAuthorization, payments]) {
    assert.equal(authorization.insufficient.reason, "GS020");
    assert.equal(authorization.replay.reason, "GS026");
  }
  assert.equal(payments.native.innerCallVerified, true);
  assert.equal(payments.projectAsset.innerCallVerified, true);
  assert.equal(lifecycle.graduation.custody.liquidity, lifecycle.graduation.liquidity);
});
