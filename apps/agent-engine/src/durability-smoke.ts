import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type AgentSafetyEnvelope,
  type StrategySpec,
} from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import { AgentEngine, type AgentEngineConfig } from "./engine.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { agentEngineSchemaSql } from "./persistence/schema.ts";
import {
  PostgresAgentStateStore,
  type SqlClientLike,
  type SqlQueryResult,
} from "./persistence/postgres-store.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 2_000,
  maximumPortfolioExposureBps: 6_000,
  maximumOpenPositions: 6,
  maximumDailyLossBps: 1_000,
  maximumDrawdownBps: 2_000,
  maximumTradesPerDay: 30,
  maximumSlippageBps: 100,
  maximumPriceImpactBps: 200,
  minimumEvaluationIntervalSeconds: 30,
};

const config: AgentEngineConfig = {
  safetyEnvelope,
  paperFillDelayMs: 100,
  policyVersion: "AGENT_PAPER_V1",
};

const strategy: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA", "COMMUNITY"], minimumLiquidityUsd: 5_000 },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 600, maximumHoldingSeconds: 3_600 },
  signals: [{ type: "momentum", weight: 0.6 }, { type: "liquidity", weight: 0.4 }],
  prediction: { enabled: true, minimumConfidence: 0.6 },
  risk: {
    maximumPositionBps: 1_500,
    maximumPortfolioExposureBps: 5_000,
    maximumOpenPositions: 4,
    maximumDailyLossBps: 800,
    maximumDrawdownBps: 1_500,
    maximumTradesPerDay: 20,
  },
  execution: { venuePolicy: "RMT_BEST_VERIFIED", maximumSlippageBps: 75, maximumPriceImpactBps: 150 },
  prohibitedActions: ["arbitrary-calldata", "private-key-export"],
};

assert.equal(typeof PostgresAgentStateStore, "function", "Postgres store must load without importing pg at module scope");

class RecordingSqlClient implements SqlClientLike {
  readonly queries: string[] = [];
  private readonly stateRows: Array<{ revision: string | number; state_json: ReturnType<typeof emptyAgentEngineSnapshot>; state_hash: string }>;
  private readonly mutationRows: Array<{ operation: string; request_hash: string; result_json: unknown }>;

  constructor(input: {
    stateRows?: Array<{ revision: string | number; state_json: ReturnType<typeof emptyAgentEngineSnapshot>; state_hash: string }>;
    mutationRows?: Array<{ operation: string; request_hash: string; result_json: unknown }>;
  } = {}) {
    this.stateRows = input.stateRows ?? [];
    this.mutationRows = input.mutationRows ?? [];
  }

  async query<Row = Record<string, unknown>>(text: string): Promise<SqlQueryResult<Row>> {
    this.queries.push(text);
    if (text.includes("FROM agent_engine_state")) return { rows: structuredClone(this.stateRows) as Row[] };
    if (text.includes("FROM agent_engine_mutations")) return { rows: structuredClone(this.mutationRows) as Row[] };
    return { rows: [] };
  }

  release(): void {}
}

class RecordingSqlPool {
  readonly client: RecordingSqlClient;
  constructor(client: RecordingSqlClient) {
    this.client = client;
  }
  async connect(): Promise<RecordingSqlClient> {
    return this.client;
  }
}

const store = new InMemoryAgentStateStore();
const engine = await DurableAgentEngine.initialize({ config, store, streamId: "smoke" });

const seasonInput = { seasonId: "season-1", name: "Genesis Paper", startsAt: 1_000, endsAt: 100_000, createdAt: 900 };
const season = await engine.createSeason(seasonInput, "season:create:1");
assert.equal(season.seasonId, "season-1");
assert.deepEqual(await engine.createSeason(seasonInput, "season:create:1"), season, "idempotent season retry must replay result");

