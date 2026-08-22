import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  readVNextCanonicalMarketInventory,
  type VNextCanonicalMarketInventoryQuery,
  type VNextCanonicalMarketInventoryResult
} from "./vnext-market-indexer";

const readCredential = [
  "market",
  "inventory",
  "smoke",
  "credential",
  "0123456789"
].join("-");
const marketIndexerBaseUrl = "https://market-indexer.internal.example/service";
const configuredEnvironment = {
  RMT_MARKET_INDEXER_URL: marketIndexerBaseUrl,
  RMT_MARKET_INDEXER_READ_TOKEN: readCredential,
  RMT_MARKET_INDEXER_TIMEOUT_MS: "5000"
};
const sourceManifestHash = `0x${"ab".repeat(32)}`;
const requestCursor = "eyJ2IjoxfQ";
const responseCursor = "bmV4dC1jdXJzb3I";
const stonkBrokerAddress = "0xe934e36a439c94017b64a3fece66af12099abf50";
const zeroAddress = `0x${"0".repeat(40)}`;
const canonicalSourceIds = [
  "sushiswap-v2",
  "sushiswap-v3",
  "uniswap-v2",
  "uniswap-v3",
  "uniswap-v4",
  "up-v2",
  "up-cl"
] as const;
const stateFields = {
  stateStatus: null,
  liveFee: null,
  feeDenominator: null,
  gaugeAddress: null,
  gaugeAlive: null,
  gaugeWeight: null,
  gaugeClaimable: null,
  feesAddress: null,
  bribeAddress: null,
  stateError: null,
  stateObservedBlock: null,
  stateObservedBlockHash: null
} as const;
const v2Pool = {
  sourceId: "sushiswap-v2",
  protocol: "sushiswap",
  version: 2,
  poolKey: "0x2222222222222222222222222222222222222222",
  poolAddress: "0x2222222222222222222222222222222222222222",
  token0: "0x1111111111111111111111111111111111111111",
  token1: "0x3333333333333333333333333333333333333333",
  stable: null,
  fee: null,
  tickSpacing: null,
  hooks: null,
  transactionHash: `0x${"21".repeat(32)}`,
  blockNumber: "100",
  blockHash: `0x${"31".repeat(32)}`,
  ...stateFields
};
const v3Pool = {
  ...v2Pool,
  sourceId: "uniswap-v3",
  protocol: "uniswap",
  version: 3,
  poolKey: "0x4444444444444444444444444444444444444444",
  poolAddress: "0x4444444444444444444444444444444444444444",
  token0: "0x5555555555555555555555555555555555555555",
  token1: "0x6666666666666666666666666666666666666666",
  fee: 3_000,
  tickSpacing: 60,
  transactionHash: `0x${"22".repeat(32)}`,
  blockNumber: "101",
  blockHash: `0x${"32".repeat(32)}`
};
const v4Pool = {
  ...v2Pool,
  sourceId: "uniswap-v4",
  protocol: "uniswap",
  version: 4,
  poolKey: `0x${"42".repeat(32)}`,
  poolAddress: null,
  token0: "0x7777777777777777777777777777777777777777",
  token1: stonkBrokerAddress,
  fee: 3_000,
  tickSpacing: 60,
  hooks: "0x0000000000000000000000000000000000000000",
  transactionHash: `0x${"23".repeat(32)}`,
  blockNumber: "102",
  blockHash: `0x${"33".repeat(32)}`
};
const nativeV4Pool = {
  ...v4Pool,
  token0: zeroAddress,
  token1: stonkBrokerAddress
};
const upV2Pool = {
  ...v2Pool,
  sourceId: "up-v2",
  protocol: "up",
  poolKey: "0x8888888888888888888888888888888888888888",
  poolAddress: "0x8888888888888888888888888888888888888888",
  stable: false,
  transactionHash: `0x${"24".repeat(32)}`,
  blockNumber: "103",
  blockHash: `0x${"34".repeat(32)}`,
  stateStatus: "ready",
  liveFee: 30,
  feeDenominator: 10_000,
  stateObservedBlock: "104",
  stateObservedBlockHash: `0x${"35".repeat(32)}`
};

function coverage(complete: boolean) {
  return {
    complete,
    finalizedHead: "200",
    sources: canonicalSourceIds.map((sourceId, index) => ({
      sourceId,
      status: complete || index > 0 ? "shadow-ready" : "backfilling",
      indexedThrough: complete || index > 0 ? "200" : "199"
    }))
  };
}

