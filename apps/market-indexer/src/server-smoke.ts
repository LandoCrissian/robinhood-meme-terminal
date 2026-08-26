import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import type { Pool } from "pg";
import { loadMarketIndexerConfig } from "./config.js";
import { createMarketIndexerServer } from "./server.js";
import { marketSources } from "./sources.js";
import type { MarketIndexerWorker } from "./worker.js";

const readToken = "server-smoke-read-token-0000000000000001";
const config = loadMarketIndexerConfig({
  MARKET_INDEXER_DATABASE_URL:
    "postgres://postgres:postgres@localhost:5432/rmt_market_indexer",
  MARKET_INDEXER_RPC_URL: "https://rpc.mainnet.chain.robinhood.com/",
  MARKET_INDEXER_READ_TOKEN: readToken,
  MARKET_INDEXER_STORAGE_MODE: "rebuildable",
  MARKET_INDEXER_MAX_DATABASE_MB: "350",
  PGSSLMODE: "disable"
});
const now = new Date().toISOString();
const totalPools = marketSources.reduce(
  (total, _source, index) => total + index + 1,
  0
);
const sources = marketSources.map((source, index) => ({
  sourceId: source.id,
  status: "backfilling" as const,
  startBlock: source.startBlock.toString(),
  nextBlock: "101",
  indexedThrough: "100",
  finalizedHead: "110",
  lagBlocks: "10",
  poolCount: index + 1,
  stateReadyCount: source.protocol === "up" ? 1 : 0,
  stateErrorCount: source.id === "up-cl" ? 1 : 0,
  lastSyncAt: now,
  updatedAt: now,
  error: null
}));
const worker = {
  status: {
    running: false,
    cycleSequence: 3,
    verifiedSources: marketSources.map((source) => source.id),
    verifiedDependencies: [
      "up-voter",
      "up-v2-pool-implementation",
      "up-cl-pool-implementation"
    ],
    indexedThrough: Object.fromEntries(
      marketSources.map((source) => [source.id, "100"])
    ),
    lastSyncAt: now,
    lastError: null,
    lastCycleStartedAt: now,
    lastCycleCompletedAt: now,
    lastCycleDurationMs: 42,
    lastFinalizedHead: "110",
    telemetry: {
      capturedAt: now,
      finalizedHead: "110",
      totalPools,
      stateReadyPools: 2,
      stateErrorPools: 1,
      database: {
        scope: "logical-database-only" as const,
        logicalBytes: 10_000,
        configuredLimitBytes: config.databaseSizeLimitBytes,
        remainingLogicalBytes: config.databaseSizeLimitBytes! - 10_000,
        usageBps: 0,
        pressure: "healthy" as const,
        providerVolumeIncluded: false as const
      },
      sources
    }
  }
} as unknown as MarketIndexerWorker;

