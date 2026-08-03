import { getAddress, isAddress } from "viem";
import {
  externalTradeSnapshotSignature,
  externalTradesRequestUrl,
  parseExternalPoolTrades,
  type ExternalPoolTradesPayload
} from "../../../../lib/external-trades";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const encoder = new TextEncoder();
const STREAM_INTERVAL_MS = 6_000;
const STREAM_LIFETIME_MS = 45_000;
const HEARTBEAT_INTERVAL_MS = 8_000;

function event(name: string, value: unknown) {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(value)}\n\n`);
}

function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      signal.removeEventListener("abort", abort);
      clearTimeout(timeout);
      resolve();
    };
    const abort = () => finish();
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function confirmedTradeSnapshot(token: string, pair: string) {
  const response = await fetch(externalTradesRequestUrl(pair, token), {
    headers: { Accept: "application/json" },
    next: { revalidate: STREAM_INTERVAL_MS / 1_000 },
    signal: AbortSignal.timeout(7_000)
  });
  if (!response.ok) throw new Error("Trade source unavailable.");
  const payload: ExternalPoolTradesPayload = {
    token: getAddress(token),
    pair: getAddress(pair),
    source: "GeckoTerminal",
    updatedAt: new Date().toISOString(),
    trades: parseExternalPoolTrades(await response.json(), token, 20)
  };
  return payload;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const pair = url.searchParams.get("pair") ?? "";
  if (!isAddress(token) || !isAddress(pair)) {
    return Response.json({ error: "Invalid live market stream request." }, { status: 400 });
  }

  const controller = new AbortController();
  const stop = () => controller.abort();
  request.signal.addEventListener("abort", stop, { once: true });
  const stream = new ReadableStream<Uint8Array>({
    start(output) {
      void (async () => {
        const startedAt = Date.now();
        let lastSignature = "";
        let lastHeartbeatAt = 0;
        output.enqueue(encoder.encode(`retry: 1000\n\n`));
        try {
          while (!controller.signal.aborted && Date.now() - startedAt < STREAM_LIFETIME_MS) {
            try {
              const payload = await confirmedTradeSnapshot(token, pair);
              const signature = externalTradeSnapshotSignature(payload);
              if (signature !== lastSignature) {
                output.enqueue(event("snapshot", payload));
                lastSignature = signature;
                lastHeartbeatAt = Date.now();
              } else if (Date.now() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
                output.enqueue(event("heartbeat", { at: new Date().toISOString() }));
                lastHeartbeatAt = Date.now();
              }
            } catch {
              output.enqueue(event("upstream-delay", { at: new Date().toISOString() }));
            }
            await delay(STREAM_INTERVAL_MS, controller.signal);
          }
          if (!controller.signal.aborted) {
            output.enqueue(event("rotate", { at: new Date().toISOString() }));
          }
        } finally {
          request.signal.removeEventListener("abort", stop);
          if (!controller.signal.aborted) output.close();
        }
      })();
    },
    cancel() {
      controller.abort();
      request.signal.removeEventListener("abort", stop);
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
