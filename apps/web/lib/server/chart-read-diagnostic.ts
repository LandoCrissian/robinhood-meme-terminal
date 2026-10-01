/** Bounded public-chart diagnostics only. No provider body, URL, headers or raw errors. */
export type ChartOperation = "TOKEN_MARKET_RESOLUTION" | "GECKO_TOKEN_DISCOVERY" | "GECKO_POOL_READ" | "GECKO_OHLCV_FETCH" | "GECKO_TIMEOUT" | "GECKO_HTTP_STATUS" | "GECKO_PARSE" | "REFERENCE_PRICE" | "LOCAL_BUDGET" | "GLOBAL_COOLDOWN" | "STALE_EVIDENCE_READ" | "STALE_EVIDENCE_WRITE" | "RESPONSE_SERIALIZATION" | "OTHER";
type Facts = {
  reason?: "CACHE_FRESH" | "CACHE_MISS" | "CACHE_EXPIRED" | "PENDING_REUSE" | "FAILURE_BACKOFF" | "START_BUDGET" | "CONCURRENCY" | "COOLDOWN" | "HTTP_RESPONSE" | "BODY" | "PAYLOAD" | "BODY_TOO_LARGE" | "BODY_MISSING" | "HTTP_DATE_TOO_OLD" | "HTTP_DATE_FUTURE" | "HTTP_DATE_VALID" | "FETCH_REJECTED" | "STALE_FALLBACK" | "REFERENCE_MISMATCH";
  source?: "HINT" | "CANONICAL" | "GECKO_DISCOVERY";
  observationSource?: "HTTP_DATE" | "LOCAL_TIME_FALLBACK";
  pool?: string; httpStatus?: number; ageMs?: number; expiresInMs?: number;
  observedAt?: string; remainingMs?: number; starts?: number; pending?: number;
  staleAvailable?: boolean; stale?: boolean;
  errorClass?: ReturnType<typeof chartErrorClass>; errorCode?: string | null;
};
type Event = Facts & { operation: ChartOperation; atMs: number; durationMs: number; outcome: "OK" | "FAILED" | "SKIPPED" };
const bounded = (value: number) => Math.max(-86_400_000, Math.min(86_400_000, Math.round(value)));
const publicAddress = (value: unknown) => typeof value === "string" && /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value) ? value.toLowerCase() : null;
export function chartErrorClass(error: unknown) {
  if (error instanceof DOMException) return error.name === "AbortError" ? "AbortError" : error.name === "TimeoutError" ? "TimeoutError" : "DOMException";
  if (error instanceof SyntaxError) return "SyntaxError";
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof Error && error.constructor.name === "PresentationProviderError") return "PresentationProviderError";
  return error instanceof Error ? "Error" : "Unknown";
}
export function chartErrorFacts(error: unknown): { errorClass: ReturnType<typeof chartErrorClass>; errorCode: string | null } {
  const codes = ["UNAVAILABLE", "RATE_LIMITED", "INVALID", "ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"];
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = [candidate?.code, candidate?.cause?.code].find(value => typeof value === "string" && codes.includes(value));
  return { errorClass: chartErrorClass(error), errorCode: typeof code === "string" ? code : null };
}
export function createChartReadDiagnostic(token: string, range: string, hint: string | null, clock = () => performance.now()) {
  const started = clock();
  const events: Event[] = [];
  let omitted = 0;
  // Copy only known fields. Even accidentally passed raw errors/headers cannot be emitted.
  function event(operation: ChartOperation, since: number, outcome: Event["outcome"], facts: Facts = {}) {
    if (events.length >= 48) { omitted++; return; }
    const clean: Facts = {};
    if (["CACHE_FRESH", "CACHE_MISS", "CACHE_EXPIRED", "PENDING_REUSE", "FAILURE_BACKOFF", "START_BUDGET", "CONCURRENCY", "COOLDOWN", "HTTP_RESPONSE", "BODY", "PAYLOAD", "BODY_TOO_LARGE", "BODY_MISSING", "HTTP_DATE_TOO_OLD", "HTTP_DATE_FUTURE", "HTTP_DATE_VALID", "FETCH_REJECTED", "STALE_FALLBACK", "REFERENCE_MISMATCH"].includes(facts.reason!)) clean.reason = facts.reason;
    if (["HINT", "CANONICAL", "GECKO_DISCOVERY"].includes(facts.source!)) clean.source = facts.source;
    if (["HTTP_DATE", "LOCAL_TIME_FALLBACK"].includes(facts.observationSource!)) clean.observationSource = facts.observationSource;
    if (["PresentationProviderError", "AbortError", "TimeoutError", "DOMException", "SyntaxError", "TypeError", "Error", "Unknown"].includes(facts.errorClass!)) clean.errorClass = facts.errorClass;
    if (facts.errorCode === null || ["UNAVAILABLE", "RATE_LIMITED", "INVALID", "ENOTFOUND", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET"].includes(facts.errorCode!)) clean.errorCode = facts.errorCode;
    if (publicAddress(facts.pool)) clean.pool = publicAddress(facts.pool)!;
    if (facts.observedAt && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(facts.observedAt) && Number.isFinite(Date.parse(facts.observedAt))) clean.observedAt = facts.observedAt;
    for (const key of ["httpStatus", "ageMs", "expiresInMs", "remainingMs", "starts", "pending"] as const) if (typeof facts[key] === "number" && Number.isFinite(facts[key])) clean[key] = bounded(facts[key]!);
    for (const key of ["staleAvailable", "stale"] as const) if (typeof facts[key] === "boolean") clean[key] = facts[key];
    events.push({ operation, atMs: bounded(since - started), durationMs: bounded(clock() - since), outcome, ...clean });
  }
  return {
    now: clock, event,
    summary(status: number, error?: unknown) {
      const code = (error as { code?: unknown } | null)?.code;
      return { event: "RMT_CHART_READ_DIAGNOSTIC_V1", token: publicAddress(token), range: /^(5M|15M|1H|6H|24H|7D)$/.test(range) ? range : null, hint: publicAddress(hint), httpStatus: status, durationMs: bounded(clock() - started), errorClass: error === undefined ? null : chartErrorClass(error), errorCode: typeof code === "string" && ["UNAVAILABLE", "RATE_LIMITED", "INVALID"].includes(code) ? code : null, events: events.slice(), omitted, platformInternals: "NOT_DIRECTLY_OBSERVABLE; correlate Next fetch boundary with Vercel cache/origin spans" };
    }
  };
}
export type ChartReadDiagnostic = ReturnType<typeof createChartReadDiagnostic>;
