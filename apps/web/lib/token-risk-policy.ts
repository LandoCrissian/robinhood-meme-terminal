import type {
  TokenRiskEvidence,
  TokenRiskEvidenceState
} from "./token-risk-evidence";
import type { TradeEvidenceState } from "./trade-readiness";

export type TokenRiskFindingSeverity = "review" | "blocked";

export type TokenRiskFinding = {
  code:
    | "sell-direction-blocked"
    | "published-bytecode-changed"
    | "launch-restrictions-active"
    | "contract-source-unverified"
    | "proxy-contract"
    | "privileged-controls"
    | "sell-direction-unknown"
    | "liquidity-control-unproven"
    | "liquidity-creator-controlled"
    | "liquidity-operator-approved"
    | "holder-concentration"
    | "creator-concentration"
    | "flagged-holder"
    | "partial-coverage"
    | "evidence-unavailable";
  severity: TokenRiskFindingSeverity;
  label: string;
};

export type TokenRiskDecision = {
  state: TradeEvidenceState;
  findings: TokenRiskFinding[];
  primaryFinding: TokenRiskFinding | null;
};

function reviewFindings(evidence: TokenRiskEvidence): TokenRiskFinding[] {
  const findings: TokenRiskFinding[] = [];
  const add = (finding: TokenRiskFinding) => findings.push(finding);

  if (evidence.contract.sourcePublished !== true) {
    add({
      code: "contract-source-unverified",
      severity: "review",
      label: "Contract source could not be fully verified"
    });
  }
  if (evidence.contract.isProxy === true) {
    add({
      code: "proxy-contract",
      severity: "review",
      label: "Token behavior depends on a proxy implementation"
    });
  }
  if (
    evidence.contract.controls.assessment === "unknown"
    || evidence.contract.controls.assessment === "review-required"
  ) {
    add({
      code: "privileged-controls",
      severity: "review",
      label: "Privileged token controls require review"
    });
  }
  if (evidence.marketVerified && (
    evidence.sellSimulation.status === "unavailable"
    || evidence.sellSimulation.status === "not-run"
  )) {
    add({
      code: "sell-direction-unknown",
      severity: "review",
      label: "Sell-direction evidence is unavailable"
    });
  }
  if (evidence.marketVerified && evidence.liquidity.controlStatus === "creator-controlled") {
    add({
      code: "liquidity-creator-controlled",
      severity: "review",
      label: "Creator can transfer the verified liquidity position"
    });
  } else if (evidence.marketVerified && evidence.liquidity.controlStatus === "not-proven") {
    add({
      code: "liquidity-control-unproven",
      severity: "review",
      label: "Liquidity-position control is not proven"
    });
  }
  if (evidence.marketVerified && evidence.liquidity.approvedOperator) {
    add({
      code: "liquidity-operator-approved",
      severity: "review",
      label: "Liquidity position has an approved transfer operator"
    });
  }
  const largestHolderShare = evidence.marketVerified
    ? evidence.holders.largestNonPoolHolder?.shareBps
    : evidence.holders.largestHolder?.shareBps;
  if ((largestHolderShare ?? 0) >= 1_000) {
    add({
      code: "holder-concentration",
      severity: "review",
      label: evidence.marketVerified
        ? "One non-pool wallet controls at least 10% of supply"
        : "One visible holder controls at least 10% of supply"
    });
  }
  if ((evidence.holders.creatorShareBps ?? 0) >= 1_000) {
    add({
      code: "creator-concentration",
      severity: "review",
      label: "Reported creator controls at least 10% of supply"
    });
  }
  const visibleHolders = evidence.marketVerified
    ? evidence.holders.topNonPoolHolders
    : evidence.holders.topHolders;
  if (visibleHolders.some((holder) => holder.isScam)) {
    add({
      code: "flagged-holder",
      severity: "review",
      label: "A visible holder is flagged by the evidence provider"
    });
  }
  if (evidence.coverage === "partial") {
    add({
      code: "partial-coverage",
      severity: "review",
      label: "Contract or holder evidence is incomplete"
    });
  }
  return findings;
}

function blockedFindings(evidence: TokenRiskEvidence): TokenRiskFinding[] {
  const findings: TokenRiskFinding[] = [];
  if (evidence.marketVerified && evidence.sellSimulation.status === "blocked") {
    findings.push({
      code: "sell-direction-blocked",
      severity: "blocked",
      label: "Read-only holder-to-pool transfer failed"
    });
  }
  if (evidence.contract.bytecodeChanged === true) {
    findings.push({
      code: "published-bytecode-changed",
      severity: "blocked",
      label: "Deployed bytecode differs from the published source"
    });
  }
  if (evidence.contract.controls.activeLaunchRestrictions === true) {
    findings.push({
      code: "launch-restrictions-active",
      severity: "blocked",
      label: "Onchain launch restrictions are still active"
    });
  }
  return findings;
}

export function tokenRiskDecision(
  evidenceState: TokenRiskEvidenceState,
  side: "buy" | "sell"
): TokenRiskDecision {
  if (evidenceState.status === "loading") {
    return { state: "checking", findings: [], primaryFinding: null };
  }
  if (evidenceState.status === "unavailable") {
    const finding: TokenRiskFinding = {
      code: "evidence-unavailable",
      severity: "review",
      label: "Contract and holder evidence is temporarily unavailable"
    };
    return { state: "review", findings: [finding], primaryFinding: finding };
  }

  const reviews = reviewFindings(evidenceState.evidence);
  const blocked = side === "buy" ? blockedFindings(evidenceState.evidence) : [];
  const findings = [...blocked, ...reviews];
  return {
    state: blocked.length > 0 ? "blocked" : reviews.length > 0 ? "review" : "clear",
    findings,
    primaryFinding: findings[0] ?? null
  };
}
