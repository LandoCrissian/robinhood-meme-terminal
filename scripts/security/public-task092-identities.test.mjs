import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {verifyTask091SnapshotHistoryPublicData as verifyPrior} from "./public-task091-snapshot-identities.mjs";
import {verifyTask092HistoryPublicData as verifyNew} from "./public-task092-identities.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const proofBytes = readFileSync(new URL("../../docs/evidence/rmt-task092/history-adjudication/exact-public-identities.json", import.meta.url));
const proof = JSON.parse(proofBytes), commit = proof.sourceCommit;
const priorProof = JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task091/history-adjudication/derived-report-proof.json", import.meta.url)));
// These are the unchanged legacy raw rows plus the exact security fields
// captured from the new real 322-finding scan. The initial raw report's digest
// is retained in the immutable supplemental proof; no raw row is suppressed.
const priorRows = JSON.parse(priorProof.actualCiRawReportUtf8), additions = proof.records.map(record => record.finding);
const findings = [...priorRows, ...additions], css = priorRows.length, type = findings.length - 1;
const cache = new Map();
const git = (c, path) => {
  const key = c + ":" + path;
  if (!cache.has(key)) cache.set(key, execFileSync("git", ["show", key], {cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024}));
  return cache.get(key);
};
const verify = (rows, options = {}) => verifyNew(rows, {readGit: git, ...options});
const blocked = rows => assert.equal(verify(rows).status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const normalize = bytes => bytes.toString().replaceAll("\r\n", "\n");

test("all 322 recorded raw identities retain the original 300 and add only 22 exact immutable public identities", () => {
  const before = JSON.stringify(findings), result = verify(findings);
  assert.equal(result.status, "PASSED_EXACT_PUBLIC_DATA_ONLY"); assert.equal(result.rawFindingCount, 322);
  assert.equal(result.classified.length, 322); assert.deepEqual(result.unclassified, []); assert.deepEqual(result.missing, []);
  assert.equal(result.classified.filter(row => row.commit === commit).length, 22);
  assert.equal(result.classified.filter(row => row.commit === commit && row.kind === "PUBLIC_SOURCE_FILE_SHA256").length, 21);
  assert.equal(result.classified.filter(row => row.commit === commit && row.kind === "PUBLIC_CANONICAL_SOLIDITY_TYPE").length, 1);
  for (const field of ["rawScanPassed", "detectorsChanged", "ignoreAdded", "financialSecurityClearance", "productionAuthorization"]) assert.equal(result[field], false);
  assert.equal(JSON.stringify(findings), before);
  const legacy = verifyPrior(findings, {readGit: git}); assert.equal(legacy.classified.length, 300); assert.equal(legacy.unclassified.length, 22);
});

test("each missing or duplicated supplemental observation remains blocked", () => {
  for (let index = css; index < findings.length; index++) {
    blocked(findings.filter((_, i) => i !== index)); blocked([...findings, findings[index]]);
  }
  blocked(findings.slice(1)); blocked([...findings, findings[0]]);
});

test("every changed finding coordinate, detector, redaction, commit and fingerprint stays blocked", () => {
  for (const index of [css, type]) for (const [key, value] of Object.entries({Fingerprint: findings[index].Fingerprint + ":new",
    RuleID: "different-detector", Secret: "unreviewed", Match: 'api_key = "REDACTED"', Commit: "f".repeat(40),
    File: "docs/evidence/unreviewed.json", StartLine: 1, EndLine: 1, StartColumn: 1, EndColumn: 1})) {
    const rows = structuredClone(findings); rows[index][key] = value; blocked(rows);
  }
});

test("a public-looking identity at a new commit or path never inherits acceptance", () => {
  for (const index of [css, type]) {
    const rows = structuredClone(findings); rows[index].Commit = "f".repeat(40);
    rows[index].Fingerprint = rows[index].Fingerprint.replace(commit, rows[index].Commit); blocked(rows);
    const other = structuredClone(findings); other[index].File = "docs/evidence/rmt-task092/another-report.json";
    other[index].Fingerprint = other[index].Fingerprint.replace(findings[index].File, other[index].File); blocked(other);
  }
});

test("changed public CSS, source report, producer or compiler/runtime support bytes fail closed", () => {
  const paths = [proof.publicSource.path, additions[0].File, additions.at(-1).File, ...proof.compilerProof.bindings.map(binding => binding.path)];
  for (const path of paths) assert.throws(() => verify(findings, {readGit: (c, p) => c === commit && p === path
    ? Buffer.concat([git(c, p), Buffer.from("\n")]) : git(c, p)}), /proof/);
});

test("tampering with supplemental identities, hashes, compiler bindings or authorization fields fails", () => {
  for (const change of [p => {p.records[0].identitySha256 = "0".repeat(64);}, p => {p.records[0].lineSha256 = "0".repeat(64);},
    p => {p.records[0].finding.File = "another.json";}, p => {p.publicSource.blobSha256 = "0".repeat(64);},
    p => {p.compilerProof.inputSha256 = "0".repeat(64);}, p => {p.compilerProof.bindings.pop();},
    p => {p.productionAuthorization = true;}, p => {p.records.push(p.records[0]);}]) {
    const altered = structuredClone(proof); change(altered);
    assert.throws(() => verify(findings, {task092ProofBytes: Buffer.from(JSON.stringify(altered))}), /proof/);
  }
});

test("original policies and legacy proof tampering still fail through the unchanged verifier", () => {
  assert.throws(() => verify(findings, {configuration: Buffer.from("changed detector configuration")}), /proof/);
  assert.throws(() => verify(findings, {ignoreBytes: Buffer.from("new ignore")}), /proof/);
  assert.throws(() => verify(findings, {snapshotProofBytes: Buffer.from("{}")}), /proof/);
});

test("the newly detected unrelated canary remains rejected beside all 322 public observations", () => {
  assert.equal(sha(proof.actualCanaryReportUtf8), proof.actualCanaryReportSha256);
  const canary = JSON.parse(proof.actualCanaryReportUtf8); assert.equal(canary.length, 1); assert.ok(canary.every(row => row.Secret === "REDACTED"));
  const result = verify([...findings, ...canary]); assert.equal(result.classified.length, 322);
  assert.equal(result.status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING"); assert.equal(result.unclassified.length, 1);
  assert.deepEqual(result.missing, []);
});

test("missing, malformed and oversized reports remain closed", () => {
  assert.throws(() => verify(null), /proof/); assert.throws(() => verify(new Array(1025)), /proof/); blocked([]); blocked([{}]);
});

test("original secret workflow, detector policies, legacy verifiers and tests remain unchanged", () => {
  const protectedPaths = [".gitleaks.toml", ".gitleaksignore", ".github/workflows/secret-scan.yml",
    "scripts/security/public-history-identities.mjs", "scripts/security/public-history-identities.test.mjs",
    "scripts/security/public-source-checksums.mjs", "scripts/security/public-source-checksums.test.mjs",
    "scripts/security/public-task090-identities.mjs", "scripts/security/public-task090-identities.test.mjs",
    "scripts/security/public-task091-identities.mjs", "scripts/security/public-task091-identities.test.mjs",
    "scripts/security/public-task091-snapshot-identities.mjs", "scripts/security/public-task091-snapshot-identities.test.mjs"];
  for (const path of protectedPaths) assert.equal(normalize(readFileSync(new URL("../../" + path, import.meta.url))), normalize(git(commit, path)), path);
  const runner = normalize(readFileSync(new URL("run-history-scan.mjs", import.meta.url)));
  assert.equal(runner, normalize(git(commit, "scripts/security/run-history-scan.mjs"))
    .replace('import {verifyTask091SnapshotHistoryPublicData as verifyHistoryPublicData} from "./public-task091-snapshot-identities.mjs";',
      'import {verifyMarketHistoryPublicData as verifyHistoryPublicData} from "./public-market-identities.mjs";'));
});

test("the new Task092 server job always executes this protected adjudication test", () => {
  const workflow = normalize(readFileSync(new URL("../../.github/workflows/task092-production-adapters.yml", import.meta.url)));
  const serverJob = workflow.split("  server-and-postgres:")[1]?.split("\n  linux-financial-artifact:")[0];
  assert.ok(serverJob); assert.match(serverJob, /node --test scripts\/security\/public-task092-identities\.test\.mjs/);
  assert.match(serverJob, /fetch-depth: 0/);
  assert.match(workflow, /"scripts\/security\/public-task092-identities\*"/); assert.match(workflow, /"scripts\/security\/run-history-scan\.mjs"/);
});
