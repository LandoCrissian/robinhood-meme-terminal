import { responseTradeFailure, type TradeFailure, type TradeFailureStage } from "./vnext/trade-failure";
import { captureResponseDiagnostic, consumeResponseDiagnostic } from "./vnext/quote-response-diagnostic";
import { recordExperienceStage } from "./experience-funnel";
import { quoteRequestKey, SHARED_QUOTE_CACHE_MS } from "./trade-speed";
import { type TradeJourneyPhase } from "./vnext/trade-journey";

export type TradeQuoteFailureCode =
  | "rejected"
  | "timeout"
  | "network"
  | "rate-limited"
  | "service-unavailable"
  | "invalid-response";

export class TradeQuoteRequestError extends Error {
  readonly code: TradeQuoteFailureCode;
  readonly attempts: number;
  readonly status?: number;
  readonly phase: TradeJourneyPhase;
  readonly retryable: boolean;
  readonly failure?: TradeFailure;

  constructor(
    code: TradeQuoteFailureCode,
    message: string,
    attempts: number,
    status?: number,
    phase: TradeJourneyPhase = "QUOTE_SERVICE_UNAVAILABLE",
    failure?: TradeFailure
  ) {
    super(message);
    this.name = "TradeQuoteRequestError";
    this.code = code;
    this.attempts = attempts;
    this.status = status;
    this.phase = failure?.phase ?? phase;
    this.failure = failure;
    this.retryable = failure?.retryable ?? ["timeout", "network", "rate-limited", "service-unavailable"].includes(code);
  }
}

export type TradeQuoteResponse = {
  diagnostic?: ReturnType<typeof captureResponseDiagnostic>;
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
  attempts: number;
  latencyMs: number;
  stage?: TradeFailureStage;
};

type QuoteEntry = {
  pending: boolean;
  createdAt: number;
  promise: Promise<TradeQuoteResponse>;
};

const quoteRequests = new Map<string, QuoteEntry>();

export type TradeQuoteRequestOptions = {
  diagnosticGeneration?: number;
  onDiagnostic?: (consumption: NonNullable<ReturnType<typeof consumeResponseDiagnostic>>) => void;
  identityScope?: string;
  identityToken?: string | null;
  now?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
};

function positiveInteger(value: number | undefined, fallback: number, maximum: number) {
  return Number.isInteger(value) && Number(value) > 0
    ? Math.min(Number(value), maximum)
    : fallback;
}

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function failureCodeForStatus(status: number): TradeQuoteFailureCode {
  if (status === 429) return "rate-limited";
  if (status >= 500) return "service-unavailable";
  return "rejected";
}

function wait(milliseconds: number) {
  return milliseconds <= 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function responsePayload(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { error: "Quote service returned an invalid response." };
  } catch {
    return { error: "Quote service returned an invalid response." };
  }
}

