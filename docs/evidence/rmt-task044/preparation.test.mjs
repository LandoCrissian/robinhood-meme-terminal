import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { normalizeOwnerSheet } from "../rmt-task041-closeout/owner-inputs.mjs";
import { verifiedRelease } from "../rmt-task041-closeout/verify-release.mjs";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const overlay = read("./provisional-owner-inputs.json");
const plans = read("./safe-treasury-plans.json");
const governance = read("./governance-wallets.json");
const infrastructure = read("./safe-infrastructure-4663.json");
const blank = read("../rmt-task041-closeout/owner-inputs.json");
const release = verifiedRelease();
const checkout = process.env.RMT_DEPLOYMENT_TEST_CHECKOUT || fileURLToPath(new URL("../../../", import.meta.url));
const viem = webTools(checkout);

test("wallet preparation carries the same frozen blocked release and all 22 highs", () => {
  for (const artifact of [overlay, plans]) {
    assert.equal(artifact.chainId, release.chainId);
    assert.equal(artifact.candidateCommit, release.candidateCommit);
    assert.equal(artifact.releaseManifestSha256Lf, release.releaseManifestSha256Lf);
    assert.equal(artifact.state, "BLOCKED_NO_BROADCAST");
    assert.equal(artifact.approval, "PROPOSED_UNAPPROVED");
    assert.equal(artifact.broadcastAuthorized, false);
  }
  assert.equal(release.releaseGate.status, "FAIL_HIGH");
  assert.equal(release.releaseGate.findings.High, 22);
});

test("the proposal binds only the three checksummed governance addresses", () => {
  const supplied = [
    "0xc447a378cfd8460febc2eef67501d7a5473b9001",
    "0xc3600f2df60929d2ab9ab294cff42eedcb984f51",
    "0x2bcc3fafce77ccc7fdbed46e0b5bb80ba3e76697",
  ];
  assert.deepEqual(Object.keys(overlay.ownerOverrides), ["governanceSigners"]);
  assert.deepEqual(overlay.ownerOverrides.governanceSigners, supplied.map((address) => viem.getAddress(address)));
  assert.equal(governance.chainId, overlay.chainId);
  assert.equal(governance.candidateCommit, overlay.candidateCommit);
  assert.equal(governance.releaseManifestSha256Lf, overlay.releaseManifestSha256Lf);
  assert.equal(governance.status, "ELIGIBLE_AT_PINNED_BLOCK");
  assert.deepEqual(governance.wallets.map(({ address }) => address), overlay.ownerOverrides.governanceSigners);
  for (const wallet of governance.wallets) {
    assert.deepEqual(wallet.codes, { official: "0x", pinax: "0x" });
    assert.equal(wallet.keyControl, "UNVERIFIED");
  }
  assert.equal(new Set(supplied).size, 3);
  assert.ok(supplied.every((address) => BigInt(address) > 0xffffn));
  assert.deepEqual(blank.governanceSigners, [null, null, null]);
  const { deploymentInput, missingOwnerInputs } = normalizeOwnerSheet({ ...blank, ...overlay.ownerOverrides }, viem.getAddress);
  assert.equal(deploymentInput, null);
  assert.deepEqual(missingOwnerInputs, [
    "operatingTreasury", "futureReserve", "deployer", "economics.approvalReference",
    "responsibilities.signerKeyContinuity[0]", "responsibilities.signerKeyContinuity[1]",
    "responsibilities.signerKeyContinuity[2]", "responsibilities.incidentLead",
  ]);
});

test("the provisional overlay cannot be submitted as approved preflight input", () => {
  assert.throws(() => normalizeOwnerSheet(overlay, viem.getAddress), /Unexpected owner sheet fields/);
  const invocation = spawnSync(process.execPath, [
    fileURLToPath(new URL("../rmt-task041-closeout/preflight.mjs", import.meta.url)),
    "--checkout", checkout, "--inputs", fileURLToPath(new URL("./provisional-owner-inputs.json", import.meta.url)),
  ], { encoding: "utf8", timeout: 5000 });
  assert.equal(invocation.status, 1, invocation.stderr);
  assert.match(invocation.stderr, /Governance-rotation profile required/);
});

