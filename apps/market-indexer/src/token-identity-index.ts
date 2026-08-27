import { gunzipSync, gzipSync } from "node:zlib";
import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  type Address,
  type Hex,
  type PublicClient
} from "viem";
import type { Pool, QueryResult } from "pg";

const ZERO_ADDRESS_BYTES = Buffer.alloc(20);
const ROBINHOOD_MULTICALL3 = getAddress("0xcA11bde05977b3631167028862bE2a173976CA11");
// Robinhood Chain's public eth_call gas ceiling rejects larger aggregate3
// identity reads. Five identities (20 calls) stays below the observed ceiling.
const IDENTITIES_PER_MULTICALL = 5;
const MAX_CONCURRENT_IDENTITY_MULTICALLS = 2;
export const CANONICAL_TOKEN_SCAN_PAGE_SIZE = 5_000;
export const CATALOG_RECONCILIATION_INTERVAL_MS = 6 * 60 * 60_000;
export const CATALOG_RECONCILIATION_RETRY_BASE_MS = 30 * 60_000;
export const CATALOG_RECONCILIATION_RETRY_MAX_MS = 6 * 60 * 60_000;
const RETRY_ERROR_AFTER_MS = 15 * 60_000;
const MAXIMUM_SHARD_BYTES = 8 * 1024 * 1024;
const ADDRESS_PATTERN = /^[0-9a-f]{40}$/;

type ReadyStoredIdentity = readonly [
  address: string,
  status: "r",
  name: string,
  symbol: string,
  decimals: number
];
type StoredIdentity = readonly [address: string, status: "i"] | ReadyStoredIdentity;
type IdentityRead =
  | { status: "success"; result: unknown }
  | { status: "failure"; error: unknown };

type TokenIdentityIndexStats = Readonly<{
  totalCanonicalMarkets: number;
  totalUniqueCanonicalTokens: number;
  totalVerifiedErc20Identities: number;
  indexedSearchTokenIdentities: number;
  unresolvedTokenIdentities: number;
  complete: boolean;
}>;

export type TokenIdentityReconciliationStatus = Readonly<{
  status: "pending" | "running" | "ready" | "delayed";
  pageSize: number;
  rowsScanned: number;
  pagesScanned: number;
  uniqueCandidateTokens: number;
  lastDurationMs: number | null;
  lastSuccessfulAt: string | null;
  nextReconciliationAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}>;

type MutableReconciliationStatus = {
  status: TokenIdentityReconciliationStatus["status"];
  rowsScanned: number;
  pagesScanned: number;
  uniqueCandidateTokens: number;
  lastDurationMs: number | null;
  lastSuccessfulAt: number | null;
  nextReconciliationAt: number;
  consecutiveFailures: number;
  lastError: string | null;
};

type IdentityIndexState = {
  shards: Map<number, Map<string, StoredIdentity>>;
  readyIdentities: Map<string, ReadyStoredIdentity>;
  canonicalTokens: Set<string> | null;
  pendingByShard: Map<number, string[]>;
  retryAfter: Map<string, number>;
  reconciliation: MutableReconciliationStatus;
  stats: TokenIdentityIndexStats;
};

const states = new WeakMap<Pool, Promise<IdentityIndexState>>();

function cleanIdentityText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
  return clean || null;
}

function isTransientReadFailure(error: unknown) {
  const descriptions: string[] = [];
  let current = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== "object") {
      descriptions.push(String(current));
      break;
    }
    const record = current as Record<string, unknown>;
    for (const field of ["name", "message", "shortMessage", "details"]) {
      if (typeof record[field] === "string") descriptions.push(record[field]);
    }
    const status = Number(record.status ?? record.statusCode);
    if (status === 408 || status === 425 || status === 429 || status >= 500) return true;
    current = record.cause;
  }
  return /network|fetch failed|timeout|timed out|rate.?limit|\b429\b|\b50[0-9]\b|socket|connection/i.test(
    descriptions.join(" ")
  );
}

