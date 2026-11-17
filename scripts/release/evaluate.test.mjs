import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { approvedCreatorConfigurationSha256, assertCurrentReleaseSources, evaluateRelease,
  releaseCandidate, releaseDigest, releasePolicy } from "./evaluate.mjs";
import { approvedOperationsFeeCap, operationsSafeBaseline } from "../../packages/contracts/scripts/prepare-operations-safe.mjs";
import { summarizeGas } from "../production-readiness/safe.mjs";

const findings = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-security/task063-findings.json", import.meta.url)));
const reviewInputs = JSON.parse(readFileSync(new URL("../../docs/evidence/production-readiness/review-inputs.json", import.meta.url)));
const archived = JSON.parse(readFileSync(new URL("../../docs/evidence/mobile-signing/sender-delegation-4663.json", import.meta.url)));
const now = Date.parse(archived.observedAt);
const decisionSource = "https://github.com/LandoCrissian/robinhood-meme-terminal/issues/657#issuecomment-6951267519";
const time = { observedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 60000).toISOString() };
const genericTransaction = {
  type: 2, chainId: 4663, from: operationsSafeBaseline.sender, to: null, nonce: "478", valueWei: "0",
  calldataHash: "0x" + "12".repeat(32), gasLimit: "1000000", maxFeePerGasWei: "40000000",
  maxPriorityFeePerGasWei: "0", maxNetworkFeeWei: "40000000000000",
};
const limits = { maximumValueWei: "0", maximumGasLimit: "1000000", maximumFeePerGasWei: "40000000",
  maximumPriorityFeePerGasWei: "0", maximumNetworkFeeWei: "40000000000000" };

// These are synthetic records used only to exercise policy transitions. The evaluator
// produces decision support and cannot authorize a live wallet or change production.
function evidenceFor(stageId, selectedFindings = findings) {
  const candidate = releaseCandidate(selectedFindings);
  const stage = releasePolicy.stages.find(({ id }) => id === stageId);
  const transaction = stage.transactionRequired ? structuredClone(genericTransaction) : null;
  const checks = Object.fromEntries(stage.requirements.map((key) => [key, {
    status: "LIVE_VERIFIED", stage: stageId, chainId: 4663, candidateDigest: candidate.digest,
    transactionSha256: releaseDigest(transaction),
    evidenceSha256: releaseDigest(key), source: "synthetic regression record", ...time,
  }]));
  if (checks["synthetic-guarded-pool-compatibility"]) Object.assign(checks["synthetic-guarded-pool-compatibility"], {
    status: "PINNED_FORK_VERIFIED", source: "docs/evidence/" + reviewInputs.artifacts.fork.path,
    evidenceSha256: reviewInputs.artifacts.fork.sha256,
  });
  return { candidateDigest: candidate.digest, stages: { [stageId]: {
    checks, transaction, limits: { ...limits },
  } } };
}

function bindDecisions(evidence, stageId, selectedFindings = findings) {
  const report = evaluateRelease(evidence, { now, findings: selectedFindings });
  const stage = report.stages.find(({ id }) => id === stageId);
  const input = evidence.stages[stageId];
  const common = { stage: stageId, owner: "LandoCrissian", source: decisionSource, chainId: 4663,
    candidateDigest: report.candidate.digest, evidenceDigest: stage.evidenceDigest,
    riskContextDigest: stage.riskContextDigest, ...time };
  input.policyApproval = { ...common, kind: "STAGE_POLICY" };
  input.riskAcceptance = { ...common, kind: "RISK_ACCEPTANCE", findingsSha256: report.candidate.findingsSha256,
    acceptedFindingIds: selectedFindings.findings.map(({ id }) => id) };
  return { report: evaluateRelease(evidence, { now, findings: selectedFindings }), input, common };
}

function selected(report, id) {
  return report.stages.find((stage) => stage.id === id);
}

function assertNoExecution(report) {
  assert.equal(report.status, "BLOCKED_NO_BROADCAST");
  assert.equal(report.signingAuthorized, false);
  assert.equal(report.broadcastAuthorized, false);
  assert.equal(report.publicTradingEnabled, false);
  assert.equal(report.tokenCreationEnabled, false);
  assert.deepEqual(report.deploymentTokenCreationTransactions, []);
  assert.equal(report.strictAnalysis.status, "FAIL_HIGH");
}

