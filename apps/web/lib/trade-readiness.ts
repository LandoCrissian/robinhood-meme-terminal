export type TradeQuoteState = "enter" | "checking" | "refreshing" | "ready" | "error";
export type TradeEvidenceState = "checking" | "clear" | "review" | "blocked";
export type TradeReadinessTone = TradeQuoteState | "review" | "blocked";

export function tradeReadinessStatus(
  quoteState: TradeQuoteState,
  evidenceState: TradeEvidenceState
): { tone: TradeReadinessTone; headline: string } {
  if (evidenceState === "blocked") {
    return { tone: "blocked", headline: "Transaction integrity block · action required" };
  }
  if (evidenceState === "review") {
    return { tone: "review", headline: "Review advised · you remain in control" };
  }
  if (evidenceState === "checking") {
    return { tone: "checking", headline: "Reviewing contract evidence" };
  }
  if (quoteState === "ready") {
    return { tone: "ready", headline: "Ready for wallet review" };
  }
  if (quoteState === "refreshing") {
    return { tone: "refreshing", headline: "Fresh quote remains available" };
  }
  if (quoteState === "error") {
    return { tone: "error", headline: "Route needs attention" };
  }
  if (quoteState === "checking") {
    return { tone: "checking", headline: "Verifying this order" };
  }
  return { tone: "enter", headline: "Waiting for an amount" };
}