async function readIdentityIndividually(rpc: PublicClient, address: Address, blockNumber: bigint) {
  const read = async (functionName: "name" | "symbol" | "decimals" | "totalSupply") => {
    const response = await rpc.call({
      to: address,
      data: encodeFunctionData({ abi: erc20Abi, functionName }),
      blockNumber,
      gas: 100_000n
    });
    if (!response.data) throw new Error(`token identity ${functionName} returned no data`);
    return decodeFunctionResult({ abi: erc20Abi, functionName, data: response.data });
  };
  const reads = await Promise.allSettled([
    read("name"),
    read("symbol"),
    read("decimals"),
    read("totalSupply")
  ]);
  if (reads.some((read) => read.status === "rejected" && isTransientReadFailure(read.reason))) {
    throw new Error("token identity fallback encountered a transient RPC failure");
  }
  return reads.map((read) => read.status === "fulfilled"
    ? { status: "success" as const, result: read.value }
    : { status: "failure" as const, error: read.reason });
}

export function normalizeTokenIdentitySearch(value: string) {
  const normalized = value.trim().replace(/^\$/, "").replace(/\s+/g, " ").toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, "");
  return {
    normalized,
    compact,
    singular: compact.length > 1 && compact.endsWith("s")
      ? compact.slice(0, -1)
      : compact
  };
}

function parseStoredIdentity(value: unknown): StoredIdentity {
  if (!Array.isArray(value) || !ADDRESS_PATTERN.test(String(value[0]))) {
    throw new Error("token identity shard contains an invalid address");
  }
  if (value[1] === "i" && value.length === 2) return [String(value[0]), "i"];
  const name = cleanIdentityText(value[2], 80);
  const symbol = cleanIdentityText(value[3], 20);
  const decimals = value[4];
  if (value[1] !== "r" || value.length !== 5 || !name || !symbol ||
      typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("token identity shard contains malformed ERC20 evidence");
  }
  return [String(value[0]), "r", name, symbol, decimals];
}

async function loadState(pool: Pool): Promise<IdentityIndexState> {
  const [shardResult, catalogResult] = await Promise.all([
    pool.query<{ shard: number; payload: Buffer }>(
      "SELECT shard,payload FROM market_token_identity_shard ORDER BY shard"
    ),
    pool.query<{
      total_canonical_markets: number;
      total_unique_tokens: number;
      evaluated_tokens: number;
      verified_tokens: number;
      complete: boolean;
    }>(`SELECT total_canonical_markets,total_unique_tokens,evaluated_tokens,verified_tokens,complete
        FROM market_token_identity_catalog_state WHERE singleton=TRUE`)
  ]);
  const shards = new Map<number, Map<string, StoredIdentity>>();
  const readyIdentities = new Map<string, ReadyStoredIdentity>();
  let loadedEntries = 0;
  let loadedVerified = 0;
  for (const row of shardResult.rows) {
    if (!Number.isInteger(row.shard) || row.shard < 0 || row.shard > 255 || row.payload.length > MAXIMUM_SHARD_BYTES) {
      throw new Error("token identity shard metadata is invalid");
    }
    const decoded = JSON.parse(gunzipSync(row.payload).toString("utf8")) as unknown;
    if (!Array.isArray(decoded)) throw new Error("token identity shard payload is invalid");
    const shard = new Map<string, StoredIdentity>();
    for (const value of decoded) {
      const identity = parseStoredIdentity(value);
      const key = `0x${identity[0]}`;
      if (Number.parseInt(key.slice(2, 4), 16) !== row.shard || shard.has(key)) {
        throw new Error("token identity shard partition is invalid");
      }
      shard.set(key, identity);
      loadedEntries += 1;
      if (identity[1] === "r") {
        readyIdentities.set(key, identity);
        loadedVerified += 1;
      }
    }
    shards.set(row.shard, shard);
  }
  const catalog = catalogResult.rows[0];
  const totalUniqueCanonicalTokens = catalog?.total_unique_tokens ?? 0;
  const evaluated = Math.min(catalog?.evaluated_tokens ?? 0, loadedEntries, totalUniqueCanonicalTokens);
  const verified = Math.min(catalog?.verified_tokens ?? 0, loadedVerified, evaluated);
  return {
    shards,
    readyIdentities,
    canonicalTokens: null,
    pendingByShard: new Map(),
    retryAfter: new Map(),
    reconciliation: {
      status: "pending",
      rowsScanned: 0,
      pagesScanned: 0,
      uniqueCandidateTokens: 0,
      lastDurationMs: null,
      lastSuccessfulAt: null,
      nextReconciliationAt: 0,
      consecutiveFailures: 0,
      lastError: null
    },
    stats: {
      totalCanonicalMarkets: catalog?.total_canonical_markets ?? 0,
      totalUniqueCanonicalTokens,
      totalVerifiedErc20Identities: verified,
      indexedSearchTokenIdentities: verified,
      unresolvedTokenIdentities: Math.max(totalUniqueCanonicalTokens - evaluated, 0),
      complete: catalog?.complete === true && evaluated === totalUniqueCanonicalTokens
    }
  };
}

