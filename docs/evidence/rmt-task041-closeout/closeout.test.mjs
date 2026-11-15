import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { webTools } from "../rmt-task043/compile-rotation-profile.mjs";
import { verifiedNonceObservation } from "../rmt-task043/deploy-rotation.mjs";
import { normalizeOwnerSheet } from "./owner-inputs.mjs";
import { verifiedRelease, verifyReleaseEvidence } from "./verify-release.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const state = {
  manifestText: read("./release-manifest.json"),
  profileText: read("../rmt-task043/4663-rotation-profile.json"),
  archive: readFileSync(new URL("../rmt-task043/slither-4663-full.json.gz", import.meta.url)),
};
const release = verifiedRelease();
const blank = JSON.parse(read("./owner-inputs.json"));
const viem = webTools(process.env.RMT_DEPLOYMENT_TEST_CHECKOUT || fileURLToPath(new URL("../../../", import.meta.url)));
const sampleAddress = (index) => viem.getAddress(viem.toHex(0xbeef440000n + BigInt(index), { size: 20 }));
const sampleSheet = {
  ...blank, operatingTreasury: sampleAddress(1), futureReserve: sampleAddress(2), deployer: sampleAddress(3),
  governanceSigners: [sampleAddress(4), sampleAddress(5), sampleAddress(6)],
  economics: { ...blank.economics, approvalReference: "local-synthetic-acceptance" },
  responsibilities: { signerKeyContinuity: ["test A", "test B", "test C"], incidentLead: "test incident lead" },
};

test("closure report is bound to the pinned 4663 compiler and remains failed", () => {
  assert.equal(release.state, "BLOCKED_NO_BROADCAST");
  assert.equal(release.releaseGate.exitCode, 1);
  assert.equal(release.releaseGate.activeEngineHigh, 18);
  assert.equal(release.releaseGate.dependencyHigh, 4);
  assert.equal(release.releaseGate.governanceMedium, 7);
  assert.equal(release.repositoryCI.clearsReleaseGate, false);
  assert.equal(release.windowsFoundry.inReleaseClosure, false);
  assert.equal(verifyReleaseEvidence({ ...state, manifestText: state.manifestText.replaceAll("\n", "\r\n") })
    .releaseManifestSha256Lf, release.releaseManifestSha256Lf);
});

test("profile or report substitution and CI-based clearance are rejected", () => {
  assert.throws(() => verifyReleaseEvidence({ ...state, profileText: state.profileText + " " }), /profile hash mismatch/);
  const archive = Buffer.from(state.archive);
  archive[20] ^= 1;
  assert.throws(() => verifyReleaseEvidence({ ...state, archive }), /archive hash mismatch/);
  const changed = (mutate) => {
    const manifest = JSON.parse(state.manifestText);
    mutate(manifest);
    return { ...state, manifestText: JSON.stringify(manifest) };
  };
  assert.throws(() => verifyReleaseEvidence(changed((m) => { m.repositoryCI.clearsReleaseGate = true; })), /cannot clear/);
  assert.throws(() => verifyReleaseEvidence(changed((m) => { m.releaseGate.findings.High = 0; })));
});

test("owner sheet makes incomplete roles and explicit economic approval visible", () => {
  assert.equal(normalizeOwnerSheet(blank, viem.getAddress).missingOwnerInputs.length, 11);
  const result = normalizeOwnerSheet({
    ...sampleSheet, economics: { ...sampleSheet.economics, approvalReference: null },
  }, viem.getAddress);
  assert.deepEqual(result, { missingOwnerInputs: ["economics.approvalReference"], deploymentInput: null });
  assert.throws(() => normalizeOwnerSheet({ ...sampleSheet, confirmedDeployerNonce: "0" }, viem.getAddress), /Unexpected owner sheet/);
  assert.throws(() => normalizeOwnerSheet({
    ...sampleSheet, economics: { ...sampleSheet.economics, proposed: { ...blank.economics.proposed, curveTradeFeeBps: 200 } },
  }, viem.getAddress), /Different terms/);
});

function mockNonceEvidence() {
  const { deploymentInput } = normalizeOwnerSheet(sampleSheet, viem.getAddress);
  assert.equal(deploymentInput.confirmedDeployerNonce, null);
  const input = { ...deploymentInput, confirmedDeployerNonce: "123" };
  const roles = [
    ["deployer", input.deployer], ["operatingTreasury", input.operatingTreasury], ["futureReserve", input.futureReserve],
    ...input.governanceSigners.map((address, i) => ["governanceSigner" + (i + 1), address]),
  ];
  return {
    state: release.state, broadcastAuthorized: false, chainId: 4663, profile: release.profile, planSha256Lf: null,
    candidateCommit: release.candidateCommit, releaseManifestSha256Lf: release.releaseManifestSha256Lf,
    releaseGate: release.releaseGate,
    deploymentInput: input,
    observation: {
      source: "https://rpc.mainnet.chain.robinhood.com", observedAt: "2026-11-15T03:38:01Z",
      block: { number: "114671490", hash: "0x" + "11".repeat(32), stateRoot: "0x" + "12".repeat(32) },
      nonce: { latest: "123", pending: "123", anchored: "123", recheckedLatest: "123", recheckedPending: "123" },
      roles: roles.map(([role, address]) => ({ role, address, accountCode: "empty" })),
    },
  };
}

test("an unsigned binding accepts a single agreeing observation and rejects nonce or role drift", () => {
  const evidence = mockNonceEvidence();
  assert.equal(verifiedNonceObservation(evidence, release).input.confirmedDeployerNonce, "123");
  const pending = structuredClone(evidence);
  pending.observation.nonce.recheckedPending = "124";
  assert.throws(() => verifiedNonceObservation(pending, release), /Nonce changed/);
  const wrongDeployer = structuredClone(evidence);
  wrongDeployer.deploymentInput.deployer = sampleAddress(7);
  assert.throws(() => verifiedNonceObservation(wrongDeployer, release), /role mismatch/);
  assert.throws(() => verifiedNonceObservation({ ...evidence, releaseManifestSha256Lf: "0" }, release));
});
