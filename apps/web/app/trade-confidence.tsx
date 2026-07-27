"use client";

import type { ExternalMarket } from "../lib/external-market";
import type { ExternalMarketRiskFlag } from "../lib/external-market-ranking";
import { formatOwnershipBps, type TokenRiskEvidenceState } from "../lib/token-risk-evidence";

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

export function TradeConfidence({
  market,
  side,
  priceImpact,
  evidenceState,
  acknowledged,
  onAcknowledgedChange
}: {
  market: ExternalMarket;
  side: "buy" | "sell";
  priceImpact?: number;
  evidenceState: TokenRiskEvidenceState;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
}) {
  const verifiedOrigin = hasVerifiedOrigin(market);
  const externalToken = market.origin?.kind !== "rmt-v6";
  const sushiRoute = market.venue.kind === "dex"
    && market.venue.dexId.toLowerCase().includes("sushi");
  const requiresAcknowledgement = tradeRequiresAcknowledgement(market, side);
  const excessivePriceImpact = priceImpact !== undefined && priceImpact > 0.1;
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
    ...(priceImpact !== undefined && priceImpact > 0.03
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

  return (
    <section className={`tradeConfidence ${excessivePriceImpact ? "blocked" : requiresAcknowledgement ? "caution" : "clear"}`} aria-labelledby="trade-confidence-heading">
      <header>
        <span aria-hidden="true">{excessivePriceImpact ? "!" : requiresAcknowledgement ? "?" : "✓"}</span>
        <div>
          <small>RMT TRADE CONFIDENCE</small>
          <strong id="trade-confidence-heading">
            {excessivePriceImpact ? "Trade blocked: extreme price impact" : requiresAcknowledgement ? "Review before buying" : "Verified checks passed"}
          </strong>
        </div>
      </header>

      <div className="tradeConfidenceChecks">
        <span className="pass"><i />Token and displayed pool matched</span>
        <span className={sourceTransparent ? "pass" : "warn"}><i />{
          evidenceState.status === "loading"
            ? "Checking published contract source"
            : sourceTransparent
              ? "Published source matches bytecode"
              : evidenceState.status === "unavailable"
                ? "Contract transparency unavailable"
                : "Contract transparency needs review"
        }</span>
        <span className={concentrated || evidenceState.status !== "ready" ? "warn" : "pass"}><i />{
          evidenceState.status === "loading"
            ? "Checking non-pool concentration"
            : largestHolderBps === undefined
              ? "Holder concentration unavailable"
              : `${formatOwnershipBps(largestHolderBps)} largest non-pool holder`
        }</span>
      </div>

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
            <dt>Token controls</dt>
            <dd>{
              evidence.contract.controls.assessment === "no-common-controls-found"
                ? "No common controls found"
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

      {requiresAcknowledgement && !excessivePriceImpact && (
        <label className="tradeConfidenceConsent">
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={evidenceState.status === "loading"}
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
          />
          <span>{evidenceState.status === "loading"
            ? "Wait while RMT checks contract and holder evidence."
            : "I reviewed these warnings and understand RMT cannot guarantee this token or prevent every rug."}</span>
        </label>
      )}

      <p>These are evidence-based checks, not a safety rating or endorsement. Your wallet remains the final authority.</p>
    </section>
  );
}
