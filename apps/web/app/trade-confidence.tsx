"use client";

import { useEffect, useState } from "react";
import type { ExternalMarket } from "../lib/external-market";
import type { ExternalMarketRiskFlag } from "../lib/external-market-ranking";
import { formatOwnershipBps, type TokenRiskEvidenceState } from "../lib/token-risk-evidence";
import { tokenRiskDecision } from "../lib/token-risk-policy";
import { PRICE_IMPACT_BLOCK, PRICE_IMPACT_CAUTION } from "../lib/trade-ticket";

const WARNING_COPY: Record<ExternalMarketRiskFlag, string> = {
  "thin-liquidity": "Liquidity is thin, so a modest trade can move the price sharply.",
  "extreme-price-spike": "The price moved unusually fast and may reverse without warning.",
  "high-volume-low-trades": "Reported volume is high relative to the number of trades.",
  "very-new-low-activity": "This market is very new and has little trading history.",
  "one-sided-activity": "Recent activity is one-sided; exiting may be harder than entering."
};

function hasVerifiedOrigin(market: ExternalMarket) {
  if (market.project) return true;
  return market.origin?.kind === "rmt-v6"
    || (market.origin?.kind === "external" && market.origin.state === "attributed");
}

export function tradeRequiresAcknowledgement(market: ExternalMarket, side: "buy" | "sell") {
  return side === "buy" && (
    market.origin?.kind !== "rmt-v6"
    || market.riskFlags.length > 0
    || !hasVerifiedOrigin(market)
    || market.liquidityUsd < 5_000
    || market.ageMinutes === null
    || market.ageMinutes < 60
  );
}

export function tradeIsBlockedByEvidence(
  evidenceState: TokenRiskEvidenceState,
  side: "buy" | "sell"
) {
  return tokenRiskDecision(evidenceState, side).state === "blocked";
}

