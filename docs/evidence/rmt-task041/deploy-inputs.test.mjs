import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { addressTools, validateInputs } from "./deploy-inputs.mjs";

const input = () => JSON.parse(readFileSync(new URL("deploy-inputs.json", import.meta.url), "utf8"));
const review = JSON.parse(readFileSync(new URL("../rmt-task042/4663-treasury-review-manifest.json", import.meta.url), "utf8"));
const { getAddress } = addressTools(process.env.RMT_DEPLOYMENT_TEST_CHECKOUT || fileURLToPath(new URL("../../../", import.meta.url)));
const candidateAddress = (role) => getAddress("0x" + createHash("sha256").update("test-only input check " + role).digest("hex").slice(0, 40));
const supplied = () => {
  const terms = { ...review.provisionalTerms };
  delete terms.approved;
  return { ...input(), deployer: candidateAddress("deployer"), operatingTreasury: candidateAddress("operations"),
    futureReserve: candidateAddress("reserve"), governanceSigners: [candidateAddress("A"), candidateAddress("B"), candidateAddress("C")],
    governanceQuorum: 2, confirmedDeployerNonce: "0", economics: terms, ownerApprovalReference: "test-only.example" };
};
const cli = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL("deploy-inputs.mjs", import.meta.url)), ...args], { encoding: "utf8" });

test("the checked-in template has explicitly unassigned owner inputs", () => {
  assert.equal(validateInputs(input(), getAddress).length, 22);
  const report = cli();
  assert.equal(report.status, 0, report.stderr);
  const result = JSON.parse(report.stdout);
  assert.equal(result.state, "BLOCKED_NO_BROADCAST");
  assert.equal(result.broadcastAuthorized, false);
  assert.equal(result.derivedDeployment, null);
  assert.equal(result.economicsApproval, "UNVERIFIED_OFFLINE");
});

test("assignments stay exact and compilation does not require an approval claim", () => {
  assert.deepEqual(validateInputs(supplied(), getAddress), []);
  const noApproval = { ...supplied(), ownerApprovalReference: null };
  assert.deepEqual(validateInputs(noApproval, getAddress), []);
  assert.throws(() => validateInputs({ ...noApproval, ownerApprovalReference: "?" }, getAddress), /approval reference/);
  assert.throws(() => validateInputs({ ...supplied(), genesisNonce: "0" }, getAddress), /input fields/);
  assert.throws(() => validateInputs({ ...supplied(), broadcastAuthorized: true }, getAddress), /Unsigned package only/);
  assert.throws(() => validateInputs({ ...supplied(), chainId: 31337 }, getAddress), /Chain mismatch/);
});

test("addresses require checksum and exclude known fixture, system and pin addresses", () => {
  const value = supplied();
  assert.throws(() => validateInputs({ ...value, deployer: value.deployer.toLowerCase() }, getAddress), /checksummed/);
  for (const deployer of [
    "0x0000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000046630000",
    "0xDFfA2677FB1f2A566a2F3d9B3606925ba6cF2f40",
    getAddress(review.externalRuntimePins.poolManager.address),
  ]) assert.throws(() => validateInputs({ ...value, deployer }, getAddress), /fixture, reserved or dependency/);
});

test("independent beneficiaries and three distinct signers are required", () => {
  const value = supplied();
  assert.throws(() => validateInputs({ ...value, operatingTreasury: value.futureReserve }, getAddress), /future reserve must differ/);
  assert.throws(() => validateInputs({ ...value, governanceSigners: [value.governanceSigners[0], ...value.governanceSigners.slice(0, 2)] },
    getAddress), /independent/);
  assert.throws(() => validateInputs({ ...value, governanceSigners: value.governanceSigners.slice(0, 2) }, getAddress), /Three signer slots/);
  assert.throws(() => validateInputs({ ...value, governanceQuorum: 3 }, getAddress), /fixed at two/);
});

test("economic controls and fee denominators must exactly match the pinned profile", () => {
  const value = supplied();
  for (const patch of [{ graduationBackingWei: "1000000000000000000" }, { poolFeePips: 10_000 }, { curveTradeFeeBps: 0 },
    { creationFeeWei: 400_000_000_000_000 }, { operationsFeesBps: 450 }, { treasuryShareOfAllFeesBpsRange: [0, 10_000] }]) {
    assert.throws(() => validateInputs({ ...value, economics: { ...value.economics, ...patch } }, getAddress), /Different economics/);
  }
});

test("nonce is exact and must leave the full nine transaction slots", () => {
  const last = (1n << 64n) - 10n;
  assert.deepEqual(validateInputs({ ...supplied(), confirmedDeployerNonce: last.toString() }, getAddress), []);
  for (const confirmedDeployerNonce of ["00", "01", "-1", "1.5", "1e3", 0, (last + 1n).toString()]) {
    assert.throws(() => validateInputs({ ...supplied(), confirmedDeployerNonce }, getAddress), /canonical and leave nine/);
  }
});

test("partial inputs and fixture mode cannot produce a plan file", () => {
  const output = resolve(tmpdir(), "rmt-must-not-write-deployment-" + process.pid + ".json");
  for (const args of [["--output", output], ["--check-fixture", "--output", output]]) {
    const result = cli(...args);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /unassigned inputs|cannot write a production plan/);
    assert.equal(statSync(output, { throwIfNoEntry: false }), undefined);
  }
});
