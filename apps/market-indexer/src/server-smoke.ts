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
const pool = {
  query: async () => ({ rows: [] })
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
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

console.info("market indexer server smoke passed");
