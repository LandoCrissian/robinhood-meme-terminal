"use client";

import type { ExternalMarket } from "../lib/external-market";
import type { ExternalMarketRiskFlag } from "../lib/external-market-ranking";

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
  acknowledged,
  onAcknowledgedChange
}: {
  market: ExternalMarket;
  side: "buy" | "sell";
  priceImpact?: number;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
}) {
  const verifiedOrigin = hasVerifiedOrigin(market);
  const externalToken = market.origin?.kind !== "rmt-v6";
  const sushiRoute = market.venue.kind === "dex"
    && market.venue.dexId.toLowerCase().includes("sushi");
  const requiresAcknowledgement = tradeRequiresAcknowledgement(market, side);
  const excessivePriceImpact = priceImpact !== undefined && priceImpact > 0.1;
  const warnings = [
    ...market.riskFlags.map((flag) => WARNING_COPY[flag]),
    ...(externalToken ? ["This is external token code. Verified origin does not prove the creator cannot rug or change market conditions."] : []),
    ...(!verifiedOrigin ? ["RMT has not verified this token’s launch origin or creator."] : []),
    ...(sushiRoute ? ["Sushi’s current Robinhood Chain route enforces minimum received but has no onchain deadline."] : []),
    ...(market.ageMinutes === null ? ["The market’s creation time is unavailable."] : []),
    ...(priceImpact !== undefined && priceImpact > 0.03
      ? [`This quote has ${Math.min(priceImpact * 100, 999).toFixed(2)}% price impact.`]
      : [])
  ];

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
        <span className={verifiedOrigin ? "pass" : "warn"}><i />{verifiedOrigin ? "Launch origin cross-checked" : "Origin or creator unverified"}</span>
        <span className={market.buys1h > 0 && market.sells1h > 0 ? "pass" : "warn"}><i />{market.buys1h > 0 && market.sells1h > 0 ? "Recent buys and sells observed" : "Two-sided activity not observed"}</span>
      </div>

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
            onChange={(event) => onAcknowledgedChange(event.target.checked)}
          />
          <span>I reviewed these warnings and understand RMT cannot guarantee this token or prevent every rug.</span>
        </label>
      )}

      <p>These are evidence-based checks, not a safety rating or endorsement. Your wallet remains the final authority.</p>
    </section>
  );
}