const agentInput = {
  ownerAddress: "0x1111111111111111111111111111111111111111",
  name: "RWA Scout",
  thesis: "Trade only verified RMT paper markets.",
  createdAt: 1_100,
};
const agent = await engine.registerAgent(agentInput, "agent:create:1");
const agentReplay = await engine.registerAgent(agentInput, "agent:create:1");
assert.equal(agentReplay.id, agent.id, "idempotent retry must not mint a second agent id");
await assert.rejects(
  engine.registerAgent({ ...agentInput, name: "Changed payload" }, "agent:create:1"),
  /different request/,
  "idempotency key reuse with different payload must fail closed",
);

const strategyVersion = await engine.createStrategyVersion(agent.id, strategy, "strategy:create:1", 1_200);
assert.equal(strategyVersion.version, 1);
await engine.activatePaperAgent(agent.id, "agent:activate:1");
const account = await engine.openPaperAccount({
  agentId: agent.id,
  seasonId: season.seasonId,
  initialBalances: { USDG: "1000000", ETH: "1000" },
  openedAt: 2_000,
}, "account:open:1");

const prediction = await engine.submitPrediction({
  agentId: agent.id,
  strategyVersion: 1,
  assetId: "RWA:AAPL",
  condition: "price higher at horizon",
  forecastProbability: 0.72,
  createdAt: 2_100,
  resolvesAt: 2_500,
}, "prediction:create:1");
await engine.resolvePrediction(prediction.predictionId, 1, 2_600, "prediction:resolve:1");

const order = await engine.submitPaperOrder({
  agentId: agent.id,
  strategyVersion: 1,
  accountId: account.accountId,
  inputAssetId: "USDG",
  outputAssetId: "RWA:AAPL",
  inputAmountAtomic: "100000",
  maximumSlippageBps: 50,
  createdAt: 3_000,
}, "order:create:1");

const quotePayload = {
  quoteId: "quote-1",
  inputAssetId: "USDG",
  outputAssetId: "RWA:AAPL",
  inputAmountAtomic: "100000",
  outputAmountAtomic: "500",
  providerId: "paper-rmt-verified",
  priceImpactBps: 40,
  observedAt: 3_200,
  expiresAt: 3_500,
  quoteBlockNumber: "123456",
};
const quote = { ...quotePayload, evidenceHash: hashPaperQuoteEvidence(quotePayload) };
const fill = await engine.fillPaperOrder(order.orderId, quote, "order:fill:1", {
  feeAssetId: "USDG",
  feeAmountAtomic: "100",
  gasAssetId: "ETH",
  gasCostAtomic: "10",
});
assert.equal(fill.orderId, order.orderId);

const balance = engine.getPaperAccount(account.accountId).balances;
assert.deepEqual(balance, { USDG: "899900", ETH: "990", "RWA:AAPL": "500" });
await engine.recordPortfolioSnapshot({
  accountId: account.accountId,
  capturedAt: 4_000,
  quoteAssetId: "USDG",
  markNavAtomic: "1000500",
  liquidationNavAtomic: "999500",
}, "portfolio:1");
await engine.recordRiskEvent({
  agentId: agent.id,
  accountId: account.accountId,
  type: "PRICE_IMPACT_NEAR_LIMIT",
  severity: "WARNING",
  detail: "Paper quote consumed a meaningful portion of the configured impact budget.",
  occurredAt: 4_100,
}, "risk:1");
const score = await engine.captureScoreSnapshot({ agentId: agent.id, seasonId: season.seasonId, capturedAt: 5_000 }, "score:1");
assert.equal(score.predictionCount, 1);
assert.equal(score.resolvedPredictionCount, 1);
assert.equal(score.paperFillCount, 1);
assert.ok(score.brierScore >= 0 && score.brierScore <= 1);

const revisionBeforeRestart = engine.getRevision();
const restarted = await DurableAgentEngine.initialize({ config, store, streamId: "smoke" });
assert.equal(restarted.getRevision(), revisionBeforeRestart, "restart must recover canonical revision");
assert.deepEqual(restarted.getPaperAccount(account.accountId).balances, balance, "restart must recover balances");
assert.equal(restarted.getAgentSummary(agent.id).paperFills, 1, "restart must recover fills");

