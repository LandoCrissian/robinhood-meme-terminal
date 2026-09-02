export const TRADE_AUTHORIZATION_TIMEOUT_MS = 30_000;
export const TRADE_AUTHORIZATION_MAX_ATTEMPTS = 1;

export type TradeAuthorizationFailureCode =
  | "timeout"
  | "network"
  | "rate-limited"
  | "service-unavailable";

export class TradeAuthorizationRequestError extends Error {
  readonly code: TradeAuthorizationFailureCode;
  readonly attempts = TRADE_AUTHORIZATION_MAX_ATTEMPTS;
  readonly status?: number;

  constructor(code: TradeAuthorizationFailureCode, message: string, status?: number) {
    super(message);
    this.name = "TradeAuthorizationRequestError";
    this.code = code;
    this.status = status;
  }
}

export type TradeAuthorizationResponse = {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
  attempts: typeof TRADE_AUTHORIZATION_MAX_ATTEMPTS;
  latencyMs: number;
};

type TimeoutHandle = ReturnType<typeof setTimeout>;

export type TradeAuthorizationTransport = {
  fetch: typeof fetch;
  now: () => number;
  setTimeout: (callback: () => void, delayMs: number) => TimeoutHandle;
  clearTimeout: (handle: TimeoutHandle) => void;
};

export type TradeAuthorizationRequestOptions = {
  identityToken?: string | null;
  timeoutMs?: number;
  transport?: TradeAuthorizationTransport;
};

const defaultTransport: TradeAuthorizationTransport = {
  fetch: (...args) => fetch(...args),
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle)
};

function boundedTimeout(value: number | undefined) {
  return Number.isInteger(value) && Number(value) > 0
    ? Math.min(Number(value), TRADE_AUTHORIZATION_TIMEOUT_MS)
    : TRADE_AUTHORIZATION_TIMEOUT_MS;
}

function failureCodeForStatus(status: number): TradeAuthorizationFailureCode {
  if (status === 429) return "rate-limited";
  if (status >= 500) return "service-unavailable";
  return "network";
}

async function responsePayload(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : { error: "Authorization service returned an invalid response." };
  } catch {
    return { error: "Authorization service returned an invalid response." };
  }
}

/**
 * One-shot wallet authorization transport. It deliberately has no shared
 * quote cache and no retry path: a timeout requires exact verification again.
 */
export async function requestTradeAuthorization(
  endpoint: string,
  body: Record<string, unknown>,
  options: TradeAuthorizationRequestOptions = {}
): Promise<TradeAuthorizationResponse> {
  const transport = options.transport ?? defaultTransport;
  const controller = new AbortController();
  const timeoutMs = boundedTimeout(options.timeoutMs);
  const timeout = transport.setTimeout(
    () => controller.abort("authorization-timeout"),
    timeoutMs
  );
  const startedAt = transport.now();
  try {
    const response = await transport.fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.identityToken ? { "privy-id-token": options.identityToken } : {})
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
      attempts: TRADE_AUTHORIZATION_MAX_ATTEMPTS,
      latencyMs: Math.max(0, transport.now() - startedAt)
    };
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new TradeAuthorizationRequestError(
        "timeout",
        "RMT could not finish protected wallet authorization in time. Verify the route again."
      );
    }
    throw new TradeAuthorizationRequestError(
      "network",
      cause instanceof Error ? cause.message : "The wallet authorization service could not be reached."
    );
  } finally {
    transport.clearTimeout(timeout);
  }
}

export function tradeAuthorizationFailureFromResponse(response: TradeAuthorizationResponse) {
  if (response.ok) return null;
  const code = failureCodeForStatus(response.status);
  const error = typeof response.payload.error === "string"
    ? response.payload.error
    : response.status === 429
      ? "The wallet authorization service is receiving too many requests. Verify the route again."
      : response.status >= 500
        ? "The wallet authorization service is temporarily unavailable. Verify the route again."
        : "The wallet authorization request was rejected. Verify the route again.";
  return new TradeAuthorizationRequestError(code, error, response.status);
}

export function isCurrentTradeAuthorizationAttempt(attempt: number, currentAttempt: number) {
  return attempt === currentAttempt;
}
