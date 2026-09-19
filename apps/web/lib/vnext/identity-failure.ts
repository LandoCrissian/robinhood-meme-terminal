// Shared, closed vocabulary. Provider error messages, URLs and response bodies
// never cross the execution identity boundary.
export const identityFailureDefinitions = {
  IDENTITY_RPC_UNAVAILABLE: ["IDENTITY_UNAVAILABLE", true, 503, "Token identity RPC is temporarily unavailable."],
  IDENTITY_TIMEOUT: ["IDENTITY_UNAVAILABLE", true, 503, "Token identity verification timed out."],
  IDENTITY_RATE_LIMITED: ["IDENTITY_UNAVAILABLE", true, 429, "Token identity RPC is rate limited."],
  IDENTITY_CALL_FAILED: ["IDENTITY_UNAVAILABLE", false, 422, "A required token metadata contract call failed."],
  TOKEN_NOT_FOUND: ["IDENTITY_CONFLICT", false, 422, "No contract code was found at the selected token address."],
  TOKEN_METADATA_INVALID: ["IDENTITY_CONFLICT", false, 422, "The selected contract returned invalid required token metadata."],
  IDENTITY_CHAIN_MISMATCH: ["IDENTITY_CONFLICT", false, 422, "Token identity requires Robinhood Chain 4663."],
  IDENTITY_CAPACITY_EXCEEDED: ["IDENTITY_UNAVAILABLE", true, 503, "Token identity verification is temporarily at capacity."],
  IDENTITY_READER_FAILED: ["IDENTITY_UNAVAILABLE", true, 503, "Token identity reader could not complete."],
  IDENTITY_EVIDENCE_UNAVAILABLE: ["IDENTITY_UNAVAILABLE", true, 503, "Required token identity evidence is unavailable."],
  SERVER_CONFIGURATION_ERROR: ["IDENTITY_UNAVAILABLE", false, 503, "Required trading server configuration is invalid."]
} as const;
export type IdentityFailureCode = keyof typeof identityFailureDefinitions;
export const identityOperations = ["binding", "capacity", "inventory", "live_reader", "eth_getCode", "name", "symbol", "decimals", "totalSupply", "metadata"] as const;
export type IdentityOperation = typeof identityOperations[number];
export type IdentityReadFailure = { code: IdentityFailureCode; operation: IdentityOperation };

export function classifyIdentityReadFailure(error: unknown, operation: IdentityOperation): IdentityReadFailure {
  const chain: Array<{ name?: unknown; code?: unknown; status?: unknown }> = [];
  let current = error;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  // Inspect every cause before classifying viem's outer contract wrapper.
  const code: IdentityFailureCode = chain.some(x => x.status === 429 || x.name === "LimitExceededRpcError")
    ? "IDENTITY_RATE_LIMITED"
    : chain.some(x => x.name === "TimeoutError" || x.name === "AbortError") ? "IDENTITY_TIMEOUT"
    : chain.some(x => x.code === "ERR_INVALID_URL" || x.name === "UrlRequiredError") ? "SERVER_CONFIGURATION_ERROR"
    : chain.some(x => ["HttpRequestError", "RpcRequestError", "WebSocketRequestError"].includes(String(x.name))) ? "IDENTITY_RPC_UNAVAILABLE"
    : chain.some(x => ["ContractFunctionRevertedError", "ContractFunctionZeroDataError", "AbiDecodingZeroDataError"].includes(String(x.name))) ? "IDENTITY_CALL_FAILED"
    : "IDENTITY_READER_FAILED";
  return { code, operation };
}
