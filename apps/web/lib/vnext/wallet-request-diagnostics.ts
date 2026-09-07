const ERROR_NAMES = new Set([
  "Error", "TypeError", "UnknownRpcError", "UserRejectedRequestError",
  "TimeoutError", "WalletTimeoutError", "ProviderRpcError", "RpcRequestError",
  "HttpRequestError", "InternalRpcError", "InvalidInputRpcError",
  "ResourceUnavailableRpcError", "LimitExceededRpcError", "PrivyConnectorError"
]);
const MAX_ELAPSED_MS = 7 * 24 * 60 * 60 * 1_000;

export type VNextWalletRequestErrorDiagnostic = {
  schemaVersion: 1;
  errorCode: number | null;
  errorName: string | null;
  causeCode: number | null;
  causeName: string | null;
  elapsedMs: number;
  connectorId: string | null;
  connectorType: string | null;
  walletClientType: string | null;
};

function property(value: unknown, key: string): unknown {
  try {
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)[key] : undefined;
  } catch {
    return undefined;
  }
}

function code(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= -2_147_483_648 && value <= 2_147_483_647 ? value : null;
}

function name(value: unknown) {
  return typeof value === "string" && ERROR_NAMES.has(value) ? value : null;
}

function identifier(value: unknown, maximum: number) {
  return typeof value === "string" && value.length <= maximum
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value) ? value : null;
}

// Never traverse messages, stacks, provider objects, request parameters, or tokens.
export function createVNextWalletRequestErrorDiagnostic(input: {
  error: unknown;
  elapsedMs: number;
  connectorId?: string;
  connectorType?: string;
  walletClientType?: string;
}): VNextWalletRequestErrorDiagnostic {
  const cause = property(input.error, "cause");
  return {
    schemaVersion: 1,
    errorCode: code(property(input.error, "code")),
    errorName: name(property(input.error, "name")),
    causeCode: code(property(cause, "code")),
    causeName: name(property(cause, "name")),
    elapsedMs: Number.isFinite(input.elapsedMs)
      ? Math.min(MAX_ELAPSED_MS, Math.max(0, Math.trunc(input.elapsedMs))) : 0,
    connectorId: identifier(input.connectorId, 160),
    connectorType: identifier(input.connectorType, 80),
    walletClientType: identifier(input.walletClientType, 80)
  };
}

export function normalizeVNextWalletRequestErrorDiagnostic(value: unknown): VNextWalletRequestErrorDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const elapsedMs = property(value, "elapsedMs");
  if (property(value, "schemaVersion") !== 1 || typeof elapsedMs !== "number"
    || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > MAX_ELAPSED_MS) return null;
  return {
    schemaVersion: 1,
    errorCode: code(property(value, "errorCode")),
    errorName: name(property(value, "errorName")),
    causeCode: code(property(value, "causeCode")),
    causeName: name(property(value, "causeName")),
    elapsedMs,
    connectorId: identifier(property(value, "connectorId"), 160),
    connectorType: identifier(property(value, "connectorType"), 80),
    walletClientType: identifier(property(value, "walletClientType"), 80)
  };
}