function stateFor(pool: Pool) {
  const existing = states.get(pool);
  if (existing) return existing;
  const created = loadState(pool);
  states.set(pool, created);
  return created;
}

async function persistShard(pool: Pool, shardNumber: number, shard: Map<string, StoredIdentity>) {
  const stored = [...shard.values()].sort((a, b) => a[0].localeCompare(b[0]));
  const payload = gzipSync(Buffer.from(JSON.stringify(stored), "utf8"), { level: 9 });
  if (payload.length > MAXIMUM_SHARD_BYTES) throw new Error(`token identity shard ${shardNumber} exceeds its bound`);
  const verified = stored.filter((entry) => entry[1] === "r").length;
  await pool.query(
    `INSERT INTO market_token_identity_shard(shard,payload,entry_count,verified_count,updated_at)
     VALUES($1,$2,$3,$4,NOW())
     ON CONFLICT(shard) DO UPDATE SET payload=EXCLUDED.payload,entry_count=EXCLUDED.entry_count,
       verified_count=EXCLUDED.verified_count,updated_at=NOW()`,
    [shardNumber, payload, stored.length, verified]
  );
}

async function persistStats(pool: Pool, stats: TokenIdentityIndexStats) {
  const evaluated = stats.totalUniqueCanonicalTokens - stats.unresolvedTokenIdentities;
  await pool.query(
    `INSERT INTO market_token_identity_catalog_state(
       singleton,total_canonical_markets,total_unique_tokens,evaluated_tokens,verified_tokens,complete,observed_at)
     VALUES(TRUE,$1,$2,$3,$4,$5,NOW())
     ON CONFLICT(singleton) DO UPDATE SET total_canonical_markets=EXCLUDED.total_canonical_markets,
       total_unique_tokens=EXCLUDED.total_unique_tokens,evaluated_tokens=EXCLUDED.evaluated_tokens,
       verified_tokens=EXCLUDED.verified_tokens,complete=EXCLUDED.complete,observed_at=NOW()`,
    [stats.totalCanonicalMarkets, stats.totalUniqueCanonicalTokens, evaluated,
      stats.totalVerifiedErc20Identities, stats.complete]
  );
}

type CanonicalMarketTokenRow = {
  source_code: number;
  pool_key: Buffer;
  token0: Buffer;
  token1: Buffer;
};

function canonicalTokenAddress(value: Buffer) {
  if (!Buffer.isBuffer(value) || value.length !== 20) {
    throw new Error("canonical token reconciliation received an invalid token address");
  }
  return value.equals(ZERO_ADDRESS_BYTES) ? null : `0x${value.toString("hex")}`;
}

