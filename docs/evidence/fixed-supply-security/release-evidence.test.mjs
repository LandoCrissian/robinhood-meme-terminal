import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

const file = (name) => readFileSync(new URL(name, import.meta.url));
const json = (bytes) => JSON.parse(bytes.toString("utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const release = json(file("release-manifest.json"));
const profileText = file("4663-profile.json").toString("utf8").replaceAll("\r\n", "\n");
const profile = JSON.parse(profileText);
const reportArchive = file("slither-4663.json.gz");
const reportBytes = gunzipSync(reportArchive);
const report = json(reportBytes);
const rehearsalArchive = file("fork-4663.json.gz");
const rehearsalBytes = gunzipSync(rehearsalArchive);
const rehearsal = json(rehearsalBytes);
const firstProject = json(file("first-project.json"));

test("active release evidence binds the exact failing compiler closure and empty live inputs", () => {
  assert.equal(release.status, "BLOCKED_NO_BROADCAST");
  assert.equal(release.broadcastAuthorized, false);
  assert.equal(firstProject.broadcastAuthorized, false);
  assert.ok(Object.values(firstProject.production).every((value) => value === null));
  assert.equal(profile.profile, firstProject.profile);
  assert.equal(profile.chainId, 4663);
  assert.equal(profile.inputSha256, release.compiler.inputSha256);
  assert.equal(sha256(profileText), release.compiler.profileSha256Lf);
  assert.equal(report.inputSha256, profile.inputSha256);
  assert.equal(report.tool, "Slither 0.11.5");
  assert.equal(report.detectorCount, 101);
  assert.equal(release.staticAnalysis.status, "FAIL_HIGH");
  assert.equal(sha256(reportArchive), release.staticAnalysis.archiveSha256);
  assert.equal(sha256(reportBytes), release.staticAnalysis.reportSha256);
  const highs = (data) => data.detectors.filter(({ impact }) => impact === "High").map(({ id }) => id).sort();
  const baseline = json(gunzipSync(file("../fixed-supply/slither-4663.json.gz")));
  assert.deepEqual(highs(report), highs(baseline));
  assert.equal(report.detectors.filter(({ impact }) => impact === "High").length,
    release.staticAnalysis.highFindings);
  assert.ok(release.staticAnalysis.highFindings > 0);
});

test("the same closure was rehearsed with unsigned constructors and only read-only upstream RPC", () => {
  assert.equal(sha256(rehearsalArchive), release.fork.archiveSha256);
  assert.equal(sha256(rehearsalBytes), release.fork.reportSha256);
  assert.equal(rehearsal.manifest.inputSha256, profile.inputSha256);
  assert.equal(rehearsal.report.execution.host, "127.0.0.1");
  assert.equal(rehearsal.report.execution.chainId, 4663);
  assert.equal(rehearsal.report.network.blockHash, release.fork.blockHash);
  assert.equal(rehearsal.report.archiveBoundary.blockedWriteProbe, "HTTP 403");
  for (const method of rehearsal.report.archiveBoundary.forwardedMethods) {
    assert.ok(rehearsal.report.archiveBoundary.methodAllowlist.includes(method));
    assert.doesNotMatch(method, /send|sign|setBalance/);
  }
  assert.deepEqual(rehearsal.projects.map(({ symbol }) => symbol), ["RMT", "HBR", "CDR"]);
  for (const project of rehearsal.projects) {
    assert.equal(project.supplyWei, "1000000000000000000000000000");
    assert.equal(project.principalUnchanged, true);
    assert.equal(project.crossProjectClaims.curve.status, "reverted");
    assert.equal(project.crossProjectClaims.lp.status, "reverted");
  }
  const rotation = rehearsal.deployment.deployment.rotation;
  assert.equal(BigInt(rotation.afterEpoch), BigInt(rotation.beforeEpoch) + 1n);
  assert.equal(rotation.replay.status, "reverted");
  assert.equal(rotation.oneSigner.status, "reverted");
  assert.equal(rehearsal.projects[0].invalidRoutes.wrongPool.status, "reverted");
  assert.equal(rehearsal.projects[0].invalidRoutes.wrongRouter.status, "reverted");
  assert.equal(rehearsal.unsignedConstructors.length, 5);
  for (const request of rehearsal.unsignedConstructors) {
    assert.equal(request.scope, "LOOPBACK_FIXTURE_ONLY");
    assert.equal(request.broadcastAuthorized, false);
    assert.equal(request.chainId, 4663);
    assert.equal(request.value, "0");
    assert.match(request.data, /^0x[0-9a-f]+$/i);
  }
});
