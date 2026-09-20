import { TradeExecutionFailure, type ExecutionFailureCode } from "./trade-failure";
import { tradeJourneyLabels, tradeJourneyPhase } from "./trade-journey";
import { identityFailureDefinitions, identityOperations, type IdentityFailureCode } from "./identity-failure";
import { safeEnvelopeDiagnostic } from "./execution-envelope-diagnostic";

const codes: readonly ExecutionFailureCode[] = [
  ...Object.keys(identityFailureDefinitions) as IdentityFailureCode[],
  "AUTH_FAILURE", "PROJECT_IDENTITY_CONFLICT", "STOCK_TOKEN_INELIGIBLE", "STOCK_TOKEN_POLICY_UNAVAILABLE",
  "PROVIDER_QUOTE_ONLY", "PROVIDER_SETTLEMENT_QUOTE_ONLY", "PROVIDER_SCOPE_INVALID",
  "CONTRACT_VERSION_UNSUPPORTED", "SETTLER_UNREGISTERED", "SETTLER_REGISTRY_UNAVAILABLE",
  "EXECUTION_ENVELOPE_REJECTED", "RPC_UNAVAILABLE", "PROVIDER_UNAVAILABLE", "RATE_LIMITED",
  "NO_ROUTE", "PROVIDER_POLICY_REJECTED", "QUOTE_EXPIRED",
];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const vercelId = /^(?:[a-z]{3}[0-9]::){1,2}[a-z0-9]{5}-[0-9]{13}-[0-9a-f]{12}$/i;
const stages = ["quote", "verification", "authorization"];

function identifier(value: unknown): string | null {
  return typeof value === "string" && uuid.test(value) ? value : null;
}

function generationId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeFields(payload: Record<string, unknown>) {
  const executionCode = codes.find((code) => code === payload.code);
  const phaseCode = tradeJourneyPhase(payload.code);
  const phase = tradeJourneyPhase(payload.phase) ?? null;
  const code = executionCode ?? phaseCode ?? null;
  return {
    code,
    ...safeEnvelopeDiagnostic(payload),
    identityOperation: typeof payload.identityOperation === "string" && (identityOperations as readonly string[]).includes(payload.identityOperation) ? payload.identityOperation : null,
    identityAsset: typeof payload.identityAsset === "string" && /^0x[0-9a-f]{40}$/i.test(payload.identityAsset) ? payload.identityAsset : null,
    stage: typeof payload.stage === "string" && stages.includes(payload.stage) ? payload.stage : null,
    phase,
    retryable: typeof payload.retryable === "boolean" ? payload.retryable : null,
    explanation: executionCode
      ? new TradeExecutionFailure(executionCode).detail
      : phaseCode ? tradeJourneyLabels[phaseCode]
        : "No recognized diagnostic code was returned. Missing fields are not evidence of success.",
  };
}

export function captureResponseDiagnostic(
  payload: Record<string, unknown>,
  receiptTime: number | null,
  quoteRequestId: unknown,
  serverRequestId: unknown,
  originGenerationId?: unknown,
) {
  return Object.freeze({
    ...safeFields(payload),
    receivedAt: receiptTime !== null && Number.isFinite(new Date(receiptTime).getTime()) ? new Date(receiptTime).toISOString() : null,
    originGenerationId: generationId(originGenerationId),
    quoteRequestId: identifier(quoteRequestId),
    serverRequestId: typeof serverRequestId === "string" && (uuid.test(serverRequestId) || vercelId.test(serverRequestId))
      ? serverRequestId : null,
  });
}

type Diagnostic = ReturnType<typeof captureResponseDiagnostic>;

export function consumeResponseDiagnostic(record: Diagnostic | undefined, consumerGeneration: unknown, reused: boolean) {
  if (!record) return undefined;
  return Object.freeze({
    record,
    consumerGenerationId: generationId(consumerGeneration),
    evidence: reused ? "CACHED_OR_IN_FLIGHT_REUSE" as const : "NETWORK_RESPONSE" as const,
  });
}

type Consumption = NonNullable<ReturnType<typeof consumeResponseDiagnostic>>;
type Entry = Readonly<Consumption & { context: string }>;

// Context is an in-memory association only. It must never enter the copyable record.
export function appendResponseDiagnostic(
  entries: readonly Entry[], consumption: Consumption | undefined,
  context: string, currentContext: string, currentGeneration: number,
): readonly Entry[] {
  if (!consumption || context !== currentContext || consumption.consumerGenerationId === null
    || consumption.consumerGenerationId !== generationId(currentGeneration)) return entries;
  return [...entries.filter((entry) => entry.context === currentContext), Object.freeze({ ...consumption, context })].slice(-8);
}

export function serializeResponseDiagnostic(entry: Entry): string {
  const { record } = entry;
  // Reconstruct the allowlist rather than serializing an extensible object.
  const safe = captureResponseDiagnostic(record, record.receivedAt === null ? null : Date.parse(record.receivedAt),
    record.quoteRequestId, record.serverRequestId, record.originGenerationId);
  return JSON.stringify({
    ...safe,
    consumerGenerationId: generationId(entry.consumerGenerationId),
    evidence: entry.evidence === "NETWORK_RESPONSE" || entry.evidence === "CACHED_OR_IN_FLIGHT_REUSE" ? entry.evidence : null,
  }, null, 2);
}
