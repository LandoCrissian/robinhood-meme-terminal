import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as wait } from "node:timers/promises";
import { custom, http } from "viem";

export function boundedSetting(
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (
    (raw !== undefined && !/^\d+$/.test(raw)) ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

// The advisory lease belongs to one PostgreSQL session. Never interleave its transactions.
export function serializedWriter() {
  let tail: Promise<void> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export const rpcFeed = new AsyncLocalStorage<
  "activity" | "registration" | "historical" | "market"
>();

function boundedLogRange(method: string, params: unknown) {
  if (method !== "eth_getLogs" || !Array.isArray(params) || params.length !== 1) return false;
  const filter = params[0];
  const quantity = /^0x(?:0|[1-9a-f][0-9a-f]{0,15})$/i;
  if (typeof filter?.fromBlock !== "string" || typeof filter.toBlock !== "string" ||
      !quantity.test(filter.fromBlock) || !quantity.test(filter.toBlock)) return false;
  const size = BigInt(filter.toBlock) - BigInt(filter.fromBlock) + 1n;
  return size > 0n && size <= 2000n;
}

export function resourceError(error: unknown, boundedLogs = false) {
  const seen = new Set<unknown>();
  let status: number | undefined,
    code: number | undefined,
    timeout = false,
    missingBlock = false,
    rangeMessage = false;
  for (
    let cause = error;
    cause && typeof cause === "object" && !seen.has(cause);

  ) {
    seen.add(cause);
    const e = cause as {
      status?: number;
      code?: number;
      name?: string;
      details?: string;
      message?: string;
      cause?: unknown;
    };
    if (Number.isInteger(e.status)) status = e.status;
    if (typeof e.code === "number" && e.code < 0) code = e.code;
    timeout ||= e.name === "TimeoutError" || e.name === "TimeoutRpcError";
    missingBlock ||= e.name === "ProviderBlockUnavailable";
    rangeMessage ||= e.details === "invalid block range params" || e.message === "invalid block range params";
    cause = e.cause;
  }
  const deferredRange = boundedLogs && rangeMessage && code === -32000;
  return {
    status,
    code,
    timeout,
    missingBlock,
    deferredRange,
    transient:
      timeout || deferredRange || missingBlock ||
      status === 408 ||
      status === 429 ||
      (status !== undefined && status >= 500) ||
      code === -32002 ||
      code === -32005,
  };
}

// A single in-flight wire request per provider covers every feed, including retries.
// Release the slot during cooldown, and service foreground reads first after it expires.
export function providerBudget(
  provider: string,
  spacingMs: number,
  random = Math.random,
) {
  const foreground: Array<() => void> = [],
    background: Array<() => void> = [];
  let active = false,
    next = 0,
    foregroundTurns = 0;
  const stats = { attempts: 0, limited: 0, retries: 0, timeouts: 0, errors: 0 };
  function wake() {
    if (active) return;
    const low =
      background.length && (!foreground.length || foregroundTurns >= 8);
    const release = (low ? background : foreground).shift();
    if (!release) return;
    foregroundTurns = low ? 0 : foregroundTurns + 1;
    active = true;
    release();
  }
  async function request<T>(method: string, send: () => Promise<T>, params?: unknown) {
    const feed = rpcFeed.getStore() ?? "historical";
    for (let attempt = 0; ; attempt++) {
      await new Promise<void>((resolve) => {
        (feed === "activity" ? background : foreground).push(resolve);
        wake();
      });
      try {
        await wait(Math.max(0, next - performance.now()));
        next = performance.now() + spacingMs;
        stats.attempts++;
        return await send();
      } catch (error) {
        const failure = resourceError(error, boundedLogRange(method, params));
        stats.errors++;
        if (failure.status === 429 || failure.code === -32005) stats.limited++;
        if (failure.timeout) stats.timeouts++;
        const retry = failure.transient && attempt < 1;
        if (failure.transient)
          next = Math.max(
            next,
            performance.now() +
              Math.round(1000 * 2 ** attempt * (1 + random())),
          );
        if (retry) stats.retries++;
        console.warn(
          JSON.stringify({
            event: "indexer_rpc_error",
            provider,
            feed,
            method,
            attempt: attempt + 1,
            httpStatus: failure.status,
            rpcCode: failure.code,
            timeout: failure.timeout,
            ...(failure.missingBlock && { reason: "numbered_block_unavailable" }),
            ...(failure.deferredRange && { reason: "valid_log_range_unavailable" }),
            retry,
          }),
        );
        if (!retry) {
          if (failure.deferredRange) {
            const unavailable = new Error("Provider could not serve the checked log range", { cause: error });
            unavailable.name = "UpstreamLogRangeUnavailable";
            throw unavailable;
          }
          throw error;
        }
      } finally {
        active = false;
        wake();
      }
    }
  }
  return { request, stats };
}

export function scheduledTransport(
  url: string,
  budget: ReturnType<typeof providerBudget>,
  signal: AbortSignal,
) {
  const wire = http(url, { retryCount: 0, timeout: 6_000 })({});
  return custom(
    {
      request: (args) =>
        budget.request(args.method, async () => {
          signal.throwIfAborted();
          const result = await wire.request(args, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
          });
          // A load-balanced provider can report a confirmed head and then route
          // its numbered header read to a backend that has not indexed it yet.
          if (result === null && args.method === "eth_getBlockByNumber" &&
              Array.isArray(args.params) && /^0x[0-9a-f]+$/i.test(args.params[0])) {
            const error = new Error("Provider did not return the requested numbered block");
            error.name = "ProviderBlockUnavailable";
            throw error;
          }
          return result;
        }, args.params),
    },
    { retryCount: 0 },
  );
}