async function scanCanonicalTokensByPrimaryKey(pool: Pool) {
  const canonicalTokens = new Set<string>();
  let rowsScanned = 0;
  let pagesScanned = 0;
  let previousSource: number | null = null;
  let previousPoolKey: Buffer | null = null;
  while (true) {
    const result: QueryResult<CanonicalMarketTokenRow> = previousSource === null
      ? await pool.query<CanonicalMarketTokenRow>(
          `SELECT source_code,pool_key,token0,token1
           FROM market_pools
           ORDER BY source_code,pool_key
           LIMIT $1`,
          [CANONICAL_TOKEN_SCAN_PAGE_SIZE]
        )
      : await pool.query<CanonicalMarketTokenRow>(
          `SELECT source_code,pool_key,token0,token1
           FROM market_pools
           WHERE (source_code,pool_key) > ($1::smallint,$2::bytea)
           ORDER BY source_code,pool_key
           LIMIT $3`,
          [previousSource, previousPoolKey, CANONICAL_TOKEN_SCAN_PAGE_SIZE]
        );
    if (result.rows.length === 0) break;
    if (result.rows.length > CANONICAL_TOKEN_SCAN_PAGE_SIZE) {
      throw new Error("canonical token reconciliation exceeded its page bound");
    }
    pagesScanned += 1;
    rowsScanned += result.rows.length;
    for (const row of result.rows) {
      const token0 = canonicalTokenAddress(row.token0);
      const token1 = canonicalTokenAddress(row.token1);
      if (token0) canonicalTokens.add(token0);
      if (token1) canonicalTokens.add(token1);
    }
    const last: CanonicalMarketTokenRow = result.rows.at(-1)!;
    if (!Number.isInteger(last.source_code) || last.source_code < 1 || last.source_code > 7 ||
        !Buffer.isBuffer(last.pool_key) || ![20, 32].includes(last.pool_key.length)) {
      throw new Error("canonical token reconciliation received an invalid primary-key cursor");
    }
    if (previousSource !== null && previousPoolKey !== null &&
        (last.source_code < previousSource ||
          (last.source_code === previousSource && Buffer.compare(last.pool_key, previousPoolKey) <= 0))) {
      throw new Error("canonical token reconciliation primary-key cursor did not advance");
    }
    previousSource = last.source_code;
    previousPoolKey = last.pool_key;
    if (result.rows.length < CANONICAL_TOKEN_SCAN_PAGE_SIZE) break;
  }
  return { canonicalTokens, rowsScanned, pagesScanned };
}

function reconciliationStatus(state: IdentityIndexState): TokenIdentityReconciliationStatus {
  const reconciliation = state.reconciliation;
  return {
    status: reconciliation.status,
    pageSize: CANONICAL_TOKEN_SCAN_PAGE_SIZE,
    rowsScanned: reconciliation.rowsScanned,
    pagesScanned: reconciliation.pagesScanned,
    uniqueCandidateTokens: reconciliation.uniqueCandidateTokens,
    lastDurationMs: reconciliation.lastDurationMs,
    lastSuccessfulAt: reconciliation.lastSuccessfulAt === null
      ? null
      : new Date(reconciliation.lastSuccessfulAt).toISOString(),
    nextReconciliationAt: reconciliation.nextReconciliationAt <= 0
      ? null
      : new Date(reconciliation.nextReconciliationAt).toISOString(),
    consecutiveFailures: reconciliation.consecutiveFailures,
    lastError: reconciliation.lastError
  };
}

