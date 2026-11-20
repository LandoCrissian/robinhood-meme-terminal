import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync, realpathSync} from "node:fs";
import {isAbsolute, relative, resolve, sep} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {gunzipSync} from "node:zlib";
import {assertCurrentReleaseSources} from "./evaluate.mjs";
import {verifyCompilerIdentity} from "../../packages/contracts/scripts/pinned-solc.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const acceptancePath = "docs/evidence/rmt-task091/security/stage-acceptance.json";
const originalPath = "docs/evidence/fixed-supply-security/task063-findings.json";
const stages = ["currentFactoryPublication", "ownerCreation", "curveTradingGraduationHarvest", "admittedV2Migration"];
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const read = path => readFileSync(resolve(root, path));
const json = path => JSON.parse(read(path));
const admissionNames = [
  "testCanonicalInitializationCannotBeFrontRunAndUnrelatedPoolCannotRedirectGraduation()",
  "testValidEoaPermitDoesNotAuthorizeContractEngineOrSignatureTransfer()",
  "testUnadmittedCallerCannotFundOrAttachAnotherTokenToEngine()",
  "testOriginalNftSignatureAndSubscriptionPathsCannotAcquireEngineAuthority()",
].sort();

export function verifyTask091Admission(proof = json("docs/evidence/rmt-task091/security/proof-results.json")) {
  assert.equal(proof.result, "PASS");
  assert.equal(proof.liveRpc, false); assert.equal(proof.productionWrites, false);
  assert.equal(proof.syntheticAccountsAndStorage, true);
  assert.equal(proof.sourceBase, "27f19787ed0a2d904ba4508d2adfab1773e82e67");
  verifyCompilerIdentity({executableSha256: proof.compiler.executableSha256, host: proof.compiler.executablePlatform, emulated: false});
  assert.equal(proof.testSource.path, "packages/contracts/test/Task091AdmissionAcceptance.t.sol");
  assert.equal(digest(read(proof.testSource.path)), proof.testSource.sha256, "Admission test source drift");
  assert.deepEqual(proof.profiles.map(row => row.profile).sort(), ["canonical4663", "default31337"]);
  for (const row of proof.profiles) {
    assert.equal(row.chainId, row.profile === "canonical4663" ? 4663 : 31337);
    assert.equal(row.passed, 4); assert.equal(row.failed, 0); assert.equal(row.skipped, 0);
    assert.deepEqual([...row.names].sort(), admissionNames);
    assert.equal(row.raw.file, row.profile + ".json.gz");
    const packed = read("docs/evidence/rmt-task091/security/" + row.raw.file);
    assert.equal(packed.length, row.raw.compressedBytes); assert.equal(digest(packed), row.raw.compressedSha256);
    const bytes = gunzipSync(packed, {maxOutputLength: 32 * 1024 * 1024});
    assert.equal(bytes.length, row.raw.expandedBytes); assert.equal(digest(bytes), row.raw.expandedSha256);
    const reports = Object.entries(JSON.parse(bytes));
    assert.equal(reports.length, 1); assert.ok(reports[0][0].endsWith(":Task091AdmissionAcceptanceTest"));
    const tests = reports[0][1].test_results;
    assert.deepEqual(Object.keys(tests).sort(), admissionNames, "Actual proof names differ from the summary");
    for (const result of Object.values(tests)) assert.equal(result.status, "Success", "Actual admission proof failed or skipped");
  }
  return {profiles: 2, distinctCases: 4, passed: 8, failed: 0, skipped: 0};
}

