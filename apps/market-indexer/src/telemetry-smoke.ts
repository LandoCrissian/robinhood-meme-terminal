import assert from "node:assert/strict";
import type { Pool } from "pg";
import { marketSources } from "./sources.js";
import {
  databaseTelemetry,
  readMarketIndexerTelemetry
} from "./telemetry.js";

assert.equal(databaseTelemetry(7_999, 10_000).pressure, "healthy");
assert.equal(databaseTelemetry(8_000, 10_000).pressure, "warning");
assert.equal(databaseTelemetry(9_000, 10_000).pressure, "critical");
assert.equal(databaseTelemetry(10_000, 10_000).pressure, "limit-reached");
assert.equal(databaseTelemetry(1, null).pressure, "unbounded");
assert.throws(() => databaseTelemetry(-1, 10_000), /invalid database size/);

const sourceRows = marketSources.map((source, index) => ({
  source_id: source.id,
  status: index === 0 ? ("shadow-ready" as const) : ("backfilling" as const),
  start_block: source.startBlock.toString(),
  next_block: "101",
  pool_count: String(index + 1),
  state_ready_count: source.protocol === "up" ? "1" : "0",
  state_error_count: source.id === "up-cl" ? "1" : "0",
  last_sync_at: "2026-07-27T12:00:00.000Z",
  updated_at: "2026-07-27T12:00:01.000Z",
  last_error: null
}));

function fakePool(rows = sourceRows, databaseBytes = "8192") {
  return {
    query: async (sql: string) =>
      sql.includes("pg_database_size")
        ? { rows: [{ bytes: databaseBytes }] }
        : { rows }
  } as unknown as Pool;
}

const telemetry = await readMarketIndexerTelemetry(
  fakePool(),
  110n,
  10_000
);
assert.equal(
  telemetry.totalPools,
  marketSources.reduce((total, _source, index) => total + index + 1, 0)
);
assert.equal(telemetry.database.scope, "logical-database-only");
assert.equal(telemetry.database.providerVolumeIncluded, false);
assert.equal(telemetry.database.pressure, "warning");
assert.equal(telemetry.stateReadyPools, 2);
assert.equal(telemetry.stateErrorPools, 1);
assert.equal(telemetry.sources[0]?.indexedThrough, "100");
assert.equal(telemetry.sources[0]?.lagBlocks, "10");
assert.equal(telemetry.sources[0]?.finalizedHead, "110");

await assert.rejects(
  readMarketIndexerTelemetry(fakePool(sourceRows.slice(1)), 110n, null),
  /source set does not match manifest/
);
await assert.rejects(
  readMarketIndexerTelemetry(fakePool(sourceRows, ""), 110n, null),
  /invalid database size/
);

console.info("market indexer telemetry smoke passed");
