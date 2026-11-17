import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { evaluateOperationsSafeRelease } from "../../packages/contracts/scripts/evaluate-operations-safe-release.mjs";
import { approvedFirstProject, approvedRmtTerms } from "../../packages/contracts/scripts/prepare-unsigned-4663.mjs";

const policyUrl = new URL("../../docs/evidence/production-readiness/task063-release-policy.json", import.meta.url);
const findingsUrl = new URL("../../docs/evidence/fixed-supply-security/task063-findings.json", import.meta.url);
const reviewUrl = new URL("../../docs/evidence/production-readiness/review-inputs.json", import.meta.url);
const manifestUrl = new URL("../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url);
const readJson = (url) => JSON.parse(readFileSync(url));
const policy = readJson(policyUrl);
const reviewed = readJson(reviewUrl);
const manifest = readJson(manifestUrl);
const exactReportBytes = readFileSync(new URL("../../docs/evidence/fixed-supply-security/slither-4663.json.gz", import.meta.url));
const exactReport = JSON.parse(gunzipSync(exactReportBytes));
const hashPattern = /^[0-9a-f]{64}$/;
const addressPattern = /^0x[0-9a-fA-F]{40}$/;
const quantityPattern = /^(0|[1-9][0-9]{0,77})$/;
const sourcePattern = /^https:\/\/github\.com\/LandoCrissian\/robinhood-meme-terminal\/issues\/[1-9][0-9]*#issuecomment-[1-9][0-9]*$/;
const currentFindingIds = reviewed.analysis.groups.flatMap(({ ids }) => ids).sort();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export const releaseDigest = (value) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const releasePolicy = policy;
export const approvedCreatorConfigurationSha256 = releaseDigest({ project: approvedFirstProject, terms: approvedRmtTerms });

// Match the compiler-profile builder's source inventory. Registry V1/V2 are
// retained historical files and are absent from this reviewed release closure.
export function assertCurrentReleaseSources(current) {
  if (current === undefined) {
    const root = new URL("../../packages/contracts/", import.meta.url);
    const paths = readdirSync(new URL("src/", root), { recursive: true })
      .filter((path) => path.endsWith(".sol") && !/^RMTLaunchProjectRegistryV[12]\.sol$/.test(path))
      .map((path) => "src/" + path.replaceAll("\\", "/")).sort();
    current = paths.map((path) => [path, createHash("sha256")
      .update(readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n")).digest("hex")]);
  }
  assert.deepEqual(current, manifest.originalSourceSha256, "Current release source inventory or content differs from the reviewed compiler profile");
}

function reviewedFindings(findings) {
  assert.equal(manifest.profile, reviewed.profile.name);
  assert.equal(manifest.chainId, reviewed.profile.chainId);
  const profileContent = readFileSync(manifestUrl, "utf8").replace(/\r\n/g, "\n");
  assert.equal(createHash("sha256").update(profileContent).digest("hex"), reviewed.artifacts.compilerProfile.sha256Lf,
    "The exact reviewed compiler profile changed");
  assert.equal(findings.inputSha256, manifest.inputSha256, "Finding evidence uses another compiler input");
  assert.equal(exactReport.inputSha256, manifest.inputSha256, "Static analysis uses another compiler input");
  assert.equal(createHash("sha256").update(exactReportBytes).digest("hex"), findings.rawAnalysis.sha256,
    "Raw security evidence changed");
  assert.equal(exactReport.detectors.length, findings.rawAnalysis.resultCount);
  assert.equal(exactReport.detectors.filter(({ impact }) => impact === "High").length, findings.rawAnalysis.highCount);
  const forkBytes = readFileSync(new URL("../../docs/evidence/" + reviewed.artifacts.fork.path, import.meta.url));
  assert.equal(createHash("sha256").update(forkBytes).digest("hex"), reviewed.artifacts.fork.sha256,
    "Pinned synthetic compatibility evidence changed");
  assert.deepEqual(findings.findings.map(({ id }) => id).sort(), currentFindingIds,
    "Every exact High and governance Medium finding requires one disposition");
  for (const finding of findings.findings) {
    const raw = exactReport.detectors.find(({ id }) => id === finding.id);
    assert.ok(raw && raw.impact === finding.impact && raw.check === finding.detector, "Finding identity or severity changed");
  }
  for (const { path, sha256Lf: expected } of findings.evidenceSha256Lf) {
    assert.ok(/^(docs\/evidence\/|packages\/contracts\/)/.test(path) && !path.includes(".."), "Unrecognized evidence path");
    const content = readFileSync(new URL("../../" + path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
    assert.equal(createHash("sha256").update(content).digest("hex"), expected, "Finding evidence changed: " + path);
  }
  assert.ok(findings.findings.every(({ disposition, evidence, residualRisk }) =>
    ["PINNED_FALSE_POSITIVE", "CONFIRMED_DEFECT", "UNRESOLVED_MATERIAL"].includes(disposition) &&
    Array.isArray(evidence) && evidence.length && typeof residualRisk === "string" && residualRisk.length),
  "Missing finding disposition, evidence or residual risk");
  return findings;
}

export function releaseCandidate(findings = readJson(findingsUrl)) {
  assertCurrentReleaseSources();
  reviewedFindings(findings);
  const candidate = {
    profile: manifest.profile,
    chainId: manifest.chainId,
    inputSha256: manifest.inputSha256,
    runtimeManifestSha256: releaseDigest(manifest),
    findingsSha256: releaseDigest(findings),
    policySha256: releaseDigest(policy),
    approvedCreatorConfigurationSha256,
  };
  return { ...candidate, digest: releaseDigest(candidate) };
}

function freshRecord(record, now, maximumSeconds) {
  if (!record || typeof record !== "object") return false;
  const issued = Date.parse(record.observedAt);
  const expires = Date.parse(record.expiresAt);
  return Number.isFinite(issued) && Number.isFinite(expires) && issued <= now && now < expires &&
    expires > issued && expires - issued <= maximumSeconds * 1000;
}

function freshCheck(record, candidate, stage, transaction, now, requirement) {
  const common = record?.stage === stage && record.chainId === 4663 &&
    record.candidateDigest === candidate.digest && hashPattern.test(record.evidenceSha256) &&
    record.transactionSha256 === releaseDigest(transaction ?? null) &&
    typeof record.source === "string" && record.source.length > 0;
  if (requirement === "synthetic-guarded-pool-compatibility") {
    return common && record.status === "PINNED_FORK_VERIFIED" &&
      record.evidenceSha256 === reviewed.artifacts.fork.sha256 && record.source === "docs/evidence/" + reviewed.artifacts.fork.path;
  }
  return common && record.status === "LIVE_VERIFIED" && freshRecord(record, now, policy.maximumObservationSeconds);
}

function ownerDecision(record, candidate, stage, bindingDigest, kind, now) {
  const transient = kind === "TRANSACTION_REVIEW";
  const issued = Date.parse(record?.observedAt);
  const expiry = record?.expiresAt;
  const validTime = Number.isFinite(issued) && issued <= now &&
    (expiry === undefined || (Number.isFinite(Date.parse(expiry)) && now < Date.parse(expiry)));
  return record?.kind === kind && record.stage === stage && record.owner === "LandoCrissian" &&
    sourcePattern.test(record.source) && record.chainId === 4663 && record.candidateDigest === candidate.digest &&
    record[transient ? "evidenceDigest" : "riskContextDigest"] === bindingDigest && validTime &&
    (!transient || freshRecord(record, now, policy.maximumObservationSeconds));
}

function transactionIssue(transaction, limits, stage) {
  if (!transaction || transaction.chainId !== 4663 || transaction.type !== 2 ||
      !addressPattern.test(transaction.from) || !(transaction.to === null || addressPattern.test(transaction.to)) ||
      !/^0x[0-9a-f]{64}$/i.test(transaction.calldataHash) ||
      !["nonce", "valueWei", "gasLimit", "maxFeePerGasWei", "maxPriorityFeePerGasWei", "maxNetworkFeeWei"]
        .every((key) => quantityPattern.test(transaction[key]))) return "INVALID_OR_MISSING_TRANSACTION";
  if (transaction.authorizationList !== undefined) return "DELEGATION_CHANGE_FORBIDDEN";
  if (BigInt(transaction.gasLimit) * BigInt(transaction.maxFeePerGasWei) !== BigInt(transaction.maxNetworkFeeWei) ||
      BigInt(transaction.maxPriorityFeePerGasWei) > BigInt(transaction.maxFeePerGasWei)) return "INCONSISTENT_FEE_FIELDS";
  if (stage.id === "operations-safe-1") {
    if (transaction.from.toLowerCase() !== "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA".toLowerCase() ||
        transaction.to?.toLowerCase() !== "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67" ||
        transaction.calldataHash !== "0x64c42b60490759e71c4777faab3ac157f5c565b6b379629bdaaec7e5352c2250") return "OPERATIONS_IDENTITY_CHANGED";
  }
  const ceilings = {
    valueWei: stage.maximumValueWei ?? limits?.maximumValueWei,
    gasLimit: stage.maximumGasLimit ?? limits?.maximumGasLimit,
    maxFeePerGasWei: stage.maximumFeePerGasWei ?? limits?.maximumFeePerGasWei,
    maxPriorityFeePerGasWei: stage.maximumPriorityFeePerGasWei ?? limits?.maximumPriorityFeePerGasWei,
    maxNetworkFeeWei: stage.maximumNetworkFeeWei ?? limits?.maximumNetworkFeeWei,
  };
  if (!Object.values(ceilings).every((value) => quantityPattern.test(value))) return "EXPLICIT_SPENDING_LIMITS_REQUIRED";
  if (Object.entries(ceilings).some(([key, value]) => BigInt(transaction[key]) > BigInt(value))) return "APPROVED_SPENDING_LIMIT_EXCEEDED";
  return null;
}

// This offline report consumes operator-validated evidence records. It has no signer,
// transport or production configuration mutation, and never confers execution authority.
export function evaluateRelease(evidence = {}, { now = Date.now(), findings = readJson(findingsUrl) } = {}) {
  assert.ok(Number.isFinite(now), "A finite review time is required");
  assert.ok(evidence && typeof evidence === "object" && !Array.isArray(evidence), "An evidence object is required");
  assert.ok(!evidence.stages || Object.keys(evidence.stages).every((id) => policy.stages.some((stage) => stage.id === id)),
    "Unknown release stage");
  const candidate = releaseCandidate(findings);
  const stages = policy.stages.map((stage) => {
    const input = evidence.stages?.[stage.id] ?? {};
    const holds = [];
    if (evidence.candidateDigest !== candidate.digest) holds.push("CANDIDATE_UNBOUND");
    const applicable = stage.appliesEngineFindings ? findings.findings : [];
    for (const finding of applicable) {
      if (finding.disposition === "CONFIRMED_DEFECT" || finding.disposition === "UNRESOLVED_MATERIAL") {
        holds.push(`${finding.disposition}:${finding.id}`);
      }
    }
    let safeEvidence;
    if (stage.id === "operations-safe-1") {
      try {
        const safe = evaluateOperationsSafeRelease(input.safeObservation, now);
        if (safe.technicalStatus === "PASS" && safe.policy.state === "OWNER_APPROVED") safeEvidence = safe.evidence;
      } catch { /* Missing or stale exact Safe observations remain unverified. */ }
      if (!safeEvidence || input.transaction?.nonce !== safeEvidence.sender.pendingNonce) {
        holds.push("UNVERIFIED:operations-safe-exact-preflight");
      }
    } else {
      if (stage.phases && !stage.phases.includes(input.tradingPhase)) holds.push("EXPLICIT_TRADING_PHASE_REQUIRED");
      const requirements = [...stage.requirements,
        ...(input.tradingPhase === "GRADUATED_V4" ? stage.postGraduationRequirements ?? [] : [])];
      for (const requirement of requirements) {
        if (!freshCheck(input.checks?.[requirement], candidate, stage.id, input.transaction, now, requirement)) holds.push(`UNVERIFIED:${requirement}`);
      }
    }
    const evidenceDigest = releaseDigest({ candidateDigest: candidate.digest, stage: stage.id,
      checks: input.checks ?? {}, safeObservation: input.safeObservation ?? null,
      transaction: input.transaction ?? null, limits: input.limits ?? null, tradingPhase: input.tradingPhase ?? null });
    const riskContextDigest = releaseDigest({ candidateDigest: candidate.digest, stage: stage.id,
      limits: input.limits ?? null, tradingPhase: input.tradingPhase ?? null,
      publicReleaseConfigSha256: input.checks?.["public-release-config"]?.evidenceSha256 ?? null });
    const adopted = stage.policyAdopted || ownerDecision(input.policyApproval, candidate, stage.id, riskContextDigest, "STAGE_POLICY", now);
    if (!adopted) holds.push("STAGE_POLICY_APPROVAL_REQUIRED");
    if (applicable.length) {
      const acceptance = input.riskAcceptance;
      const acceptedIds = Array.isArray(acceptance?.acceptedFindingIds) ? [...acceptance.acceptedFindingIds].sort() : [];
      if (!ownerDecision(acceptance, candidate, stage.id, riskContextDigest, "RISK_ACCEPTANCE", now) ||
          acceptance.findingsSha256 !== candidate.findingsSha256 ||
          JSON.stringify(acceptedIds) !== JSON.stringify(applicable.map(({ id }) => id).sort())) {
        holds.push("EXACT_OWNER_RISK_ACCEPTANCE_REQUIRED");
      }
    }
    if (stage.transactionRequired) {
      const issue = transactionIssue(input.transaction, input.limits, stage);
      if (issue) holds.push(issue);
    }
    if (stage.id === "website-rmt-creation") {
      const form = input.checks?.["actual-creator-form"];
      if (!input.transaction?.to || input.transaction.from.toLowerCase() !== approvedFirstProject.creator.toLowerCase() ||
          input.transaction.valueWei !== approvedRmtTerms.creationFeeWei ||
          form?.factory?.toLowerCase() !== input.transaction.to.toLowerCase() ||
          form?.origin !== "https://www.rmtlaunch.fun" || form?.configurationSha256 !== approvedCreatorConfigurationSha256) {
        holds.push("NORMAL_CREATOR_FORM_AND_APPROVED_RMT_FIELDS_REQUIRED");
      }
    }
    const decision = stage.transactionRequired ? input.transactionApproval : input.activationApproval;
    const decisionKind = stage.transactionRequired ? "TRANSACTION_REVIEW" : "STAGE_ACTIVATION";
    const decisionBinding = stage.transactionRequired ? evidenceDigest : riskContextDigest;
    const separatelyApproved = ownerDecision(decision, candidate, stage.id, decisionBinding, decisionKind, now) &&
      (!stage.transactionRequired || decision.transactionSha256 === releaseDigest(input.transaction ?? null));
    return {
      id: stage.id,
      readiness: holds.length ? "HOLD" : "ELIGIBLE_FOR_SEPARATE_OWNER_DECISION",
      separateDecision: separatelyApproved ? "RECORDED_REQUIRES_EXECUTION_TIME_RECHECK" : "REQUIRED",
      transactionRequired: stage.transactionRequired,
      evidenceDigest,
      riskContextDigest,
      holds,
    };
  });
  return {
    schemaVersion: 1,
    scope: "OFFLINE_RELEASE_DECISION_SUPPORT",
    status: "BLOCKED_NO_BROADCAST",
    signingAuthorized: false,
    broadcastAuthorized: false,
    publicTradingEnabled: false,
    tokenCreationEnabled: false,
    independentAudit: "NOT_PERFORMED",
    independentAuditMandatory: false,
    strictAnalysis: { status: "FAIL_HIGH", detectorCount: 101, results: 233, high: 22, governanceMedium: 7 },
    assessment: "INTERNAL_REVIEW_REQUIRES_STAGE_SPECIFIC_OWNER_RISK_ACCEPTANCE",
    candidate,
    stages,
    sequence: ["SECURITY_CLOSEOUT", "SEPARATELY_APPROVED_INFRASTRUCTURE_DEPLOYMENT_AND_VERIFICATION", "OWNER_CREATES_RMT_IN_NORMAL_WEBSITE_FORM"],
    deploymentTokenCreationTransactions: [],
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { values } = parseArgs({ options: { evidence: { type: "string" } } });
    let evidence = {};
    if (values.evidence) {
      assert.ok(statSync(values.evidence).size <= 1_000_000, "Evidence file exceeds the 1 MB bound");
      evidence = readJson(values.evidence);
    }
    const result = evaluateRelease(evidence);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.stages.some(({ readiness }) => readiness === "HOLD")) process.exitCode = 1;
  } catch (error) {
    process.stderr.write("Release evidence is invalid: " + error.message.split(/\r?\n/)[0].slice(0, 200) + "\n");
    process.exitCode = 1;
  }
}