const stonkBrokerAddress = "0xe934e36a439c94017b64a3fece66af12099abf50";
const v2Pool = {
  sourceId: "uniswap-v2",
  protocol: "uniswap",
  version: 2,
  poolKey: "0x2222222222222222222222222222222222222222",
  poolAddress: "0x2222222222222222222222222222222222222222",
  token0: "0x3333333333333333333333333333333333333333",
  token1: "0x4444444444444444444444444444444444444444",
  stable: null,
  fee: null,
  tickSpacing: null,
  hooks: null,
  transactionHash: `0x${"21".repeat(32)}`,
  blockNumber: "101",
  blockHash: `0x${"31".repeat(32)}`,
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
};
const v3Pool = {
  ...v2Pool,
  sourceId: "uniswap-v3",
  version: 3,
  poolKey: "0x5555555555555555555555555555555555555555",
  poolAddress: "0x5555555555555555555555555555555555555555",
  token0: "0x6666666666666666666666666666666666666666",
  token1: "0x7777777777777777777777777777777777777777",
  fee: 3_000,
  tickSpacing: 60,
  transactionHash: `0x${"22".repeat(32)}`,
  blockNumber: "102",
  blockHash: `0x${"32".repeat(32)}`
};
const alternateV2Pool = {
  ...v2Pool,
  sourceId: "sushiswap-v2",
  protocol: "sushiswap",
  transactionHash: `0x${"25".repeat(32)}`,
  blockNumber: "100",
  blockHash: `0x${"35".repeat(32)}`
};
const v4Pool = {
  ...v2Pool,
  sourceId: "uniswap-v4",
  version: 4,
  poolKey: `0x${"42".repeat(32)}`,
  poolAddress: null,
  token0: "0x1111111111111111111111111111111111111111",
  token1: stonkBrokerAddress,
  fee: 3_000,
  tickSpacing: 60,
  hooks: "0x8888888888888888888888888888888888888888",
  transactionHash: `0x${"23".repeat(32)}`,
  blockNumber: "99",
  blockHash: `0x${"33".repeat(32)}`
};
const olderV4Pool = {
  ...v4Pool,
  poolKey: `0x${"43".repeat(32)}`,
  poolAddress: null,
  transactionHash: `0x${"24".repeat(32)}`,
  blockNumber: "98",
  blockHash: `0x${"34".repeat(32)}`
};
const indexedPools = [v3Pool, v2Pool, alternateV2Pool, v4Pool, olderV4Pool];
const indexedRows = [
  { ...v3Pool, logIndex: 0 },
  { ...v2Pool, logIndex: 4 },
  { ...alternateV2Pool, logIndex: 3 },
  { ...v4Pool, logIndex: 2 },
  { ...olderV4Pool, logIndex: 1 }
];
const poolQueries: Array<{ text: string; values: unknown[] }> = [];
const pool = {
  query: async (text: string, values: unknown[]) => {
    poolQueries.push({ text, values });
    if (text.includes("market_token_identity_shard")) {
      return { rows: [{
        shard: Number.parseInt(stonkBrokerAddress.slice(2, 4), 16),
        payload: gzipSync(Buffer.from(JSON.stringify([[
          stonkBrokerAddress.slice(2), "r", "StonkBrokers", "STONKBROKER", 18
        ]]), "utf8"))
      }] };
    }
    if (text.includes("market_token_identity_catalog_state")) {
      return { rows: [{
        total_canonical_markets: 4_001,
        total_unique_tokens: 1,
        evaluated_tokens: 1,
        verified_tokens: 1,
        complete: true
      }] };
    }
    if (text.includes("FROM matched_pools AS pools")) {
      return { rows: [{ ...v4Pool, matchedToken: stonkBrokerAddress, logIndex: 2 }] };
    }
    const [
      sourceId,
      token,
      poolKey,
      cursorBlock,
      cursorLogIndex,
      limit
    ] = values as [
      string | null,
      string | null,
      string | null,
      string | null,
      number | null,
      number
    ];
    const rows = indexedRows
      .filter((row) => sourceId === null || row.sourceId === sourceId)
      .filter(
        (row) => token === null || row.token0 === token || row.token1 === token
      )
      .filter((row) => poolKey === null || row.poolKey === poolKey)
      .filter((row) => {
        if (cursorBlock === null) return true;
        const blockDifference = BigInt(row.blockNumber) - BigInt(cursorBlock);
        if (blockDifference !== 0n) return blockDifference < 0n;
        return row.logIndex < cursorLogIndex!;
      })
      .slice(0, limit);
    return { rows };
  }
} as unknown as Pool;
const server = createMarketIndexerServer(pool, config, worker);
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