const workerA = await DurableAgentEngine.initialize({ config, store, streamId: "smoke" });
const workerB = await DurableAgentEngine.initialize({ config, store, streamId: "smoke" });
await workerA.recordRiskEvent({
  agentId: agent.id,
  type: "WORKER_A",
  severity: "INFO",
  detail: "first concurrent writer",
  occurredAt: 5_100,
}, "concurrency:a");
await assert.rejects(
  workerB.recordRiskEvent({
    agentId: agent.id,
    type: "WORKER_B",
    severity: "INFO",
    detail: "stale concurrent writer",
    occurredAt: 5_101,
  }, "concurrency:b"),
  /revision conflict/,
  "stale concurrent writer must fail rather than overwrite canonical state",
);
assert.equal(workerB.getRevision(), workerA.getRevision(), "conflicted worker must resync canonical revision");
await workerB.recordRiskEvent({
  agentId: agent.id,
  type: "WORKER_B",
  severity: "INFO",
  detail: "stale concurrent writer",
  occurredAt: 5_101,
}, "concurrency:b");
assert.equal(workerB.getRevision(), workerA.getRevision() + 1, "retry after resync must commit exactly once");

const stored = await store.load("smoke");
assert.ok(stored);
const tampered = structuredClone(stored!.snapshot);
tampered.strategyVersions[0]!.strategyHash = "0x" + "0".repeat(64);
assert.throws(() => AgentEngine.fromSnapshot(config, tampered), /strategy hash mismatch/, "tampered durable snapshot must fail integrity validation");

const requiredTables = [
  "agent_engine_state",
  "agent_engine_mutations",
  "agent_seasons",
  "agents",
  "strategy_versions",
  "agent_decisions",
  "predictions",
  "paper_accounts",
  "paper_orders",
  "paper_fills",
  "portfolio_snapshots",
  "risk_events",
  "score_snapshots",
];
for (const table of requiredTables) assert.match(agentEngineSchemaSql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
assert.match(agentEngineSchemaSql, /execution_mode = 'PAPER_ONLY'/, "database schema must hard-bind paper execution mode");
assert.match(agentEngineSchemaSql, /UNIQUE \(stream_id, idempotency_key\)/, "database schema must enforce idempotency uniqueness");


const emptySnapshot = emptyAgentEngineSnapshot();
const recordingClient = new RecordingSqlClient();
const recordingStore = new PostgresAgentStateStore(new RecordingSqlPool(recordingClient));
const recordingCommit = await recordingStore.commit({
  streamId: "recording",
  expectedRevision: 0,
  idempotencyKey: "recording:1",
  operation: "recordingSmoke",
  requestHash: hashCanonicalPayload({ operation: "recordingSmoke", payload: {} }),
  result: { ok: true },
  snapshot: emptySnapshot,
  createdAt: 6_000,
});
assert.equal(recordingCommit.status, "COMMITTED");
assert.ok(recordingClient.queries.some((query) => query.includes("pg_advisory_xact_lock")), "Postgres commit must take a per-stream advisory transaction lock");
assert.ok(recordingClient.queries.some((query) => query === "COMMIT"), "Postgres commit must close the transaction");

const corruptSnapshot = emptyAgentEngineSnapshot();
const corruptClient = new RecordingSqlClient({
  stateRows: [{ revision: "1", state_json: corruptSnapshot, state_hash: "0x" + "0".repeat(64) }],
});
const corruptStore = new PostgresAgentStateStore(new RecordingSqlPool(corruptClient));
await assert.rejects(corruptStore.load("corrupt"), /state hash mismatch/, "Postgres load must reject corrupted canonical snapshot hashes");

console.log("agent-engine durability smoke: ok");
