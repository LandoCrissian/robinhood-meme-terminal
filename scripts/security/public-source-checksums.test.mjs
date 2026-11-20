import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {test} from "node:test";
import {verifyHistoryPublicIdentities} from "./public-history-identities.mjs";
import {verifyHistoryPublicData} from "./public-source-checksums.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const evidence = new URL("../../docs/evidence/rmt-task088/hash-adjudication/", import.meta.url);
const findings = JSON.parse(gunzipSync(readFileSync(new URL("original-ci-history-raw-redacted.json.gz", evidence))));
const supplementBytes = readFileSync(new URL("exact-source-checksums.json", evidence));
const sourceCommit = "3ec076fdd77e6dd502061040698c998eadc81b7b";
const supplementalIndexes = findings.flatMap((row, index) => row.Commit === sourceCommit ? [index] : []);
const git = (commit, path) => execFileSync("git", ["show", `${commit}:${path}`],
  {cwd: repository, windowsHide: true, maxBuffer: 4 * 1024 * 1024});
const blocked = rows => assert.equal(verifyHistoryPublicData(rows).status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");

test("seven exact public observations retain every raw finding and all security holds", () => {
  const before = JSON.stringify(findings);
  const result = verifyHistoryPublicData(findings);
  assert.equal(result.status, "PASSED_EXACT_PUBLIC_DATA_ONLY");
  assert.equal(result.rawFindingCount, 7);
  assert.equal(result.classified.length, 7);
  assert.deepEqual(result.unclassified, []);
  assert.deepEqual(result.missing, []);
  assert.equal(result.rawScanPassed, false);
  for (const property of ["detectorsChanged", "ignoreAdded", "financialSecurityClearance", "productionAuthorization"]) assert.equal(result[property], false);
  assert.equal(JSON.stringify(findings), before, "adjudication must not edit the raw report");
  assert.equal(result.classified.filter(row => row.kind === "PUBLIC_SOURCE_FILE_SHA256").length, 2);
});
test("the original five-record verifier remains unchanged and rejects the two new observations", () => {
  const result = verifyHistoryPublicIdentities(findings);
  assert.equal(result.status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
  assert.equal(result.classified.length, 5);
  assert.equal(result.unclassified.length, 2);
});
for (let index = 0; index < findings.length; index++) {
  test(`missing raw observation ${index + 1} blocks`, () => blocked(findings.filter((_, item) => item !== index)));
  test(`duplicate raw observation ${index + 1} blocks`, () => blocked([...findings, findings[index]]));
}
test("an unrelated key-shaped finding is still rejected", () => blocked([...findings, {
  ...findings[supplementalIndexes[0]], Fingerprint: "unrelated-key-shaped-canary",
  File: "unrelated.txt", Commit: "f".repeat(40), Match: 'api_key = "REDACTED"',
}]));
const changes = [
  ["commit", {Commit: "f".repeat(40)}],
  ["future identical source value", {Fingerprint: findings[supplementalIndexes[0]].Fingerprint.replace(sourceCommit, "b02a0c2bb3b2814bfc9a0610dee79860b648cc08"), Commit: "b02a0c2bb3b2814bfc9a0610dee79860b648cc08"}],
  ["path", {File: "docs/evidence/rmt-task088/another-manifest.json"}],
  ["start line", {StartLine: 16}],
  ["end line", {EndLine: 16}],
  ["rule", {RuleID: "another-detector"}],
  ["fingerprint", {Fingerprint: "same-looking-unreviewed-finding"}],
  ["unredacted secret", {Secret: "another-value"}],
  ["redacted match field", {Match: 'another-api-file.ts": "REDACTED"'}],
  ["redacted match value", {Match: 'launch-api.ts": "changed"'}],
];
for (const index of supplementalIndexes) for (const [name, change] of changes) {
  test(`changed ${name} for source-checksum observation at line ${findings[index].StartLine} blocks`, () => {
    const rows = structuredClone(findings);
    Object.assign(rows[index], change);
    blocked(rows);
  });
}
test("changed immutable manifest blob fails proof verification", () => {
  assert.throws(() => verifyHistoryPublicData(findings, {readGit: (commit, path) =>
    commit === sourceCommit && path === "docs/evidence/rmt-task088/test-results.json"
      ? Buffer.concat([git(commit, path), Buffer.from("\n")]) : git(commit, path)}), /proof/);
});
for (const sourcePath of ["apps/launch-website/lib/server/launch-api.test.ts", "apps/launch-website/lib/server/launch-api.ts"]) {
  test(`changed public source bytes fail proof verification: ${sourcePath}`, () => {
    assert.throws(() => verifyHistoryPublicData(findings, {readGit: (commit, path) =>
      commit === sourceCommit && path === sourcePath ? Buffer.concat([git(commit, path), Buffer.from("\n")]) : git(commit, path)}), /proof/);
  });
}
for (const property of ["sourcePath", "sourceBlobSha256", "lineSha256", "manifestGitBlobSha1", "valueSha256", "redactedMatchSha256"]) {
  test(`supplemental ${property} tampering fails closed`, () => {
    const altered = JSON.parse(supplementBytes);
    altered.records[0][property] = "changed";
    assert.throws(() => verifyHistoryPublicData(findings, {supplementBytes: Buffer.from(JSON.stringify(altered))}), /proof/);
  });
}
test("original detector configuration, ignore and five-record policy tampering still fail", () => {
  const configuration = readFileSync(new URL("../../.gitleaks.toml", import.meta.url));
  assert.throws(() => verifyHistoryPublicData(findings, {configuration: Buffer.concat([configuration, Buffer.from("\n# changed")])}), /proof/);
  assert.throws(() => verifyHistoryPublicData(findings, {ignoreBytes: Buffer.from("new ignore")}), /proof/);
  assert.throws(() => verifyHistoryPublicData(findings, {policyBytes: Buffer.from("{}")}), /proof/);
});
test("malformed and oversized reports fail closed", () => {
  assert.throws(() => verifyHistoryPublicData(null), /proof/);
  assert.throws(() => verifyHistoryPublicData(new Array(1025)), /proof/);
  blocked([]);
  blocked([{}]);
});
