import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";

const evidenceRoot = new URL("../", import.meta.url);
const contractsRoot = new URL("../../../packages/contracts/", import.meta.url);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const withLf = (bytes) => bytes.toString("utf8").replaceAll("\r\n", "\n");
const packet = JSON.parse(readFileSync(new URL("review-inputs.json", import.meta.url), "utf8"));
const artifact = (key) => {
  const { path } = packet.artifacts[key];
  return readFileSync(new URL(path, evidenceRoot));
};
const profile = JSON.parse(artifact("compilerProfile"));
const report = JSON.parse(gunzipSync(artifact("slither")));
const release = JSON.parse(artifact("releaseManifest"));

test("review packet pins release inputs and carries no approval or live transaction", () => {
  assert.equal(packet.evidenceBaseline.commit, "7733ed293ebcb16699ef22412298fbe40bb52725");
  assert.equal(packet.evidenceBaseline.deployableSourceCommit, release.deployableSourceCommit);
  assert.equal(packet.independentReview, "OPEN");
  assert.equal(packet.status, "BLOCKED_NO_BROADCAST");
  assert.equal(packet.broadcastAuthorized, false);

  for (const [key, identity] of Object.entries(packet.artifacts)) {
    const bytes = artifact(key);
    if (identity.decodedSha256) {
      assert.equal(hash(bytes), identity.sha256, identity.path);
      assert.equal(hash(gunzipSync(bytes)), identity.decodedSha256, identity.path);
    } else {
      assert.equal(hash(withLf(bytes)), identity.sha256Lf, identity.path);
    }
  }
  assert.equal(packet.profile.standardInputSha256, profile.inputSha256);
  assert.equal(report.inputSha256, profile.inputSha256);
  assert.equal(profile.inputSha256, release.compiler.inputSha256);
  assert.equal(packet.profile.chainId, profile.chainId);
  assert.equal(packet.profile.name, profile.profile);
  assert.equal(packet.profile.compilerVersion, profile.compilerVersion);
  assert.deepEqual([
    packet.profile.bootstrapInitcodeBytes, packet.profile.bootstrapInitcodeHeadroom,
    packet.profile.factoryRuntimeBytes, packet.profile.factoryRuntimeHeadroom,
  ], [
    profile.size.bootstrapInitcodeBytes, 49_152 - profile.size.bootstrapInitcodeBytes,
    profile.size.factoryRuntimeBytes, 24_576 - profile.size.factoryRuntimeBytes,
  ]);
  assert.equal(packet.profile.sourceCount, profile.sourceSha256.length);
  assert.equal(packet.profile.dependencySourceCount, profile.sourceSha256.filter(([path]) => path.startsWith("lib/")).length);

  const unsigned = JSON.parse(artifact("unsignedFixture"));
  const { transactions, ...inputs } = unsigned.production;
  assert.equal(unsigned.broadcastAuthorized, false);
  assert.deepEqual(transactions, []);
  assert.ok(Object.values(inputs).every((value) => value === null));
});

test("tracked deployable sources and every deliberate 4663 transformation match the reviewed closure", () => {
  const targetHashes = new Map(profile.sourceSha256);
  for (const [path, original] of profile.originalSourceSha256) {
    let source = withLf(readFileSync(new URL(path, contractsRoot)));
    assert.equal(hash(source), original, path);
    for (const { file, from, to, occurrences } of profile.transformations.filter(({ file }) => file === path)) {
      assert.equal(source.split(from).length - 1, occurrences, file);
      source = source.replaceAll(from, to);
    }
    assert.equal(hash(source), targetHashes.get(path), path);
  }
});

test("each in-scope High and governance Medium is individually bound to the archived report and review matrix", () => {
  assert.equal(packet.analysis.status, "FAIL_HIGH");
  assert.equal(packet.analysis.status, release.staticAnalysis.status);
  assert.equal(report.tool, packet.analysis.tool);
  assert.equal(report.cryticCompile, packet.analysis.cryticCompile);
  assert.equal(report.detectorCount, packet.analysis.detectorCount);
  assert.equal(report.detectors.length, packet.analysis.resultCount);
  const governance = new Set(["src/RMTLaunchCurveDirectoryV2.sol", "src/RMTLaunchProjectRegistryV3.sol"]);
  const inScope = report.detectors.filter(({ impact, elements }) => impact === "High"
    || (impact === "Medium" && governance.has(elements[0].source_mapping.filename_short)));
  const rows = new Map(inScope.map((row) => [row.id, row]));
  const listed = packet.analysis.groups.flatMap(({ ids }) => ids);
  assert.deepEqual([...listed].sort(), [...rows.keys()].sort());
  assert.equal(listed.length, 29);
  assert.equal(inScope.filter(({ impact }) => impact === "High").length, 22);
  assert.equal(inScope.filter(({ impact }) => impact === "Medium").length, 7);

  const matrix = withLf(artifact("dispositions"));
  const outline = withLf(readFileSync(new URL("independent-review.md", import.meta.url)));
  for (const { group, impact, check, assessment, ids } of packet.analysis.groups) {
    assert.ok(outline.includes("| " + group + " |"), group);
    const internalAssessment = group.startsWith("dependency-") || group === "directory-equality";
    assert.equal(assessment, internalAssessment
      ? "INTERNAL_FALSE_POSITIVE_PENDING_INDEPENDENT_REVIEW"
      : "OPEN_FOR_INDEPENDENT_REVIEW", group);
    for (const id of ids) {
      const row = rows.get(id);
      assert.equal(row.impact, impact, id);
      assert.equal(row.check, check, id);
      assert.ok(matrix.includes("`" + id.slice(0, 12) + "`"), id);
    }
  }
});
