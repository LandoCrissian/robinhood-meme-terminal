/** Diagnostics for the explicitly loopback-only synthetic lifecycle fixture.
 * Never return provider messages, URLs, request parameters, stacks or revert
 * strings: those may contain credentials or arbitrary upstream content. */
export type LifecycleDiagnosticStage =
  | "request" | "deployment-binding" | "indexed-discovery" | "curve-identity"
  | "curve-state" | "wallet-nonce" | "wallet-code" | "review-block"
  | "v4-state" | "quote" | "calldata" | "gas-estimate" | "gas-price"
  | "simulation" | "latest-block" | "receipt-verification";

const invariantReasons = new Map([
  ["Fixture chain mismatch", "fixture-chain-mismatch"],
  ["Fixture deployment mismatch", "fixture-deployment-mismatch"],
  ["Indexed curve unavailable", "indexed-curve-unavailable"],
  ["Canonical lifecycle unavailable", "canonical-lifecycle-unavailable"],
  ["Unverified curve identity", "unverified-curve-identity"],
  ["Curve identity mismatch", "curve-identity-mismatch"],
  ["Curve state and indexed evidence disagree", "curve-state-index-conflict"],
]);
const kinds = new Set([
  "TimeoutError", "HttpRequestError", "RpcRequestError", "ContractFunctionExecutionError",
  "ContractFunctionRevertedError", "ExecutionRevertedError", "EstimateGasExecutionError",
  "CallExecutionError", "BlockNotFoundError", "AbiDecodingDataSizeTooSmallError",
  "InvalidInputRpcError", "InternalRpcError", "UnknownRpcError",
]);

class LifecycleStageError extends Error {
  constructor(readonly stage: LifecycleDiagnosticStage, cause: unknown) {
    super("Isolated lifecycle evidence unavailable", { cause });
    this.name = "LifecycleStageError";
  }
}

export async function atLifecycleStage<T>(stage: LifecycleDiagnosticStage, work: () => Promise<T>): Promise<T> {
  try { return await work(); }
  catch (error) { throw error instanceof LifecycleStageError ? error : new LifecycleStageError(stage, error); }
}

export function lifecycleFailureDiagnostic(error: unknown) {
  const diagnostic: { stage: LifecycleDiagnosticStage; kind: string; reason?: string; revertSelector?: string } = {
    stage: error instanceof LifecycleStageError ? error.stage : "request", kind: "unknown",
  };
  let current = error;
  const seen = new Set<unknown>();
  // Bound cause traversal and reject cyclic/untrusted error objects.
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const item = current as { name?: unknown; message?: unknown; data?: unknown; cause?: unknown };
    if (typeof item.name === "string" && kinds.has(item.name)) diagnostic.kind = item.name;
    if (typeof item.message === "string" && invariantReasons.has(item.message)) diagnostic.reason = invariantReasons.get(item.message);
    if (!diagnostic.revertSelector && typeof item.data === "string" && /^0x[0-9a-f]{8}(?:[0-9a-f]{2}){0,512}$/i.test(item.data)) {
      diagnostic.revertSelector = item.data.slice(0, 10).toLowerCase();
    }
    current = item.cause;
  }
  return diagnostic;
}