const completeCoverage = coverage(true);
const incompleteCoverage = coverage(false);

function inventoryResponse(
  pools: unknown[],
  additions: Record<string, unknown> = {}
) {
  return {
    chainId: 4_663,
    mode: "shadow",
    authoritative: false,
    sourceManifestHash,
    coverage: completeCoverage,
    nextCursor: null,
    pools,
    ...additions
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

type CapturedRequest = { url: URL; init: RequestInit };

async function readFixture(
  query: VNextCanonicalMarketInventoryQuery,
  body: unknown,
  captured: CapturedRequest[] = []
) {
  return readVNextCanonicalMarketInventory(query, {
    env: configuredEnvironment,
    fetch: async (input, init = {}) => {
      captured.push({ url: new URL(input), init });
      return jsonResponse(body);
    }
  });
}

function assertSafeResult(result: VNextCanonicalMarketInventoryResult) {
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(readCredential), false);
  assert.equal(serialized.includes(marketIndexerBaseUrl), false);
  assert.equal(serialized.includes(new URL(marketIndexerBaseUrl).origin), false);
}

async function main() {
const captured: CapturedRequest[] = [];
const tokenResult = await readFixture(
  { token: `0x${stonkBrokerAddress.slice(2).toUpperCase()}`, limit: 1 },
  inventoryResponse([v4Pool]),
  captured
);
assert.equal(tokenResult.status, "verified_shadow");
if (tokenResult.status !== "verified_shadow") throw new Error("unreachable");
assert.equal(tokenResult.chainId, 4_663);
assert.equal(tokenResult.mode, "shadow");
assert.equal(tokenResult.authoritative, false);
assert.equal(tokenResult.sourceManifestHash, sourceManifestHash);
assert.deepEqual(tokenResult.coverage, completeCoverage);
assert.deepEqual(
  tokenResult.coverage.sources.map(({ sourceId }) => sourceId).sort(),
  [...canonicalSourceIds].sort()
);
assert.equal(tokenResult.nextCursor, null);
assert.deepEqual(tokenResult.pools, [v4Pool]);
assert.equal(tokenResult.pools[0]?.token1, stonkBrokerAddress);
assert.equal(tokenResult.pools[0]?.poolAddress, null);
assert.equal("price" in tokenResult.pools[0]!, false);
assert.equal("liquidity" in tokenResult.pools[0]!, false);
assert.equal("volume" in tokenResult.pools[0]!, false);
assert.equal("chart" in tokenResult.pools[0]!, false);
assert.equal("execution" in tokenResult.pools[0]!, false);
assertSafeResult(tokenResult);

assert.equal(captured.length, 1);
assert.equal(captured[0]?.url.pathname, "/service/v1/pools");
assert.equal(captured[0]?.url.searchParams.get("token"), stonkBrokerAddress);
assert.equal(captured[0]?.url.searchParams.get("limit"), "1");
assert.equal(captured[0]?.url.searchParams.size, 2);
assert.equal(captured[0]?.init.method, "GET");
assert.equal(captured[0]?.init.cache, "no-store");
assert.ok(captured[0]?.init.signal instanceof AbortSignal);
const capturedHeaders = new Headers(captured[0]?.init.headers);
assert.equal(capturedHeaders.get("accept"), "application/json");
assert.equal(capturedHeaders.get("authorization"), `Bearer ${readCredential}`);

for (const pool of [v2Pool, v3Pool, v4Pool]) {
  const result = await readFixture(
    { poolKey: pool.poolKey },
    inventoryResponse([pool])
  );
  assert.equal(result.status, "verified_shadow");
  if (result.status !== "verified_shadow") throw new Error("unreachable");
  assert.deepEqual(result.pools, [pool]);
  if (pool.version === 4) assert.equal(result.pools[0]?.poolAddress, null);
}

const nativeV4Result = await readFixture(
  { token: stonkBrokerAddress },
  inventoryResponse([nativeV4Pool])
);
assert.equal(nativeV4Result.status, "verified_shadow");
if (nativeV4Result.status !== "verified_shadow") throw new Error("unreachable");
assert.equal(nativeV4Result.pools[0]?.token0, zeroAddress);
assert.equal(nativeV4Result.pools[0]?.token1, stonkBrokerAddress);
assert.equal(nativeV4Result.pools[0]?.poolKey, v4Pool.poolKey);
assert.equal(nativeV4Result.pools[0]?.poolAddress, null);

const stateResult = await readFixture({}, inventoryResponse([upV2Pool]));
assert.equal(stateResult.status, "verified_shadow");
if (stateResult.status !== "verified_shadow") throw new Error("unreachable");
assert.deepEqual(stateResult.pools[0], upV2Pool);
assert.equal(stateResult.pools[0]?.stateStatus, "ready");
assert.equal(stateResult.pools[0]?.liveFee, 30);
assert.equal(stateResult.pools[0]?.stateObservedBlock, "104");

const emptyResult = await readFixture(
  { token: v2Pool.token0 },
  inventoryResponse([])
);
assert.deepEqual(emptyResult, {
  status: "verified_shadow",
  chainId: 4_663,
  mode: "shadow",
  authoritative: false,
  sourceManifestHash,
  coverage: completeCoverage,
  nextCursor: null,
  pools: []
});

const incompleteResult = await readFixture(
  {},
  inventoryResponse([], { coverage: incompleteCoverage })
);
assert.equal(incompleteResult.status, "verified_shadow");
if (incompleteResult.status !== "verified_shadow") throw new Error("unreachable");
assert.equal(incompleteResult.coverage.complete, false);
assert.equal(incompleteResult.coverage.sources.length, canonicalSourceIds.length);

const combinedCaptured: CapturedRequest[] = [];
const combinedResult = await readFixture(
  {
    token: stonkBrokerAddress,
    poolKey: v4Pool.poolKey,
    source: v4Pool.sourceId,
    limit: 25,
    cursor: requestCursor
  },
  inventoryResponse([v4Pool], { nextCursor: responseCursor }),
  combinedCaptured
);
assert.equal(combinedResult.status, "verified_shadow");
if (combinedResult.status !== "verified_shadow") throw new Error("unreachable");
assert.equal(combinedResult.nextCursor, responseCursor);
const combinedSearch = combinedCaptured[0]!.url.searchParams;
assert.equal(combinedSearch.get("token"), stonkBrokerAddress);
assert.equal(combinedSearch.get("poolKey"), v4Pool.poolKey);
assert.equal(combinedSearch.get("source"), v4Pool.sourceId);
assert.equal(combinedSearch.get("limit"), "25");
assert.equal(combinedSearch.get("cursor"), requestCursor);

let rejectedCallerFetches = 0;
const rejectedCallerDependencies = {
  env: configuredEnvironment,
  fetch: async () => {
    rejectedCallerFetches += 1;
    return jsonResponse(inventoryResponse([]));
  }
};
const invalidQueries: Array<{
  query: VNextCanonicalMarketInventoryQuery;
  reason:
    | "invalid_token"
    | "invalid_pool_key"
    | "invalid_source"
    | "invalid_limit"
    | "invalid_cursor";
}> = [
  { query: { token: "malformed" }, reason: "invalid_token" },
  { query: { token: `0x${"0".repeat(40)}` }, reason: "invalid_token" },
  { query: { poolKey: "0x1234" }, reason: "invalid_pool_key" },
  { query: { poolKey: `0x${"0".repeat(40)}` }, reason: "invalid_pool_key" },
  { query: { poolKey: `0x${"0".repeat(64)}` }, reason: "invalid_pool_key" },
  { query: { source: "UNSAFE SOURCE" }, reason: "invalid_source" },
  { query: { limit: 0 }, reason: "invalid_limit" },
  { query: { limit: 501 }, reason: "invalid_limit" },
  { query: { limit: 1.5 }, reason: "invalid_limit" },
  { query: { cursor: "not+base64url" }, reason: "invalid_cursor" },
  { query: { cursor: "a".repeat(1_025) }, reason: "invalid_cursor" }
];
for (const vector of invalidQueries) {
  assert.deepEqual(
    await readVNextCanonicalMarketInventory(
      vector.query,
      rejectedCallerDependencies
    ),
    { status: "invalid_query", reason: vector.reason }
  );
}
assert.equal(rejectedCallerFetches, 0);

let fallbackFetches = 0;
const originOnlyResult = await readVNextCanonicalMarketInventory(
  { token: stonkBrokerAddress },
  {
    env: {
      RMT_INDEXER_URL: "https://origin-indexer.internal.example",
      RMT_INDEXER_READ_TOKEN: "origin-credential-not-for-market-inventory"
    },
    fetch: async () => {
      fallbackFetches += 1;
      return jsonResponse(inventoryResponse([]));
    }
  }
);
assert.deepEqual(originOnlyResult, {
  status: "not_configured",
  reason: "market_indexer_not_configured"
});
assert.equal(fallbackFetches, 0);

for (const env of [
  { RMT_MARKET_INDEXER_URL: marketIndexerBaseUrl },
  { RMT_MARKET_INDEXER_READ_TOKEN: readCredential },
  { RMT_MARKET_INDEXER_TIMEOUT_MS: "5000" },
  {
    ...configuredEnvironment,
    RMT_MARKET_INDEXER_URL: "https://user:password@market-indexer.example"
  },
  {
    ...configuredEnvironment,
    RMT_MARKET_INDEXER_URL: "http://market-indexer.example"
  },
  {
    ...configuredEnvironment,
    RMT_MARKET_INDEXER_URL: "https://market-indexer.example?unsafe=true"
  },
  {
    ...configuredEnvironment,
    RMT_MARKET_INDEXER_URL: "https://market-indexer.example#unsafe"
  }
]) {
  assert.deepEqual(
    await readVNextCanonicalMarketInventory({}, { env }),
    { status: "misconfigured", reason: "market_indexer_misconfigured" }
  );
}

const loopbackResult = await readVNextCanonicalMarketInventory({}, {
  env: {
    ...configuredEnvironment,
    RMT_MARKET_INDEXER_URL: "http://127.0.0.1:43123"
  },
  fetch: async () => jsonResponse(inventoryResponse([]))
});
assert.equal(loopbackResult.status, "verified_shadow");

const httpFailure = await readVNextCanonicalMarketInventory({}, {
  env: configuredEnvironment,
  fetch: async () => jsonResponse({ internal: readCredential }, 503)
});
assert.deepEqual(httpFailure, {
  status: "upstream_unavailable",
  reason: "http_failure"
});
assertSafeResult(httpFailure);

const timeoutResult = await readVNextCanonicalMarketInventory({}, {
  env: configuredEnvironment,
  timeoutMs: 250,
  fetch: async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true }
      );
    })
});
assert.deepEqual(timeoutResult, {
  status: "upstream_unavailable",
  reason: "timeout"
});

