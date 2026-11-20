import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {gunzipSync, gzipSync} from "node:zlib";
import {test} from "node:test";
import {verifyTask090HistoryPublicData} from "./public-task090-identities.mjs";
import {verifyHistoryPublicData} from "./public-source-checksums.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const evidence = new URL("../../docs/evidence/rmt-task090/history-adjudication/", import.meta.url);
const findings = JSON.parse(gunzipSync(readFileSync(new URL("original-ci-history-raw-redacted.json.gz", evidence))));
const canary = JSON.parse(readFileSync(new URL("original-ci-canary-redacted.json", evidence)));
const proofBytes = readFileSync(new URL("exact-public-identities.json", evidence));
const proof = JSON.parse(proofBytes);
const sourceCommit = "b6d094d1fc446fd84ab162e546a487a5304b8b4d";
const supplementalIndexes = findings.flatMap((row, index) => row.Commit === sourceCommit ? [index] : []);
const cache = new Map();
const git = (commit, path) => {
  const key = commit + ":" + path;
  if (!cache.has(key)) cache.set(key, execFileSync("git", ["show", key],
    {cwd: repository, windowsHide: true, maxBuffer: 32 * 1024 * 1024}));
  return cache.get(key);
};
const verify = (rows, options = {}) => verifyTask090HistoryPublicData(rows, {readGit: git, ...options});
const blocked = rows => assert.equal(verify(rows).status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");

test("all17 original CI observations remain intact; only10 exact new public records are added", () => {
  assert.equal(findings.length, 17); assert.equal(supplementalIndexes.length, 10);
  const before = JSON.stringify(findings), result = verify(findings);
  assert.equal(result.status, "PASSED_EXACT_PUBLIC_DATA_ONLY");
  assert.equal(result.rawFindingCount, 17); assert.equal(result.classified.length, 17);
  assert.equal(result.classified.filter(row => row.commit === sourceCommit).length, 10);
  assert.deepEqual(result.unclassified, []); assert.deepEqual(result.missing, []);
  assert.equal(result.rawScanPassed, false);
  for (const key of ["detectorsChanged", "ignoreAdded", "financialSecurityClearance", "productionAuthorization"]) assert.equal(result[key], false);
  assert.equal(JSON.stringify(findings), before);
  const legacy = verifyHistoryPublicData(findings, {readGit: git});
  assert.equal(legacy.classified.length, 7); assert.equal(legacy.unclassified.length, 10);
  assert.equal(legacy.status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
});

for (let index = 0; index < findings.length; ++index) {
  test(`missing immutable observation ${index + 1} blocks`, () => blocked(findings.filter((_, item) => item !== index)));
  test(`duplicated immutable observation ${index + 1} blocks`, () => blocked([...findings, findings[index]]));
}

for (const index of supplementalIndexes) test(`altered fingerprint for new observation at ${findings[index].File}:${findings[index].StartLine} blocks`, () => {
  const rows = structuredClone(findings); rows[index].Fingerprint += ":unreviewed"; blocked(rows);
});

for (const [name, change] of [
  ["commit", {Commit: "f".repeat(40)}],
  ["same address in a future commit", {Commit: "f".repeat(40), Fingerprint: findings[supplementalIndexes[0]].Fingerprint.replace(sourceCommit, "f".repeat(40))}],
  ["path", {File: "docs/evidence/rmt-task090/unreviewed.json"}],
  ["start line", {StartLine: 51}], ["end line", {EndLine: 51}],
  ["start column", {StartColumn: 8}], ["end column", {EndColumn: 59}],
  ["rule", {RuleID: "another-detector"}], ["unredacted value", {Secret: "another-value"}],
  ["different matched field", {Match: 'api_key = "REDACTED"'}],
]) test(`altered ${name} blocks`, () => {
  const rows = structuredClone(findings); Object.assign(rows[supplementalIndexes[0]], change); blocked(rows);
});

for (const path of [...new Set(proof.records.map(record => record.path))]) {
  test(`changed immutable blob blocks: ${path}`, () => {
    assert.throws(() => verify(findings, {readGit: (commit, file) => commit === sourceCommit && file === path
      ? Buffer.concat([git(commit, file), Buffer.from("\n")]) : git(commit, file)}), /proof/);
  });
  test(`changed actual ERC20 address blocks despite unchanged raw metadata: ${path}`, () => {
    assert.throws(() => verify(findings, {readGit: (commit, file) => commit === sourceCommit && file === path
      ? Buffer.from(git(commit, file).toString().replace(/"token": "0x[0-9a-f]{40}"/ig, '"token": "0x0000000000000000000000000000000000000099"'))
      : git(commit, file)}), /proof/);
  });
}

test("changed graduation factory creation receipt blocks", () => {
  const path = proof.receiptProofs.graduation.artifact.path;
  assert.throws(() => verify(findings, {readGit: (commit, file) => commit === sourceCommit && file === path
    ? Buffer.from(git(commit, file).toString().replace("emit CurveCreated(token:", "emit ChangedReceipt(token:")) : git(commit, file)}), /proof/);
});

test("changed CREATE2 success and returned runtime in retained harvest receipt block", () => {
  const path = proof.receiptProofs.harvest.artifact.path;
  for (const mutate of [frame => frame.trace.success = false, frame => frame.trace.output = "0x00"]) {
    assert.throws(() => verify(findings, {readGit: (commit, file) => {
      if (commit !== sourceCommit || file !== path) return git(commit, file);
      const trace = JSON.parse(gunzipSync(git(commit, file), {maxOutputLength: 32 * 1024 * 1024}));
      const result = Object.values(Object.values(trace)[0].test_results)[0];
      mutate(result.traces.find(([phase]) => phase === "Setup")[1].arena[64]);
      return gzipSync(Buffer.from(JSON.stringify(trace)));
    }}), /proof/);
  }
});

for (const field of ["fingerprint", "commit", "path", "ruleId", "gitBlobSha1", "blobContentDigest", "line",
  "startColumn", "endColumn", "lineContentDigest", "publicValueDigest", "jsonPointer", "receiptProof",
  "redactedMatchContentDigest", "publicKind"])
  test(`registry ${field} mutation cannot broaden the pinned proof`, () => {
    const altered = structuredClone(proof); altered.records[0][field] = "changed";
    assert.throws(() => verify(findings, {proofBytes: Buffer.from(JSON.stringify(altered))}), /proof/);
  });

test("changed receipt frame in proof metadata blocks", () => {
  const altered = structuredClone(proof); altered.receiptProofs.harvest.receipts[0].frame = 65;
  assert.throws(() => verify(findings, {proofBytes: Buffer.from(JSON.stringify(altered))}), /proof/);
});

test("original detected runtime canary and a masquerading API-key match remain rejected", () => {
  assert.ok(canary.length > 0); assert.ok(canary.every(row => row.Secret === "REDACTED"));
  const result = verify([...findings, ...canary]);
  assert.equal(result.status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
  assert.equal(result.classified.length, 17); assert.ok(result.unclassified.length >= canary.length);
  const rows = structuredClone(findings); rows[supplementalIndexes[0]].Match = 'api_key = "REDACTED"'; blocked(rows);
});

test("original detector and ignore policies still fail closed when changed", () => {
  const configuration = readFileSync(new URL("../../.gitleaks.toml", import.meta.url));
  assert.throws(() => verify(findings, {configuration: Buffer.concat([configuration, Buffer.from("\n# changed")])}), /proof/);
  assert.throws(() => verify(findings, {ignoreBytes: Buffer.from("new ignore")}), /proof/);
});

test("malformed, empty and oversized input cannot pass", () => {
  assert.throws(() => verify(null), /proof/); assert.throws(() => verify(new Array(1025)), /proof/);
  blocked([]); blocked([{}]);
});