async function rescanCanonicalTokens(pool: Pool, state: IdentityIndexState) {
  const startedAt = Date.now();
  state.reconciliation.status = "running";
  state.reconciliation.lastError = null;
  const { canonicalTokens, rowsScanned, pagesScanned } = await scanCanonicalTokensByPrimaryKey(pool);
  const dirtyShards = new Set<number>();
  for (const [shardNumber, shard] of state.shards) {
    for (const address of shard.keys()) {
      if (canonicalTokens.has(address)) continue;
      shard.delete(address);
      state.readyIdentities.delete(address);
      dirtyShards.add(shardNumber);
    }
  }
  await Promise.all([...dirtyShards].map((shardNumber) =>
    persistShard(pool, shardNumber, state.shards.get(shardNumber) ?? new Map())
  ));
  const pendingByShard = new Map<number, string[]>();
  let evaluated = 0;
  let verified = 0;
  const now = Date.now();
  for (const address of canonicalTokens) {
    const identity = state.shards.get(Number.parseInt(address.slice(2, 4), 16))?.get(address);
    if (identity) {
      evaluated += 1;
      if (identity[1] === "r") verified += 1;
      continue;
    }
    if ((state.retryAfter.get(address) ?? 0) > now) continue;
    const shardNumber = Number.parseInt(address.slice(2, 4), 16);
    const pending = pendingByShard.get(shardNumber) ?? [];
    pending.push(address);
    pendingByShard.set(shardNumber, pending);
  }
  const totalUniqueCanonicalTokens = canonicalTokens.size;
  state.canonicalTokens = canonicalTokens;
  state.pendingByShard = pendingByShard;
  state.stats = {
    totalCanonicalMarkets: rowsScanned,
    totalUniqueCanonicalTokens,
    totalVerifiedErc20Identities: verified,
    indexedSearchTokenIdentities: verified,
    unresolvedTokenIdentities: Math.max(totalUniqueCanonicalTokens - evaluated, 0),
    complete: evaluated === totalUniqueCanonicalTokens
  };
  await persistStats(pool, state.stats);
  const completedAt = Date.now();
  state.reconciliation = {
    status: "ready",
    rowsScanned,
    pagesScanned,
    uniqueCandidateTokens: totalUniqueCanonicalTokens,
    lastDurationMs: completedAt - startedAt,
    lastSuccessfulAt: completedAt,
    nextReconciliationAt: completedAt + CATALOG_RECONCILIATION_INTERVAL_MS,
    consecutiveFailures: 0,
    lastError: null
  };
  console.info(JSON.stringify({
    event: "market_token_identity_reconciliation_completed",
    durationMs: completedAt - startedAt,
    rowsScanned,
    pagesScanned,
    uniqueCandidateTokens: totalUniqueCanonicalTokens,
    nextReconciliationAt: new Date(state.reconciliation.nextReconciliationAt).toISOString()
  }));
}

async function reconcileCanonicalTokensIfDue(pool: Pool, state: IdentityIndexState) {
  const now = Date.now();
  if (state.reconciliation.status === "running" || state.reconciliation.nextReconciliationAt > now) {
    return;
  }
  const startedAt = now;
  try {
    await rescanCanonicalTokens(pool, state);
  } catch (error) {
    const completedAt = Date.now();
    const consecutiveFailures = state.reconciliation.consecutiveFailures + 1;
    const retryDelayMs = Math.min(
      CATALOG_RECONCILIATION_RETRY_BASE_MS * (2 ** Math.min(consecutiveFailures - 1, 8)),
      CATALOG_RECONCILIATION_RETRY_MAX_MS
    );
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 4_096);
    state.reconciliation = {
      ...state.reconciliation,
      status: "delayed",
      lastDurationMs: completedAt - startedAt,
      nextReconciliationAt: completedAt + retryDelayMs,
      consecutiveFailures,
      lastError: message
    };
    console.warn(JSON.stringify({
      event: "market_token_identity_reconciliation_delayed",
      durationMs: completedAt - startedAt,
      consecutiveFailures,
      retryDelayMs,
      nextReconciliationAt: new Date(state.reconciliation.nextReconciliationAt).toISOString(),
      error: message
    }));
  }
}

export async function readCanonicalTokenIdentityIndexStats(pool: Pool) {
  return (await stateFor(pool)).stats;
}

export async function readCanonicalTokenIdentityReconciliationStatus(pool: Pool) {
  return reconciliationStatus(await stateFor(pool));
}

export async function warmCanonicalTokenIdentityIndex(pool: Pool) {
  await stateFor(pool);
}

