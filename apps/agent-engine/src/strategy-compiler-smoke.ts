import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  type AgentRecord,
  type AgentSafetyEnvelope,
  type StrategyCompilerPolicy,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import { StrategyAdmissionService, type StrategyAdmissionWriter } from "./strategy-admission.ts";
import { InMemoryStrategyCompilationStore } from "./strategy-compilation-store.ts";
import { StrategyCompiler, type StrategyModelAdapter, type StrategyModelAdapterInput } from "./strategy-compiler.ts";

const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 1_000,
  maximumPortfolioExposureBps: 5_000,
  maximumOpenPositions: 10,
  maximumDailyLossBps: 500,
  maximumDrawdownBps: 2_000,
  maximumTradesPerDay: 50,
  maximumSlippageBps: 200,
  maximumPriceImpactBps: 500,
  minimumEvaluationIntervalSeconds: 30,
};

const policy: StrategyCompilerPolicy = {
  schemaVersion: 1,
  compilerVersion: "RMT_STRATEGY_COMPILER_V1",
  policyVersion: "RMT_AGENT_FOUNDATION_V1",
  maximumThesisChars: 4_000,
  allowedAssetClasses: ["RWA"],
  maximumAssetsPerList: 32,
  maximumSignals: 12,
  maximumSignalParameters: 16,
  requiredProhibitedActions: ["ARBITRARY_CALL", "UNVERIFIED_VENUE"],
};

const safeStrategy: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA"], minimumLiquidityUsd: 25_000 },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 86_400, maximumHoldingSeconds: 604_800 },
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
  prohibitedActions: [],
};

class FakeAdapter implements StrategyModelAdapter {
  readonly adapterId = "fake-structured-adapter";
  readonly modelIdentity = "fake-model-v1";
  compileCount = 0;
  private readonly output: unknown;
  private readonly delayMs: number;

  constructor(output: unknown, delayMs = 0) {
    this.output = output;
    this.delayMs = delayMs;
  }

  async compile(input: StrategyModelAdapterInput): Promise<unknown> {
    this.compileCount += 1;
    assert.equal(input.outputInstruction, "STRUCTURED_STRATEGY_DRAFT_ONLY");
    assert.equal(input.strategySchemaVersion, 1);
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return structuredClone(this.output);
  }
}

class FakeWriter implements StrategyAdmissionWriter {
  readonly agent: AgentRecord = {
    id: "agent-1",
    ownerAddress: "0x0000000000000000000000000000000000000001",
    name: "HoodHound",
    thesis: "  Trade liquid tokenized technology assets when momentum and liquidity agree.  ",
    performanceState: "INCUBATING",
    executionMode: "PAPER_ONLY",
    createdAt: 1_000,
  };
  private readonly idempotent = new Map<string, StrategyVersionRecord>();
  readonly versions: StrategyVersionRecord[] = [];

  getAgentSummary(agentId: string): { agent: AgentRecord; latestStrategy?: StrategyVersionRecord } {
    if (agentId !== this.agent.id) throw new Error("unknown agent");
    return { agent: structuredClone(this.agent), latestStrategy: this.versions.at(-1) };
  }

  async createStrategyVersion(agentId: string, spec: StrategySpec, idempotencyKey: string, createdAt = Date.now()): Promise<StrategyVersionRecord> {
    const prior = this.idempotent.get(idempotencyKey);
    if (prior) {
      assert.deepEqual(prior.spec, spec);
      return structuredClone(prior);
    }
    const version = this.versions.length + 1;
    const record: StrategyVersionRecord = {
      id: `strategy-${version}`,
      agentId,
      version,
      spec: structuredClone(spec),
      strategyHash: hashCanonicalPayload({ agentId, version, spec }),
      createdAt,
    };
    this.versions.push(record);
    this.idempotent.set(idempotencyKey, record);
    return structuredClone(record);
  }
}

const safeDraft = {
  spec: safeStrategy,
  summary: "Trade liquid technology RWAs using momentum confirmed by liquidity.",
  assumptions: ["RMT provides verified paper-market observations."],
  warnings: ["Momentum can reverse quickly."],
};

const adapter = new FakeAdapter(safeDraft);
const compiler = new StrategyCompiler({ safetyEnvelope, policy }, adapter);
const writer = new FakeWriter();
const store = new InMemoryStrategyCompilationStore();
const service = new StrategyAdmissionService({ streamId: "paper-default", compiler, store, writer });

