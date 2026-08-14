import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  type AgentDecision,
  type AgentRecord,
  type AgentRunRecord,
  type PaperAccountRecord,
  type PredictionRecord,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import { InMemoryAgentRunStore, PostgresAgentRunStore, type AgentRunStore } from "./agent-run-store.ts";
import {
  PaperEvaluationService,
  type PaperDecisionAdapter,
  type PaperDecisionAdapterInput,
  type PaperEvaluationMarketSource,
  type PaperEvaluationMarketSourceInput,
  type PaperEvaluationWriter,
} from "./paper-evaluation.ts";

const strategySpec: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA", "AMD"], excludeAssets: ["TSLA"], minimumLiquidityUsd: 25_000 },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 120, maximumHoldingSeconds: 604_800 },
  signals: [{ type: "momentum", weight: 0.7 }, { type: "liquidity", weight: 0.3 }],
  prediction: { enabled: true, minimumConfidence: 0.65 },
  risk: {
    maximumPositionBps: 500,
    maximumPortfolioExposureBps: 2_500,
    maximumOpenPositions: 5,
    maximumDailyLossBps: 300,
    maximumDrawdownBps: 1_000,
    maximumTradesPerDay: 20,
  },
  execution: { venuePolicy: "RMT_BEST_VERIFIED", maximumSlippageBps: 100, maximumPriceImpactBps: 250 },
  prohibitedActions: ["ARBITRARY_CALL", "UNVERIFIED_VENUE"],
};

const agent: AgentRecord = {
  id: "agent-1",
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "HoodHound",
  thesis: "Trade liquid technology RWAs when momentum and liquidity agree.",
  performanceState: "PAPER_ACTIVE",
  executionMode: "PAPER_ONLY",
  createdAt: 1_000,
};

const strategy: StrategyVersionRecord = {
  id: "strategy-1",
  agentId: agent.id,
  version: 1,
  spec: strategySpec,
  strategyHash: hashCanonicalPayload({ agentId: agent.id, version: 1, spec: strategySpec }),
  createdAt: 2_000,
};

const account: PaperAccountRecord = {
  accountId: "account-1",
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: agent.id,
  balances: { USDG: "1000000000" },
  openedAt: 3_000,
};

const baseSnapshot = {
  chainId: 4663,
  capturedAt: 9_500,
  observations: [
    {
      assetId: "NVDA",
      quoteAssetId: "USDG",
      referencePriceAtomic: "150250000",
      referencePriceDecimals: 6,
      liquidityUsdAtomic: "250000000000",
      liquidityUsdDecimals: 6,
      features: { momentum_1h_bps: 120, verified: true },
    },
    {
      assetId: "AMD",
      quoteAssetId: "USDG",
      referencePriceAtomic: "180000000",
      referencePriceDecimals: 6,
      liquidityUsdAtomic: "100000000000",
      liquidityUsdDecimals: 6,
      features: { momentum_1h_bps: 40 },
    },
  ],
};

const predictionProposal = {
  action: "PREDICTION",
  confidence: 0.82,
  reasoningSummary: "NVDA momentum is above the strategy threshold while observed liquidity remains sufficient.",
  prediction: {
    assetId: "NVDA",
    condition: "reference price closes higher at the strategy horizon",
    forecastProbability: 0.74,
  },
};

const openPositionProposal = {
  action: "OPEN_POSITION",
  confidence: 0.79,
  reasoningSummary: "NVDA momentum and liquidity satisfy the strategy entry conditions.",
  openPosition: {
    assetId: "NVDA",
    requestedPositionBps: 400,
  },
};

class FakeMarketSource implements PaperEvaluationMarketSource {
  readonly sourceId: string;
  calls = 0;
  private readonly output: unknown;
  private readonly delayMs: number;

  constructor(output: unknown, sourceId = "verified-rmt-paper-market-v1", delayMs = 0) {
    this.output = output;
    this.sourceId = sourceId;
    this.delayMs = delayMs;
  }

  async capture(input: PaperEvaluationMarketSourceInput): Promise<unknown> {
    this.calls += 1;
    assert.equal(input.agentId, agent.id);
    assert.equal(input.accountId, account.accountId);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return structuredClone(this.output);
  }
}

class FakeDecisionAdapter implements PaperDecisionAdapter {
  readonly adapterId: string;
  readonly modelIdentity: string;
  calls = 0;
  private readonly output: unknown;
  private readonly delayMs: number;