// This verifier reconciles the new bounded technical recommendation with every
// original finding. It cannot grant owner acceptance or operate a wallet/host.
export function verifyTask091Acceptance(acceptance = json(acceptancePath), {readEvidence = read, verifySources = assertCurrentReleaseSources} = {}) {
  verifySources();
  const original = json(originalPath);
  const rawBytes = read(original.rawAnalysis.path);
  assert.equal(digest(rawBytes), original.rawAnalysis.sha256, "Original raw scanner evidence drift");
  const raw = JSON.parse(gunzipSync(rawBytes, {maxOutputLength: 32 * 1024 * 1024}));
  assert.equal(raw.inputSha256, original.inputSha256);
  assert.equal(raw.detectors.length, 233);
  assert.equal(raw.detectors.filter(row => row.impact === "High").length, 22);
  assert.equal(original.rawAnalysis.detectorCount, 101);
  assert.equal(original.rawAnalysis.governanceMediumCount, 7);
  assert.equal(acceptance.schemaVersion, 1);
  assert.equal(acceptance.sourceBase, "27f19787ed0a2d904ba4508d2adfab1773e82e67");
  assert.equal(acceptance.compilerInputSha256, original.inputSha256, "Candidate compiler input drift");
  assert.equal(acceptance.rawAnalysis.sha256, original.rawAnalysis.sha256);
  for (const [key, value] of Object.entries({detectors: 101, results: 233, high: 22, governanceMedium: 7, strictExit: 1})) {
    assert.equal(acceptance.rawAnalysis[key], value, "Original scanner state changed: " + key);
  }
  assert.ok(Array.isArray(acceptance.findings));
  assert.deepEqual(acceptance.findings.map(row => row.id).sort(), original.findings.map(row => row.id).sort(),
    "Every original High and governance Medium ID is required exactly once");
  const evidence = new Map();
  const stageHolds = Object.fromEntries(stages.map(stage => [stage, []]));
  for (const row of acceptance.findings) {
    const prior = original.findings.find(finding => finding.id === row.id);
    const rawFinding = raw.detectors.find(finding => finding.id === row.id);
    assert.equal(row.impact, prior.impact, "Original severity changed");
    assert.equal(row.check, prior.detector, "Original detector changed");
    assert.equal(row.impact, rawFinding.impact);
    assert.equal(row.check, rawFinding.check);
    assert.ok(["ACCEPT_WITH_BOUNDED_RISK", "BLOCK"].includes(row.technicalRecommendation), "Unknown finding recommendation");
    assert.ok(typeof row.materialLossPath === "boolean", "A material loss-path determination is required");
    assert.ok(typeof row.residualRisk === "string" && row.residualRisk.trim().length > 40, "Bounded residual risk required");
    assert.deepEqual(Object.keys(row.stages).sort(), [...stages].sort(), "Exact stage coverage required");
    assert.ok(Array.isArray(row.evidence) && row.evidence.length > 0, "Reproducible evidence required");
    for (const ref of row.evidence) {
      assert.ok(typeof ref.path === "string" && /^(docs\/evidence\/|packages\/contracts\/|scripts\/)/.test(ref.path)
        && !ref.path.includes("\\") && !ref.path.split("/").some(part => part === ".." || part === "." || part === "")
        && !isAbsolute(ref.path), "Evidence path escapes allowed repository scope");
      const actualPath = realpathSync(resolve(root, ref.path));
      const outside = relative(realpathSync(root), actualPath);
      assert.ok(outside && !outside.startsWith(".." + sep) && !isAbsolute(outside), "Evidence symlink escapes repository");
      assert.match(ref.sha256, /^[0-9a-f]{64}$/);
      assert.equal(digest(readEvidence(ref.path)), ref.sha256, "Evidence bytes changed: " + ref.path);
      evidence.set(ref.path, ref.sha256);
    }
    for (const stage of stages) {
      const disposition = row.stages[stage];
      assert.ok(["ACCEPT_WITH_BOUNDED_RISK", "BLOCK"].includes(disposition.technicalRecommendation), "Unknown technical recommendation");
      assert.equal(typeof disposition.appliesDirectly, "boolean");
      assert.ok(typeof disposition.rationale === "string" && disposition.rationale.trim().length > 20, "Stage-specific rationale required");
      // A plausible material loss path cannot be waived by a technical label.
      const admitsReachableGraph = stage === "currentFactoryPublication" || stage === "ownerCreation";
      if (disposition.technicalRecommendation === "BLOCK"
        || (row.materialLossPath && (disposition.appliesDirectly || admitsReachableGraph))
        || (row.technicalRecommendation === "BLOCK" && disposition.appliesDirectly)) stageHolds[stage].push(row.id);
    }
  }
  const admissionProofs = verifyTask091Admission();
  return {schemaVersion: 1, status: "VERIFIED_BOUNDED_TECHNICAL_RECOMMENDATION", compilerInputSha256: original.inputSha256,
    acceptanceObjectSha256: digest(Buffer.from(JSON.stringify(acceptance))), findings: {high: 22, governanceMedium: 7},
    rawAnalysis: {detectors: 101, results: 233, strictStatus: "FAIL_HIGH", strictExit: 1},
    stages: Object.fromEntries(stages.map(stage => [stage, {technicalRecommendation: stageHolds[stage].length ? "BLOCK" : "ACCEPT_WITH_BOUNDED_RISK", unresolvedMaterialIds: stageHolds[stage]}])),
    evidenceFiles: evidence.size, admissionProofs, ownerRiskAcceptance: "REQUIRED_SEPARATELY", operationalAcceptance: "REQUIRED_SEPARATELY",
    signingAuthorized: false, broadcastAuthorized: false, factoryPublicationAuthorized: false,
    websiteActivationAuthorized: false, tokenCreationAuthorized: false};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(verifyTask091Acceptance(), null, 2));
}
