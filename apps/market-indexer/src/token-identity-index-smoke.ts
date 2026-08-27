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
  CANONICAL_TOKEN_SCAN_PAGE_SIZE,
  CATALOG_RECONCILIATION_INTERVAL_MS,
  CATALOG_RECONCILIATION_RETRY_BASE_MS,
  enqueueCanonicalTokenIdentityCandidates,
  normalizeTokenIdentitySearch,
  readCanonicalTokenIdentityIndexStats,
  readCanonicalTokenIdentityReconciliationStatus,
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
let fallbackScanRequests = 0;
const fallbackPool = {
  query: async (text: string) => {
    if (text.startsWith("SELECT shard,payload")) return { rows: [] };
    if (text.startsWith("SELECT total_canonical_markets")) return { rows: [] };
    if (text.includes("FROM market_pools")) {
      fallbackScanRequests += 1;
      return { rows: [{
        source_code: 1,
        pool_key: Buffer.from("11".repeat(20), "hex"),
        token0: Buffer.from(fallbackAddress.slice(2), "hex"),
        token1: Buffer.alloc(20)
      }] };
    }
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
assert.equal(fallbackScanRequests, 1);

const bufferFromIndex = (index: number) => Buffer.from(
  BigInt(index).toString(16).padStart(40, "0"),
  "hex"
);
const PRODUCTION_SCALE_ROWS = 940_000;
const PRODUCTION_SCALE_UNIQUE_TOKENS = 758_634;
let scaleOffset = 0;
let scaleScanRequests = 0;
let maximumPageRows = 0;
let largestPagePayloadBytes = 0;
let peakHeapBytes = process.memoryUsage().heapUsed;
const scaleQueries: string[] = [];
const scalePool = {
  query: async (text: string, values: unknown[] = []) => {
    if (text.startsWith("SELECT shard,payload")) return { rows: [] };
    if (text.startsWith("SELECT total_canonical_markets")) return { rows: [] };
    if (text.includes("FROM market_pools")) {
      scaleQueries.push(text);
      scaleScanRequests += 1;
      assert.match(text, /ORDER BY source_code,pool_key\s+LIMIT \$/);
      assert.doesNotMatch(text, /\b(?:UNION|DISTINCT|GROUP\s+BY)\b|ORDER BY token/i);
      if (scaleOffset > 0) {
        assert.match(text, /WHERE \(source_code,pool_key\) > \(\$1::smallint,\$2::bytea\)/);
        assert.equal(values[0], Math.min(Math.floor((scaleOffset - 1) / 140_000) + 1, 7));
        assert.deepEqual(values[1], bufferFromIndex(scaleOffset));
      }
      const count = Math.min(CANONICAL_TOKEN_SCAN_PAGE_SIZE, PRODUCTION_SCALE_ROWS - scaleOffset);
      const rows = Array.from({ length: Math.max(count, 0) }, (_, pageIndex) => {
        const index = scaleOffset + pageIndex;
        return {
          source_code: Math.min(Math.floor(index / 140_000) + 1, 7),
          pool_key: bufferFromIndex(index + 1),
          token0: bufferFromIndex((index % PRODUCTION_SCALE_UNIQUE_TOKENS) + 1),
          token1: index % 100 === 0
            ? Buffer.alloc(20)
            : bufferFromIndex(((index + 37_000) % PRODUCTION_SCALE_UNIQUE_TOKENS) + 1)
        };
      });
      scaleOffset += rows.length;
      maximumPageRows = Math.max(maximumPageRows, rows.length);
      largestPagePayloadBytes = Math.max(
        largestPagePayloadBytes,
        rows.reduce((bytes, row) => bytes + 2 + row.pool_key.length + row.token0.length + row.token1.length, 0)
      );
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
      return { rows };
    }
    if (text.startsWith("INSERT INTO market_token_identity_")) return { rows: [] };
    throw new Error(`unexpected production-scale query: ${text}`);
  }
} as unknown as Pool;
const scaleRpc = {
  multicall: async ({ contracts }: { contracts: Array<{ functionName: string }> }) =>
    contracts.map(({ functionName }) => ({
      status: "success" as const,
      result: functionName === "name" ? "Scale Token"
        : functionName === "symbol" ? "SCALE"
          : functionName === "decimals" ? 18 : 1_000n
    }))
} as unknown as PublicClient;
const scaleHeapBefore = process.memoryUsage().heapUsed;
const scaleStartedAt = Date.now();
const scaleRefresh = await refreshCanonicalTokenIdentityIndex(
  scalePool,
  scaleRpc,
  25,
  1n,
  `0x${"2".repeat(64)}`
);
const scaleDurationMs = Date.now() - scaleStartedAt;
peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
const scaleStats = await readCanonicalTokenIdentityIndexStats(scalePool);
assert.equal(scaleStats.totalCanonicalMarkets, PRODUCTION_SCALE_ROWS);
assert.equal(scaleStats.totalUniqueCanonicalTokens, PRODUCTION_SCALE_UNIQUE_TOKENS);
assert.equal(scaleRefresh.reconciliation.status, "ready");
assert.equal(scaleRefresh.reconciliation.rowsScanned, PRODUCTION_SCALE_ROWS);
assert.equal(scaleRefresh.reconciliation.pagesScanned, Math.ceil(PRODUCTION_SCALE_ROWS / CANONICAL_TOKEN_SCAN_PAGE_SIZE));
assert.equal(scaleRefresh.reconciliation.uniqueCandidateTokens, PRODUCTION_SCALE_UNIQUE_TOKENS);
assert.equal(maximumPageRows, CANONICAL_TOKEN_SCAN_PAGE_SIZE);
assert.equal(scaleScanRequests, Math.ceil(PRODUCTION_SCALE_ROWS / CANONICAL_TOKEN_SCAN_PAGE_SIZE) + 1);
assert.ok(scaleRefresh.reconciliation.nextReconciliationAt);
assert.ok(
  Date.parse(scaleRefresh.reconciliation.nextReconciliationAt!) - Date.now() >
    CATALOG_RECONCILIATION_INTERVAL_MS - 60_000
);
assert.equal(scaleQueries.some((query) => /\bUNION\b|ORDER BY token/i.test(query)), false);

const incrementalAddress = "0xffffffffffffffffffffffffffffffffffffffff";
await enqueueCanonicalTokenIdentityCandidates(scalePool, [incrementalAddress, `0x${"0".repeat(40)}`], 1);
const incrementalStats = await readCanonicalTokenIdentityIndexStats(scalePool);
assert.equal(incrementalStats.totalCanonicalMarkets, PRODUCTION_SCALE_ROWS + 1);
assert.equal(incrementalStats.totalUniqueCanonicalTokens, PRODUCTION_SCALE_UNIQUE_TOKENS + 1);
assert.equal(incrementalStats.unresolvedTokenIdentities, scaleStats.unresolvedTokenIdentities + 1);

let failedScanRequests = 0;
const failingPool = {
  query: async (text: string) => {
    if (text.startsWith("SELECT shard,payload")) return { rows: [] };
    if (text.startsWith("SELECT total_canonical_markets")) return { rows: [] };
    if (text.includes("FROM market_pools")) {
      failedScanRequests += 1;
      throw new Error("could not write to file base/pgsql_tmp/test: No space left on device");
    }
    throw new Error(`unexpected failure-path query: ${text}`);
  }
} as unknown as Pool;
const failureStartedAt = Date.now();
const firstFailure = await refreshCanonicalTokenIdentityIndex(
  failingPool,
  scaleRpc,
  25,
  1n,
  `0x${"3".repeat(64)}`
);
const secondFailure = await refreshCanonicalTokenIdentityIndex(
  failingPool,
  scaleRpc,
  25,
  1n,
  `0x${"3".repeat(64)}`
);
assert.equal(firstFailure.processed, 0);
assert.equal(firstFailure.reconciliation.status, "delayed");
assert.equal(secondFailure.reconciliation.status, "delayed");
assert.equal(failedScanRequests, 1);
assert.ok(Date.parse(firstFailure.reconciliation.nextReconciliationAt!) - failureStartedAt >=
  CATALOG_RECONCILIATION_RETRY_BASE_MS);
assert.match(firstFailure.reconciliation.lastError ?? "", /No space left on device/);
assert.deepEqual(
  await readCanonicalTokenIdentityReconciliationStatus(failingPool),
  secondFailure.reconciliation
);

let restartScanRequests = 0;
const restartAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const restartPool = {
  query: async (text: string) => {
    if (text.startsWith("SELECT shard,payload")) return { rows: [] };
    if (text.startsWith("SELECT total_canonical_markets")) return { rows: [] };
    if (text.includes("FROM market_pools")) {
      restartScanRequests += 1;
      return { rows: [{
        source_code: 7,
        pool_key: Buffer.from("44".repeat(20), "hex"),
        token0: Buffer.from(restartAddress.slice(2), "hex"),
        token1: Buffer.alloc(20)
      }] };
    }
    if (text.startsWith("INSERT INTO market_token_identity_")) return { rows: [] };
    throw new Error(`unexpected restart query: ${text}`);
  }
} as unknown as Pool;
await refreshCanonicalTokenIdentityIndex(
  restartPool,
  scaleRpc,
  25,
  1n,
  `0x${"4".repeat(64)}`
);
assert.equal(restartScanRequests, 1);
assert.equal((await readCanonicalTokenIdentityIndexStats(restartPool)).totalUniqueCanonicalTokens, 1);

console.log(JSON.stringify({
  event: "token_identity_reconciliation_scale_evidence",
  productionScaleRows: PRODUCTION_SCALE_ROWS,
  uniqueTokens: PRODUCTION_SCALE_UNIQUE_TOKENS,
  pageSize: CANONICAL_TOKEN_SCAN_PAGE_SIZE,
  pagesScanned: scaleRefresh.reconciliation.pagesScanned,
  maximumPageRows,
  largestPagePayloadBytes,
  scanDurationMs: scaleDurationMs,
  peakNodeHeapBytes: peakHeapBytes,
  heapDeltaBytes: Math.max(peakHeapBytes - scaleHeapBefore, 0),
  globalTokenUnion: false,
  globalTokenOrderBy: false,
  perPollFailureRetry: false,
  restartReconstruction: true,
  incrementalEnqueue: true
}));
console.log("Bounded primary-key reconciliation preserves canonical token identity coverage without PostgreSQL global token sorting.");
