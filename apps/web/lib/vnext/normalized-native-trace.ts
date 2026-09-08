import { isAddress, keccak256, type Hex } from "viem";

export type NormalizedNativeTrace = {
  type: string; from?: string; to?: string; value?: Hex; inputHash?: Hex;
  error?: true; calls: NormalizedNativeTrace[];
};
const types = new Set(["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE", "CREATE", "CREATE2", "SELFDESTRUCT"]);

/** Provider-neutral callTracer normalization. Never retain messages or calldata. */
export function normalizeNativeTrace(input: unknown): NormalizedNativeTrace {
  let nodes = 0;
  const visit = (value: unknown, depth: number): NormalizedNativeTrace => {
    if (++nodes > 4096 || depth > 64 || !value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_TRACE");
    const node = value as Record<string, unknown>;
    if (typeof node.type !== "string" || !types.has(node.type) || node.calls !== undefined && !Array.isArray(node.calls)) throw new Error("INVALID_TRACE");
    const calls = ((node.calls ?? []) as unknown[]).map(child => visit(child, depth + 1));
    if (node.error !== undefined) {
      if (typeof node.error !== "string" || !node.error) throw new Error("INVALID_TRACE");
      return { type: node.type, error: true, calls };
    }
    if (typeof node.from !== "string" || !isAddress(node.from, { strict: false })
      || typeof node.to !== "string" || !isAddress(node.to, { strict: false })) throw new Error("INVALID_TRACE");
    const amount = node.value ?? (["STATICCALL", "DELEGATECALL"].includes(node.type) ? "0x0" : null);
    if (typeof amount !== "string" || !/^0x[0-9a-f]{1,64}$/i.test(amount)) throw new Error("INVALID_TRACE");
    const result: NormalizedNativeTrace = { type: node.type, from: node.from.toLowerCase(), to: node.to.toLowerCase(), value: amount as Hex, calls };
    if (depth === 0) {
      if (node.type !== "CALL" || typeof node.input !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(node.input) || node.input.length > 524290) throw new Error("INVALID_TRACE");
      result.inputHash = keccak256(node.input as Hex);
    }
    return result;
  };
  const result = visit(input, 0);
  if (result.error) throw new Error("REVERTED_TRACE_ROOT");
  return result;
}
