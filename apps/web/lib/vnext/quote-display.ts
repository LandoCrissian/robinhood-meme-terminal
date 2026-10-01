/** Presentation only. This cannot authorize a transaction or extend freshness. */
export type QuoteDisplayPhase = "NO_QUOTE" | "FETCHING_INITIAL" | "VERIFIED_FRESH" | "RENEWING_WITH_PRIOR_TERMS" | "EXPIRED" | "PROVIDER_UNAVAILABLE" | "RECOVERED";
export function quoteDisplayPhase(input: {
  hasTerms: boolean; busy: boolean; failed: boolean; expiresAtMs?: number; nowMs: number; recovered: boolean;
}): QuoteDisplayPhase {
  if (input.failed) return "PROVIDER_UNAVAILABLE";
  if (!input.hasTerms) return input.busy ? "FETCHING_INITIAL" : "NO_QUOTE";
  if (input.expiresAtMs !== undefined && input.expiresAtMs <= input.nowMs) return "EXPIRED";
  if (input.busy) return "RENEWING_WITH_PRIOR_TERMS";
  return input.recovered ? "RECOVERED" : "VERIFIED_FRESH";
}
export function compactOutputTerms(atomic: string | null | undefined, decimals: number | null | undefined) {
  return atomic != null && decimals == null ? "Exact output available in base units" : null;
}