const first = await service.compileAndAdmit(writer.agent.id, 2_000);
assert.equal(first.compilation.status, "ADMITTED");
assert.equal(first.strategy?.version, 1);
assert.equal(first.compilation.normalizedThesis, "Trade liquid tokenized technology assets when momentum and liquidity agree.");
assert.deepEqual(first.compilation.admittedSpec?.prohibitedActions, ["ARBITRARY_CALL", "UNVERIFIED_VENUE"]);
assert.equal(first.compilation.admittedSpec?.risk.maximumPositionBps, 500);
assert.equal(first.compilation.admittedSpec?.execution.maximumSlippageBps, 100);
assert.equal(adapter.compileCount, 1);

const replay = await service.compileAndAdmit(writer.agent.id, 9_999);
assert.equal(replay.compilation.compilationId, first.compilation.compilationId);
assert.equal(replay.strategy?.id, first.strategy?.id);
assert.equal(adapter.compileCount, 1);
assert.equal(writer.versions.length, 1);

const unsafeAdapter = new FakeAdapter({
  ...safeDraft,
  spec: { ...safeStrategy, risk: { ...safeStrategy.risk, maximumPositionBps: 5_000 } },
});
const unsafeCompiler = new StrategyCompiler({ safetyEnvelope, policy }, unsafeAdapter);
const unsafeStore = new InMemoryStrategyCompilationStore();
const unsafeWriter = new FakeWriter();
const unsafe = await new StrategyAdmissionService({ streamId: "unsafe", compiler: unsafeCompiler, store: unsafeStore, writer: unsafeWriter })
  .compileAndAdmit(unsafeWriter.agent.id, 3_000);
assert.equal(unsafe.compilation.status, "REJECTED");
assert.match(unsafe.compilation.errors[0] ?? "", /maximumPositionBps exceeds RMT safety envelope/);
assert.equal(unsafeWriter.versions.length, 0);

const communityAdapter = new FakeAdapter({ ...safeDraft, spec: { ...safeStrategy, universe: { assetClasses: ["COMMUNITY"] } } });
const communityWriter = new FakeWriter();
const community = await new StrategyAdmissionService({
  streamId: "community",
  compiler: new StrategyCompiler({ safetyEnvelope, policy }, communityAdapter),
  store: new InMemoryStrategyCompilationStore(),
  writer: communityWriter,
}).compileAndAdmit(communityWriter.agent.id, 4_000);
assert.equal(community.compilation.status, "REJECTED");
assert.match(community.compilation.errors[0] ?? "", /COMMUNITY is not admitted/);

const malformedAdapter = new FakeAdapter({ spec: null, summary: "bad", assumptions: [], warnings: [] });
const malformedWriter = new FakeWriter();
const malformed = await new StrategyAdmissionService({
  streamId: "malformed",
  compiler: new StrategyCompiler({ safetyEnvelope, policy }, malformedAdapter),
  store: new InMemoryStrategyCompilationStore(),
  writer: malformedWriter,
}).compileAndAdmit(malformedWriter.agent.id, 5_000);
assert.equal(malformed.compilation.status, "REJECTED");
assert.equal(malformed.compilation.candidateSpec, undefined);
assert.equal(malformedWriter.versions.length, 0);

const raceStore = new InMemoryStrategyCompilationStore();
const raceWriter = new FakeWriter();
const fasterSpec = { ...safeStrategy, prediction: { ...safeStrategy.prediction, minimumConfidence: 0.72 } };
const slow = new StrategyCompiler({ safetyEnvelope, policy }, new FakeAdapter(safeDraft, 20));
const fast = new StrategyCompiler({ safetyEnvelope, policy }, new FakeAdapter({ ...safeDraft, spec: fasterSpec }, 0));
const slowService = new StrategyAdmissionService({ streamId: "race", compiler: slow, store: raceStore, writer: raceWriter });
const fastService = new StrategyAdmissionService({ streamId: "race", compiler: fast, store: raceStore, writer: raceWriter });
const [slowResult, fastResult] = await Promise.all([
  slowService.compileAndAdmit(raceWriter.agent.id, 6_000),
  fastService.compileAndAdmit(raceWriter.agent.id, 6_001),
]);
assert.equal(slowResult.compilation.requestHash, fastResult.compilation.requestHash);
assert.equal(slowResult.compilation.compilationId, fastResult.compilation.compilationId);
assert.equal(raceWriter.versions.length, 1);
assert.equal(raceWriter.versions[0]?.spec.prediction.minimumConfidence, 0.72);

assert.equal("chainOfThought" in first.compilation, false);
assert.equal("reasoning" in first.compilation, false);
console.log("strategy-compiler smoke: ok");
