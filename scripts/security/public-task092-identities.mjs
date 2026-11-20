import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gunzipSync} from "node:zlib";
import {verifyTask091SnapshotHistoryPublicData} from "./public-task091-snapshot-identities.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const proofPath = "docs/evidence/rmt-task092/history-adjudication/exact-public-identities.json";
const proofSha256 = "85bbdb1af27363fa5d71b8ad919359e952b924e2e0987198df821e8f748ab99d";
const commit = "2aac1e0ede3b4447345c69a338981dab745259bb";
const cssPath = "apps/launch-website/app/styles/token-detail.css";
const producerPath = "docs/evidence/rmt-task092/source/prepare-project-templates.mjs";
const publicType = "RMTLaunchCurveRevenueLedgerV1";
const inputSha256 = "66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10";
const compilerPaths = {
  input: "docs/evidence/rmt-task091/governance/source-publication/RMTLaunchCurveDeploymentV2.request.json.gz",
  compilation: "docs/evidence/rmt-task090/migration/canonical-compilation.json.gz",
  reproduction: "docs/evidence/rmt-task092/source/project-template-reproduction.json",
  templates: "apps/launch-website/lib/server/production-project-templates.json",
};
const securityFields = ["Fingerprint", "RuleID", "Secret", "Match", "Commit", "File", "StartLine", "EndLine", "StartColumn", "EndColumn"];
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const blob = bytes => createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");
const git = (c, path) => execFileSync("git", ["show", `${c}:${path}`], {cwd: root, windowsHide: true, maxBuffer: 32 * 1024 * 1024});
const unpack = bytes => gunzipSync(bytes, {maxOutputLength: 32 * 1024 * 1024});
const descriptor = row => ({fingerprint: typeof row?.Fingerprint === "string" ? row.Fingerprint.slice(0, 400) : "invalid",
  ruleId: typeof row?.RuleID === "string" ? row.RuleID.slice(0, 80) : "invalid"});

/** Adjudicate only the 22 exact observations in the immutable initial Task092
 * commit. The unchanged prior verifier still decides every original 300 row.
 * Raw findings, detector policy, ignores and financial holds are not altered. */