async function requestOnce(
  endpoint: string,
  body: Record<string, unknown>,
  identityToken: string | null | undefined,
  timeoutMs: number,
  attempt: number,
  originGeneration: number | undefined
): Promise<TradeQuoteResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("quote-timeout"), timeoutMs);
  const startedAt = Date.now();
  const originalQuoteRequestId = endpoint.endsWith("/verify") ? body.quoteRequestId : undefined;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(identityToken ? { "privy-id-token": identityToken } : {})
      },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal
    });
    const payload = await responsePayload(response);
    const receivedAt = Date.now();
    return {
      ok: response.ok,
      status: response.status,
      stage: endpoint.endsWith("/verify") ? "verification" : "quote",
      payload,
      diagnostic: captureResponseDiagnostic(
        payload, receivedAt,
        endpoint.endsWith("/verify") ? originalQuoteRequestId : payload.requestId,
        response.headers.get("x-vercel-id") ?? response.headers.get("x-request-id"),
        originGeneration,
      ),
      attempts: attempt,
      latencyMs: Math.max(0, Date.now() - startedAt)
    };
  } catch (cause) {
    const timedOut = controller.signal.aborted;
    throw new TradeQuoteRequestError(
      timedOut ? "timeout" : "network",
      timedOut
        ? "The route service did not answer before the protected quote timeout."
        : cause instanceof Error ? cause.message : "The route service could not be reached.",
      attempt
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function requestWithRetry(
  endpoint: string,
  body: Record<string, unknown>,
  options: TradeQuoteRequestOptions,
  originGeneration: number | undefined
) {
  const timeoutMs = positiveInteger(options.timeoutMs, 8_000, 30_000);
  const maxAttempts = positiveInteger(options.maxAttempts, 2, 3);
  const retryDelayMs = Number.isFinite(options.retryDelayMs) && Number(options.retryDelayMs) >= 0
    ? Math.min(Number(options.retryDelayMs), 2_000)
    : 160;
  let lastResponse: TradeQuoteResponse | undefined;
  let lastError: TradeQuoteRequestError | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await requestOnce(
        endpoint,
        body,
        options.identityToken,
        timeoutMs,
        attempt,
        originGeneration
      );
      lastResponse = response;
      if (response.ok || !retryableStatus(response.status) || response.payload.retryable === false || attempt === maxAttempts) return response;
    } catch (cause) {
      lastError = cause instanceof TradeQuoteRequestError
        ? cause
        : new TradeQuoteRequestError("network", "The route service could not be reached.", attempt);
      if (attempt === maxAttempts) throw lastError;
    }
    await wait(retryDelayMs * attempt);
  }
  if (lastResponse) return lastResponse;
  throw lastError ?? new TradeQuoteRequestError("network", "The route service could not be reached.", maxAttempts);
}

export function clearTradeQuoteCache() {
  quoteRequests.clear();
}

export function requestTradeQuote(
  endpoint: string,
  body: Record<string, unknown>,
  options: TradeQuoteRequestOptions = {}
) {
  const now = options.now ?? Date.now();
  // Snapshot each caller's metadata without changing the shared promise or cache key.
  const consumerGeneration = options.diagnosticGeneration;
  const observer = options.onDiagnostic;
  const observe = (shared: Promise<TradeQuoteResponse>, reused: boolean) => {
    if (observer) void shared.then((response) => {
      try {
        const consumption = consumeResponseDiagnostic(response.diagnostic, consumerGeneration, reused);
        if (consumption) observer(consumption);
      } catch {
        // Diagnostic presentation must not change request results, retries, or execution.
      }
    }, () => { /* No HTTP response evidence exists for a transport failure. */ });
    return shared;
  };
  const key = `${options.identityScope ?? "anonymous"}:${quoteRequestKey(endpoint, body)}`;
  const existing = quoteRequests.get(key);
  if (existing && (existing.pending || now - existing.createdAt <= SHARED_QUOTE_CACHE_MS)) return observe(existing.promise, true);

  const promise = requestWithRetry(endpoint, body, options, consumerGeneration).then((response) => {
    if (!response.ok) {
      recordExperienceStage("quote_failed");
      if (quoteRequests.get(key)?.promise === promise) quoteRequests.delete(key);
    }
    return response;
  }).catch((cause) => {
    recordExperienceStage("quote_failed");
    if (quoteRequests.get(key)?.promise === promise) quoteRequests.delete(key);
    if (cause instanceof TradeQuoteRequestError) throw cause;
    throw new TradeQuoteRequestError(
      "network",
      cause instanceof Error ? cause.message : "The route service could not be reached.",
      1
    );
  });
  quoteRequests.set(key, { createdAt: now, pending: true, promise });
  void promise.then(() => { const entry = quoteRequests.get(key); if (entry?.promise === promise) entry.pending = false; }, () => {});
  return observe(promise, false);
}

export function tradeQuoteFailureFromResponse(response: TradeQuoteResponse) {
  if (response.ok) return null;
  const structured = responseTradeFailure(response.payload, response.status, response.stage ?? "verification");
  const code = failureCodeForStatus(response.status);
  const error = typeof response.payload.error === "string"
    ? response.payload.error
    : response.status === 429
      ? "The quote service is receiving too many requests."
      : response.status >= 500
        ? "The quote service is temporarily unavailable."
        : "The quote request was rejected.";
  return new TradeQuoteRequestError(code, error, response.attempts, response.status,
    structured.phase, structured);
}
