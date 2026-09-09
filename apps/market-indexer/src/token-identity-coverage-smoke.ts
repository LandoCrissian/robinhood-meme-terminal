import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { identityCoverageFixture, type CoverageIdentity } from "./token-identity-coverage-fixture.js";
import { readCanonicalBrowseIdentities, readCanonicalTokenIdentityIndexStats,
  refreshCanonicalTokenIdentityIndex } from "./token-identity-index.js";

const frozen = JSON.parse(readFileSync(resolve("fixtures/cold-directory-coverage.json"), "utf8")) as {
  tokenDigest: string; frozen: { pools: unknown[]; browseIdentities: { identities: { address: string }[] } };
  liveIdentities: CoverageIdentity[];
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fixture = () => identityCoverageFixture(frozen.liveIdentities, frozen.frozen.pools.length);
const blockHash = `0x${"1".repeat(64)}` as const;
async function drain(test: ReturnType<typeof fixture>, pool: Pool, batchSize = 25) {
  let attempted = 0;
  for (let batch = 0; batch < 256; batch += 1) {
    const count = await refreshCanonicalTokenIdentityIndex(pool, test.rpc, batchSize, 100n, blockHash);
    assert.ok(count <= batchSize);
    attempted += count;
    if (!count) return attempted;
  }
  throw new Error("BACKFILL_EXCEEDED_FROZEN_WINDOW_BOUND");
}

async function main() {
  assert.equal(frozen.frozen.pools.length, 100);
  const test = fixture();
  assert.equal(test.addresses.length, 82);
  assert.equal(digest(test.addresses), frozen.tokenDigest);
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const pool = test.pool();
    test.setMode("read_failure");
    await drain(test, pool);
    assert.equal(test.entries().length, 0, "failed RPC reads are not permanent invalid identities");
    assert.equal((await readCanonicalBrowseIdentities(pool, test.addresses)).length, 0);
    const failureCalls = test.calls;
    assert.equal(await drain(test, pool), 0, "failed reads cannot create a tight retry loop");
    assert.equal(test.calls, failureCalls);
    now += 15 * 60_000 + 1;
    test.setMode("healthy");
    await drain(test, pool);
    assert.equal((await readCanonicalBrowseIdentities(pool, test.addresses)).length, 82);
    assert.ok(test.maximumContracts <= 20, "bounded five-token aggregate calls");

    // Upgrade/backfill starts with exactly the observed durable coverage, plus
    // legacy negative entries. No web request or first-pool-page dependency.
    const legacy = fixture();
    const ready = frozen.frozen.browseIdentities.identities.map((identity) => identity.address.toLowerCase());
    assert.equal(ready.length, 3);
    legacy.seed(ready, legacy.addresses.filter((address) => !ready.includes(address)));
    let worker = legacy.pool();
    assert.equal((await readCanonicalBrowseIdentities(worker, legacy.addresses)).length, 3);
    for (let batch = 0; batch < 10; batch += 1) {
      await refreshCanonicalTokenIdentityIndex(worker, legacy.rpc, 2, 100n, blockHash);
    }
    const beforeRestart = await readCanonicalBrowseIdentities(worker, legacy.addresses);
    worker = legacy.pool();
    assert.deepEqual(await readCanonicalBrowseIdentities(worker, legacy.addresses), beforeRestart);
    await drain(legacy, worker, 2);
    const warm = await readCanonicalBrowseIdentities(worker, legacy.addresses);
    assert.equal(warm.length, 82, "all frozen verified canonical identities are backfilled");
    const cold = legacy.pool();
    assert.deepEqual(await readCanonicalBrowseIdentities(cold, legacy.addresses), warm);
    const callsBefore = legacy.calls;
    assert.equal(await drain(legacy, cold), 0);
    assert.equal(legacy.calls, callsBefore, "idempotent backfill does not rediscover ready identities");
    const stats = await readCanonicalTokenIdentityIndexStats(cold);
    assert.equal(stats.totalVerifiedErc20Identities, 82);
    assert.equal(stats.unresolvedTokenIdentities, 0);
    assert.equal(stats.complete, true);

    const aggregate = fixture();
    aggregate.setMode("aggregate_failure");
    const individualPool = aggregate.pool();
    await drain(aggregate, individualPool);
    assert.equal((await readCanonicalBrowseIdentities(individualPool, aggregate.addresses)).length, 82,
      "generic multicall failures use bounded independently decoded contract reads");

    const malformed = fixture();
    malformed.setMode("malformed");
    const malformedPool = malformed.pool();
    await drain(malformed, malformedPool);
    assert.equal((await readCanonicalBrowseIdentities(malformedPool, malformed.addresses)).length, 0);
    now += 15 * 60_000 + 1;
    malformed.setMode("healthy");
    await drain(malformed, malformedPool);
    assert.equal((await readCanonicalBrowseIdentities(malformedPool, malformed.addresses)).length, 82);
    assert.equal((await readCanonicalTokenIdentityIndexStats(malformedPool)).totalVerifiedErc20Identities, 82);

    const truncated = fixture();
    truncated.setMode("truncated");
    await drain(truncated, truncated.pool());
    assert.equal(truncated.entries().length, 0, "missing response fields are retryable, not invalid identity");

    const unavailableDb = fixture();
    const failedWritePool = unavailableDb.pool();
    unavailableDb.setWriteFailure(true);
    await assert.rejects(refreshCanonicalTokenIdentityIndex(failedWritePool, unavailableDb.rpc, 25, 100n, blockHash),
      /TEST_STORAGE_WRITE_UNAVAILABLE/);
    assert.equal((await readCanonicalBrowseIdentities(failedWritePool, unavailableDb.addresses)).length, 0,
      "failed persistence must not publish memory-only verified browse evidence");
    unavailableDb.setWriteFailure(false);
    await drain(unavailableDb, failedWritePool);
    assert.equal((await readCanonicalBrowseIdentities(unavailableDb.pool(), unavailableDb.addresses)).length, 82);
    console.log(JSON.stringify({ test: "canonical-identity-coverage", pools: 100, tokens: 82,
      durableBefore: 3, durableAfter: 82, backfillIdempotent: true, restartSafe: true,
      coldDigest: digest(warm), warmDigest: digest(warm), productionChanged: false }));
  } finally {
    Date.now = originalNow;
  }
}
void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
