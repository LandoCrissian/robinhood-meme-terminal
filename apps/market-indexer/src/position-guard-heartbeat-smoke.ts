import assert from "node:assert/strict";
import { loadMarketIndexerConfig } from "./config.js";
import { PositionGuardHeartbeat } from "./position-guard-heartbeat.js";

const base = {
  MARKET_INDEXER_DATABASE_URL:
    "postgres://postgres:postgres@localhost:5432/rmt_market_indexer",
  MARKET_INDEXER_RPC_URL: "https://rpc.mainnet.chain.robinhood.com/",
  MARKET_INDEXER_READ_TOKEN: "ci-market-indexer-read-token-000000000001",
  PGSSLMODE: "disable"
};
const configuration = loadMarketIndexerConfig({
  ...base,
  RMT_POSITION_GUARD_EVALUATOR_URL:
    "https://www.rmtlaunch.fun/api/internal/position-guards/evaluate",
  RMT_POSITION_GUARD_EVALUATOR_TOKEN:
    "position-guard-evaluator-token-000000000001"
}).positionGuardEvaluator;

let requests = 0;
const heartbeat = new PositionGuardHeartbeat(configuration, async (_url, init) => {
  requests += 1;
  assert.equal(init?.method, "POST");
  assert.equal(
    (init?.headers as Record<string, string>).authorization,
    "Bearer position-guard-evaluator-token-000000000001"
  );
  return new Response(JSON.stringify({ status: "complete" }), { status: 200 });
});
await Promise.all([heartbeat.tick(), heartbeat.tick()]);
assert.equal(requests, 1);
assert.equal(heartbeat.status.cycleSequence, 1);
assert.equal(heartbeat.status.lastError, null);
assert.ok(heartbeat.status.lastSuccessAt);

const failure = new PositionGuardHeartbeat(configuration, async () =>
  new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })
);
await failure.tick();
assert.equal(failure.status.lastSuccessAt, null);
assert.equal(failure.status.lastError, "evaluator returned HTTP 503");

const disabled = new PositionGuardHeartbeat(null, async () => {
  throw new Error("disabled heartbeat must not call fetch");
});
await disabled.tick();
assert.equal(disabled.status.enabled, false);
assert.equal(disabled.status.cycleSequence, 0);

console.info("position guard heartbeat smoke passed");
