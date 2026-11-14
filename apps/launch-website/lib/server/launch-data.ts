import snapshot from "../../data/historical-launches-4663.json";
import {
  isLaunchAddress, launchDirectoryLimit, robinhoodChainId,
  type HistoricalLaunch, type LaunchBlock, type LaunchDirectoryData, type LaunchReceipt,
} from "../launch-data";

const v4Factory = "0x88b86f10d874c2e3c8cfe63161ffa969f3273cd4";
const v6Factory = "0x8e75c57079a01ce2094bc4187b78710887547651";
export const indexedFreshnessMs = 5 * 60_000;
const responseCacheMs = 30_000;
const feedTimeoutMs = 3_000;
const feedMaxBytes = 64 * 1024;
const maxExactReads = 4;
const maxCachedExactReads = 64;

type Fields = Record<string, unknown>;
type Evidence = Omit<LaunchDirectoryData, "chainId" | "future" | "finality">;
type ReaderOptions = {
  indexerUrl?: string;
  indexerReadToken?: string;
  fetch?: typeof fetch;
  now?: () => number;
  snapshot?: unknown;
};

function requireValue(ok: unknown): asserts ok {
  if (!ok) throw new Error("Unverified historical launch evidence");
}

function record(value: unknown): Fields {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Fields;
}

function quantity(value: unknown): string {
  if (typeof value === "number") requireValue(Number.isSafeInteger(value));
  const normalized = typeof value === "number" ? String(value) : value;
  requireValue(typeof normalized === "string" && /^(0|[1-9][0-9]{0,19})$/.test(normalized));
  return normalized;
}

function hash(value: unknown): string {
  requireValue(typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value));
  return value.toLowerCase();
}

function address(value: unknown): string {
  requireValue(isLaunchAddress(value) && !/^0x0{40}$/i.test(value));
  return value;
}

function label(value: unknown): string {
  requireValue(typeof value === "string" && value.length > 0 && value.length <= 100
    && !/[\p{Cc}\p{Cf}]/u.test(value));
  return value;
}

function timestamp(value: unknown, now: number): string {
  requireValue(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value));
  const ms = Date.parse(value);
  requireValue(ms >= Date.UTC(2025, 0, 1) && ms <= now + 60_000);
  return new Date(ms).toISOString();
}

function block(row: Fields, now: number): LaunchBlock {
  return {
    blockNumber: quantity(row.blockNumber),
    blockHash: hash(row.blockHash),
    timestamp: timestamp(row.timestamp, now),
  };
}

function assertInCheckpoint(earlier: LaunchBlock, checkpoint: LaunchBlock) {
  requireValue(BigInt(earlier.blockNumber) <= BigInt(checkpoint.blockNumber)
    && earlier.timestamp <= checkpoint.timestamp
    && (earlier.blockNumber !== checkpoint.blockNumber || earlier.blockHash === checkpoint.blockHash));
}

function receipt(row: Fields, now: number): LaunchReceipt {
  requireValue(typeof row.logIndex === "number" && Number.isSafeInteger(row.logIndex) && row.logIndex >= 0);
  return { ...block(row, now), transactionHash: hash(row.transactionHash), logIndex: row.logIndex };
}

function distinct(rows: HistoricalLaunch[]) {
  const tokens = new Set<string>();
  const logs = new Set<string>();
  const registrations = new Set<string>();
  for (const row of rows) {
    const token = row.token.toLowerCase();
    const log = row.receipt.transactionHash + ":" + row.receipt.logIndex;
    const launch = row.factory.toLowerCase() + ":" + row.launchId;
    requireValue(!tokens.has(token) && !logs.has(log) && !registrations.has(launch));
    tokens.add(token);
    logs.add(log);
    registrations.add(launch);
  }
}

function parseLaunch(row: Fields, evidence: LaunchBlock, now: number, fromIndex: boolean): HistoricalLaunch {
  const version = fromIndex ? 6 : row.version;
  requireValue((fromIndex || row.kind === "historical-rmt") && (version === 4 || version === 6));
  const factory = fromIndex ? v6Factory : address(row.factory);
  requireValue(factory.toLowerCase() === (version === 4 ? v4Factory : v6Factory));
  const registered = receipt(record(fromIndex ? row.registration : row.receipt), now);
  assertInCheckpoint(registered, evidence);
  const lifecycle = row.lifecycle;
  requireValue(lifecycle === "curve" || lifecycle === "graduated" || lifecycle === "unknown");
  const position = fromIndex ? row.lifecycleEvidence : row.lifecycleAt;
  const lifecycleAt = position === null ? null : (fromIndex ? receipt : block)(record(position), now);
  requireValue((lifecycle === "unknown") === (lifecycleAt === null));
  if (lifecycleAt) {
    assertInCheckpoint(registered, lifecycleAt);
    assertInCheckpoint(lifecycleAt, evidence);
  }
  const classification = fromIndex ? "historical" : row.classification;
  requireValue(classification === "historical" || classification === "retired" || classification === "deployment-test");
  return {
    kind: "historical-rmt", classification, version, factory,
    token: address(row.token), market: address(fromIndex ? row.curve : row.market),
    launchId: quantity(row.launchId), creator: row.creator === null ? null : address(row.creator),
    name: label(row.name), symbol: label(row.symbol), receipt: registered, lifecycle, lifecycleAt,
    reservedPoolId: fromIndex || row.reservedPoolId === null ? null : hash(row.reservedPoolId),
  };
}

