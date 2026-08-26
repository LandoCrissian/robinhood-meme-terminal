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
import type { Pool } from "pg";

const ZERO_ADDRESS_BYTES = Buffer.alloc(20);
const ROBINHOOD_MULTICALL3 = getAddress("0xcA11bde05977b3631167028862bE2a173976CA11");
// Robinhood Chain's public eth_call gas ceiling rejects larger aggregate3
// identity reads. Five identities (20 calls) stays below the observed ceiling.
const IDENTITIES_PER_MULTICALL = 5;
const MAX_CONCURRENT_IDENTITY_MULTICALLS = 2;
const CATALOG_RESCAN_MS = 15 * 60_000;
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

type IdentityIndexState = {
  shards: Map<number, Map<string, StoredIdentity>>;
  readyIdentities: Map<string, ReadyStoredIdentity>;
  canonicalTokens: Set<string> | null;
  pendingByShard: Map<number, string[]>;
  retryAfter: Map<string, number>;
  lastScanAt: number;
  stats: TokenIdentityIndexStats;
};

const states = new WeakMap<Pool, Promise<IdentityIndexState>>();

function cleanIdentityText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
  return clean || null;
}

function isTransientReadFailure(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /http|network|fetch|timeout|timed out|rate.?limit|429|502|503|504|socket|connection/i.test(message);
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
  return {
    normalized,
    compact: normalized.replace(/[\s_-]+/g, ""),
    singular: normalized.length > 1 && normalized.endsWith("s")
      ? normalized.slice(0, -1)
      : normalized
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
    lastScanAt: 0,
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

async function rescanCanonicalTokens(pool: Pool, state: IdentityIndexState) {
  const [marketResult, tokenResult] = await Promise.all([
    pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM market_pools"),
    pool.query<{ token: string }>(
      `SELECT encode(token,'hex') AS token FROM (
         SELECT token0 AS token FROM market_pools WHERE token0 <> $1
         UNION
         SELECT token1 AS token FROM market_pools WHERE token1 <> $1
       ) AS canonical_tokens ORDER BY token`,
      [ZERO_ADDRESS_BYTES]
    )
  ]);
  const canonicalTokens = new Set(tokenResult.rows.map((row) => `0x${row.token}`));
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
  state.lastScanAt = now;
  state.stats = {
    totalCanonicalMarkets: Number(marketResult.rows[0]?.count ?? 0),
    totalUniqueCanonicalTokens,
    totalVerifiedErc20Identities: verified,
    indexedSearchTokenIdentities: verified,
    unresolvedTokenIdentities: Math.max(totalUniqueCanonicalTokens - evaluated, 0),
    complete: evaluated === totalUniqueCanonicalTokens
  };
  await persistStats(pool, state.stats);
}

export async function readCanonicalTokenIdentityIndexStats(pool: Pool) {
  return (await stateFor(pool)).stats;
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
    state.lastScanAt = 0;
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
  if (state.canonicalTokens === null || state.lastScanAt + CATALOG_RESCAN_MS <= Date.now()) {
    await rescanCanonicalTokens(pool, state);
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
  if (selected.length === 0 || selectedShard === null) return 0;
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
  return selected.length;
}

export async function searchCanonicalTokenIdentityIndex(pool: Pool, query: string, limit: number) {
  const state = await stateFor(pool);
  const normalized = normalizeTokenIdentitySearch(query);
  const matches: Array<{ priority: number; identity: ReadyStoredIdentity }> = [];
  for (const identity of state.readyIdentities.values()) {
    const nameSearch = normalizeTokenIdentitySearch(identity[2]);
    const symbolSearch = normalizeTokenIdentitySearch(identity[3]);
    const priority = [
      symbolSearch.normalized,
      nameSearch.normalized,
      symbolSearch.compact,
      nameSearch.compact,
      symbolSearch.singular,
      nameSearch.singular
    ].findIndex((key) =>
      key === normalized.normalized || key === normalized.compact || key === normalized.singular
    );
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
