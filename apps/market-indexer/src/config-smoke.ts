import assert from "node:assert/strict";
import { loadMarketIndexerConfig } from "./config.js";

const base = {
  MARKET_INDEXER_DATABASE_URL:
    "postgres://postgres:postgres@localhost:5432/rmt_market_indexer",
  MARKET_INDEXER_RPC_URL: "https://rpc.mainnet.chain.robinhood.com/",
  MARKET_INDEXER_READ_TOKEN: "ci-market-indexer-read-token-000000000001",
  PGSSLMODE: "disable"
};

const config = loadMarketIndexerConfig(base);
assert.equal(config.confirmations, 20);
assert.equal(config.batchSize, 5_000);
assert.equal(config.heartbeatIntervalMs, 60_000);
assert.equal(config.databaseSsl, false);
assert.equal(config.storageMode, "durable");
assert.equal(config.databaseSizeLimitBytes, null);

assert.equal(
  loadMarketIndexerConfig({
    ...base,
    MARKET_INDEXER_STORAGE_MODE: "rebuildable"
  }).storageMode,
  "rebuildable"
);
assert.equal(
  loadMarketIndexerConfig({
    ...base,
    MARKET_INDEXER_MAX_DATABASE_MB: "350"
  }).databaseSizeLimitBytes,
  350 * 1024 * 1024
);

assert.throws(
  () =>
    loadMarketIndexerConfig({
      ...base,
      DATABASE_URL: base.MARKET_INDEXER_DATABASE_URL
    }),
  /must not equal DATABASE_URL/
);
assert.throws(
  () =>
    loadMarketIndexerConfig({
      ...base,
      MARKET_INDEXER_RPC_URL: "http://rpc.example"
    }),
  /must be HTTPS/
);
assert.throws(
  () =>
    loadMarketIndexerConfig({
      ...base,
      MARKET_INDEXER_CONFIRMATIONS: "11"
    }),
  /between 12 and 10000/
);
assert.throws(
  () =>
    loadMarketIndexerConfig({
      ...base,
      MARKET_INDEXER_READ_TOKEN: "short"
    }),
  /32 to 512/
);
assert.throws(
  () =>
    loadMarketIndexerConfig({
      ...base,
      MARKET_INDEXER_STORAGE_MODE: "temporary"
    }),
  /must be durable or rebuildable/
);
assert.throws(
  () =>
    loadMarketIndexerConfig({
      ...base,
      MARKET_INDEXER_MAX_DATABASE_MB: "63"
    }),
  /between 64 and 1000000/
);
assert.throws(
  () =>
    loadMarketIndexerConfig({
      ...base,
      MARKET_INDEXER_HEARTBEAT_INTERVAL_MS: "9999"
    }),
  /between 10000 and 3600000/
);

console.info("market indexer config smoke passed");
