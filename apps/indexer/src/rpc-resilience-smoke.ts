import assert from "node:assert/strict";
import {
  classifySyncFailure,
  failureBackoffMs,
  LOCAL_SYNC_FAILURE_MESSAGE,
  partitionMarketEventLogs,
  PUBLIC_SYNC_DELAY_MESSAGE,
  publicSyncState
} from "./rpc-resilience.js";

const trade = { eventName: "Trade", id: 1 };
const graduation = { eventName: "Graduated", id: 2 };
const migration = { eventName: "LiquidityMigrated", id: 3 };
const partitioned = partitionMarketEventLogs([trade, graduation, migration]);

assert.deepEqual(partitioned.trades, [trade]);
assert.deepEqual(partitioned.graduations, [graduation]);
assert.deepEqual(partitioned.migrations, [migration]);
assert.throws(() => partitionMarketEventLogs([{ eventName: "Unexpected" }]), /Unsupported market event/);

assert.deepEqual(
  [1, 2, 3, 4, 5].map((failure) => failureBackoffMs(10_000, failure)),
  [10_000, 20_000, 40_000, 60_000, 60_000]
);

assert.equal(LOCAL_SYNC_FAILURE_MESSAGE, "Indexer synchronization is temporarily unavailable.");
assert.equal(classifySyncFailure(new Error("Too Many Requests (429)")), "upstream");
assert.equal(classifySyncFailure({ name: "HttpRequestError", message: "request failed" }), "upstream");
assert.equal(classifySyncFailure({ name: "Error", message: "outer", cause: { name: "TimeoutError" } }), "upstream");
assert.equal(classifySyncFailure({ code: "23505", message: "duplicate key" }), "local");
assert.equal(classifySyncFailure(new Error("Incomplete V6 launch accounting")), "local");

assert.deepEqual(publicSyncState(false, null), {
  available: false,
  stale: false,
  publicError: null
});
assert.deepEqual(publicSyncState(true, null), {
  available: true,
  stale: false,
  publicError: null
});
assert.deepEqual(publicSyncState(true, "upstream"), {
  available: true,
  stale: true,
  publicError: PUBLIC_SYNC_DELAY_MESSAGE
});
assert.deepEqual(publicSyncState(true, "local"), {
  available: false,
  stale: false,
  publicError: null
});

console.info("RPC resilience smoke test passed");