const malformedJson = await readVNextCanonicalMarketInventory({}, {
  env: configuredEnvironment,
  fetch: async () => new Response("{not-json", { status: 200 })
});
assert.deepEqual(malformedJson, {
  status: "invalid_upstream_response",
  reason: "malformed_json"
});

async function expectSchemaRejection(body: unknown) {
  const result = await readFixture({}, body);
  assert.deepEqual(result, {
    status: "invalid_upstream_response",
    reason: "schema_mismatch"
  });
  assertSafeResult(result);
}

await expectSchemaRejection({ ...inventoryResponse([]), chainId: 1 });
await expectSchemaRejection({ ...inventoryResponse([]), authoritative: true });
await expectSchemaRejection({ ...inventoryResponse([]), mode: "production" });
await expectSchemaRejection({
  ...inventoryResponse([]),
  nextCursor: "not+base64url"
});
await expectSchemaRejection({
  ...inventoryResponse([]),
  coverage: { ...completeCoverage, unexpected: true }
});
await expectSchemaRejection({
  ...inventoryResponse([]),
  coverage: { ...completeCoverage, complete: true, finalizedHead: null }
});
await expectSchemaRejection({
  ...inventoryResponse([]),
  coverage: {
    ...completeCoverage,
    sources: completeCoverage.sources.slice(0, -1)
  }
});
await expectSchemaRejection({
  ...inventoryResponse([]),
  coverage: {
    ...completeCoverage,
    sources: [
      ...completeCoverage.sources,
      {
        sourceId: "bogus-source",
        status: "shadow-ready",
        indexedThrough: "200"
      }
    ]
  }
});
await expectSchemaRejection({
  ...inventoryResponse([]),
  coverage: {
    ...completeCoverage,
    sources: [
      ...completeCoverage.sources.slice(0, -1),
      completeCoverage.sources[0]
    ]
  }
});
await expectSchemaRejection({
  ...inventoryResponse([]),
  coverage: {
    ...incompleteCoverage,
    sources: incompleteCoverage.sources.slice(0, -1)
  }
});
await expectSchemaRejection({
  ...inventoryResponse([]),
  coverage: {
    complete: true,
    finalizedHead: "200",
    sources: completeCoverage.sources.map((source, index) =>
      index === 0
        ? { ...source, status: "backfilling", indexedThrough: "100" }
        : source
    )
  }
});
await expectSchemaRejection({
  ...inventoryResponse([]),
  coverage: {
    complete: true,
    finalizedHead: "200",
    sources: completeCoverage.sources.map((source, index) =>
      index === 0 ? { ...source, indexedThrough: "199" } : source
    )
  }
});
await expectSchemaRejection({
  ...inventoryResponse([]),
  sourceManifestHash: `0x${"0".repeat(64)}`
});
await expectSchemaRejection({ ...inventoryResponse([]), sourceManifestHash: "bad" });
await expectSchemaRejection(
  inventoryResponse([{ ...v4Pool, token1: zeroAddress }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v3Pool, token0: zeroAddress }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v3Pool, token1: zeroAddress }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v2Pool, token0: zeroAddress }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v2Pool, token1: zeroAddress }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...upV2Pool, token0: zeroAddress }])
);
await expectSchemaRejection(
  inventoryResponse([{
    ...v3Pool,
    sourceId: "sushiswap-v3",
    protocol: "sushiswap",
    token0: zeroAddress
  }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v2Pool, poolAddress: v3Pool.poolAddress }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v3Pool, poolAddress: null }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v4Pool, poolAddress: v2Pool.poolAddress }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v2Pool, sourceId: "bogus-source" }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v2Pool, sourceId: "uniswap-v2" }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v3Pool, sourceId: "uniswap-v2" }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v4Pool, sourceId: "uniswap-v3" }])
);
await expectSchemaRejection(
  inventoryResponse([{ ...v2Pool, liveFee: 30 }])
);

