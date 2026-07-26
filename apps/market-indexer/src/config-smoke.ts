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
assert.equal(config.databaseSsl, false);

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

console.info("market indexer config smoke passed");