function readCheckedSnapshot(input: unknown, now: number): Evidence {
  const data = record(input);
  requireValue(data.schemaVersion === 1 && data.chainId === robinhoodChainId
    && typeof data.completeForPinnedFactories === "boolean" && Array.isArray(data.launches) && data.launches.length <= launchDirectoryLimit);
  const observedAt = timestamp(data.observedAt, now);
  const checkpoint = block(record(data.verificationBlock), now);
  requireValue(checkpoint.timestamp <= observedAt);
  const launches = data.launches.map((row) => parseLaunch(record(row), checkpoint, now, false));
  distinct(launches);
  return { coverage: "verified-snapshot", status: "stale", checkpoint, observedAt, launches, truncated: !data.completeForPinnedFactories };
}

function readIndexedEvidence(input: unknown, now: number, token?: string): Evidence {
  const data = record(input);
  requireValue(data.schemaVersion === 1 && data.chainId === robinhoodChainId && data.factory === v6Factory
    && Array.isArray(data.launches) && data.launches.length <= (token ? 1 : launchDirectoryLimit));
  const checkpointFields = record(data.checkpoint);
  const checkpoint = block(checkpointFields, now);
  const observedAt = timestamp(checkpointFields.observedAt, now);
  requireValue(checkpoint.timestamp <= observedAt && typeof checkpointFields.stale === "boolean"
    && checkpointFields.finality === "l2-confirmed");
  const launches = data.launches.map((row) => parseLaunch(record(row), checkpoint, now, true));
  distinct(launches);
  requireValue(!token || launches.every((launch) => launch.token.toLowerCase() === token));
  requireValue(data.nextCursor === null || (!token && typeof data.nextCursor === "string" && data.nextCursor.length <= 512));
  const stale = checkpointFields.stale || now - Date.parse(checkpoint.timestamp) > indexedFreshnessMs;
  return { coverage: "v6-indexed", status: stale ? "stale" : "ready", checkpoint, observedAt, launches, truncated: data.nextCursor !== null };
}

function mergeEvidence(indexed: Evidence, archived: Evidence, token?: string): Evidence {
  const archivedV6 = archived.launches.filter((row) => row.version === 6 && (!token || row.token.toLowerCase() === token));
  const indexedCheckpoint = indexed.checkpoint;
  const archivedCheckpoint = archived.checkpoint;
  requireValue(indexedCheckpoint && archivedCheckpoint);
  assertInCheckpoint(archivedCheckpoint, indexedCheckpoint);
  const launches = indexed.launches.map((row) => {
    const older = archivedV6.find((item) => item.token.toLowerCase() === row.token.toLowerCase());
    if (!older) {
      requireValue(!archivedV6.some((item) => item.launchId === row.launchId)
        && BigInt(row.receipt.blockNumber) > BigInt(archivedCheckpoint.blockNumber));
      return row;
    }
    requireValue(older.market.toLowerCase() === row.market.toLowerCase()
      && older.receipt.transactionHash === row.receipt.transactionHash
      && older.receipt.logIndex === row.receipt.logIndex && older.receipt.blockHash === row.receipt.blockHash
      && older.receipt.blockNumber === row.receipt.blockNumber && older.receipt.timestamp === row.receipt.timestamp
      && older.launchId === row.launchId && older.creator?.toLowerCase() === row.creator?.toLowerCase()
      && older.name === row.name && older.symbol === row.symbol
      && (row.lifecycleAt === null || older.lifecycleAt === null ||
        BigInt(row.lifecycleAt.blockNumber) > BigInt(older.lifecycleAt.blockNumber)));
    return { ...row, classification: older.classification, reservedPoolId: older.reservedPoolId,
      ...(row.lifecycle === "unknown" && older.lifecycle !== "unknown"
        ? { lifecycle: older.lifecycle, lifecycleAt: older.lifecycleAt } : {}) };
  });
  if (!indexed.truncated) {
    requireValue(archivedV6.every((item) => launches.some((row) => row.token.toLowerCase() === item.token.toLowerCase())));
  }
  launches.push(...archived.launches.filter((row) => row.version === 4 && (!token || row.token.toLowerCase() === token)));
  distinct(launches);
  return { ...indexed, launches, truncated: indexed.truncated || launches.length > launchDirectoryLimit };
}

function getFeedUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return new URL("/historical-launches", url);
  } catch {
    return null;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  requireValue(response.ok && response.headers.get("content-type")?.split(";")[0] === "application/json"
    && response.body && Number(response.headers.get("content-length")) <= feedMaxBytes);
  const reader = response.body.getReader();
  const buffer = new Uint8Array(feedMaxBytes);
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      requireValue(bytes + value.byteLength <= feedMaxBytes);
      buffer.set(value, bytes);
      bytes += value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytes)));
}

const unavailable: Evidence = {
  status: "unavailable", coverage: "verified-snapshot", checkpoint: null, observedAt: null, launches: [], truncated: false,
};

export function createLaunchDirectoryReader(options: ReaderOptions) {
  const now = options.now ?? Date.now;
  const fetchFeed = options.fetch ?? fetch;
  const feed = getFeedUrl(options.indexerUrl);
  const credential = options.indexerReadToken;
  const input = options.snapshot === undefined ? snapshot : options.snapshot;
  let cachedList: { evidence: Evidence | null; expiresAt: number } | undefined;
  let pendingList: Promise<Evidence | null> | undefined;
  const pendingExact = new Map<string, Promise<Evidence | null>>();
  const cachedExact = new Map<string, { evidence: Evidence | null; expiresAt: number }>();

  async function fetchIndex(archived: Evidence, token?: string): Promise<Evidence | null> {
    if (!feed || !credential || !/^[\x21-\x7e]{1,512}$/.test(credential)) return null;
    const url = new URL(feed);
    if (token) url.searchParams.set("token", token);
    else url.searchParams.set("limit", String(launchDirectoryLimit));
    try {
      const response = await fetchFeed(url, {
        headers: { Accept: "application/json", Authorization: "Bearer " + credential },
        redirect: "error", cache: "no-store", signal: AbortSignal.timeout(feedTimeoutMs),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        return null;
      }
      return mergeEvidence(readIndexedEvidence(await readBoundedJson(response), now(), token), archived, token);
    } catch {
      return null;
    }
  }

  async function getList(archived: Evidence): Promise<Evidence | null> {
    if (cachedList && cachedList.expiresAt > now()) return cachedList.evidence;
    pendingList ??= fetchIndex(archived).then((evidence) => {
      cachedList = { evidence, expiresAt: now() + responseCacheMs };
      pendingList = undefined;
      return evidence;
    });
    return pendingList;
  }

  function getExact(archived: Evidence, token: string, checkpoint: LaunchBlock) {
    // A new list checkpoint may invalidate both a missing token and a prior registration.
    const key = checkpoint.blockHash + ":" + token;
    const cached = cachedExact.get(key);
    if (cached && cached.expiresAt > now()) return cached.evidence;
    const pending = pendingExact.get(key);
    if (pending) return pending;
    if (pendingExact.size >= maxExactReads) return null;
    const request = fetchIndex(archived, token).then((result) => {
      let evidence = result;
      if (evidence?.checkpoint) {
        try {
          assertInCheckpoint(checkpoint, evidence.checkpoint);
        } catch {
          evidence = null;
        }
      }
      cachedExact.delete(key);
      cachedExact.set(key, { evidence, expiresAt: now() + responseCacheMs });
      if (cachedExact.size > maxCachedExactReads) {
        const oldest = cachedExact.keys().next().value;
        if (oldest) cachedExact.delete(oldest);
      }
      return evidence;
    }).finally(() => pendingExact.delete(key));
    pendingExact.set(key, request);
    return request;
  }

  return async function readDirectory(inputToken?: string): Promise<LaunchDirectoryData> {
    const token = isLaunchAddress(inputToken) ? inputToken.toLowerCase() : undefined;
    let evidence = unavailable;
    if (!inputToken || token) {
      try {
        const archived = readCheckedSnapshot(input, now());
        const current = await getList(archived);
        if (token && current?.checkpoint && current.truncated && !current.launches.some((row) => row.token.toLowerCase() === token)) {
          const exact = await getExact(archived, token, current.checkpoint);
          const knownHistorically = archived.launches.some((row) => row.token.toLowerCase() === token);
          evidence = exact ?? (knownHistorically ? archived : unavailable);
        } else {
          evidence = current ?? archived;
        }
      } catch {
        // Do not publish data without a validated review snapshot.
      }
    }
    const launches = evidence.launches
      .filter((row) => !token || row.token.toLowerCase() === token)
      .sort((a, b) => Number(BigInt(b.receipt.blockNumber) - BigInt(a.receipt.blockNumber)))
      .slice(0, launchDirectoryLimit);
    const status = evidence.status === "ready" && evidence.checkpoint
      && now() - Date.parse(evidence.checkpoint.timestamp) >= indexedFreshnessMs ? "stale" : evidence.status;
    return { ...evidence, status, launches, chainId: robinhoodChainId, future: "prelaunch", finality: "l1-unverified" };
  };
}

export const readLaunchDirectory = createLaunchDirectoryReader({
  indexerUrl: process.env.RMT_LAUNCH_HISTORY_INDEXER_URL,
  indexerReadToken: process.env.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN,
});