test("the two proposed Safe configurations preserve separate unassigned roles and the exact fee shares", () => {
  const [operations, reserve] = plans.treasuries;
  assert.equal(plans.treasuries.length, 2);
  assert.deepEqual([operations.name, reserve.name], ["RMT-OPERATIONS", "RMT-RESERVE"]);
  assert.deepEqual([operations.releaseInputField, reserve.releaseInputField], ["operatingTreasury", "futureReserve"]);
  for (const proposal of plans.treasuries) {
    for (const field of ["safeAddress", "owners", "threshold", "deploymentSaltNonce", "gasPayer"]) {
      assert.equal(proposal[field], null);
    }
  }
  assert.equal(operations.eligibleCurveAndOriginalLpFeeShareBps, blank.economics.proposed.operationsFeesBps);
  assert.equal(reserve.eligibleCurveAndOriginalLpFeeShareBps, blank.economics.proposed.futureReserveFeesBps);
  assert.equal(operations.creationFeeShareBps, 10_000);
  assert.equal(reserve.creationFeeShareBps, 0);
  assert.notEqual(operations.spendingReview, reserve.spendingReview);
  assert.deepEqual(plans.safeProfile.enabledModules, []);
  assert.equal(plans.safeProfile.setupDelegateCall, false);
  assert.equal(plans.safeProfile.setupPaymentWei, "0");
  assert.equal(infrastructure.chainId, plans.chainId);
  assert.equal(infrastructure.candidate, plans.candidateCommit);
  assert.equal(infrastructure.treasuryAddressesAssigned, false);
  assert.equal(infrastructure.signaturesRequested, false);
  assert.equal(infrastructure.writesPerformed, false);
});

test("creation release and beneficiary-led claims use the existing exact call shapes", () => {
  const [creation, ...claims] = plans.claimCalls;
  assert.deepEqual(creation, {
    ledger: "factory", signature: "claimCreationFees()", destinationRole: "RMT-OPERATIONS", caller: "any",
  });
  assert.deepEqual(claims.map(({ ledger, signature, argument, assets, caller }) =>
    [ledger, signature, argument, assets, caller]), [
    ["curve revenue ledger", "claim()", undefined, ["ETH"], "beneficiary Safe"],
    ["original LP fee ledger", "claim()", undefined, ["ETH", "ERC-20"], "beneficiary Safe"],
    ["original LP fee ledger", "claimAsset(bool)", true, ["ETH"], "beneficiary Safe"],
    ["original LP fee ledger", "claimAsset(bool)", false, ["ERC-20"], "beneficiary Safe"],
  ]);
});

test("Safe infrastructure evidence binds both factory simulations and gas estimates to the recorded runtime pins", () => {
  assert.equal(infrastructure.block.postReadHashUnchanged, true);
  assert.equal(infrastructure.block.l1FinalityVerified, false);
  const versions = ["1.4.1", "1.5.0"];
  assert.deepEqual(Object.keys(infrastructure.registry.contracts), versions);
  for (const version of versions) {
    const pins = Object.values(infrastructure.registry.contracts[version]);
    assert.equal(pins.length, 6);
    for (const pin of pins) {
      assert.match(pin.registryRuntimeKeccak256, /^0x[0-9a-f]{64}$/);
      assert.equal(pin.officialRuntimeKeccak256, pin.registryRuntimeKeccak256);
      assert.equal(pin.historicalPinaxRuntimeKeccak256, pin.registryRuntimeKeccak256);
    }
    const fixture = infrastructure.fees.readOnlyFixtureProfiles[version];
    assert.equal(fixture.create2MatchesStaticCallWithEmptyPredictedAddress, true);
    const gas = fixture.nodeInterfaceEstimate;
    assert.equal(gas.totalGas, fixture.rpcEstimateGas);
    assert.equal(BigInt(gas.totalEstimateWei), BigInt(gas.totalGas) * BigInt(gas.l2BaseFeeWei));
  }
  assert.equal(infrastructure.fees.ownerInputSpecificEstimate, false);
});