  constructor(output: unknown, delayMs = 0, adapterId = "fake-paper-decision-v1", modelIdentity = "fake-model-v1") {
    this.output = output;
    this.delayMs = delayMs;
    this.adapterId = adapterId;
    this.modelIdentity = modelIdentity;
  }

  async evaluate(input: PaperDecisionAdapterInput): Promise<unknown> {
    this.calls += 1;
    assert.equal(input.outputInstruction, "NO_ACTION_PREDICTION_OR_OPEN_POSITION");
    assert.equal(input.marketSnapshot.chainId, 4663);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return structuredClone(this.output);
  }
}

class FakeWriter implements PaperEvaluationWriter {
  readonly decisions: AgentDecision[] = [];
  readonly predictions: PredictionRecord[] = [];
  private readonly decisionIdempotency = new Map<string, AgentDecision>();
  private readonly predictionIdempotency = new Map<string, PredictionRecord>();

  getAgentSummary(agentId: string): { agent: AgentRecord; latestStrategy?: StrategyVersionRecord } {
    if (agentId !== agent.id) throw new Error("unknown agent");
    return { agent: structuredClone(agent), latestStrategy: structuredClone(strategy) };
  }

  getPaperAccount(accountId: string): PaperAccountRecord {
    if (accountId !== account.accountId) throw new Error("unknown account");
    return structuredClone(account);
  }

  async recordDecision(
    input: Omit<AgentDecision, "decisionId" | "decisionHash" | "policyVersion">,
    idempotencyKey: string,
  ): Promise<AgentDecision> {
    const prior = this.decisionIdempotency.get(idempotencyKey);
    if (prior) return structuredClone(prior);
    const base = { ...structuredClone(input), policyVersion: "RMT_AGENT_FOUNDATION_V1" };
    const decision: AgentDecision = {
      ...base,
      decisionId: `decision-${this.decisions.length + 1}`,
      decisionHash: hashCanonicalPayload(base),
    };
    this.decisions.push(decision);
    this.decisionIdempotency.set(idempotencyKey, decision);
    return structuredClone(decision);
  }

  async submitPrediction(
    input: Omit<PredictionRecord, "predictionId" | "resolvedOutcome" | "resolvedAt">,
    idempotencyKey: string,
  ): Promise<PredictionRecord> {
    const prior = this.predictionIdempotency.get(idempotencyKey);
    if (prior) return structuredClone(prior);
    const prediction: PredictionRecord = { ...structuredClone(input), predictionId: `prediction-${this.predictions.length + 1}` };
    this.predictions.push(prediction);
    this.predictionIdempotency.set(idempotencyKey, prediction);
    return structuredClone(prediction);
  }
}

const config = {
  streamId: "paper-default",
  chainId: 4663,
  runnerVersion: "RMT_PAPER_EVALUATION_V1",
  maximumSnapshotAgeMs: 2_000,
  maximumObservations: 64,
  maximumFeaturesPerObservation: 16,
};

const source = new FakeMarketSource(baseSnapshot);
const adapter = new FakeDecisionAdapter(predictionProposal);
const writer = new FakeWriter();
const runStore = new InMemoryAgentRunStore();
const service = new PaperEvaluationService({ config, marketSource: source, decisionAdapter: adapter, runStore, writer });

const first = await service.evaluate({ agentId: agent.id, accountId: account.accountId, evaluationKey: "agent-1:slot-1", evaluatedAt: 10_000 });
assert.equal(first.run.proposal.action, "PREDICTION");
assert.equal(first.run.marketSnapshot.snapshotId, first.run.marketSnapshot.snapshotHash);
assert.equal(first.run.marketSourceId, source.sourceId);
assert.equal(first.decision.marketSnapshotId, first.run.marketSnapshot.snapshotId);
assert.equal(first.decision.compilerVersion, config.runnerVersion);
assert.equal(first.prediction?.assetId, "NVDA");
assert.equal(first.prediction?.resolvesAt, 130_000);
assert.equal(source.calls, 1);
assert.equal(adapter.calls, 1);
assert.equal(writer.decisions.length, 1);
assert.equal(writer.predictions.length, 1);
assert.equal("submitPaperOrder" in service, false);

