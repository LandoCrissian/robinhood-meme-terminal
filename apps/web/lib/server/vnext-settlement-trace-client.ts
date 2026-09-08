import { normalizeNativeTrace, type NormalizedNativeTrace } from "../vnext/normalized-native-trace";

if (typeof window !== "undefined") throw new Error("Settlement trace transport is server-only.");
const MAX_BYTES = 1024 * 1024;
const HASH = /^0x[0-9a-f]{64}$/i;
export type SettlementTraceResult = { status: "available"; txHash: string; blockHash: string; trace: NormalizedNativeTrace }
  | { status: "unavailable"; reason: "NOT_CONFIGURED" | "INVALID_HASH" | "RPC_OR_TRACE_UNAVAILABLE" };

// Resource and duplicate-key validation happens before parsing the full JSON.
// Strings are scanned as strings, so braces in provider text cannot bypass limits.
function validateJsonBounds(text: string) {
  const stack: { kind: string; keys: Set<string> }[] = [];
  let objects = 0;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === '"') {
      const start = i++;
      for (; i < text.length; i++) {
        if (text[i] === "\\") { i++; continue; }
        if (text[i] === '"') break;
      }
      if (i >= text.length) throw new Error();
      let next = i + 1; while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] === ":") {
        const parent = stack.at(-1);
        if (parent?.kind !== "{") throw new Error();
        const key = JSON.parse(text.slice(start, i + 1)) as string;
        if (parent.keys.has(key)) throw new Error();
        parent.keys.add(key);
      }
    } else if (character === "{" || character === "[") {
      if (character === "{" && ++objects > 8192) throw new Error();
      stack.push({ kind: character, keys: new Set() });
      if (stack.length > 132) throw new Error();
    } else if (character === "}" || character === "]") {
      if (stack.pop()?.kind !== (character === "}" ? "{" : "[")) throw new Error();
    }
  }
  if (stack.length) throw new Error();
}
export async function readBoundedSettlementJson(response: Pick<Response, "headers" | "body">, limit = MAX_BYTES): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error();
  const reader = response.body?.getReader(); if (!reader) throw new Error();
  let size = 0, text = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength; if (size > limit) throw new Error();
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode(); validateJsonBounds(text);
    return JSON.parse(text);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Factory is a test seam only. Its returned client accepts a hash, not methods,
 * URLs, accounts, or transaction payloads. No generic RPC proxy is exposed. */
export function createSettlementTraceClient(options: { endpoint?: string; fetch?: typeof fetch; timeoutMs?: number } = {}) {
  return async (txHash: string): Promise<SettlementTraceResult> => {
    if (!HASH.test(txHash)) return { status: "unavailable", reason: "INVALID_HASH" };
    const endpoint = options.endpoint ?? process.env.RMT_SETTLEMENT_TRACE_RPC_URL?.trim();
    if (!endpoint) return { status: "unavailable", reason: "NOT_CONFIGURED" };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error();
      const rpc = async (method: "eth_chainId" | "eth_getTransactionReceipt" | "debug_traceTransaction", params: unknown[], id: number) => {
        if (controller.signal.aborted) throw new Error();
        const response = await (options.fetch ?? fetch)(endpoint, { method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" }, signal: controller.signal,
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
        if (!response.ok) { await response.body?.cancel(); throw new Error(); }
        const body = await readBoundedSettlementJson(response);
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        const message = body as Record<string, unknown>;
        if (message.jsonrpc !== "2.0" || message.id !== id || "error" in message || !("result" in message)
          || Object.keys(message).some(key => !["jsonrpc", "id", "result"].includes(key))) throw new Error();
        return message.result;
      };
      const receiptBlock = (value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
        const receipt = value as Record<string, unknown>;
        if (typeof receipt.transactionHash !== "string" || receipt.transactionHash.toLowerCase() !== txHash.toLowerCase()
          || receipt.status !== "0x1" || typeof receipt.blockHash !== "string" || !HASH.test(receipt.blockHash)) throw new Error();
        return receipt.blockHash.toLowerCase();
      };
      const work = async (): Promise<SettlementTraceResult> => {
        if (await rpc("eth_chainId", [], 1) !== "0x1237") throw new Error();
        const blockHash = receiptBlock(await rpc("eth_getTransactionReceipt", [txHash], 2));
        const trace = normalizeNativeTrace(await rpc("debug_traceTransaction", [txHash, { tracer: "callTracer", timeout: "5s" }], 3));
        if (receiptBlock(await rpc("eth_getTransactionReceipt", [txHash], 4)) !== blockHash) throw new Error();
        return { status: "available", txHash: txHash.toLowerCase(), blockHash, trace };
      };
      return await Promise.race([work(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error()); }, Math.min(options.timeoutMs ?? 8000, 8000));
      })]);
    } catch { return { status: "unavailable", reason: "RPC_OR_TRACE_UNAVAILABLE" }; }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
}
export const readSettlementTrace = createSettlementTraceClient();