export async function enqueueCanonicalTokenIdentityCandidates(
  pool: Pool,
  addresses: readonly string[],
  addedMarkets: number
) {
  const state = await stateFor(pool);
  if (state.canonicalTokens === null) {
    return;
  }
  let addedTokens = 0;
  for (const rawAddress of addresses) {
    const address = rawAddress.toLowerCase();
    if (address === `0x${"0".repeat(40)}` || state.canonicalTokens.has(address)) continue;
    state.canonicalTokens.add(address);
    addedTokens += 1;
    const shardNumber = Number.parseInt(address.slice(2, 4), 16);
    if (state.shards.get(shardNumber)?.has(address) || (state.retryAfter.get(address) ?? 0) > Date.now()) continue;
    const pending = state.pendingByShard.get(shardNumber) ?? [];
    pending.push(address);
    state.pendingByShard.set(shardNumber, pending);
  }
  if (addedTokens === 0 && addedMarkets === 0) return;
  state.stats = {
    ...state.stats,
    totalCanonicalMarkets: state.stats.totalCanonicalMarkets + addedMarkets,
    totalUniqueCanonicalTokens: state.stats.totalUniqueCanonicalTokens + addedTokens,
    unresolvedTokenIdentities: state.stats.unresolvedTokenIdentities + addedTokens,
    complete: false
  };
  await persistStats(pool, state.stats);
}

