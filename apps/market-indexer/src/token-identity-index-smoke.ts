import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import type { Pool } from "pg";
import {
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  type PublicClient
} from "viem";
import {
  ensureCanonicalTokenIdentity,
  normalizeTokenIdentitySearch,
  readCanonicalBrowseIdentities,
  readCanonicalTokenIdentityIndexStats,
  refreshCanonicalTokenIdentityIndex,
  searchCanonicalTokenIdentityIndex
} from "./token-identity-index.js";

const identity = (index: number) => {
  const address = index.toString(16).padStart(40, "0");
  if (index === 1) return [address, "r", "First Canonical", "FIRST", 18] as const;
  if (index === 2) return [address, "r", "StonkBroker", "STONKBROKER", 18] as const;
  if (index === 3) return [address, "r", "Shared Alpha", "SHARED", 18] as const;
  if (index === 4) return [address, "r", "Shared Beta", "SHARED", 18] as const;
  if (index === 2_049) return [address, "r", "After Old Boundary", "POSTBOUND", 18] as const;
  return [address, "r", `Canonical Token ${index}`, `T${index}`, 18] as const;
};
const payload = gzipSync(Buffer.from(JSON.stringify(
  Array.from({ length: 2_049 }, (_, index) => identity(index + 1))
), "utf8"));
const queries: string[] = [];
const pool = {
  query: async (text: string) => {
    queries.push(text);
    if (text.includes("market_token_identity_shard")) {
      return { rows: [{ shard: 0, payload }] };
    }
    if (text.includes("market_token_identity_catalog_state")) {
      return { rows: [{
        total_canonical_markets: 4_001,
        total_unique_tokens: 2_049,
        evaluated_tokens: 2_049,
        verified_tokens: 2_049,
        complete: true
      }] };
    }
    throw new Error(`unexpected query: ${text}`);
  }
} as unknown as Pool;

const normalized = normalizeTokenIdentitySearch("  $After-old_boundary  ");
assert.equal(normalized.normalized, "after-old_boundary");
assert.equal(normalized.compact, "afteroldboundary");
assert.equal(normalizeTokenIdentitySearch("Stonk Brokers").singular, "stonkbroker");

const stats = await readCanonicalTokenIdentityIndexStats(pool);
// A new Pool object represents a cold process cache. The persisted compressed
// shard alone supplies metadata; no live RPC is present in this read path.
for (let cold = 0; cold < 3; cold++) {
  const freshPool = { query: pool.query.bind(pool) } as unknown as Pool;
  const page = await readCanonicalBrowseIdentities(freshPool, ["0x0000000000000000000000000000000000000801", "0x0000000000000000000000000000000000000801", "0x000000000000000000000000000000000000ffff"]);
  assert.equal(page.length, 1);
  assert.equal(page[0]?.symbol, "POSTBOUND");
}
queries.splice(2);
assert.deepEqual(stats, {
  totalCanonicalMarkets: 4_001,
  totalUniqueCanonicalTokens: 2_049,
  totalVerifiedErc20Identities: 2_049,
  indexedSearchTokenIdentities: 2_049,
  unresolvedTokenIdentities: 0,
  complete: true
});
assert.deepEqual(await readCanonicalTokenIdentityIndexStats(pool), stats);
assert.equal(queries.length, 2);

for (const query of ["POSTBOUND", "After Old Boundary", "after-old_boundary"]) {
  const result = await searchCanonicalTokenIdentityIndex(pool, query, 512);
  assert.equal(result[0]?.address.toLowerCase(), "0x0000000000000000000000000000000000000801");
}
assert.equal((await searchCanonicalTokenIdentityIndex(pool, "FIRST", 512))[0]?.address.toLowerCase(),
  "0x0000000000000000000000000000000000000001");
assert.equal((await searchCanonicalTokenIdentityIndex(
  pool,
  "0x0000000000000000000000000000000000000801",
  1
))[0]?.symbol, "POSTBOUND");
for (const query of [
  "STONKBROKER",
  "StonkBroker",
  "StonkBrokers",
  "$STONKBROKER",
  "Stonk Broker",
  "Stonk-Broker",
  "Stonk_Broker",
  "Stonk Brokers",
  "Stonk-Brokers",
  "Stonk_Brokers"
]) {
  const result = await searchCanonicalTokenIdentityIndex(pool, query, 512);
  assert.equal(result[0]?.address.toLowerCase(), "0x0000000000000000000000000000000000000002", query);
}
assert.deepEqual(await searchCanonicalTokenIdentityIndex(pool, "STONK", 512), []);
assert.deepEqual(
  (await searchCanonicalTokenIdentityIndex(pool, "SHARED", 512)).map((result) => result.address.toLowerCase()),
  [
    "0x0000000000000000000000000000000000000003",
    "0x0000000000000000000000000000000000000004"
  ]
);