const tokenMismatch = await readFixture(
  { token: stonkBrokerAddress },
  inventoryResponse([v2Pool])
);
assert.deepEqual(tokenMismatch, {
  status: "invalid_upstream_response",
  reason: "query_mismatch"
});
const poolKeyMismatch = await readFixture(
  { poolKey: v2Pool.poolKey },
  inventoryResponse([v3Pool])
);
assert.deepEqual(poolKeyMismatch, {
  status: "invalid_upstream_response",
  reason: "query_mismatch"
});
const sourceMismatch = await readFixture(
  { source: v2Pool.sourceId },
  inventoryResponse([v3Pool])
);
assert.deepEqual(sourceMismatch, {
  status: "invalid_upstream_response",
  reason: "query_mismatch"
});
const overLimit = await readFixture(
  { limit: 1 },
  inventoryResponse([v2Pool, v3Pool])
);
assert.deepEqual(overLimit, {
  status: "invalid_upstream_response",
  reason: "query_mismatch"
});

for (const echoedValue of [readCredential, marketIndexerBaseUrl]) {
  const sensitiveEcho = await readFixture(
    {},
    inventoryResponse([
      {
        ...upV2Pool,
        stateStatus: "error",
        liveFee: null,
        feeDenominator: null,
        stateError: echoedValue,
        stateObservedBlock: "105",
        stateObservedBlockHash: `0x${"36".repeat(32)}`
      }
    ])
  );
  assert.deepEqual(sensitiveEcho, {
    status: "invalid_upstream_response",
    reason: "sensitive_echo"
  });
  assertSafeResult(sensitiveEcho);
}

const moduleSource = await readFile(
  new URL("./vnext-market-indexer.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(moduleSource, /NEXT_PUBLIC_RMT_MARKET_INDEXER/);
assert.doesNotMatch(moduleSource, /Dexscreener|GeckoTerminal|DeFiLlama/);
assert.doesNotMatch(moduleSource, /RMT_INDEXER_URL|RMT_INDEXER_READ_TOKEN/);
assert.doesNotMatch(moduleSource, /sendTransaction|signTransaction|walletClient/);

const envExample = await readFile(
  new URL("../../.env.example", import.meta.url),
  "utf8"
);
assert.match(envExample, /^RMT_MARKET_INDEXER_URL=$/m);
assert.match(envExample, /^RMT_MARKET_INDEXER_READ_TOKEN=$/m);
assert.match(envExample, /^RMT_MARKET_INDEXER_TIMEOUT_MS=5000$/m);
assert.doesNotMatch(envExample, /^NEXT_PUBLIC_RMT_MARKET_INDEXER_/m);

console.info("VNext canonical market inventory adapter smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
