import type { Address, Hash, Hex } from "viem";
import {
  marketReadSignal,
  marketRequestId,
  resourceError,
  type providerBudget,
} from "./feed-scheduler.js";

export type MarketWordReader = (
  address: Address,
  hash: Hash,
  selectors: Hex[],
  deadline: number,
) => Promise<Hex[]>;

function rpcError(error: { code: number; message?: string }) {
  return Object.assign(
    new Error(
      resourceError(error).pruned
        ? "Historical state unavailable"
        : "Market RPC getter rejected",
    ),
    { code: error.code },
  );
}

async function readReplies(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing market RPC response");
  const bytes = new Uint8Array(16384);
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (size + value.length > bytes.length)
        throw new Error("Oversized market RPC response");
      bytes.set(value, size);
      size += value.length;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
    );
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

// Only the fixed-width getters in the market ABI use this path. One scheduler
// slot covers a bounded JSON-RPC batch on one provider. No cross-provider cache.
export function marketWordReader(
  url: string,
  budget: ReturnType<typeof providerBudget>,
  stop: AbortSignal,
): MarketWordReader {
  const pending = new Map<string, Promise<Hex[]>>();
  async function load(
    address: Address,
    hash: Hash,
    selectors: Hex[],
    deadline: number,
  ) {
    const results = new Map<number, Hex>();
    // A nine-call envelope returned HTTP 413 on the production archive.
    // Serialize small groups through its existing shared provider budget.
    for (let offset = 0; offset < selectors.length; offset += 3) {
      let queued = performance.now();
      await budget.request("eth_call", async () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error("Market read budget expired");
        const calls = selectors
          .slice(offset, offset + 3)
          .map((data, id) => ({
            jsonrpc: "2.0",
            id: offset + id,
            method: "eth_call",
            params: [
              { to: address, data },
              { blockHash: hash, requireCanonical: true },
            ],
          }))
          .filter((call) => !results.has(call.id));
        const started = performance.now();
        try {
          const response = await fetch(url, {
            method: "POST",
            redirect: "error",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(calls.length === 1 ? calls[0] : calls),
            signal: AbortSignal.any([
              stop,
              marketReadSignal.getStore() ?? stop,
              AbortSignal.timeout(Math.min(remaining, 2200)),
            ]),
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw Object.assign(new Error("Market RPC HTTP failure"), {
              status: response.status,
            });
          }
          const raw = await readReplies(response);
          const replies =
            calls.length === 1 && !Array.isArray(raw) ? [raw] : raw;
          if (replies && typeof replies === "object" && "error" in replies) {
            const failure = replies.error as { code: number } | null;
            if (failure && Number.isInteger(failure.code))
              throw rpcError(failure);
          }
          if (!Array.isArray(replies) || replies.length !== calls.length)
            throw new Error("Invalid market batch size");
          const expected = new Set(calls.map((call) => call.id));
          const failures: Error[] = [];
          for (const reply of replies) {
            if (reply?.jsonrpc !== "2.0" || !expected.delete(reply.id))
              throw new Error("Invalid market batch identity");
            if (
              reply.error &&
              !("result" in reply) &&
              Number.isInteger(reply.error.code)
            ) {
              failures.push(rpcError(reply.error));
            } else if (
              !("error" in reply) &&
              typeof reply.result === "string" &&
              /^0x[0-9a-f]{64}$/i.test(reply.result)
            ) {
              results.set(reply.id, reply.result as Hex);
            } else throw new Error("Invalid market getter response");
          }
          // A permanent rejection cannot be masked by a transient sibling.
          if (failures.length)
            throw (
              failures.find((e) => !resourceError(e).transient) ?? failures[0]
            );
        } finally {
          const ended = performance.now();
          console.info(
            JSON.stringify({
              event: "market_rpc_batch",
              requestId: marketRequestId.getStore(),
              provider: budget.provider,
              method: "eth_call",
              blockHash: hash,
              count: calls.length,
              completed: results.size,
              queueMs: Math.round(started - queued),
              wireMs: Math.round(ended - started),
            }),
          );
          queued = ended;
        }
      });
    }
    return selectors.map((_, id) => results.get(id)!);
  }
  return (address, hash, selectors, deadline) => {
    if (!selectors.length || selectors.length > 9)
      throw new Error("Invalid market batch width");
    const key = [address, hash, ...selectors].join("/");
    const existing = pending.get(key);
    if (existing) return existing;
    const request = load(address, hash, selectors, deadline);
    pending.set(key, request);
    return request.finally(() => pending.delete(key));
  };
}