const replay = await service.evaluate({ agentId: agent.id, accountId: account.accountId, evaluationKey: "agent-1:slot-1" });
assert.equal(replay.run.runId, first.run.runId);
assert.equal(replay.decision.decisionId, first.decision.decisionId);
assert.equal(replay.prediction?.predictionId, first.prediction?.predictionId);
assert.equal(source.calls, 1);
assert.equal(adapter.calls, 1);
assert.equal(writer.decisions.length, 1);
assert.equal(writer.predictions.length, 1);

const tradeWriter = new FakeWriter();
const tradeService = new PaperEvaluationService({
  config,
  marketSource: new FakeMarketSource(baseSnapshot),
  decisionAdapter: new FakeDecisionAdapter(openPositionProposal),
  runStore: new InMemoryAgentRunStore(),
  writer: tradeWriter,
});
const trade = await tradeService.evaluate({ agentId: agent.id, accountId: account.accountId, evaluationKey: "agent-1:trade-slot", evaluatedAt: 10_000 });
assert.equal(trade.run.proposal.action, "OPEN_POSITION");
assert.equal(trade.run.proposal.openPosition?.assetId, "NVDA");
assert.equal(trade.run.proposal.openPosition?.requestedPositionBps, 400);
assert.equal(trade.decision.action, "OPEN_POSITION");
assert.equal(trade.prediction, undefined);
assert.equal(tradeWriter.decisions.length, 1);
assert.equal(tradeWriter.predictions.length, 0);
assert.equal("submitPaperOrder" in tradeService, false);

async function expectReject(
  marketOutput: unknown,
  proposal: unknown,
  pattern: RegExp,
  evaluatedAt = 10_000,
): Promise<void> {
  const localSource = new FakeMarketSource(marketOutput);
  const localAdapter = new FakeDecisionAdapter(proposal);
  const localWriter = new FakeWriter();
  const localService = new PaperEvaluationService({
    config,
    marketSource: localSource,
    decisionAdapter: localAdapter,
    runStore: new InMemoryAgentRunStore(),
    writer: localWriter,
  });
  await assert.rejects(
    () => localService.evaluate({ agentId: agent.id, accountId: account.accountId, evaluationKey: `reject-${Math.random()}`, evaluatedAt }),
    pattern,
  );
  assert.equal(localWriter.decisions.length, 0);
  assert.equal(localWriter.predictions.length, 0);
}

await expectReject({ ...baseSnapshot, capturedAt: 7_000 }, predictionProposal, /market snapshot is stale/);
await expectReject({ ...baseSnapshot, capturedAt: 10_001 }, predictionProposal, /captured in the future/);
await expectReject({ ...baseSnapshot, chainId: 1 }, predictionProposal, /chainId mismatch/);
await expectReject(baseSnapshot, { ...predictionProposal, action: "CLOSE_POSITION" }, /action is not admitted/);
await expectReject(baseSnapshot, { ...predictionProposal, confidence: 0.5 }, /below strategy minimum/);
await expectReject(baseSnapshot, { ...predictionProposal, prediction: { ...predictionProposal.prediction, assetId: "META" } }, /absent from market snapshot/);
await expectReject(baseSnapshot, { ...openPositionProposal, openPosition: { assetId: "META", requestedPositionBps: 400 } }, /absent from market snapshot/);
await expectReject(baseSnapshot, { ...openPositionProposal, openPosition: { assetId: "NVDA", requestedPositionBps: 600 } }, /exceeds strategy maximumPositionBps/);
await expectReject(baseSnapshot, { ...openPositionProposal, prediction: predictionProposal.prediction }, /cannot include prediction/);
await expectReject(
  { ...baseSnapshot, observations: [{ ...baseSnapshot.observations[0], referencePriceAtomic: "0" }] },
  predictionProposal,
  /referencePriceAtomic must be greater than zero/,
);
await expectReject(
  { ...baseSnapshot, observations: [baseSnapshot.observations[0], { ...baseSnapshot.observations[0] }] },
  predictionProposal,
  /duplicate market observation/,
);

