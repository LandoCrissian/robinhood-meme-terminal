import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {gunzipSync, gzipSync} from "node:zlib";
import {verifyTask091SnapshotHistoryPublicData as verifySnapshot} from "./public-task091-snapshot-identities.mjs";
import {verifyTask091HistoryPublicData as verifyPrior} from "./public-task091-identities.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const bytes = readFileSync(new URL("../../docs/evidence/rmt-task091/history-adjudication/derived-report-proof.json", import.meta.url));
const proof = JSON.parse(bytes), raw = JSON.parse(proof.actualCiRawReportUtf8), commit = proof.sourceCommit;
const index = raw.findIndex(r => r.Commit === commit && r.File === proof.sourcePath);
const cache = new Map();
const git = (c, p) => {
  const key = c + ":" + p;
  if (!cache.has(key)) cache.set(key, execFileSync("git", ["show", key], {cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024}));
  return cache.get(key);
};
const verify = (rows, options = {}) => verifySnapshot(rows, {readGit: git, ...options});
const blocked = rows => assert.equal(verify(rows).status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING");

test("actual hosted CI raw300 retains every original22 and admits exactly278 immutable receipt-proven public references", () => {
  assert.equal(createHash("sha256").update(proof.actualCiRawReportUtf8).digest("hex"), proof.actualCiRawReportSha256);
  assert.equal(raw.length, 300); const before = JSON.stringify(raw), r = verify(raw);
  assert.equal(r.status, "PASSED_EXACT_PUBLIC_DATA_ONLY"); assert.equal(r.rawFindingCount, 300);
  assert.equal(r.classified.length, 300); assert.deepEqual(r.unclassified, []); assert.deepEqual(r.missing, []);
  assert.equal(r.classified.filter(x => x.commit === commit).length, 278);
  for (const k of ["rawScanPassed", "detectorsChanged", "ignoreAdded", "financialSecurityClearance", "productionAuthorization"]) assert.equal(r[k], false);
  assert.equal(JSON.stringify(raw), before);
  const prior = verifyPrior(raw, {readGit: git}); assert.equal(prior.classified.length, 22); assert.equal(prior.unclassified.length, 278);
});
test("missing, duplicated and unknown findings never inherit derived-reference acceptance", () => {
  blocked(raw.filter((_, i) => i !== index)); blocked([...raw, raw[index]]);
  blocked(raw.filter((_, i) => i !== raw.length - 1));
  blocked([...raw, {Fingerprint: "unknown:new-value:1", RuleID: "generic-api-key", Secret: "REDACTED", Match: 'api_key = "REDACTED"'}]);
});
test("every security coordinate, detector, redaction, commit and fingerprint remains exact", () => {
  for (const [key, value] of Object.entries({Fingerprint: raw[index].Fingerprint + ":new", RuleID: "different-rule", Secret: "unreviewed",
    Match: 'api_key = "REDACTED"', Commit: "f".repeat(40), File: "docs/evidence/unreviewed.json", StartLine: 1, EndLine: 1, StartColumn: 1, EndColumn: 1})) {
    const rows = structuredClone(raw); rows[index][key] = value; blocked(rows);
  }
});
test("the same public-looking identity in a future commit or another path stays unclassified", () => {
  const rows = structuredClone(raw); rows[index].Commit = "f".repeat(40);
  rows[index].Fingerprint = rows[index].Fingerprint.replace(commit, rows[index].Commit); blocked(rows);
  const other = structuredClone(raw); other[index].File = "docs/evidence/rmt-task091/unreviewed.json";
  other[index].Fingerprint = other[index].Fingerprint.replace(proof.sourcePath, other[index].File); blocked(other);
});
test("immutable derived report, exact CI index, original scan manifest and raw rows cannot drift", () => {
  for (const path of [proof.sourcePath, proof.indexPath, "docs/evidence/rmt-task091/validation/final-scan/scan-manifest.json",
    "docs/evidence/rmt-task091/validation/final-scan/gitleaks-redacted.json"]) {
    assert.throws(() => verify(raw, {readGit: (c, p) => c === commit && p === path ? Buffer.concat([git(c, p), Buffer.from("\n")]) : git(c, p)}), /proof/);
  }
});
test("unrecognized asset references and changed creation receipts cannot replace the immutable public proof", () => {
  for (const change of [r => {r.findings[proof.records[0].derivedIndex].proof.token = "0x" + "12".repeat(20);},
    r => {r.findings[proof.records[0].derivedIndex].proof.creation.status = "reverted";},
    r => {r.findings[proof.records[0].derivedIndex].proof.origin += ":unknown";}]) {
    assert.throws(() => verify(raw, {readGit: (c, p) => {
      if (c !== commit || p !== proof.sourcePath) return git(c, p);
      const r = JSON.parse(git(c, p)); change(r); return Buffer.from(JSON.stringify(r));
    }}), /proof/);
  }
});
test("synthetic creation receipts in retained creator and wallet reports are immutable provenance", () => {
  const paths = ["docs/evidence/rmt-task091/journey/retained-head/chromium-mobile.json.gz",
    "docs/evidence/rmt-task091/journey/retained-head/chromium-claim-wallet-acceptance.json.gz"];
  for (const path of paths) assert.throws(() => verify(raw, {readGit: (c, p) => {
    if (c !== commit || p !== path) return git(c, p);
    const r = JSON.parse(gunzipSync(git(c, p)));
    if (r.projects) r.projects[0].creation.status = "reverted"; else r.receipt.status = "0x0";
    return gzipSync(JSON.stringify(r));
  }}), /proof/);
});
test("proof fields, original scanner policy and ignored paths cannot be broadened", () => {
  const changed = structuredClone(proof); changed.records[0].publicValueSha256 = "0".repeat(64);
  assert.throws(() => verify(raw, {snapshotProofBytes: Buffer.from(JSON.stringify(changed))}), /proof/);
  assert.throws(() => verify(raw, {configuration: Buffer.from("changed scanner policy")}), /proof/);
  assert.throws(() => verify(raw, {ignoreBytes: Buffer.from("new ignored path")}), /proof/);
});
test("the actually detected unrelated canary remains rejected alongside all300 public matches", () => {
  const canary = JSON.parse(readFileSync(new URL("../../docs/evidence/rmt-task090/history-adjudication/original-ci-canary-redacted.json", import.meta.url)));
  const r = verify([...raw, ...canary]); assert.equal(r.classified.length, 300);
  assert.equal(r.status, "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING"); assert.ok(r.unclassified.length >= canary.length);
});
test("missing malformed and oversized input fails closed", () => {
  assert.throws(() => verify(null), /proof/); assert.throws(() => verify(new Array(1025)), /proof/); blocked([]); blocked([{}]);
});
