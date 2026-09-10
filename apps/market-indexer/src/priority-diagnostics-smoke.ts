import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Pool } from "pg";
import { loadMarketIndexerConfig } from "./config.js";
import { identityCoverageFixture } from "./token-identity-coverage-fixture.js";
import { createMarketIndexerServer } from "./server.js";
import { MarketIndexerWorker } from "./worker.js";
import { PRIORITY_CANDIDATE_SQL, refreshIdentityPriority, readIdentityPriorityDiagnostics, selectIdentityBatch } from "./token-identity-priority.js";

const token = "diagnostic-fixture-read-authorization";
const config = loadMarketIndexerConfig({ MARKET_INDEXER_DATABASE_URL: "postgres://localhost/test",
  MARKET_INDEXER_RPC_URL: "https://rpc.invalid", MARKET_INDEXER_READ_TOKEN: token, PGSSLMODE: "disable" });
const identity = JSON.parse(readFileSync("fixtures/cold-directory-coverage.json", "utf8")).liveIdentities[0];
const fixture = identityCoverageFixture([identity], 1);
const storage = fixture.pool();
let writes = 0;
let queries = 0;
let fail: "none" | "stats" | "shard" = "stats";
const pool = { query: async (sql: string, values?: unknown[]) => {
  queries++;
  if (sql === PRIORITY_CANDIDATE_SQL) return { rows: [{ token: identity.address.slice(2) }] };
  if (sql.startsWith("INSERT")) writes++;
  if ((fail === "stats" && sql.startsWith("INSERT INTO market_token_identity_catalog_state"))
    || (fail === "shard" && sql.startsWith("INSERT INTO market_token_identity_shard"))) throw new Error("TEST_STORAGE_UNAVAILABLE");
  return storage.query(sql, values);
} } as unknown as Pool;
const worker = new MarketIndexerWorker(pool, config);
Object.assign(worker, {
  rpc: { ...fixture.rpc, getBlockNumber: async () => 100n + BigInt(config.confirmations),
    getBlock: async () => ({ hash: `0x${"1".repeat(64)}` }) },
  assertDatabaseWithinLimit: async () => {}, restoreRebuildableStateIfNeeded: async () => {},
  indexSource: async () => {}, refreshUpPoolEvidence: async () => {}, refreshTelemetry: async () => {},
  logHeartbeat: () => {},
});
const server = createMarketIndexerServer(pool, config, worker);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/token-identities/priority`;
const headers = { authorization: `Bearer ${token}` };
try {
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await fetch(`${url}?token=${token}`, { headers: { "x-forwarded-authorization": `Bearer ${token}` } })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers })).status, 405);
  const before = await (await fetch(url, { headers })).json() as Record<string, unknown>;
  assert.equal(before.priorityStatus, "not_requested");
  assert.equal(before.identityStats, null);
  assert.equal(queries, 0, "diagnostics must not initialize database state");
  await worker.tick();
  assert.ok(worker.status.lastError);
  assert.equal(worker.status.consecutiveWorkerFailures, 1);
  fail = "shard";
  await worker.tick();
  assert.equal(worker.status.consecutiveWorkerFailures, 2);
  fail = "none";
  await worker.tick();
  assert.equal(worker.status.lastError, null);
  assert.equal(worker.status.consecutiveWorkerFailures, 0);
  assert.equal(worker.status.totalWorkerFailures, 2);
  assert.ok(worker.status.lastWorkerFailureAt);
  assert.ok(worker.status.lastWorkerSuccessAt);
  const queryBefore = queries;
  const writeBefore = writes;
  const response = await fetch(url, { headers });
  assert.equal(response.status, 200);
  const healthy = await response.json() as Record<string, unknown>;
  assert.equal(healthy.workerStatus, "healthy");
  assert.equal(healthy.priorityAlreadyReadyCount, 1);
  assert.equal(healthy.priorityPendingCount, 0);
  for (let i = 0; i < 5; i++) assert.deepEqual(await (await fetch(url, { headers })).json(), healthy);
  let releaseCycle = () => {};
  const cycleGate = new Promise<void>((resolve) => { releaseCycle = resolve; });
  Object.assign(worker, { assertDatabaseWithinLimit: async () => cycleGate });
  const activeCycle = worker.tick();
  const running = await (await fetch(url, { headers })).json() as Record<string, unknown>;
  assert.equal(running.workerStatus, "running");
  assert.equal(queries, queryBefore);
  assert.equal(writes, writeBefore);
  releaseCycle();
  await activeCycle;
  assert.equal(JSON.stringify(healthy).includes(token), false);
  assert.equal(JSON.stringify(healthy).includes(identity.address), false);
  console.log(JSON.stringify({ noAuth: 401, wrongAuth: 401, authorized: 200,
    databaseWriteCountFromDiagnostics: 0, databaseReadCountFromDiagnostics: 0,
    failedStatsThenFailedShardThenHealthy: true, historicalFailureCount: 2,
    prioritySetDigest: healthy.prioritySetDigest }));
} finally { await new Promise<void>((resolve) => server.close(() => resolve())); }

let mode: "healthy" | "failed" | "malformed" | "empty" = "healthy";
const selected = { query: async () => {
  if (mode === "failed") throw new Error("TEST_QUERY_UNAVAILABLE");
  if (mode === "malformed") return { rows: null };
  if (mode === "empty") return { rows: [] };
  return { rows: [{ token: identity.address }] };
} } as unknown as Pool;
await refreshIdentityPriority(selected, 1);
const first = readIdentityPriorityDiagnostics(selected, new Map());
mode = "failed";
await refreshIdentityPriority(selected, 900002);
const retained = readIdentityPriorityDiagnostics(selected, new Map());
assert.equal(retained.status, "unavailable");
assert.equal(retained.prioritySetDigest, first.prioritySetDigest);
assert.equal(retained.priorityCandidateCount, 1);
mode = "malformed";
await refreshIdentityPriority(selected, 1800003);
assert.equal(readIdentityPriorityDiagnostics(selected, new Map()).status, "unavailable");
assert.equal(readIdentityPriorityDiagnostics(selected, new Map()).prioritySetDigest, first.prioritySetDigest);
const key = identity.address.toLowerCase();
const shard = Number.parseInt(key.slice(2, 4), 16);
const pending = { pendingByShard: new Map([[shard, [key]]]), readyIdentities: new Map<string, boolean>(),
  retryAfter: new Map([[key, 9000000]]) };
assert.equal(selectIdentityBatch(selected, pending, 25, 1800003).lane, "idle");
pending.retryAfter.clear();
pending.readyIdentities.set(key, true);
assert.equal(selectIdentityBatch(selected, pending, 25, 1800003).lane, "idle");
pending.readyIdentities.clear();
mode = "empty";
await refreshIdentityPriority(selected, 2700004);
assert.notEqual(readIdentityPriorityDiagnostics(selected, new Map()).prioritySetDigest, first.prioritySetDigest);
assert.equal(selectIdentityBatch(selected, pending, 25, 2700004).lane, "background");