export function TradeConfidence({
  market,
  side,
  priceImpact,
  maxPriceImpact = PRICE_IMPACT_BLOCK,
  evidenceState,
  criticalEvidenceAcknowledged = false,
  onCriticalEvidenceAcknowledgement
}: {
  market: ExternalMarket;
  side: "buy" | "sell";
  priceImpact?: number;
  maxPriceImpact?: number;
  evidenceState: TokenRiskEvidenceState;
  criticalEvidenceAcknowledged?: boolean;
  onCriticalEvidenceAcknowledgement?: (acknowledged: boolean) => void;
}) {
  const verifiedOrigin = hasVerifiedOrigin(market);
  const externalToken = market.origin?.kind !== "rmt-v6";
  const sushiRoute = market.venue.kind === "dex"
    && market.venue.dexId.toLowerCase().includes("sushi");
  const requiresAcknowledgement = tradeRequiresAcknowledgement(market, side);
  const excessivePriceImpact = priceImpact !== undefined && priceImpact > maxPriceImpact;
  const evidenceDecision = tokenRiskDecision(evidenceState, side);
  const criticalEvidence = evidenceDecision.state === "blocked";
  const evidenceBlocked = criticalEvidence && !criticalEvidenceAcknowledged;
  const tradeBlocked = excessivePriceImpact || evidenceBlocked;
  const evidence = evidenceState.evidence;
  const sourceTransparent = evidence?.contract.sourcePublished === true
    && evidence.contract.bytecodeChanged === false
    && evidence.contract.isProxy !== true;
  const largestHolderBps = evidence?.holders.largestNonPoolHolder?.shareBps;
  const concentrated = largestHolderBps !== undefined && largestHolderBps >= 1_000;
  const warnings = [
    ...market.riskFlags.map((flag) => WARNING_COPY[flag]),
    ...(evidence?.warnings ?? []),
    ...(evidenceState.status === "unavailable"
      ? ["Contract and holder evidence is temporarily unavailable. Treat this as unknown, not safe."]
      : []),
    ...(externalToken ? ["This is external token code. Verified origin does not prove the creator cannot rug or change market conditions."] : []),
    ...(!verifiedOrigin ? ["RMT has not verified this token’s launch origin or creator."] : []),
    ...(sushiRoute ? ["Sushi’s current Robinhood Chain route enforces minimum received but has no onchain deadline."] : []),
    ...(market.ageMinutes === null ? ["The market’s creation time is unavailable."] : []),
    ...(priceImpact !== undefined && priceImpact > PRICE_IMPACT_CAUTION
      ? [`This quote has ${Math.min(priceImpact * 100, 999).toFixed(2)}% price impact.`]
      : [])
  ];
  const liquidityControlLabel = evidence?.liquidity.controlStatus === "creator-controlled"
    ? "Creator can transfer"
    : evidence?.liquidity.controlStatus === "contract-held"
      ? "Contract-held · lock unproven"
      : evidence?.liquidity.controlStatus === "third-party-wallet"
        ? "Other wallet · lock unproven"
        : evidence?.liquidity.controlStatus === "burn-address"
          ? "Burn address"
          : "Not proven locked";
  const positionLabel = evidence?.liquidity.positionId
    ? `${liquidityControlLabel} · #${evidence.liquidity.positionId}`
    : liquidityControlLabel;
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (tradeBlocked) setExpanded(true);
  }, [tradeBlocked]);

  const confidenceHeading = criticalEvidence
    ? criticalEvidenceAcknowledged
      ? "Critical evidence acknowledged"
      : `Critical evidence: ${evidenceDecision.primaryFinding?.label.toLowerCase() ?? "review required"}`
    : excessivePriceImpact
      ? "Trade blocked: extreme price impact"
      : requiresAcknowledgement
        ? "Review before buying"
        : "Verified checks passed";
  const reviewLabel = tradeBlocked
    ? "Required review"
    : expanded
      ? "Hide evidence"
      : `${warnings.length > 0 ? warnings.length : 3} ${warnings.length === 1 ? "notice" : "checks"}`;
  const contractSummary = evidenceState.status === "loading"
    ? "Checking"
    : sourceTransparent
      ? "Source matched"
      : evidenceState.status === "unavailable"
        ? "Unavailable"
        : "Review needed";
  const holderSummary = evidenceState.status === "loading"
    ? "Checking"
    : largestHolderBps === undefined
      ? "Unavailable"
      : formatOwnershipBps(largestHolderBps);
  const additionalFindingCount = Math.max(evidenceDecision.findings.length - 1, 0);

  return (
    <section className={`tradeConfidence ${tradeBlocked ? "blocked" : requiresAcknowledgement ? "caution" : "clear"}`} aria-labelledby="trade-confidence-heading">
      <button
        type="button"
        className="tradeConfidenceToggle"
        aria-expanded={expanded}
        aria-controls="trade-confidence-details"
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="tradeConfidenceIcon" aria-hidden="true">{tradeBlocked ? "!" : requiresAcknowledgement ? "?" : "✓"}</span>
        <span>
          <small>RMT PRE-TRADE EVIDENCE</small>
          <strong id="trade-confidence-heading">{confidenceHeading}</strong>
        </span>
        <em>{reviewLabel}<i aria-hidden="true">{expanded ? "−" : "+"}</i></em>
      </button>

      {expanded && (
        <div className="tradeConfidenceDetails" id="trade-confidence-details">
          <div className="tradeConfidenceSummary" aria-label="Pre-trade evidence summary">
            <span className="pass"><small>MARKET</small><strong>Pool matched</strong></span>
            <span className={sourceTransparent ? "pass" : "warn"}><small>CONTRACT</small><strong>{contractSummary}</strong></span>
            <span className={concentrated || evidenceState.status !== "ready" ? "warn" : "pass"}><small>LARGEST HOLDER</small><strong>{holderSummary}</strong></span>
          </div>

          {evidenceDecision.findings.length > 0 && (
            <div className="tradeConfidenceFinding" aria-label="Primary evidence finding">
              <i aria-hidden="true" />
              <span>
                <small>{criticalEvidence ? "CRITICAL REVIEW" : "NEEDS ATTENTION"}</small>
                <strong>{evidenceDecision.findings[0].label}</strong>
              </span>
              {additionalFindingCount > 0 && <em>+{additionalFindingCount}</em>}
            </div>
          )}

          <details className="tradeConfidenceTechnical">
            <summary>
              <span><small>FULL EVIDENCE</small><strong>Contract, holders, exits &amp; controls</strong></span>
              <em>{warnings.length + evidenceDecision.findings.length} signals</em>
            </summary>
            <div>
              {evidenceDecision.findings.length > 1 && (
                <div className="tradeConfidenceFindingList" aria-label="Additional evidence findings">
                  {evidenceDecision.findings.slice(1).map((finding) => <span key={finding.code}>{finding.label}</span>)}
                </div>
              )}

              {evidence && (
                <dl className="tradeConfidenceEvidence">
                  <div><dt>Known holders</dt><dd>{evidence.holders.count?.toLocaleString() ?? "Unavailable"}</dd></div>
                  <div><dt>Pool-held supply</dt><dd>{formatOwnershipBps(evidence.holders.poolShareBps)}</dd></div>
                  <div>
                    <dt>Reported creator balance</dt>
                    <dd>{evidence.holders.creator ? formatOwnershipBps(evidence.holders.creatorShareBps) : "No verified creator"}</dd>
                  </div>
                  <div>
                    <dt>Recent exit evidence</dt>
                    <dd>{market.sells1h > 0 ? `${market.sells1h.toLocaleString()} sells · 1h` : "No sells observed · 1h"}</dd>
                  </div>
                  <div>
                    <dt>Sell-direction simulation</dt>
                    <dd>{
                      evidence.sellSimulation.status === "passed"
                        ? "Holder → pool passed"
                        : evidence.sellSimulation.status === "blocked"
                          ? "Blocked"
                          : "Unknown"
                    }</dd>
                  </div>
                  <div>
                    <dt>Token controls</dt>
                    <dd>{
                      evidence.contract.controls.assessment === "no-common-controls-found"
                        ? "No common controls found"
                        : evidence.contract.controls.assessment === "known-launch-controls"
                          ? "Known Pons protection · expired"
                          : evidence.contract.controls.assessment === "review-required"
                            ? "Review required"
                            : "Unknown"
                    }</dd>
                  </div>
                  <div><dt>LP position control</dt><dd>{positionLabel}</dd></div>
                  {evidence.contract.controls.activeLaunchRestrictions && (
                    <div>
                      <dt>Active launch limits</dt>
                      <dd>{
                        evidence.contract.controls.maxTransactionBps !== null
                          ? `${formatOwnershipBps(evidence.contract.controls.maxTransactionBps)} tx`
                          : "Restrictions active"
                      }{
                        evidence.contract.controls.maxWalletBps !== null
                          ? ` · ${formatOwnershipBps(evidence.contract.controls.maxWalletBps)} wallet`
                          : ""
                      }</dd>
                    </div>
                  )}
                </dl>
              )}

              {warnings.length > 0 && (
                <ul>
                  {Array.from(new Set(warnings)).map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              )}

              <p>Evidence-based checks are not a safety rating or endorsement. Token evidence continues to update and your wallet remains the final authority.</p>
            </div>
          </details>

          {criticalEvidence && onCriticalEvidenceAcknowledgement && (
            <label className="tradeConfidenceConsent">
              <input
                type="checkbox"
                checked={criticalEvidenceAcknowledged}
                onChange={(event) => onCriticalEvidenceAcknowledgement(event.target.checked)}
              />
              <span>
                I reviewed the critical evidence and choose to continue. RMT will still verify and simulate the exact transaction before opening my wallet.
              </span>
            </label>
          )}

          {criticalEvidence && <p className="tradeConfidenceCriticalNote">Critical findings require an explicit choice but do not decide the trade for you.</p>}
        </div>
      )}
    </section>
  );
}
