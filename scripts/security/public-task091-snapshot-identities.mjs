import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import {verifyTask091HistoryPublicData} from "./public-task091-identities.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const proofPath = "docs/evidence/rmt-task091/history-adjudication/derived-report-proof.json";
const proofSha = "80eb09a30465c9493d2033fdafdafd504887b7c1d1344a44f6037936f32cb209";
const commit = "e7df811511f8d607abe9192f1e2bf6eefde2bd5c";
const sourcePath = "docs/evidence/rmt-task091/validation/final-scan/public-classification.json";
const sourceSha = "a1da69617ee6e60134b186280799c749719b5e2e41a8129ac93f8bd95c43a7e8";
const sourceBlob = "29acf9c8bd072d81d1e274571ce8a5d86fe4c09e";
const indexPath = "docs/evidence/rmt-task091/journey/evidence-index.json";
const indexSha = "88b945fe88728ad3b6663cb86de8a5e9050e1dc5e7271c8cce9bc584a18a5b7e";
const sha = b => createHash("sha256").update(b).digest("hex");
const blob = b => createHash("sha1").update(Buffer.from(`blob ${b.length}\0`)).update(b).digest("hex");
const canonicalReceipt = r => JSON.stringify(Object.fromEntries(Object.keys(r).sort().map(k => [k, r[k]])));
const git = (c, p) => execFileSync("git", ["show", `${c}:${p}`], {cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024});
const unpack = b => gunzipSync(b, {maxOutputLength: 32 * 1024 * 1024});
const securityFields = ["Fingerprint", "RuleID", "Secret", "Match", "Commit", "File", "StartLine", "EndLine", "StartColumn", "EndColumn"];
const descriptor = r => ({fingerprint: typeof r?.Fingerprint === "string" ? r.Fingerprint.slice(0, 400) : "invalid", ruleId: typeof r?.RuleID === "string" ? r.RuleID.slice(0, 80) : "invalid"});

/** Exact immutable references to already-created synthetic assets only. The
 * unchanged prior verifier handles all original22 observations and scanner policy.
 * This grants no path/address-pattern exception and never clears the raw scan. */
