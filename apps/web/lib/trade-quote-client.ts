import { recordExperienceStage } from "./experience-funnel";
import { quoteRequestKey, SHARED_QUOTE_CACHE_MS } from "./trade-speed";

export type TradeQuoteFailureCode =
  | "timeout"
  | "network"
  | "rate-limited"
  | "service-unavailable"
  | "invalid-response";

export class TradeQuoteRequestError extends Error {
  readonly code: TradeQuoteFailureCode;
  readonly attempts: number;
  readonly status?: number;

  constructor(
    code: TradeQuoteFailureCode,
    message: string,
    attempts: number,
    status?: number
  ) {
    super(message);
    this.name = "TradeQuoteRequestError";
    this.code = code;
    this.attempts = attempts;
    this.status = status;
  }
}

export type TradeQuoteResponse = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
  attempts: number;
  latencyMs: number;
};

type QuoteEntry = {
  createdAt: number;
  promise: Promise<TradeQuoteResponse>;
};

const quoteRequests = new Map<string, QuoteEntry>();

export type TradeQuoteRequestOptions = {
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
  return "network";
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
  body: Record<string, string | number>,
  identityToken: string | null | undefined,
  timeoutMs: number,
  attempt: number
): Promise<TradeQuoteResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("quote-timeout"), timeoutMs);
  const startedAt = Date.now();
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
    return {
      ok: response.ok,
      status: response.status,
      payload: await responsePayload(response),
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
  body: Record<string, string | number>,
  options: TradeQuoteRequestOptions
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
        attempt
      );
      lastResponse = response;
      if (response.ok || !retryableStatus(response.status) || attempt === maxAttempts) return response;
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
  body: Record<string, string | number>,
  options: TradeQuoteRequestOptions = {}
) {
  const now = options.now ?? Date.now();
  const key = `${options.identityScope ?? "anonymous"}:${quoteRequestKey(endpoint, body)}`;
  const existing = quoteRequests.get(key);
  if (existing && now - existing.createdAt <= SHARED_QUOTE_CACHE_MS) return existing.promise;

  const promise = requestWithRetry(endpoint, body, options).then((response) => {
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
  quoteRequests.set(key, { createdAt: now, promise });
  return promise;
}

export function tradeQuoteFailureFromResponse(response: TradeQuoteResponse) {
  if (response.ok) return null;
  const code = failureCodeForStatus(response.status);
  const error = typeof response.payload.error === "string"
    ? response.payload.error
    : response.status === 429
      ? "The quote service is receiving too many requests."
      : response.status >= 500
        ? "The quote service is temporarily unavailable."
        : "The quote request was rejected.";
  return new TradeQuoteRequestError(code, error, response.attempts, response.status);
}