try {
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const healthResponse = await fetch(`${origin}/health`);
  const healthText = await healthResponse.text();
  const health = JSON.parse(healthText);
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get("cache-control"), "no-store");
  assert.equal(health.ok, true);
  assert.equal(health.activationLocked, true);
  assert.equal(health.authoritative, false);
  assert.equal(health.database.scope, "logical-database-only");
  assert.equal(health.database.providerVolumeIncluded, false);
  assert.equal(health.totalPools, totalPools);
  assert.equal(health.stateReadyPools, 2);
  assert.equal(health.stateErrorPools, 1);
  assert.equal(healthText.includes(readToken), false);
  assert.equal(healthText.includes(config.databaseUrl), false);

  worker.status.lastCycleCompletedAt = "2026-01-01T00:00:00.000Z";
  const staleResponse = await fetch(`${origin}/health`);
  const stale = (await staleResponse.json()) as {
    ok: boolean;
    heartbeat: { stale: boolean };
  };
  assert.equal(staleResponse.status, 200);
  assert.equal(stale.ok, false);
  assert.equal(stale.heartbeat.stale, true);
  worker.status.lastCycleCompletedAt = now;

  const readyResponse = await fetch(`${origin}/ready`);
  assert.equal(readyResponse.status, 503);

  const unauthorized = await fetch(`${origin}/v1/status`);
  assert.equal(unauthorized.status, 401);
  const wrongToken = await fetch(`${origin}/v1/status`, {
    headers: { authorization: "Bearer wrong-token" }
  });
  assert.equal(wrongToken.status, 401);
  const statusResponse = await fetch(`${origin}/v1/status`, {
    headers: { authorization: `Bearer ${readToken}` }
  });
  const statusText = await statusResponse.text();
  const status = JSON.parse(statusText);
  assert.equal(statusResponse.status, 200);
  assert.equal(status.activationLocked, true);
  assert.equal(status.telemetry.totalPools, totalPools);
  assert.equal(statusText.includes(readToken), false);
  assert.equal(statusText.includes(config.databaseUrl), false);

  const unauthorizedPools = await fetch(`${origin}/v1/pools`);
  assert.equal(unauthorizedPools.status, 401);
  const poolHeaders = { authorization: `Bearer ${readToken}` };

  const unauthorizedTokenSearch = await fetch(`${origin}/v1/token-identities/search?q=STONKBROKER`);
  assert.equal(unauthorizedTokenSearch.status, 401);
  const tokenSearchResponse = await fetch(
    `${origin}/v1/token-identities/search?q=STONKBROKER&limit=64`,
    { headers: poolHeaders }
  );
  const tokenSearch = (await tokenSearchResponse.json()) as {
    capacity: { complete: boolean; totalCanonicalMarkets: number; totalUniqueCanonicalTokens: number };
    entries: Array<{ address: string; markets: typeof indexedPools }>;
  };
  assert.equal(tokenSearchResponse.status, 200);
  assert.equal(tokenSearch.capacity.complete, true);
  assert.equal(tokenSearch.capacity.totalCanonicalMarkets, 4_001);
  assert.equal(tokenSearch.capacity.totalUniqueCanonicalTokens, 1);
  assert.equal(tokenSearch.entries[0]?.address.toLowerCase(), stonkBrokerAddress);
  assert.deepEqual(tokenSearch.entries[0]?.markets, [v4Pool]);
  assert.match(
    poolQueries.find((query) => query.text.includes("FROM matched_pools AS pools"))?.text ?? "",
    /token_rank <= 16/
  );

  const cursorFor = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const allPoolsResponse = await fetch(`${origin}/v1/pools`, {
    headers: poolHeaders
  });
  const allPools = (await allPoolsResponse.json()) as {
    mode: string;
    authoritative: boolean;
    pools: typeof indexedPools;
    nextCursor: string | null;
    coverage: {
      complete: boolean;
      finalizedHead: string | null;
      sources: Array<{
        sourceId: string;
        status: string;
        indexedThrough: string | null;
      }>;
    };
  };
  assert.equal(allPoolsResponse.status, 200);
  assert.equal(allPools.mode, "shadow");
  assert.equal(allPools.authoritative, false);
  assert.deepEqual(allPools.pools, indexedPools);
  assert.equal(allPools.nextCursor, null);
  assert.equal(allPools.coverage.complete, false);
  assert.equal(allPools.coverage.finalizedHead, "110");
  assert.equal(allPools.coverage.sources.length, marketSources.length);
  assert.equal(
    allPools.pools.some((row) => "transactionIndex" in row || "logIndex" in row),
    false
  );
  const unfilteredQuery = poolQueries.at(-1)!;
  assert.deepEqual(unfilteredQuery.values, [
    null,
    null,
    null,
    null,
    null,
    101
  ]);
  assert.ok(
    unfilteredQuery.text.indexOf("pools.token0 = decode(substring($2") <
      unfilteredQuery.text.indexOf("LIMIT $6")
  );
  assert.ok(
    unfilteredQuery.text.indexOf("pools.pool_key = decode(substring($3") <
      unfilteredQuery.text.indexOf("LIMIT $6")
  );
  assert.ok(
    unfilteredQuery.text.indexOf("pools.block_number, pools.log_index") <
      unfilteredQuery.text.indexOf("LIMIT $6")
  );

  const firstPageResponse = await fetch(`${origin}/v1/pools?limit=2`, {
    headers: poolHeaders
  });
  const firstPage = (await firstPageResponse.json()) as {
    pools: typeof indexedPools;
    nextCursor: string | null;
  };
  assert.equal(firstPageResponse.status, 200);
  assert.deepEqual(firstPage.pools, [v3Pool, v2Pool]);
  assert.match(firstPage.nextCursor ?? "", /^[A-Za-z0-9_-]+$/);
  assert.equal(poolQueries.at(-1)!.values[5], 3);

  const secondPageResponse = await fetch(
    `${origin}/v1/pools?limit=2&cursor=${firstPage.nextCursor}`,
    { headers: poolHeaders }
  );
  const secondPage = (await secondPageResponse.json()) as {
    pools: typeof indexedPools;
    nextCursor: string | null;
  };
  assert.equal(secondPageResponse.status, 200);
  assert.deepEqual(secondPage.pools, [alternateV2Pool, v4Pool]);
  assert.notEqual(secondPage.nextCursor, null);
  assert.equal(
    firstPage.pools.some((first) =>
      secondPage.pools.some(
        (second) =>
          first.sourceId === second.sourceId && first.poolKey === second.poolKey
      )
    ),
    false
  );
  assert.equal(secondPage.pools[1]?.poolAddress, null);

  const finalPageResponse = await fetch(
    `${origin}/v1/pools?limit=2&cursor=${secondPage.nextCursor}`,
    { headers: poolHeaders }
  );
  const finalPage = (await finalPageResponse.json()) as {
    pools: typeof indexedPools;
    nextCursor: string | null;
  };
  assert.deepEqual(finalPage.pools, [olderV4Pool]);
  assert.equal(finalPage.nextCursor, null);
  assert.equal(finalPage.pools[0]?.poolAddress, null);
  assert.equal(
    secondPage.pools.some((second) =>
      finalPage.pools.some(
        (final) =>
          second.sourceId === final.sourceId && second.poolKey === final.poolKey
      )
    ),
    false
  );

  const repeatedFirstPage = (await (
    await fetch(`${origin}/v1/pools?limit=2`, { headers: poolHeaders })
  ).json()) as { pools: typeof indexedPools; nextCursor: string | null };
  assert.deepEqual(repeatedFirstPage, firstPage);

  const tokenResponse = await fetch(
    `${origin}/v1/pools?limit=1&token=0x${stonkBrokerAddress.slice(2).toUpperCase()}`,
    { headers: poolHeaders }
  );
  const tokenResult = (await tokenResponse.json()) as {
    pools: typeof indexedPools;
  };
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokenResult.pools.length, 1);
  assert.deepEqual(tokenResult.pools[0], v4Pool);
  assert.equal(tokenResult.pools[0]?.poolAddress, null);
  assert.equal("chart" in tokenResult.pools[0]!, false);
  assert.equal("liquidity" in tokenResult.pools[0]!, false);
  assert.equal("volume" in tokenResult.pools[0]!, false);
  assert.equal("executionRoute" in tokenResult.pools[0]!, false);
  assert.equal(poolQueries.at(-1)!.values[1], stonkBrokerAddress);
  assert.equal(poolQueries.at(-1)!.values[5], 2);

  const tokenFirst = tokenResult as typeof tokenResult & {
    nextCursor: string | null;
  };
  assert.notEqual(tokenFirst.nextCursor, null);
  const tokenSecond = (await (
    await fetch(
      `${origin}/v1/pools?limit=1&token=${stonkBrokerAddress}&cursor=${tokenFirst.nextCursor}`,
      { headers: poolHeaders }
    )
  ).json()) as { pools: typeof indexedPools; nextCursor: string | null };
  assert.deepEqual(tokenSecond.pools, [olderV4Pool]);
  assert.equal(tokenSecond.nextCursor, null);

  const sourceFirst = (await (
    await fetch(`${origin}/v1/pools?limit=1&source=uniswap-v4`, {
      headers: poolHeaders
    })
  ).json()) as { pools: typeof indexedPools; nextCursor: string | null };
  assert.deepEqual(sourceFirst.pools, [v4Pool]);
  assert.notEqual(sourceFirst.nextCursor, null);
  const sourceSecond = (await (
    await fetch(
      `${origin}/v1/pools?limit=1&source=uniswap-v4&cursor=${sourceFirst.nextCursor}`,
      { headers: poolHeaders }
    )
  ).json()) as { pools: typeof indexedPools; nextCursor: string | null };
  assert.deepEqual(sourceSecond.pools, [olderV4Pool]);
  assert.equal(sourceSecond.nextCursor, null);

  const filteredFirstResponse = await fetch(
    `${origin}/v1/pools?source=uniswap-v4&token=${stonkBrokerAddress}&limit=1`,
    { headers: poolHeaders }
  );
  const filteredFirst = (await filteredFirstResponse.json()) as {
    pools: typeof indexedPools;
    nextCursor: string | null;
  };
  assert.deepEqual(filteredFirst.pools, [v4Pool]);
  assert.notEqual(filteredFirst.nextCursor, null);
  const filteredSecondResponse = await fetch(
    `${origin}/v1/pools?source=uniswap-v4&token=${stonkBrokerAddress}&limit=1&cursor=${filteredFirst.nextCursor}`,
    { headers: poolHeaders }
  );
  const filteredSecond = (await filteredSecondResponse.json()) as {
    pools: typeof indexedPools;
    nextCursor: string | null;
  };
  assert.deepEqual(filteredSecond.pools, [olderV4Pool]);
  assert.equal(filteredSecond.nextCursor, null);

  const mismatchedFilteredCursor = await fetch(
    `${origin}/v1/pools?token=${stonkBrokerAddress}&limit=1&cursor=${filteredFirst.nextCursor}`,
    { headers: poolHeaders }
  );
  assert.equal(mismatchedFilteredCursor.status, 400);
  const mismatchedSourceCursor = await fetch(
    `${origin}/v1/pools?source=uniswap-v3&limit=1&cursor=${sourceFirst.nextCursor}`,
    { headers: poolHeaders }
  );
  assert.equal(mismatchedSourceCursor.status, 400);
  const mismatchedPoolKeyCursor = await fetch(
    `${origin}/v1/pools?poolKey=${v4Pool.poolKey}&limit=1&cursor=${firstPage.nextCursor}`,
    { headers: poolHeaders }
  );
  assert.equal(mismatchedPoolKeyCursor.status, 400);

  const v2PoolKeyResponse = await fetch(
    `${origin}/v1/pools?limit=1&poolKey=${v2Pool.poolKey}`,
    { headers: poolHeaders }
  );
  const v2PoolKeyResult = (await v2PoolKeyResponse.json()) as {
    pools: typeof indexedPools;
    nextCursor: string | null;
  };
  assert.deepEqual(v2PoolKeyResult.pools, [v2Pool]);
  assert.notEqual(v2PoolKeyResult.nextCursor, null);
  const v2PoolKeyContinuation = (await (
    await fetch(
      `${origin}/v1/pools?limit=1&poolKey=${v2Pool.poolKey}&cursor=${v2PoolKeyResult.nextCursor}`,
      { headers: poolHeaders }
    )
  ).json()) as { pools: typeof indexedPools; nextCursor: string | null };
  assert.deepEqual(v2PoolKeyContinuation.pools, [alternateV2Pool]);
  assert.equal(v2PoolKeyContinuation.nextCursor, null);

  const v3PoolKeyResponse = await fetch(
    `${origin}/v1/pools?poolKey=${v3Pool.poolKey}`,
    { headers: poolHeaders }
  );
  const v3PoolKeyResult = (await v3PoolKeyResponse.json()) as {
    pools: typeof indexedPools;
  };
  assert.equal(v3PoolKeyResponse.status, 200);
  assert.deepEqual(v3PoolKeyResult.pools, [v3Pool]);

  const v4PoolKeyResponse = await fetch(
    `${origin}/v1/pools?poolKey=${v4Pool.poolKey.toUpperCase().replace("0X", "0x")}`,
    { headers: poolHeaders }
  );
  const v4PoolKeyResult = (await v4PoolKeyResponse.json()) as {
    pools: typeof indexedPools;
  };
  assert.equal(v4PoolKeyResponse.status, 200);
  assert.deepEqual(v4PoolKeyResult.pools, [v4Pool]);
  assert.equal(v4PoolKeyResult.pools[0]?.poolAddress, null);
  assert.equal(poolQueries.at(-1)!.values[2], v4Pool.poolKey);

  const combinedMatch = await fetch(
    `${origin}/v1/pools?source=uniswap-v4&token=${stonkBrokerAddress}&poolKey=${v4Pool.poolKey}`,
    { headers: poolHeaders }
  );
  assert.deepEqual(
    ((await combinedMatch.json()) as { pools: typeof indexedPools }).pools,
    [v4Pool]
  );
  const combinedMismatch = await fetch(
    `${origin}/v1/pools?token=${stonkBrokerAddress}&poolKey=${v2Pool.poolKey}`,
    { headers: poolHeaders }
  );
  assert.deepEqual(
    ((await combinedMismatch.json()) as { pools: typeof indexedPools }).pools,
    []
  );

  const cursorTemplate = {
    v: 2,
    chainId: 4_663,
    source: null,
    token: null,
    poolKey: null,
    blockNumber: "101",
    logIndex: 4
  };

  const queryCountBeforeInvalidRequests = poolQueries.length;
  const invalidQueries = [
    "token=not-an-address",
    `token=0x${"0".repeat(40)}`,
    `token=0x${"1".repeat(42)}`,
    "poolKey=not-a-pool-key",
    `poolKey=0x${"0".repeat(40)}`,
    `poolKey=0x${"0".repeat(64)}`,
    `poolKey=0x${"1".repeat(62)}`,
    "source=unsupported",
    "limit=0",
    "limit=501",
    "cursor=not+base64url",
    `cursor=${"a".repeat(1_025)}`,
    `cursor=${cursorFor({ ...cursorTemplate, v: 1 })}`,
    `cursor=${cursorFor({ ...cursorTemplate, chainId: 1 })}`,
    `cursor=${cursorFor({ ...cursorTemplate, blockNumber: "01" })}`,
    `cursor=${cursorFor({ ...cursorTemplate, logIndex: -1 })}`,
    `token=${stonkBrokerAddress}&cursor=${cursorFor(cursorTemplate)}`
  ];
  for (const query of invalidQueries) {
    const invalidResponse = await fetch(`${origin}/v1/pools?${query}`, {
      headers: poolHeaders
    });
    assert.equal(invalidResponse.status, 400, query);
  }
  assert.equal(poolQueries.length, queryCountBeforeInvalidRequests);

  const originalTelemetry = worker.status.telemetry;
  const originalLastError = worker.status.lastError;
  const originalCompletedAt = worker.status.lastCycleCompletedAt;

  worker.status.telemetry = null;
  const missingTelemetryCoverage = (await (
    await fetch(`${origin}/v1/pools?limit=1`, { headers: poolHeaders })
  ).json()) as { coverage: typeof allPools.coverage };
  assert.equal(missingTelemetryCoverage.coverage.complete, false);
  assert.equal(
    missingTelemetryCoverage.coverage.sources.every(
      (source) => source.status === "missing" && source.indexedThrough === null
    ),
    true
  );

  worker.status.telemetry = originalTelemetry;
  worker.status.lastCycleCompletedAt = "2026-01-01T00:00:00.000Z";
  const staleCoverage = (await (
    await fetch(`${origin}/v1/pools?limit=1`, { headers: poolHeaders })
  ).json()) as { coverage: typeof allPools.coverage };
  assert.equal(staleCoverage.coverage.complete, false);

  worker.status.lastCycleCompletedAt = originalCompletedAt;
  worker.status.lastError = "synthetic worker failure";
  const workerErrorCoverage = (await (
    await fetch(`${origin}/v1/pools?limit=1`, { headers: poolHeaders })
  ).json()) as { coverage: typeof allPools.coverage };
  assert.equal(workerErrorCoverage.coverage.complete, false);

  worker.status.lastError = originalLastError;
  worker.status.telemetry = {
    ...originalTelemetry!,
    sources: originalTelemetry!.sources.map((source, index) => ({
      ...source,
      status: index === 0 ? "error" : "shadow-ready",
      error: index === 0 ? "synthetic source failure" : null,
      indexedThrough: "110",
      finalizedHead: "110",
      lagBlocks: "0",
      lastSyncAt: now
    }))
  };
  const sourceErrorCoverage = (await (
    await fetch(`${origin}/v1/pools?limit=1`, { headers: poolHeaders })
  ).json()) as { coverage: typeof allPools.coverage };
  assert.equal(sourceErrorCoverage.coverage.complete, false);

  worker.status.telemetry = {
    ...originalTelemetry!,
    sources: originalTelemetry!.sources.map((source) => ({
      ...source,
      status: "shadow-ready" as const,
      error: null,
      indexedThrough: "110",
      finalizedHead: "110",
      lagBlocks: "0",
      lastSyncAt: now
    }))
  };
  const completeCoverage = (await (
    await fetch(`${origin}/v1/pools?limit=1`, { headers: poolHeaders })
  ).json()) as { coverage: typeof allPools.coverage };
  assert.equal(completeCoverage.coverage.complete, true);
  assert.equal(
    completeCoverage.coverage.sources.every(
      (source) =>
        source.status === "shadow-ready" && source.indexedThrough === "110"
    ),
    true
  );

  worker.status.telemetry = originalTelemetry;
  worker.status.lastError = originalLastError;
  worker.status.lastCycleCompletedAt = originalCompletedAt;
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

console.info("market indexer server smoke passed");
