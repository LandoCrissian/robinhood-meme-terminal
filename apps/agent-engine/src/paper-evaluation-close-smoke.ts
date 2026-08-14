import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  type AgentDecision,
  type AgentRecord,
  type PaperAccountRecord,
  type PredictionRecord,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import { InMemoryAgentRunStore } from "./agent-run-store.ts";
import {
  PaperEvaluationService,
  type PaperDecisionAdapter,
  type PaperDecisionAdapterInput,
  type PaperEvaluationMarketSource,
  type PaperEvaluationMarketSourceInput,
  type PaperEvaluationWriter,
} from "./paper-evaluation.ts";

const assetId = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const strategySpec: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA"] },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 120 },
  signals: [{ type: "momentum", weight: 1 }],
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
  id: "agent-close",
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Closer",
  thesis: "Reduce positions when exit conditions are met.",
  performanceState: "PAPER_ACTIVE",
  executionMode: "PAPER_ONLY",
  createdAt: 1_000,
};
const strategy: StrategyVersionRecord = {
  id: "strategy-close",
  agentId: agent.id,
  version: 1,
  spec: strategySpec,
  strategyHash: hashCanonicalPayload({ agentId: agent.id, version: 1, spec: strategySpec }),
  createdAt: 1_100,
};
const account: PaperAccountRecord = {
  accountId: "account-close",
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: agent.id,
  balances: { [quoteAssetId]: "800", [assetId]: "490" },
  openedAt: 1_200,
};

class MarketSource implements PaperEvaluationMarketSource {
  readonly sourceId = "close-market-source-v1";
  async capture(input: PaperEvaluationMarketSourceInput): Promise<unknown> {
    assert.equal(input.agentId, agent.id);
    return {
      chainId: 4_663,
      capturedAt: input.evaluatedAt - 100,
      observations: [{
        assetId,
        aliases: ["NVDA"],
        quoteAssetId,
        referencePriceAtomic: "150000000",
        referencePriceDecimals: 6,
      }],
    };
  }
}

class CloseAdapter implements PaperDecisionAdapter {
  readonly adapterId = "close-adapter-v1";
  readonly modelIdentity = "close-model-v1";
  async evaluate(input: PaperDecisionAdapterInput): Promise<unknown> {
    assert.equal(input.outputInstruction, "NO_ACTION_PREDICTION_OR_OPEN_POSITION");
    assert.deepEqual(input.allowedActions, ["NO_ACTION", "PREDICTION", "OPEN_POSITION", "CLOSE_POSITION"]);
    return {
      action: "CLOSE_POSITION",
      confidence: 0.9,
      reasoningSummary: "Exit conditions are satisfied; reduce the entire current NVDA position.",
      closePosition: { assetId: "NVDA", requestedReductionBps: 10_000 },
    };
  }
}

class Writer implements PaperEvaluationWriter {
  readonly decisions: AgentDecision[] = [];
  readonly predictions: PredictionRecord[] = [];
  getAgentSummary(): { agent: AgentRecord; latestStrategy?: StrategyVersionRecord } {
    return { agent: structuredClone(agent), latestStrategy: structuredClone(strategy) };
  }
  getPaperAccount(): PaperAccountRecord {
    return structuredClone(account);
  }
  async recordDecision(
    input: Omit<AgentDecision, "decisionId" | "decisionHash" | "policyVersion">,
  ): Promise<AgentDecision> {
    const base = { ...structuredClone(input), policyVersion: "RMT_AGENT_FOUNDATION_V1" };
    const decision: AgentDecision = {
      ...base,
      decisionId: "decision-close",
      decisionHash: hashCanonicalPayload(base),
    };
    this.decisions.push(decision);
    return structuredClone(decision);
  }
  async submitPrediction(input: Omit<PredictionRecord, "predictionId" | "resolvedOutcome" | "resolvedAt">): Promise<PredictionRecord> {
    const prediction = { ...structuredClone(input), predictionId: "unexpected-prediction" };
    this.predictions.push(prediction);
    return prediction;
  }
}

const writer = new Writer();
const service = new PaperEvaluationService({
  config: {
    streamId: "paper-close",
    chainId: 4_663,
    runnerVersion: "RMT_PAPER_EVALUATION_V2",
    maximumSnapshotAgeMs: 1_000,
    maximumObservations: 8,
    maximumFeaturesPerObservation: 8,
  },
  marketSource: new MarketSource(),
  decisionAdapter: new CloseAdapter(),
  runStore: new InMemoryAgentRunStore(),
  writer,
});
const result = await service.evaluate({
  agentId: agent.id,
  accountId: account.accountId,
  evaluationKey: "close-slot-1",
  evaluatedAt: 2_000,
});
assert.equal(result.run.proposal.action, "CLOSE_POSITION");
assert.equal(result.run.proposal.closePosition?.assetId, assetId);
assert.equal(result.run.proposal.closePosition?.requestedReductionBps, 10_000);
assert.equal(result.decision.action, "CLOSE_POSITION");
assert.equal(result.prediction, undefined);
assert.equal(writer.decisions.length, 1);
assert.equal(writer.predictions.length, 0);
assert.equal("submitPaperOrder" in service, false);
assert.equal("fillPaperOrder" in service, false);

console.log("paper-evaluation-close smoke: ok");
