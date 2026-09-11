import { tradeJourneyPhase, type TradeJourneyPhase } from "./trade-journey";

export type TradeFailureStage = "quote" | "verification" | "authorization";
const definitions = {
  CONTRACT_VERSION_UNSUPPORTED: ["FIRM_VERIFY_FAILED", false, 422, "The returned 0x contract version has not passed RMT compatibility review."],
  SETTLER_UNREGISTERED: ["FIRM_VERIFY_FAILED", false, 422, "The returned Settler is not an eligible official deployment."],
  SETTLER_REGISTRY_UNAVAILABLE: ["FIRM_VERIFY_FAILED", false, 422, "Official Settler eligibility could not be established. Execution is blocked."],
  EXECUTION_ENVELOPE_REJECTED: ["FIRM_VERIFY_FAILED", false, 422, "The exact execution envelope failed verification."],
  RPC_UNAVAILABLE: ["QUOTE_SERVICE_UNAVAILABLE", true, 503, "Required execution RPC evidence is temporarily unavailable."],
  PROVIDER_UNAVAILABLE: ["ZEROX_PROVIDER_UNAVAILABLE", true, 503, "Route provider temporarily unavailable."],
  RATE_LIMITED: ["ZEROX_PROVIDER_UNAVAILABLE", true, 429, "The route provider is rate limited."],
  NO_ROUTE: ["ZEROX_NO_ROUTE", false, 422, "No 0x route currently available."],
  PROVIDER_POLICY_REJECTED: ["ZEROX_POLICY_REJECTED", false, 422, "The provider response failed execution policy."],
  QUOTE_EXPIRED: ["QUOTE_EXPIRED", true, 409, "The verified quote expired. A fresh quote is required."]
} as const;
export type ExecutionFailureCode = keyof typeof definitions;
export type TradeFailure = {
  stage: TradeFailureStage; code: string; phase: TradeJourneyPhase; retryable: boolean; detail: string;
};

/** Only reviewed static messages cross the provider/contract failure boundary. */
export class TradeExecutionFailure extends Error implements TradeFailure {
  readonly phase: TradeJourneyPhase;
  readonly retryable: boolean;
  readonly status: number;
  readonly detail: string;
  constructor(readonly code: ExecutionFailureCode, readonly stage: TradeFailureStage = "verification") {
    const [phase, retryable, status, detail] = definitions[code];
    super(detail);
    this.name = "TradeExecutionFailure";
    this.phase = phase; this.retryable = retryable; this.status = status; this.detail = detail;
  }
}

export function executionFailureResponse(cause: unknown, stage: TradeFailureStage): Response | null {
  if (!(cause instanceof TradeExecutionFailure)) return null;
  return Response.json({ error: cause.detail, detail: cause.detail, code: cause.code,
    phase: cause.phase, retryable: cause.retryable, stage },
  { status: cause.status, headers: { "Cache-Control": "no-store" } });
}

/** Preserve existing domain phases; HTTP 422 alone is never a transport failure. */
export function responseTradeFailure(payload: Record<string, unknown>, status: number, stage: TradeFailureStage): TradeFailure {
  const typed = typeof payload.code === "string" && Object.hasOwn(definitions, payload.code)
    ? new TradeExecutionFailure(payload.code as ExecutionFailureCode, stage) : null;
  if (typed) return { stage, code: typed.code, phase: typed.phase, retryable: typed.retryable, detail: typed.detail };
  const phase = tradeJourneyPhase(payload.phase) ?? (status === 401 || status === 403 ? "AUTHENTICATION_FAILED"
    : status === 409 ? "QUOTE_EXPIRED" : status === 429 || status >= 500 ? "QUOTE_SERVICE_UNAVAILABLE"
    : stage === "authorization" ? "AUTHORIZATION_FAILED" : "FIRM_VERIFY_FAILED");
  const retryable = payload.retryable !== false && ["IDENTITY_UNAVAILABLE", "QUOTE_EXPIRED", "QUOTE_SERVICE_UNAVAILABLE", "ZEROX_PROVIDER_UNAVAILABLE"].includes(phase);
  const detail = typeof payload.error === "string" ? payload.error : "The request could not be completed.";
  return { stage, code: status === 401 || status === 403 ? "AUTHENTICATION_FAILED"
    : status === 429 ? "RATE_LIMITED" : phase, phase, retryable, detail };
}

export async function structureTradeFailure(response: Response, stage: TradeFailureStage): Promise<Response> {
  if (response.ok) return response;
  const payload = await response.json() as Record<string, unknown>;
  const failure = responseTradeFailure(payload, response.status, stage);
  return Response.json({ ...payload, ...failure, error: failure.detail }, { status: response.status, headers: response.headers });
}