const fallbackAddress = "0x1234567890123456789012345678901234567890";
const fallbackPool = {
  query: async (text: string) => {
    if (text.startsWith("SELECT shard,payload")) return { rows: [] };
    if (text.startsWith("SELECT total_canonical_markets")) return { rows: [] };
    if (text.includes("COUNT(*)::text AS count")) return { rows: [{ count: "1" }] };
    if (text.includes("encode(token0,'hex') AS token0")) return { rows: [{ token0: fallbackAddress.slice(2), token1: fallbackAddress.slice(2), block_number: 1, log_index: 0 }] };
    if (text.startsWith("INSERT INTO market_token_identity_")) return { rows: [] };
    throw new Error(`unexpected fallback query: ${text}`);
  }
} as unknown as Pool;
const fallbackRpc = {
  multicall: async () => Array.from({ length: 4 }, () => ({
    status: "failure" as const,
    error: Object.assign(new Error("HTTP request failed"), { status: 429 })
  })),
  call: async ({ data }: { data: `0x${string}` }) => {
    const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
    const result = functionName === "name" ? "Fallback Token"
      : functionName === "symbol" ? "FALLBACK"
        : functionName === "decimals" ? 18 : 1_000n;
    return { data: encodeFunctionResult({ abi: erc20Abi, functionName, result }) };
  }
} as unknown as PublicClient;
await refreshCanonicalTokenIdentityIndex(
  fallbackPool,
  fallbackRpc,
  250,
  1n,
  `0x${"1".repeat(64)}`
);
assert.equal((await searchCanonicalTokenIdentityIndex(fallbackPool, "FALLBACK", 1))[0]?.address.toLowerCase(),
  fallbackAddress);

const shcatAddress = "0x14c51bb55592372eac7141a1d0527d1dd7fbd42f";
const persistedShards = new Map<number, Buffer>();
const durableQueries: string[] = [];
const durableQuery = async (text: string, values: unknown[] = []) => {
  durableQueries.push(text);
  if (text.startsWith("SELECT shard,payload")) {
    return { rows: [...persistedShards].map(([shard, storedPayload]) => ({ shard, payload: storedPayload })) };
  }
  if (text.startsWith("SELECT total_canonical_markets")) return { rows: [] };
  if (text.includes("COUNT(*)::text AS count")) return { rows: [{ count: "0" }] };
  if (text.includes("encode(token0,'hex') AS token0")) return { rows: [] };
  if (text.includes("WITH recent_pools AS MATERIALIZED")) return { rows: [] };
  if (text.startsWith("INSERT INTO market_token_identity_shard")) {
    persistedShards.set(values[0] as number, values[1] as Buffer);
    return { rows: [] };
  }
  if (text.startsWith("INSERT INTO market_token_identity_catalog_state")) return { rows: [] };
  throw new Error(`unexpected durable query: ${text}`);
};
const durablePool = { query: durableQuery } as unknown as Pool;
let durableRpcCalls = 0;
const durableRpc = {
  getBytecode: async () => {
    durableRpcCalls++;
    return "0x6000" as const;
  },
  call: async ({ data }: { data: `0x${string}` }) => {
    durableRpcCalls++;
    const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
    const result = functionName === "name" ? "Shareholder Cat"
      : functionName === "symbol" ? "SHCAT"
        : functionName === "decimals" ? 18 : 1_000_000n;
    return { data: encodeFunctionResult({ abi: erc20Abi, functionName, result }) };
  },
  multicall: async () => []
} as unknown as PublicClient;
const ensured = await ensureCanonicalTokenIdentity(durablePool, durableRpc, shcatAddress, 100n);
assert.deepEqual(ensured, {
  address: "0x14C51bB55592372eAC7141A1D0527D1dD7Fbd42F",
  name: "Shareholder Cat",
  symbol: "SHCAT",
  decimals: 18
});
assert.equal(durableRpcCalls, 5);
assert.equal((await searchCanonicalTokenIdentityIndex(durablePool, shcatAddress, 1))[0]?.symbol, "SHCAT");

// A catalog rescan with no indexed pools must retain positive exact-address
// evidence. The next process loads it from the same persisted shard without RPC.
await refreshCanonicalTokenIdentityIndex(
  durablePool,
  durableRpc,
  25,
  101n,
  `0x${"2".repeat(64)}`
);
assert.equal((await searchCanonicalTokenIdentityIndex(durablePool, shcatAddress, 1))[0]?.symbol, "SHCAT");
const restartedPool = { query: durableQuery } as unknown as Pool;
assert.equal((await searchCanonicalTokenIdentityIndex(restartedPool, shcatAddress, 1))[0]?.symbol, "SHCAT");
assert.equal((await readCanonicalTokenIdentityIndexStats(restartedPool)).indexedSearchTokenIdentities, 1);
const callsBeforeWarmEnsure = durableRpcCalls;
assert.equal((await ensureCanonicalTokenIdentity(restartedPool, {
  getBytecode: async () => { throw new Error("RPC unavailable after restart"); }
} as unknown as PublicClient, shcatAddress, 102n))?.decimals, 18);
assert.equal(durableRpcCalls, callsBeforeWarmEnsure);
assert.ok(durableQueries.some((query) => query.startsWith("INSERT INTO market_token_identity_shard")));

const invalidDecimalsAddress = "0x2234567890123456789012345678901234567890";
const invalidDecimals = await ensureCanonicalTokenIdentity(durablePool, {
  getBytecode: async () => "0x6000",
  call: async ({ data }: { data: `0x${string}` }) => {
    const { functionName } = decodeFunctionData({ abi: erc20Abi, data });
    const result = functionName === "name" ? "Invalid Units"
      : functionName === "symbol" ? "BADUNITS"
        : functionName === "decimals" ? 255 : 1_000n;
    return { data: encodeFunctionResult({ abi: erc20Abi, functionName, result }) };
  }
} as unknown as PublicClient, invalidDecimalsAddress, 102n);
assert.equal(invalidDecimals, null);
assert.deepEqual(await searchCanonicalTokenIdentityIndex(durablePool, invalidDecimalsAddress, 1), []);
console.log("Compressed canonical identity shards preserve exact search beyond the retired 2048-token/4000-market catalog bounds.");
