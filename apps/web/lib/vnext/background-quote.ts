import { selectVNextRoute, type VNextQuoteResponse } from "./quote-observation";

export const VNEXT_BACKGROUND_QUOTE_DEBOUNCE_MS = 120;
export const VNEXT_BACKGROUND_QUOTE_REFRESH_MS = 4_000;
export const VNEXT_TRADE_QUOTE_MAX_AGE_MS = 6_000;
const MIN_EXECUTION_LIFETIME_MS = 5_000;

export function isVNextQuoteReusableForTrade(response: VNextQuoteResponse | undefined, nowMs: number) {
  if (!response || !Number.isFinite(nowMs)) return false;
  const candidate = selectVNextRoute(response.attempts).verificationCandidate;
  if (
    !candidate
    || candidate.status !== "indicative"
    || candidate.quotedAtMs === null
    || candidate.expiresAtMs === null
  ) return false;
  return candidate.quotedAtMs <= nowMs
    && nowMs - candidate.quotedAtMs <= VNEXT_TRADE_QUOTE_MAX_AGE_MS
    && candidate.expiresAtMs - nowMs >= MIN_EXECUTION_LIFETIME_MS;
}
