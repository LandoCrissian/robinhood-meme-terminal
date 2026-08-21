import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
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
const indexedPools = [v3Pool, v2Pool, v4Pool];
const poolQueries: Array<{ text: string; values: unknown[] }> = [];
const pool = {
  query: async (text: string, values: unknown[]) => {
    poolQueries.push({ text, values });
    const [chainId, sourceId, token, poolKey, limit] = values as [
      number,
      string | null,
      string | null,
      string | null,
      number
    ];
    assert.equal(chainId, 4_663);
    const rows = indexedPools
      .filter((row) => sourceId === null || row.sourceId === sourceId)
      .filter(
        (row) => token === null || row.token0 === token || row.token1 === token
      )
      .filter((row) => poolKey === null || row.poolKey === poolKey)
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
  const allPoolsResponse = await fetch(`${origin}/v1/pools`, {
    headers: poolHeaders
  });
  const allPools = (await allPoolsResponse.json()) as {
    mode: string;
    authoritative: boolean;
    pools: typeof indexedPools;
  };
  assert.equal(allPoolsResponse.status, 200);
  assert.equal(allPools.mode, "shadow");
  assert.equal(allPools.authoritative, false);
  assert.deepEqual(allPools.pools, indexedPools);
  const unfilteredQuery = poolQueries.at(-1)!;
  assert.deepEqual(unfilteredQuery.values, [4_663, null, null, null, 100]);
  assert.ok(
    unfilteredQuery.text.indexOf("pools.token0 = $3") <
      unfilteredQuery.text.indexOf("LIMIT $5")
  );
  assert.ok(
    unfilteredQuery.text.indexOf("pools.pool_key = $4") <
      unfilteredQuery.text.indexOf("LIMIT $5")
  );

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
  assert.equal(poolQueries.at(-1)!.values[2], stonkBrokerAddress);
  assert.equal(poolQueries.at(-1)!.values[4], 1);

  for (const expected of [v2Pool, v3Pool]) {
    const poolKeyResponse = await fetch(
      `${origin}/v1/pools?poolKey=${expected.poolKey}`,
      { headers: poolHeaders }
    );
    const poolKeyResult = (await poolKeyResponse.json()) as {
      pools: typeof indexedPools;
    };
    assert.equal(poolKeyResponse.status, 200);
    assert.deepEqual(poolKeyResult.pools, [expected]);
  }

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
  assert.equal(poolQueries.at(-1)!.values[3], v4Pool.poolKey);

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
    "limit=501"
  ];
  for (const query of invalidQueries) {
    const invalidResponse = await fetch(`${origin}/v1/pools?${query}`, {
      headers: poolHeaders
    });
    assert.equal(invalidResponse.status, 400, query);
  }
  assert.equal(poolQueries.length, queryCountBeforeInvalidRequests);
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

console.info("market indexer server smoke passed");