test("absence of an external audit does not defeat an otherwise evidenced and explicitly accepted stage", () => {
  const evidence = evidenceFor("protocol-deployment");
  const { report } = bindDecisions(evidence, "protocol-deployment");
  assert.equal(report.independentAudit, "NOT_PERFORMED");
  assert.equal(report.independentAuditMandatory, false);
  assert.equal(selected(report, "protocol-deployment").readiness, "ELIGIBLE_FOR_SEPARATE_OWNER_DECISION");
  assert.equal(selected(report, "protocol-deployment").separateDecision, "REQUIRED");
  assertNoExecution(report);
});

test("unaccepted findings, expired risk records, different candidates and different evidence retain a hold", () => {
  const evidence = evidenceFor("protocol-deployment");
  assert.ok(selected(evaluateRelease(evidence, { now }), "protocol-deployment").holds.includes("EXACT_OWNER_RISK_ACCEPTANCE_REQUIRED"));
  for (const alter of [
    (input) => { input.riskAcceptance.expiresAt = new Date(now).toISOString(); },
    (input) => { input.riskAcceptance.candidateDigest = "0".repeat(64); },
    (input) => { input.riskAcceptance.acceptedFindingIds.pop(); },
    (input) => { input.riskAcceptance.findingsSha256 = "0".repeat(64); },
    (input) => { input.limits.maximumNetworkFeeWei = "40000000000001"; },
    (input) => { input.riskAcceptance.owner = "someone-else"; },
  ]) {
    const fixture = evidenceFor("protocol-deployment");
    const { input } = bindDecisions(fixture, "protocol-deployment");
    alter(input);
    const stage = selected(evaluateRelease(fixture, { now }), "protocol-deployment");
    assert.equal(stage.readiness, "HOLD");
    assert.ok(stage.holds.includes("EXACT_OWNER_RISK_ACCEPTANCE_REQUIRED"));
  }
});

test("confirmed defects and unresolved material paths remain held even with matching owner acceptance", () => {
  for (const disposition of ["CONFIRMED_DEFECT", "UNRESOLVED_MATERIAL"]) {
    const changed = structuredClone(findings);
    changed.findings[0].disposition = disposition;
    const evidence = evidenceFor("protocol-deployment", changed);
    const { report } = bindDecisions(evidence, "protocol-deployment", changed);
    assert.ok(selected(report, "protocol-deployment").holds.includes(disposition + ":" + changed.findings[0].id));
    assertNoExecution(report);
  }
});

test("failed operational evidence, synthetic provenance, stale observations and over-limit fees hold the stage", () => {
  for (const alter of [
    (input) => { input.checks["unsigned-protocol-plan"].status = "UNAVAILABLE"; },
    (input) => { input.checks["unsigned-protocol-plan"].status = "SYNTHETIC"; },
    (input) => { input.checks["unsigned-protocol-plan"].expiresAt = new Date(now).toISOString(); },
    (input) => { input.transaction.valueWei = "1"; },
    (input) => { input.transaction.maxPriorityFeePerGasWei = "1"; },
    (input) => { input.transaction.authorizationList = []; },
  ]) {
    const evidence = evidenceFor("protocol-deployment");
    alter(evidence.stages["protocol-deployment"]);
    const { report } = bindDecisions(evidence, "protocol-deployment");
    assert.equal(selected(report, "protocol-deployment").readiness, "HOLD");
  }
});

