import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const here = (path) => new URL(path, import.meta.url);
const lf = (value) => value.replaceAll("\r\n", "\n");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const candidate = "d4d81d1153a11728d98e694c1f3976ceb3408915";

export function verifyReleaseEvidence({ manifestText, profileText, archive }) {
  const manifest = JSON.parse(manifestText);
  const profile = JSON.parse(profileText);
  const gate = manifest.releaseGate;
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.candidateCommit, candidate, "Unexpected frozen candidate");
  assert.equal(manifest.chainId, 4663);
  assert.equal(profile.chainId, manifest.chainId);
  assert.equal(profile.profile, manifest.profile);
  assert.equal(profile.status, "BLOCKED_NO_BROADCAST");
  assert.equal(profile.broadcastAuthorized, false);
  assert.equal(manifest.state, "BLOCKED_NO_BROADCAST");
  assert.equal(manifest.broadcastAuthorized, false);
  assert.equal(manifest.compilerProfileSha256Lf, sha256(lf(profileText)), "Compiler profile hash mismatch");
  assert.equal(manifest.compilerInputSha256, profile.inputSha256, "Compiler input mismatch");
  assert.equal(gate.reportArchiveSha256, sha256(archive), "Analysis archive hash mismatch");

  const raw = gunzipSync(archive, { maxOutputLength: 12 * 1024 * 1024 });
  assert.equal(gate.reportSha256, sha256(raw), "Analysis report hash mismatch");
  const report = JSON.parse(raw);
  assert.equal(report.inputSha256, manifest.compilerInputSha256, "Analysis does not cover this compiler input");
  assert.equal(report.analysisInputSha256, gate.analysisInputSha256);
  assert.equal(report.compilerSha256, gate.compilerSha256);
  assert.equal(report.compilerSha256, profile.executableSha256);
  assert.equal(report.tool, gate.tool);
  assert.equal(report.cryticCompile, gate.cryticCompile);
  assert.equal(report.sources, gate.sourceCount);
  assert.equal(report.sources, profile.sourceSha256.length);
  assert.equal(report.detectorCount, gate.detectorCount);

  const counts = {};
  for (const { impact } of report.detectors) counts[impact] = (counts[impact] ?? 0) + 1;
  assert.deepEqual(counts, gate.findings);
  const high = report.detectors.filter(({ impact }) => impact === "High");
  const source = (finding) => finding.elements[0].source_mapping.filename_relative.replaceAll("\\", "/");
  const dependency = high.filter((finding) => source(finding).includes("/lib/"));
  const active = high.filter((finding) => finding.check === "reentrancy-balance" && source(finding).includes("/src/"));
  assert.equal(active.length, gate.activeEngineHigh);
  assert.equal(dependency.length, gate.dependencyHigh);
  assert.equal(active.length + dependency.length, high.length);
  assert.equal(sha256(high.map(({ id }) => id).sort().join("\n")), gate.highFindingIdsSha256);
  const governance = report.detectors.filter((finding) => finding.impact === "Medium"
    && /\/src\/RMTLaunch(CurveDirectory|ProjectRegistry)V2\.sol$/.test(source(finding)));
  assert.equal(governance.length, gate.governanceMedium);
  assert.ok(high.length > 0, "Expected unresolved high findings");
  assert.deepEqual([gate.scope, gate.status, gate.exitCode], ["EXACT_4663_COMPILER_CLOSURE", "FAIL_HIGH", 1]);
  assert.equal(manifest.repositoryCI.clearsReleaseGate, false, "Repository CI cannot clear the release gate");

  return { ...manifest, releaseManifestSha256Lf: sha256(lf(manifestText)) };
}

export function verifiedRelease() {
  return verifyReleaseEvidence({
    manifestText: readFileSync(here("./release-manifest.json"), "utf8"),
    profileText: readFileSync(here("../rmt-task043/4663-rotation-profile.json"), "utf8"),
    archive: readFileSync(here("../rmt-task043/slither-4663-full.json.gz")),
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.equal(process.argv.length, 2, "This verifier reads only the pinned release artifacts");
  console.log(JSON.stringify(verifiedRelease(), null, 2));
}
