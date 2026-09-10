import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { identityCoverageFixture } from "./token-identity-coverage-fixture.js";
import { readCanonicalBrowseIdentities, refreshCanonicalTokenIdentityIndex } from "./token-identity-index.js";
import { PRIORITY_CANDIDATE_SQL } from "./token-identity-priority.js";

const frozen = JSON.parse(readFileSync("fixtures/cold-directory-coverage.json", "utf8"));
const template = frozen.liveIdentities[0];
const relevant = Array.from({ length: 1_000 }, (_, index) => `0xf0${(index + 1).toString(16).padStart(38, "0")}`);
const historical = Array.from({ length: 9_000 }, (_, index) => `0x01${(index + 1).toString(16).padStart(38, "0")}`);
const fixture = identityCoverageFixture([...historical, ...relevant].map((address, index) => ({
  ...template, address, name: `Canonical ${index}`, symbol: `C${index}`,
  totalSupply: BigInt(template.totalSupply),
})), 5_000);
let selectionQueries = 0;
let queryCount = 0;
const makePool = () => ({ query: async (sql: string, parameters?: unknown[]) => {
  queryCount++;
  if (sql === PRIORITY_CANDIDATE_SQL) {
    selectionQueries++;
    return { rows: relevant.map((token) => ({ token: token.slice(2) })) };
  }
  return fixture.pool().query(sql, parameters);
} }) as unknown as Pool;
const pool = makePool();
const hash = `0x${"1".repeat(64)}` as const;
const started = performance.now();
const first = refreshCanonicalTokenIdentityIndex(pool, fixture.rpc, 100, 100n, hash);
const concurrent = refreshCanonicalTokenIdentityIndex(pool, fixture.rpc, 100, 100n, hash);
assert.equal(first, concurrent, "overlapping ticks must share the full read/persist operation");
assert.equal(await first, 100);
assert.equal((await readCanonicalBrowseIdentities(pool, relevant)).length, 100);
let batches = 1;
while ((await readCanonicalBrowseIdentities(pool, relevant)).length < 1_000) {
  assert.ok(batches < 15, "relevant work must not wait for the historical catalog");
  await refreshCanonicalTokenIdentityIndex(pool, fixture.rpc, 100, 100n, hash);
  batches++;
}
const after = await readCanonicalBrowseIdentities(pool, relevant);
assert.equal(after.length, 1_000);
assert.equal(selectionQueries, 1);
const backgroundReady = (await readCanonicalBrowseIdentities(pool, historical.slice(0, 1_000))).length;
assert.ok(backgroundReady > 0 && backgroundReady < 1_000);
const restarted = await readCanonicalBrowseIdentities(makePool(), relevant);
assert.deepEqual(restarted, after, "priority identities survive a fresh worker state through persisted shards");
console.log(JSON.stringify({ source: "actual-canonical-worker", canonicalTokens: 10_000,
  priorityTokens: 1_000, readyBefore: 0, readyAfter: after.length, batches,
  backgroundReady, selectionQueries, databaseQueryCount: queryCount,
  workerTotalMs: performance.now() - started, restartPreserved: true, singleFlight: true }));
