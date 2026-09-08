// A failed first read is not an observed count of zero.
export function directoryCountsObserved(status: string, marketCount: number) {
  return marketCount > 0 || status === "ready" || status === "stale" || status === "fallback";
}

export const DIRECTORY_FAILURE_REASONS = [
  "IDENTITY_RPC_TIMEOUT", "IDENTITY_RPC_UNAVAILABLE", "IDENTITY_MULTICALL_FAILURE",
  "IDENTITY_RESPONSE_INVALID", "STOCK_CLASSIFICATION_UNAVAILABLE",
  "PROJECT_IDENTITY_AUTHORITY_UNAVAILABLE", "INDEXED_INVENTORY_UNAVAILABLE",
  "INDEXED_IDENTITY_SNAPSHOT_UNAVAILABLE", "CURATED_POOL_VERIFICATION_UNAVAILABLE",
  "OTHER_BOUNDED_REASON"
] as const;
export type DirectoryFailureReason = typeof DIRECTORY_FAILURE_REASONS[number];
export function boundedDirectoryFailureReasons(value: unknown): DirectoryFailureReason[] {
  return Array.isArray(value) ? [...new Set(value.filter((reason): reason is DirectoryFailureReason =>
    typeof reason === "string" && (DIRECTORY_FAILURE_REASONS as readonly string[]).includes(reason)))].slice(0, DIRECTORY_FAILURE_REASONS.length) : [];
}
// Error types only: never retain provider messages, URLs or bodies.
export function identityReadFailureReason(error: unknown): DirectoryFailureReason {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const entry = current as { name?: unknown; cause?: unknown };
    if (entry.name === "TimeoutError" || entry.name === "AbortError") return "IDENTITY_RPC_TIMEOUT";
    if (entry.name === "HttpRequestError" || entry.name === "RpcRequestError" || entry.name === "WebSocketRequestError") return "IDENTITY_RPC_UNAVAILABLE";
    if (entry.name === "ContractFunctionExecutionError" || entry.name === "ContractFunctionRevertedError") return "IDENTITY_MULTICALL_FAILURE";
    current = entry.cause;
  }
  return "OTHER_BOUNDED_REASON";
}