test("the Safe stage requires actual exact-evidence validation and preserves the approved fee ceiling", () => {
  const evidence = evidenceFor("operations-safe-1");
  const input = evidence.stages["operations-safe-1"];
  input.transaction = { ...genericTransaction, to: operationsSafeBaseline.destination, nonce: operationsSafeBaseline.nonce,
    calldataHash: operationsSafeBaseline.inputHash, ...approvedOperationsFeeCap };
  // An arbitrary caller-provided technical PASS or a generic verified check grants nothing.
  input.technicalStatus = "PASS";
  assert.ok(selected(evaluateRelease(evidence, { now }), "operations-safe-1").holds.includes("UNVERIFIED:operations-safe-exact-preflight"));
  const proof = structuredClone(archived);
  proof.sender.createDestinations = [];
  for (const provider of proof.sender.providers) provider.pendingSafeVacancy = { code: "0x", nonce: "0" };
  proof.safes.proposals.splice(1);
  const gas = summarizeGas({ total: 313391n, l1: 25494n, baseFee: 20010000n, l1BaseFee: 17582038n, estimateGas: 313391n });
  proof.safes.proposals[0].gas = gas;
  proof.safes.estimatedTotalWei = gas.estimatedTotalWei;
  proof.safes.estimatedTotalEth = gas.estimatedTotalEth;
  proof.safes.budgetAtObservation = true;
  input.safeObservation = proof;
  const report = evaluateRelease(evidence, { now });
  assert.equal(selected(report, "operations-safe-1").readiness, "ELIGIBLE_FOR_SEPARATE_OWNER_DECISION");
  assert.equal(selected(report, "operations-safe-1").separateDecision, "REQUIRED");
  assertNoExecution(report);
  input.transaction.gasLimit = "391740";
  input.transaction.maxNetworkFeeWei = (391740n * 40020000n).toString();
  assert.ok(selected(evaluateRelease(evidence, { now }), "operations-safe-1").holds.includes("APPROVED_SPENDING_LIMIT_EXCEEDED"));
});

test("stage and transaction approvals cannot be replayed across stages, nonces or expired evidence", () => {
  const evidence = evidenceFor("protocol-deployment");
  const { input, common } = bindDecisions(evidence, "protocol-deployment");
  input.transactionApproval = { ...common, kind: "TRANSACTION_REVIEW", transactionSha256: releaseDigest(input.transaction) };
  assert.equal(selected(evaluateRelease(evidence, { now }), "protocol-deployment").separateDecision,
    "RECORDED_REQUIRES_EXECUTION_TIME_RECHECK");
  input.transaction.nonce = "479";
  assert.equal(selected(evaluateRelease(evidence, { now }), "protocol-deployment").separateDecision, "REQUIRED");
  assert.equal(selected(evaluateRelease(evidence, { now }), "public-trading").readiness, "HOLD");
  assertNoExecution(evaluateRelease(evidence, { now }));
});

test("a renewed quote preserves stable owner risk acceptance while transaction approval requires a fresh decision", () => {
  const evidence = evidenceFor("protocol-deployment");
  const { input, common } = bindDecisions(evidence, "protocol-deployment");
  delete input.policyApproval.expiresAt;
  delete input.riskAcceptance.expiresAt;
  input.transactionApproval = { ...common, kind: "TRANSACTION_REVIEW", transactionSha256: releaseDigest(input.transaction) };
  const later = now + 180_000;
  for (const check of Object.values(input.checks)) {
    check.observedAt = new Date(later - 1000).toISOString();
    check.expiresAt = new Date(later + 60_000).toISOString();
  }
  const report = evaluateRelease(evidence, { now: later });
  assert.equal(selected(report, "protocol-deployment").readiness, "ELIGIBLE_FOR_SEPARATE_OWNER_DECISION");
  assert.equal(selected(report, "protocol-deployment").separateDecision, "REQUIRED");
  assertNoExecution(report);
});

test("RMT creation requires verified infrastructure and the normal website form with its own approval", () => {
  const evidence = evidenceFor("website-rmt-creation");
  const input = evidence.stages["website-rmt-creation"];
  input.transaction.to = "0x1111111111111111111111111111111111111111";
  input.transaction.valueWei = "400000000000000";
  for (const check of Object.values(input.checks)) check.transactionSha256 = releaseDigest(input.transaction);
  Object.assign(input.checks["actual-creator-form"], { factory: input.transaction.to,
    origin: "https://www.rmtlaunch.fun", configurationSha256: approvedCreatorConfigurationSha256 });
  const { report } = bindDecisions(evidence, "website-rmt-creation");
  assert.equal(selected(report, "website-rmt-creation").readiness, "ELIGIBLE_FOR_SEPARATE_OWNER_DECISION");
  delete input.checks["verified-live-infrastructure"];
  assert.ok(selected(evaluateRelease(evidence, { now }), "website-rmt-creation").holds.includes("UNVERIFIED:verified-live-infrastructure"));
  assert.deepEqual(report.sequence, ["SECURITY_CLOSEOUT", "SEPARATELY_APPROVED_INFRASTRUCTURE_DEPLOYMENT_AND_VERIFICATION",
    "OWNER_CREATES_RMT_IN_NORMAL_WEBSITE_FORM"]);
  assertNoExecution(report);
  input.transaction.to = null;
  assert.ok(selected(evaluateRelease(evidence, { now }), "website-rmt-creation").holds
    .includes("NORMAL_CREATOR_FORM_AND_APPROVED_RMT_FIELDS_REQUIRED"));
});