export function verifyTask092HistoryPublicData(findings, options = {}) {
  try {
    assert.ok(Array.isArray(findings) && findings.length <= 1024);
    const {task092ProofBytes = readFileSync(new URL("../../" + proofPath, import.meta.url)), ...legacyOptions} = options;
    assert.equal(sha(Buffer.from(task092ProofBytes).toString().replaceAll("\r\n", "\n")), proofSha256);
    const policy = JSON.parse(task092ProofBytes);
    assert.equal(policy.schemaVersion, 1); assert.equal(policy.sourceCommit, commit);
    assert.equal(policy.sourceTree, "4027f082b7a3fba74a47a6549169cf5aa11d1714");
    assert.equal(policy.initialRawExit, 1); assert.equal(policy.initialRawFindingCount, 322);
    assert.equal(policy.legacyFindingCount, 300); assert.equal(policy.newFindingCount, 22); assert.equal(policy.records.length, 22);
    for (const key of ["detectorsChanged", "ignoreAdded", "rawScanPassed", "financialSecurityClearance", "productionAuthorization"]) assert.equal(policy[key], false);
    const cache = new Map(), reader = options.readGit ?? git;
    const read = (c, path) => {
      const key = c + ":" + path;
      if (!cache.has(key)) {const bytes = reader(c, path); assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 32 * 1024 * 1024); cache.set(key, bytes);}
      return cache.get(key);
    };
    const css = read(commit, cssPath), cssDigest = sha(css);
    assert.equal(policy.publicSource.path, cssPath); assert.equal(policy.publicSource.bytes, css.length);
    assert.equal(policy.publicSource.blobSha256, cssDigest); assert.equal(policy.publicSource.gitBlobSha1, blob(css));
    const bindings = new Map(policy.compilerProof.bindings.map(entry => [entry.path, entry]));
    assert.deepEqual([...bindings.keys()].sort(), Object.values(compilerPaths).sort());
    for (const [path, binding] of bindings) {const bytes = read(commit, path); assert.equal(sha(bytes), binding.blobSha256); assert.equal(blob(bytes), binding.gitBlobSha1);}
    assert.equal(policy.compilerProof.inputPayloadPath, compilerPaths.input); assert.equal(policy.compilerProof.inputSha256, inputSha256);
    const payload = JSON.parse(unpack(read(commit, compilerPaths.input))), input = JSON.parse(payload.fields.sourceCode);
    assert.equal(sha(payload.fields.sourceCode), inputSha256); assert.equal(payload.compilerInputSha256, inputSha256);
    const contractPath = "src/" + publicType + ".sol", contractSource = input.sources[contractPath].content;
    assert.equal(policy.compilerProof.contractPath, contractPath); assert.equal(sha(contractSource), policy.compilerProof.sourceSha256);
    assert.match(contractSource, new RegExp("\\bcontract\\s+" + publicType + "\\b"));
    const reproduced = JSON.parse(read(commit, compilerPaths.reproduction)), templates = JSON.parse(read(commit, compilerPaths.templates));
    const compilation = JSON.parse(unpack(read(commit, compilerPaths.compilation)));
    assert.equal(reproduced.status, "CANONICAL_TOKEN_AND_REVENUE_LEDGER_TEMPLATES_REPRODUCED");
    assert.equal(reproduced.canonicalInputSha256, inputSha256); assert.equal(reproduced.artifactSha256, sha(read(commit, compilerPaths.templates)));
    assert.equal(reproduced.networkRequests, 0); assert.equal(reproduced.productionWrites, false);
    assert.equal(templates.chainId, 4663); assert.equal(templates.compilerInputSha256, inputSha256);
    assert.equal(templates.templates[publicType].runtime, compilation.artifacts[publicType].runtime);
    const proof = new Map(); let cssCount = 0, typeCount = 0;
    for (const record of policy.records) {
      const expected = record.finding;
      assert.equal(expected.Commit, commit); assert.equal(expected.RuleID, "generic-api-key"); assert.equal(expected.Secret, "REDACTED");
      assert.equal(expected.EndLine, expected.StartLine);
      assert.equal(expected.Fingerprint, `${commit}:${expected.File}:generic-api-key:${expected.StartLine}`);
      const bytes = read(commit, expected.File); assert.equal(sha(bytes), record.blobSha256); assert.equal(blob(bytes), record.gitBlobSha1);
      const line = bytes.toString().split(/(?<=\n)/)[expected.StartLine - 1]; assert.equal(sha(line), record.lineSha256);
      let value;
      if (record.publicKind === "PUBLIC_SOURCE_FILE_SHA256") {
        cssCount++; assert.equal(record.sourcePath, cssPath);
        const report = JSON.parse(bytes); assert.equal(report.schemaVersion, 1); assert.equal(report.chainId, 4663);
        assert.equal(report.profile, "rmt-task092-production-adapter-browser-v1"); value = report.source[cssPath];
        assert.equal(value, cssDigest); assert.equal(expected.Match, 'token-detail.css": "REDACTED"');
        assert.ok(line.includes(JSON.stringify(cssPath) + ": " + JSON.stringify(value)));
      } else {
        typeCount++; assert.equal(record.publicKind, "PUBLIC_CANONICAL_SOLIDITY_TYPE"); assert.equal(expected.File, producerPath);
        assert.equal(expected.StartLine, 21); assert.equal(record.contractPath, contractPath); value = publicType;
        assert.equal(expected.Match, 'RMTLaunchCurveTokenV2","REDACTED"');
      }
      assert.equal(sha(value), record.identitySha256);
      const publicMatch = expected.Match.replace("REDACTED", value), length = expected.EndColumn - expected.StartColumn + 1;
      assert.equal(publicMatch.length, length); assert.equal(line.slice(expected.StartColumn - 2, expected.StartColumn - 2 + length), publicMatch);
      assert.ok(!proof.has(expected.Fingerprint)); proof.set(expected.Fingerprint, record);
    }
    assert.equal(cssCount, 21); assert.equal(typeCount, 1); assert.equal(proof.size, 22);
    const additions = [], priorRows = []; for (const row of findings) (proof.has(row?.Fingerprint) ? additions : priorRows).push(row);
    const legacy = verifyTask091SnapshotHistoryPublicData(priorRows, {...legacyOptions, readGit: read});
    const classified = [...legacy.classified], unclassified = [...legacy.unclassified], seen = new Set();
    for (const row of additions) {
      const record = proof.get(row.Fingerprint), valid = !seen.has(row.Fingerprint) && securityFields.every(key => row[key] === record.finding[key]);
      if (valid) {seen.add(row.Fingerprint); classified.push({fingerprint: row.Fingerprint, kind: record.publicKind, commit,
        gitBlobSha1: record.gitBlobSha1, lineSha256: record.lineSha256, publicValueSha256: record.identitySha256,
        ...(record.publicKind === "PUBLIC_SOURCE_FILE_SHA256" ? {sourcePath: cssPath, sourceGitBlobSha1: blob(css), sourceBlobSha256: cssDigest}
          : {compilerInputSha256: inputSha256, sourceBlobSha256: policy.compilerProof.sourceSha256})});}
      else unclassified.push(descriptor(row));
    }
    const missing = [...legacy.missing, ...[...proof.keys()].filter(key => !seen.has(key))];
    return {...legacy, rawFindingCount: findings.length, classified, unclassified, missing,
      status: unclassified.length || missing.length ? "BLOCKED_UNCLASSIFIED_OR_MISSING_FINDING" : "PASSED_EXACT_PUBLIC_DATA_ONLY",
      rawScanPassed: findings.length === 0, detectorsChanged: false, ignoreAdded: false, financialSecurityClearance: false, productionAuthorization: false,
      task092Proof: "22-exact-initial-commit-public-source-and-compiler-bound-identities"};
  } catch {throw Error("Exact Task092 immutable public identity proof is unavailable or changed");}
}