const raceStore = new InMemoryAgentRunStore();
const raceWriter = new FakeWriter();
const raceSnapshot = { ...baseSnapshot, capturedAt: 19_500 };
const raceSourceA = new FakeMarketSource(raceSnapshot, "race-market-v1");
const raceSourceB = new FakeMarketSource(raceSnapshot, "race-market-v1");
const slowAdapter = new FakeDecisionAdapter(
  { action: "NO_ACTION", confidence: 0.4, reasoningSummary: "No qualifying setup." },
  20,
  "race-decision-v1",
  "race-model-v1",
);
const fastAdapter = new FakeDecisionAdapter(predictionProposal, 0, "race-decision-v1", "race-model-v1");
const raceA = new PaperEvaluationService({ config, marketSource: raceSourceA, decisionAdapter: slowAdapter, runStore: raceStore, writer: raceWriter });
const raceB = new PaperEvaluationService({ config, marketSource: raceSourceB, decisionAdapter: fastAdapter, runStore: raceStore, writer: raceWriter });
const [raceSlow, raceFast] = await Promise.all([
  raceA.evaluate({ agentId: agent.id, accountId: account.accountId, evaluationKey: "race-slot", evaluatedAt: 20_000 }),
  raceB.evaluate({ agentId: agent.id, accountId: account.accountId, evaluationKey: "race-slot", evaluatedAt: 20_000 }),
]);
assert.equal(raceSlow.run.runId, raceFast.run.runId);
assert.equal(raceSlow.run.proposal.action, "PREDICTION");
assert.equal(raceFast.run.proposal.action, "PREDICTION");
assert.equal(raceWriter.decisions.length, 1);
assert.equal(raceWriter.predictions.length, 1);

class TamperedRunStore implements AgentRunStore {
  async getByEvaluationKey(): Promise<AgentRunRecord> {
    return { ...structuredClone(first.run), proposal: { ...first.run.proposal, confidence: 0.01 } };
  }
  async putIfAbsent(_streamId: string, record: AgentRunRecord): Promise<AgentRunRecord> {
    return structuredClone(record);
  }
}
const tamperSource = new FakeMarketSource(baseSnapshot);
const tamperAdapter = new FakeDecisionAdapter(predictionProposal);
const tamperWriter = new FakeWriter();
const tamperService = new PaperEvaluationService({
  config,
  marketSource: tamperSource,
  decisionAdapter: tamperAdapter,
  runStore: new TamperedRunStore(),
  writer: tamperWriter,
});
await assert.rejects(
  () => tamperService.evaluate({ agentId: agent.id, accountId: account.accountId, evaluationKey: first.run.evaluationKey }),
  /proposal hash mismatch|run hash mismatch/,
);
assert.equal(tamperSource.calls, 0);
assert.equal(tamperAdapter.calls, 0);
assert.equal(tamperWriter.decisions.length, 0);

class RecordingSqlClient {
  readonly queries: string[] = [];
  released = false;
  private readonly selectRows: Array<Record<string, unknown>>;

  constructor(selectRows: Array<Record<string, unknown>> = []) {
    this.selectRows = selectRows;
  }

  async query<Row = Record<string, unknown>>(text: string, _values?: unknown[]): Promise<{ rows: Row[] }> {
    this.queries.push(text);
    if (text.includes("SELECT record_json, record_hash")) return { rows: this.selectRows as Row[] };
    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

class RecordingSqlPool {
  readonly clients: RecordingSqlClient[] = [];
  private readonly rows: Array<Record<string, unknown>>;

  constructor(rows: Array<Record<string, unknown>> = []) {
    this.rows = rows;
  }

  async connect(): Promise<RecordingSqlClient> {
    const client = new RecordingSqlClient(this.rows);
    this.clients.push(client);
    return client;
  }
}

const pgPool = new RecordingSqlPool();
const pgRunStore = new PostgresAgentRunStore(pgPool);
await pgRunStore.ensureSchema();
const persisted = await pgRunStore.putIfAbsent("paper-default", first.run);
assert.equal(persisted.runId, first.run.runId);
const pgQueries = pgPool.clients.flatMap((client) => client.queries);
assert.ok(pgQueries.some((query) => query.includes("CREATE TABLE IF NOT EXISTS agent_runs")));
assert.ok(pgQueries.some((query) => query.includes("pg_advisory_xact_lock")));
assert.ok(pgQueries.some((query) => query.includes("INSERT INTO agent_runs")));
assert.ok(pgPool.clients.every((client) => client.released));

const corruptedDbPool = new RecordingSqlPool([{
  record_json: first.run,
  record_hash: "0x" + "0".repeat(64),
}]);
await assert.rejects(
  () => new PostgresAgentRunStore(corruptedDbPool).getByEvaluationKey("paper-default", first.run.evaluationKey),
  /stored agent run record hash mismatch/,
);

console.log("paper-evaluation smoke: ok");