export function verifyTask091SnapshotHistoryPublicData(findings, options = {}) {
  try {
    assert.ok(Array.isArray(findings) && findings.length <= 1024);
    const {snapshotProofBytes = readFileSync(new URL("../../" + proofPath, import.meta.url)), ...legacyOptions} = options;
    assert.equal(sha(Buffer.from(snapshotProofBytes).toString().replaceAll("\r\n", "\n")), proofSha);
    const policy = JSON.parse(snapshotProofBytes);
    assert.equal(policy.schemaVersion, 1); assert.equal(policy.sourceCommit, commit); assert.equal(policy.sourcePath, sourcePath);
    assert.equal(policy.records.length, 278); assert.equal(policy.blobSha256, sourceSha); assert.equal(policy.gitBlobSha1, sourceBlob);
    assert.equal(policy.indexPath, indexPath); assert.equal(policy.indexSha256, indexSha);
    assert.equal(sha(policy.actualCiRawReportUtf8), policy.actualCiRawReportSha256);
    assert.equal(JSON.parse(policy.actualCiRawReportUtf8).length, 300);
    assert.equal(policy.ciRun, 44816584941); assert.equal(policy.ciArtifactId, 14669787004);
    assert.equal(policy.ciArtifactZipSha256, "f2dc814564e9d597685e52c75cbf594ef85314347f205049b5aa5e5abf204f57");
    const cache = new Map(), reader = options.readGit ?? git;
    const read = (c, p) => {
      const key = c + ":" + p;
      if (!cache.has(key)) {const b = reader(c, p); assert.ok(Buffer.isBuffer(b) && b.length <= 32 * 1024 * 1024); cache.set(key, b);}
      return cache.get(key);
    };
    const source = read(commit, sourcePath); assert.equal(sha(source), sourceSha); assert.equal(blob(source), sourceBlob);
    const report = JSON.parse(source); assert.equal(report.rawExit, 1); assert.equal(report.rawFindings, 288);
    assert.equal(report.unknownFindings, 0); assert.equal(report.rawGateCleared, false); assert.equal(report.detectorOrIgnoreChanges, false);
    assert.equal(report.admittedSyntheticTokenCount, 14); assert.equal(report.unknownTokenCanary, "REJECTED");
    assert.equal(report.base, "27f19787ed0a2d904ba4508d2adfab1773e82e67");
    const manifest = read(commit, "docs/evidence/rmt-task091/validation/final-scan/scan-manifest.json");
    const scopedRaw = read(commit, "docs/evidence/rmt-task091/validation/final-scan/gitleaks-redacted.json");
    assert.equal(sha(manifest), policy.scopedManifestSha256); assert.equal(sha(manifest), report.manifestSha256);
    assert.equal(sha(scopedRaw), policy.scopedRawReportSha256); assert.equal(sha(scopedRaw), report.reportSha256);
    const scanned = JSON.parse(scopedRaw); assert.equal(scanned.length, 288);
    const indexBytes = read(commit, indexPath); assert.equal(sha(indexBytes), indexSha);
    const index = JSON.parse(indexBytes); assert.equal(index.head, report.base); assert.equal(index.reports.length, 11);
    assert.equal(index.sourceAuditSha256, "bd586b2cb3c2f8f28d2f6c496a1668ba0238191b20c6b2fa0c65df4595c9562b");
    const created = new Map(), reportPaths = new Set();
    const admit = (identity, creation, origin) => {
      assert.match(identity, /^0x[0-9a-fA-F]{40}$/); assert.equal(creation.status, "success");
      assert.match(creation.transactionHash, /^0x[0-9a-fA-F]{64}$/); assert.match(creation.blockHash, /^0x[0-9a-fA-F]{64}$/);
      assert.ok(BigInt(creation.blockNumber) > 0n); assert.ok(!created.has(identity.toLowerCase()));
      created.set(identity.toLowerCase(), {identity, creation, origin});
    };
    for (const e of index.reports) {
      const packed = read(commit, e.path); assert.equal(sha(packed), e.gzipSha256 || e.rawSha256);
      const raw = e.gzipSha256 ? unpack(packed) : packed; assert.equal(sha(raw), e.rawSha256); assert.equal(e.status, "PASS");
      reportPaths.add("expanded/" + e.path.replace(/\.gz$/, "")); const r = JSON.parse(raw);
      if (e.kind === "creator") {
        assert.equal(r.candidateCommit, report.base); assert.equal(r.chainId, 31337); assert.equal(r.receipt.status, "0x1");
        assert.equal(r.indexed.status, "created"); assert.equal(r.earnings.token.toLowerCase(), r.indexed.token.toLowerCase());
        assert.equal(r.indexed.creation.transactionHash, r.receipt.hash); assert.equal(r.indexed.creation.blockHash, r.receipt.blockHash);
        assert.equal(BigInt(r.indexed.creation.blockNumber), BigInt(r.receipt.blockNumber));
        admit(r.indexed.token, {...r.indexed.creation, status: "success"}, e.path + "#indexed.creation+receipt");
        assert.equal(r.successorEarnings.synthetic, true); assert.equal(r.successorEarnings.chainId, 31337); assert.equal(r.successorEarnings.status, "passed");
        assert.ok(r.successorEarnings.receipts.some(c => canonicalReceipt(c) === canonicalReceipt(r.successorEarnings.creation)));
        admit(r.successorEarnings.token, r.successorEarnings.creation, e.path + "#successorEarnings.creation");
      } else if (e.kind === "wallet-claim-wallet-acceptance") {
        assert.equal(r.chainId, 31337); assert.equal(r.productionExecution, false); assert.equal(r.status, "passed"); assert.equal(r.projects.length, 3);
        for (const p of r.projects) {
          assert.ok(r.receipts.some(c => canonicalReceipt(c) === canonicalReceipt(p.creation)));
          admit(p.token, p.creation, e.path + "#projects[].creation");
        }
      }
    }
    assert.equal(created.size, 14);
    const lines = source.toString().split(/(?<=\n)/), proof = new Map();
    const sourceReferenceLines = lines.flatMap((line, i) => /^\s+"token": "0x[0-9a-fA-F]{40}",\s*$/.test(line) ? [i + 1] : []);
    assert.equal(sourceReferenceLines.length, 278);
    const derivedIndexes = report.findings.flatMap((row, i) => row.category === "PUBLIC_SYNTHETIC_TOKEN_CREATION" ? [i] : []);
    assert.equal(derivedIndexes.length, 278);
    for (let i = 0; i < policy.records.length; i++) {
      const p = policy.records[i], expected = p.finding, item = report.findings[derivedIndexes[i]];
      assert.equal(p.derivedIndex, derivedIndexes[i]); assert.equal(expected.StartLine, sourceReferenceLines[i]);
      assert.equal(expected.Commit, commit); assert.equal(expected.File, sourcePath); assert.equal(expected.RuleID, "generic-api-key");
      assert.equal(expected.Fingerprint, `${commit}:${sourcePath}:generic-api-key:${expected.StartLine}`);
      assert.equal(expected.EndLine, expected.StartLine); assert.equal(expected.Secret, "REDACTED");
      assert.equal(expected.Match, 'token": "REDACTED"');
      const line = lines[expected.StartLine - 1]; assert.equal(sha(line), p.lineSha256);
      const provenance = created.get(item.proof.token.toLowerCase()); assert.ok(provenance);
      assert.equal(provenance.identity, item.proof.token); assert.equal(provenance.origin, item.proof.origin); assert.equal(p.origin, provenance.origin);
      assert.deepEqual(provenance.creation, item.proof.creation); assert.equal(sha(canonicalReceipt(provenance.creation)), p.creationReceiptSha256);
      assert.equal(sha(provenance.identity), p.publicValueSha256);
      assert.ok(item.value === provenance.identity || item.value === provenance.identity.toLowerCase());
      assert.ok(reportPaths.has(item.scanPath));
      assert.ok(scanned.some(r => r.File.replaceAll("\\", "/").endsWith("/snapshot/" + item.scanPath)
        && r.RuleID === "generic-api-key" && r.StartLine === item.line && r.EndLine === item.line
        && r.StartColumn === item.startColumn && r.EndColumn === item.endColumn && r.Match === expected.Match && r.Secret === "REDACTED"));
      const length = expected.EndColumn - expected.StartColumn + 1, publicMatch = expected.Match.replace("REDACTED", provenance.identity);
      assert.equal(length, publicMatch.length); assert.equal(line.slice(expected.StartColumn - 2, expected.StartColumn - 2 + length), publicMatch);
      assert.ok(!proof.has(expected.Fingerprint)); proof.set(expected.Fingerprint, p);
    }
    const additions = [], priorRows = []; for (const r of findings) (proof.has(r?.Fingerprint) ? additions : priorRows).push(r);
    const legacy = verifyTask091HistoryPublicData(priorRows, {...legacyOptions, readGit: read});
    const classified = [...legacy.classified], unclassified = [...legacy.unclassified], seen = new Set();
    for (const row of additions) {
      const p = proof.get(row.Fingerprint), valid = !seen.has(row.Fingerprint) && securityFields.every(k => row[k] === p.finding[k]);
      if (valid) {seen.add(row.Fingerprint); classified.push({fingerprint: row.Fingerprint, kind: "IMMUTABLE_PUBLIC_SYNTHETIC_CREATION_PROOF_REFERENCE",
        commit, gitBlobSha1: sourceBlob, lineSha256: p.lineSha256, publicValueSha256: p.publicValueSha256, creationReceiptSha256: p.creationReceiptSha256});}
      else unclassified.push(descriptor(row));
    }
    const missing = [...legacy.missing, ...[...proof.keys()].filter(k => !seen.has(k))];
    return {...legacy, rawFindingCount: findings.length, classified, unclassified, missing,
      status: unclassified.length || missing.length ? "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING" : "PASSED_EXACT_PUBLIC_DATA_ONLY",
      rawScanPassed: findings.length === 0, detectorsChanged: false, ignoreAdded: false, financialSecurityClearance: false, productionAuthorization: false,
      task091DerivedProof: "278-exact-e7df-immutable-references-to-fourteen-proven-synthetic-creations"};
  } catch {throw Error("Exact Task091 immutable derived-report creation proof is unavailable or changed");}
}
