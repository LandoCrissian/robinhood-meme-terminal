export const PUBLIC_SYNC_DELAY_MESSAGE = "RPC synchronization is temporarily delayed. Serving the last confirmed checkpoint.";
export const LOCAL_SYNC_FAILURE_MESSAGE = "Indexer synchronization is temporarily unavailable.";

export type SyncFailureKind = "upstream" | "local";

type NamedLog = { eventName?: unknown };

export function partitionMarketEventLogs(logs: readonly unknown[]) {
  const trades: unknown[] = [];
  const graduations: unknown[] = [];
  const migrations: unknown[] = [];

  for (const log of logs) {
    const eventName = (log as NamedLog | null)?.eventName;
    switch (eventName) {
      case "Trade":
        trades.push(log);
        break;
      case "Graduated":
        graduations.push(log);
        break;
      case "LiquidityMigrated":
        migrations.push(log);
        break;
      default:
        throw new Error(`Unsupported market event ${String(eventName)}`);
    }
  }

  return { trades, graduations, migrations };
}

export function failureBackoffMs(baseMs: number, consecutiveFailures: number, capMs = 60_000) {
  if (!Number.isSafeInteger(baseMs) || baseMs <= 0) throw new Error("baseMs must be a positive integer");
  if (!Number.isSafeInteger(consecutiveFailures) || consecutiveFailures <= 0) {
    throw new Error("consecutiveFailures must be a positive integer");
  }
  if (!Number.isSafeInteger(capMs) || capMs < baseMs) throw new Error("capMs must be at least baseMs");

  const multiplier = 2 ** Math.min(consecutiveFailures - 1, 16);
  return Math.min(capMs, baseMs * multiplier);
}

type ErrorLike = {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
  name?: unknown;
};

const TRANSIENT_UPSTREAM_ERROR = /(?:too many requests|\b429\b|context deadline exceeded|fetch failed|http request failed|gateway timeout|service unavailable|socket hang up|timed? out|econnreset|enotfound)/i;
const TRANSIENT_UPSTREAM_NAMES = new Set(["HttpRequestError", "TimeoutError", "SocketClosedError"]);

export function classifySyncFailure(error: unknown): SyncFailureKind {
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as ErrorLike;
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) return "local";
    if (typeof candidate.name === "string" && TRANSIENT_UPSTREAM_NAMES.has(candidate.name)) return "upstream";
    if (typeof candidate.message === "string" && TRANSIENT_UPSTREAM_ERROR.test(candidate.message)) return "upstream";
    current = candidate.cause;
  }

  if (typeof current === "string" && TRANSIENT_UPSTREAM_ERROR.test(current)) return "upstream";
  return "local";
}

export function publicSyncState(initialSyncComplete: boolean, failureKind: SyncFailureKind | null) {
  const stale = initialSyncComplete && failureKind === "upstream";
  return {
    available: initialSyncComplete && failureKind !== "local",
    stale,
    publicError: stale ? PUBLIC_SYNC_DELAY_MESSAGE : null
  };
}
