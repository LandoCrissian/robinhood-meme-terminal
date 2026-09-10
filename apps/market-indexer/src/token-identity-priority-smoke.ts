import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  PRIORITY_CANDIDATE_SQL, refreshIdentityPriority,
  selectIdentityBatch, readIdentityPriorityDiagnostics,
} from "./token-identity-priority.js";

const address = (prefix: string, index: number) => "0x" + prefix + index.toString(16).padStart(38, "0");
const relevant = Array.from({ length: 1_000 }, (_, index) => address("f0", index + 1));
const background = Array.from({ length: 9_000 }, (_, index) => address("01", index + 1));
let snapshot = [relevant[0]!, relevant[0]!.toUpperCase(), relevant[0]!.slice(2),
  "0x1234", "0x" + "g".repeat(40), "0x" + "0".repeat(40),
  "0x" + "1".repeat(42), ...relevant];
let queries = 0;
const pool = { query: async (sql: string) => {
  assert.equal(sql, PRIORITY_CANDIDATE_SQL);
  queries++;
  return { rows: snapshot.map((token) => ({ token })) };
} } as unknown as Pool;
const state = {
  pendingByShard: new Map([[1, [...background]], [240, [relevant[0]!, ...relevant]]]),
  readyIdentities: new Map<string, boolean>(),
  retryAfter: new Map<string, number>(),
};
const now = 1_000_000;
await refreshIdentityPriority(pool, now);
await refreshIdentityPriority(pool, now + 1);
assert.equal(queries, 1, "selection must not query every worker tick");
assert.equal(readIdentityPriorityDiagnostics(pool, state.readyIdentities).priorityCandidateCount, 1_000,
  "case variants deduplicate and malformed/non-20-byte candidates are ignored");
const processed = new Set<string>();
const lanes: string[] = [];
const start = performance.now();
while (relevant.some((token) => !state.readyIdentities.has(token))) {
  const batch = selectIdentityBatch(pool, state, 100, now);
  assert.ok(batch.addresses.length > 0);
  lanes.push(batch.lane);
  for (const token of batch.addresses) {
    assert.equal(processed.has(token), false, "no duplicate scheduling");
    processed.add(token);
    state.readyIdentities.set(token, true);
  }
}
assert.deepEqual(lanes.slice(0, 5), ["priority", "priority", "priority", "priority", "background"]);
assert.ok(background.some((token) => state.readyIdentities.has(token)), "background must progress");
assert.ok(processed.size < 2_000, "do not resolve the whole historical universe first");
assert.equal(readIdentityPriorityDiagnostics(pool, state.readyIdentities).priorityAlreadyReadyCount, 1_000);

// Promotion does not duplicate a background address; backoff still wins.
const promoted = background.at(-1)!;
snapshot = [promoted];
state.retryAfter.set(promoted, now + 2_000_000);
await refreshIdentityPriority(pool, now + 900_001);
const backedOff = selectIdentityBatch(pool, state, 100, now + 900_001);
assert.equal(backedOff.addresses.includes(promoted), false);
state.retryAfter.delete(promoted);
const promotedBatch = selectIdentityBatch(pool, state, 100, now + 900_002);
assert.deepEqual(promotedBatch.addresses, [promoted]);
assert.equal(state.pendingByShard.get(1)!.includes(promoted), false);

// A restart reconstructs priority without changing durable readiness.
const restartedPool = { query: async () => ({ rows: relevant.map((token) => ({ token })) }) } as unknown as Pool;
await refreshIdentityPriority(restartedPool, now);
assert.equal(readIdentityPriorityDiagnostics(restartedPool, state.readyIdentities).priorityAlreadyReadyCount, 1_000);
assert.equal(selectIdentityBatch(restartedPool, state, 100, now).lane, "background");

console.log(JSON.stringify({
  fixtureCanonicalCount: 10_000, fixtureRelevantCount: 1_000,
  priorityReadyBefore: 0, priorityReadyAfter: 1_000,
  scheduledCount: processed.size, duplicateProcessing: 0,
  schedulerMs: performance.now() - start, selectionQueries: queries,
  prioritySelectionMs: readIdentityPriorityDiagnostics(pool, state.readyIdentities).selectionMs,
  backgroundProgress: true, promotionPreserved: true, backoffPreserved: true,
}));