export async function refreshCanonicalTokenIdentityIndex(
  pool: Pool,
  rpc: PublicClient,
  batchSize: number,
  observedBlock: bigint,
  _observedBlockHash: Hex
) {
  const state = await stateFor(pool);
  await reconcileCanonicalTokensIfDue(pool, state);
  if (state.canonicalTokens === null) {
    return { processed: 0, reconciliation: reconciliationStatus(state) };
  }
  const selected: string[] = [];
  let selectedShard: number | null = null;
  for (let shardNumber = 0; shardNumber <= 255; shardNumber += 1) {
    const pending = state.pendingByShard.get(shardNumber);
    if (!pending?.length) continue;
    selectedShard = shardNumber;
    selected.push(...pending.splice(0, batchSize));
    break;
  }
  if (selected.length === 0 || selectedShard === null) {
    return { processed: 0, reconciliation: reconciliationStatus(state) };
  }
  const addresses = selected.map((address) => getAddress(address));
  const batches = Array.from(
    { length: Math.ceil(addresses.length / IDENTITIES_PER_MULTICALL) },
    (_, index) => addresses.slice(index * IDENTITIES_PER_MULTICALL, (index + 1) * IDENTITIES_PER_MULTICALL)
  );
  const reads: Array<{
    batch: Address[];
    results: IdentityRead[];
    failed: boolean;
  }> = [];
  let nextBatch = 0;
  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENT_IDENTITY_MULTICALLS, batches.length) },
    async () => {
      while (true) {
        const batchIndex = nextBatch;
        nextBatch += 1;
        const batch = batches[batchIndex];
        if (!batch) return;
        try {
          const aggregate = await rpc.multicall({
          allowFailure: true,
          blockNumber: observedBlock,
          multicallAddress: ROBINHOOD_MULTICALL3,
          contracts: batch.flatMap((address) => [
            { address, abi: erc20Abi, functionName: "name" as const },
            { address, abi: erc20Abi, functionName: "symbol" as const },
            { address, abi: erc20Abi, functionName: "decimals" as const },
            { address, abi: erc20Abi, functionName: "totalSupply" as const }
          ])
          });
          const rawResults = aggregate.some((result) =>
            result.status === "failure" && isTransientReadFailure(result.error)
          ) ? (await Promise.all(
              batch.map((address) => readIdentityIndividually(rpc, address, observedBlock))
            )).flat() : aggregate;
          const results: IdentityRead[] = rawResults.map((result) => result.status === "success"
            ? { status: "success", result: result.result }
            : { status: "failure", error: result.error });
          reads.push({ batch, results, failed: false });
        } catch {
          reads.push({ batch, results: [], failed: true });
        }
      }
    }
  ));
  const shard = state.shards.get(selectedShard) ?? new Map<string, StoredIdentity>();
  state.shards.set(selectedShard, shard);
  let evaluatedAdded = 0;
  let verifiedAdded = 0;
  for (const read of reads) {
    if (read.failed) {
      for (const address of read.batch) state.retryAfter.set(address.toLowerCase(), Date.now() + RETRY_ERROR_AFTER_MS);
      continue;
    }
    for (let index = 0; index < read.batch.length; index += 1) {
      const address = read.batch[index]!;
      const key = address.toLowerCase();
      const nameResult = read.results[index * 4];
      const symbolResult = read.results[index * 4 + 1];
      const decimalsResult = read.results[index * 4 + 2];
      const supplyResult = read.results[index * 4 + 3];
      const name = cleanIdentityText(nameResult?.status === "success" ? nameResult.result : null, 80);
      const symbol = cleanIdentityText(symbolResult?.status === "success" ? symbolResult.result : null, 20);
      const decimals = decimalsResult?.status === "success" ? decimalsResult.result : null;
      const totalSupply = supplyResult?.status === "success" ? supplyResult.result : null;
      const ready = Boolean(name && symbol && typeof decimals === "number" && decimals >= 0 && decimals <= 36 &&
        typeof totalSupply === "bigint" && totalSupply > 0n);
      const stored: StoredIdentity = ready
        ? [key.slice(2), "r", name!, symbol!, decimals as number]
        : [key.slice(2), "i"];
      shard.set(key, stored);
      if (stored[1] === "r") state.readyIdentities.set(key, stored);
      else state.readyIdentities.delete(key);
      state.retryAfter.delete(key);
      evaluatedAdded += 1;
      if (ready) verifiedAdded += 1;
    }
  }
  await persistShard(pool, selectedShard, shard);
  const evaluated = state.stats.totalUniqueCanonicalTokens - state.stats.unresolvedTokenIdentities + evaluatedAdded;
  const verified = state.stats.totalVerifiedErc20Identities + verifiedAdded;
  state.stats = {
    ...state.stats,
    totalVerifiedErc20Identities: verified,
    indexedSearchTokenIdentities: verified,
    unresolvedTokenIdentities: Math.max(state.stats.totalUniqueCanonicalTokens - evaluated, 0),
    complete: evaluated === state.stats.totalUniqueCanonicalTokens
  };
  await persistStats(pool, state.stats);
  return { processed: selected.length, reconciliation: reconciliationStatus(state) };
}

export async function searchCanonicalTokenIdentityIndex(pool: Pool, query: string, limit: number) {
  const state = await stateFor(pool);
  const normalized = normalizeTokenIdentitySearch(query);
  const matches: Array<{ priority: number; identity: ReadyStoredIdentity }> = [];
  for (const identity of state.readyIdentities.values()) {
    const nameSearch = normalizeTokenIdentitySearch(identity[2]);
    const symbolSearch = normalizeTokenIdentitySearch(identity[3]);
    const priority = normalized.normalized === symbolSearch.normalized ? 0
      : normalized.normalized === nameSearch.normalized ? 1
        : normalized.compact === symbolSearch.compact ? 2
          : normalized.compact === nameSearch.compact ? 3
            : normalized.compact !== "" && (
                normalized.singular === symbolSearch.singular ||
                normalized.singular === nameSearch.singular
              ) ? 4
              : -1;
    if (priority >= 0) matches.push({ priority, identity });
  }
  return matches
    .sort((left, right) => left.priority - right.priority || left.identity[0].localeCompare(right.identity[0]))
    .slice(0, limit)
    .map(({ identity }) => ({
      address: getAddress(`0x${identity[0]}`),
      name: identity[2],
      symbol: identity[3],
      decimals: identity[4]
    }));
}
