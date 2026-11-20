import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {verifyHistoryPublicIdentities} from "./public-history-identities.mjs";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const supplementPath = "docs/evidence/rmt-task088/hash-adjudication/exact-source-checksums.json";
const supplementSha256 = "5ed87071d55bae822cb9e4465607fd79b52b3b674cb104e02347af57e0d80881";
const sourceCommit = "3ec076fdd77e6dd502061040698c998eadc81b7b";
const manifestPath = "docs/evidence/rmt-task088/test-results.json";
const sourceAtLine = new Map([
  [14, "apps/launch-website/lib/server/launch-api.test.ts"],
  [15, "apps/launch-website/lib/server/launch-api.ts"],
]);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const blobSha1 = bytes => createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
const git = (commit, path) => execFileSync("git", ["show", `${commit}:${path}`],
  {cwd: repository, windowsHide: true, maxBuffer: 4 * 1024 * 1024});
const descriptor = row => ({
  fingerprint: typeof row?.Fingerprint === "string" ? row.Fingerprint.slice(0, 400) : "invalid",
  ruleId: typeof row?.RuleID === "string" ? row.RuleID.slice(0, 80) : "invalid",
});

/** Classify two exact immutable public file checksums after the unchanged raw scan.
 * The five-record Task082 verifier is unchanged and still validates its own policy,
 * scanner configuration and historical ignore file. No raw finding is removed from
 * the returned result; every unknown, missing, duplicate or changed row blocks.
 */
export function verifyHistoryPublicData(findings, options = {}) {
  try {
    assert.ok(Array.isArray(findings) && findings.length <= 1024);
    const {supplementBytes = readFileSync(new URL("../../" + supplementPath, import.meta.url)), ...legacyOptions} = options;
    assert.equal(sha256(Buffer.from(supplementBytes).toString().replaceAll("\r\n", "\n")), supplementSha256);
    const supplement = JSON.parse(supplementBytes);
    assert.equal(supplement.records.length, 2);
    const readGit = options.readGit ?? git;
    const proof = new Map();
    for (const record of supplement.records) {
      assert.equal(record.commit, sourceCommit);
      assert.equal(record.path, manifestPath);
      assert.equal(record.ruleId, "generic-api-key");
      assert.equal(record.sourcePath, sourceAtLine.get(record.line));
      assert.equal(record.publicKind, "PUBLIC_SOURCE_FILE_SHA256");
      assert.equal(record.fingerprint, `${sourceCommit}:${manifestPath}:generic-api-key:${record.line}`);
      const manifest = readGit(record.commit, record.path);
      assert.ok(Buffer.isBuffer(manifest) && manifest.length <= 65536);
      assert.equal(sha256(manifest), record.manifestBlobSha256);
      assert.equal(blobSha1(manifest), record.manifestGitBlobSha1);
      const line = manifest.toString().split(/(?<=\n)/)[record.line - 1];
      assert.equal(sha256(line), record.lineSha256);
      const data = JSON.parse(manifest);
      assert.equal(data.schemaVersion, 1);
      const value = data.sourceFileSha256[record.sourcePath];
      assert.match(value, /^[0-9a-f]{64}$/);
      assert.ok(line.includes(`"${record.sourcePath}": "${value}"`));
      const source = readGit(record.commit, record.sourcePath);
      assert.ok(Buffer.isBuffer(source) && source.length <= 65536);
      assert.equal(blobSha1(source), record.sourceGitBlobSha1);
      assert.equal(sha256(source), record.sourceBlobSha256);
      assert.equal(sha256(source), value, "The reported value must be recomputed from the actual public source bytes");
      assert.equal(sha256(value.toLowerCase()), record.valueSha256);
      assert.ok(!proof.has(record.fingerprint));
      proof.set(record.fingerprint, record);
    }
    assert.equal(proof.size, 2);
    const supplementalRows = [], legacyRows = [];
    for (const row of findings) (proof.has(row?.Fingerprint) ? supplementalRows : legacyRows).push(row);
    const legacy = verifyHistoryPublicIdentities(legacyRows, legacyOptions);
    const classified = [...legacy.classified], unclassified = [...legacy.unclassified], seen = new Set();
    for (const row of supplementalRows) {
      const record = proof.get(row.Fingerprint);
      const valid = !seen.has(row.Fingerprint) && row.RuleID === record.ruleId && row.Commit === record.commit
        && row.File === record.path && row.StartLine === record.line && row.EndLine === record.line
        && row.Secret === "REDACTED" && typeof row.Match === "string"
        && sha256(row.Match) === record.redactedMatchSha256;
      if (valid) {
        seen.add(row.Fingerprint);
        classified.push({fingerprint: record.fingerprint, kind: record.publicKind, commit: record.commit,
          gitBlobSha1: record.manifestGitBlobSha1, lineSha256: record.lineSha256,
          sourcePath: record.sourcePath, sourceGitBlobSha1: record.sourceGitBlobSha1,
          sourceBlobSha256: record.sourceBlobSha256, publicValueSha256: record.valueSha256});
      } else unclassified.push(descriptor(row));
    }
    const missing = [...legacy.missing, ...[...proof.keys()].filter(key => !seen.has(key))];
    return {...legacy, rawFindingCount: findings.length, classified, unclassified, missing,
      status: unclassified.length || missing.length ? "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING" : "PASSED_EXACT_PUBLIC_DATA_ONLY",
      rawScanPassed: findings.length === 0, detectorsChanged: false, ignoreAdded: false,
      financialSecurityClearance: false, productionAuthorization: false,
      supplementalProof: "task088-exact-source-file-checksums-v1"};
  } catch {
    throw Error("Exact public source checksum proof is unavailable or changed");
  }
}