test("infrastructure can be verified before a project exists and graduated public trading has its own pool evidence", () => {
  const infra = evidenceFor("infrastructure-verification");
  const { report } = bindDecisions(infra, "infrastructure-verification");
  assert.equal(selected(report, "infrastructure-verification").readiness, "ELIGIBLE_FOR_SEPARATE_OWNER_DECISION");
  assert.ok(!releasePolicy.stages.find(({ id }) => id === "infrastructure-verification").requirements.includes("full-poolkey-routing"));
  const evidence = evidenceFor("public-trading");
  evidence.stages["public-trading"].tradingPhase = "CURVE";
  assert.equal(selected(bindDecisions(evidence, "public-trading").report, "public-trading").readiness,
    "ELIGIBLE_FOR_SEPARATE_OWNER_DECISION");
  evidence.stages["public-trading"].tradingPhase = "GRADUATED_V4";
  const v4 = bindDecisions(evidence, "public-trading").report;
  assert.ok(selected(v4, "public-trading").holds.includes("UNVERIFIED:full-poolkey-observed-routing"));
  assertNoExecution(v4);
});

test("a stable configuration activation decision survives fresh observations and expires on phase or configuration drift", () => {
  const evidence = evidenceFor("public-trading");
  evidence.stages["public-trading"].tradingPhase = "CURVE";
  const { input, common } = bindDecisions(evidence, "public-trading");
  input.activationApproval = { ...common, kind: "STAGE_ACTIVATION" };
  for (const approval of [input.policyApproval, input.riskAcceptance, input.activationApproval]) delete approval.expiresAt;
  const later = now + 180_000;
  for (const check of Object.values(input.checks)) {
    check.observedAt = new Date(later - 1000).toISOString();
    check.expiresAt = new Date(later + 60_000).toISOString();
  }
  const refreshed = evaluateRelease(evidence, { now: later });
  assert.equal(selected(refreshed, "public-trading").readiness, "ELIGIBLE_FOR_SEPARATE_OWNER_DECISION");
  assert.equal(selected(refreshed, "public-trading").separateDecision, "RECORDED_REQUIRES_EXECUTION_TIME_RECHECK");
  input.tradingPhase = "GRADUATED_V4";
  assert.equal(selected(evaluateRelease(evidence, { now: later }), "public-trading").separateDecision, "REQUIRED");
  input.tradingPhase = "CURVE";
  input.checks["public-release-config"].evidenceSha256 = releaseDigest("different public configuration");
  assert.equal(selected(evaluateRelease(evidence, { now: later }), "public-trading").separateDecision, "REQUIRED");
  assertNoExecution(refreshed);
});

test("every original compiler source and its inventory must match, including files outside finding-specific evidence", () => {
  assertCurrentReleaseSources();
  const { originalSourceSha256 } = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url)));
  const changed = structuredClone(originalSourceSha256);
  changed.find(([path]) => path === "src/RMTLaunchCurveMathV1.sol")[1] = "0".repeat(64);
  assert.throws(() => assertCurrentReleaseSources(changed), /source inventory or content/);
  assert.throws(() => assertCurrentReleaseSources([...originalSourceSha256, ["src/Unexpected.sol", "0".repeat(64)]]),
    /source inventory or content/);
  assert.throws(() => assertCurrentReleaseSources(originalSourceSha256.slice(1)), /source inventory or content/);
});

test("missing, duplicated or altered finding evidence and unknown stages are rejected", () => {
  const missing = structuredClone(findings);
  missing.findings.pop();
  assert.throws(() => releaseCandidate(missing), /Every exact/);
  const changed = structuredClone(findings);
  changed.evidenceSha256Lf[0].sha256Lf = "0".repeat(64);
  assert.throws(() => releaseCandidate(changed), /evidence changed/);
  assert.throws(() => evaluateRelease({ stages: { bypass: {} } }, { now }), /Unknown release stage/);
  assert.throws(() => evaluateRelease([], { now }), /evidence object/);
});
