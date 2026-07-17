import assert from "node:assert/strict";
import {
  hasSharedCachePolicy,
  maximumExpectedCheckpointDriftBlocks,
  maximumExpectedIndexerLagBlocks
} from "./production-health-policy.mjs";

assert.equal(
  hasSharedCachePolicy(
    "cache-control: public\r\ncdn-cache-control: public, s-maxage=15, stale-while-revalidate=30\r\n",
    15
  ),
  true
);
assert.equal(hasSharedCachePolicy("cache-control: public\r\n", 15), false);
assert.equal(hasSharedCachePolicy("cache-control: public, s-maxage=5\r\n", 15), false);
assert.equal(hasSharedCachePolicy("cache-control: public, s-maxage=5\r\n", 5), true);

assert.equal(
  maximumExpectedIndexerLagBlocks({ confirmationDepth: 20n, lastSyncAgeMs: 7_000 }),
  260n
);
assert.equal(
  maximumExpectedCheckpointDriftBlocks({
    confirmationDepth: 20n,
    newerSyncedAtMs: 40_000,
    olderSyncedAtMs: 8_000
  }),
  760n
);
assert.equal(
  maximumExpectedCheckpointDriftBlocks({
    confirmationDepth: 20n,
    newerSyncedAtMs: 8_000,
    olderSyncedAtMs: 40_000
  }),
  120n
);
assert.throws(
  () => maximumExpectedIndexerLagBlocks({ confirmationDepth: 20n, lastSyncAgeMs: -1 }),
  /nonnegative/
);

console.info("Production health policy smoke test passed");
