import assert from "node:assert/strict";
import { hashPaperQuoteEvidence, type AgentSafetyEnvelope, type StrategySpec, type VerifiedPaperQuoteEvidence } from "../../../packages/agent-core/src/index.ts";
import { AgentEngine } from "./engine.ts";

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

const strategy: StrategySpec = {
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
  prohibitedActions: ["ARBITRARY_CALL", "UNVERIFIED_VENUE"],
};

const engine = new AgentEngine({ safetyEnvelope, paperFillDelayMs: 1_000, policyVersion: "RMT_AGENT_FOUNDATION_V1" });
engine.createSeason({ seasonId: "season-1", name: "Smoke", startsAt: 1_000, endsAt: 10_000, createdAt: 900 });
const agent = engine.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "HoodHound",
  thesis: "Trade liquid tokenized technology assets when momentum and liquidity agree.",
  createdAt: 1_000,
});
assert.equal(agent.executionMode, "PAPER_ONLY");
const version = engine.createStrategyVersion(agent.id, strategy, 1_001);
assert.equal(version.version, 1);
engine.activatePaperAgent(agent.id);
const account = engine.openPaperAccount({ agentId: agent.id, seasonId: "season-1", initialBalances: { USDG: "10000000", ETH: "10000" }, openedAt: 1_002 });
const decision = engine.recordDecision({
  agentId: agent.id,
  strategyVersion: 1,
  marketSnapshotId: "snapshot-1",
  createdAt: 1_500,
  action: "PREDICTION",
  confidence: 0.8,
  reasoningSummary: "Momentum and liquidity conditions satisfy the compiled strategy.",
  modelIdentity: "paper-test-model",
  compilerVersion: "compiler-v1",
});
assert.equal(decision.policyVersion, "RMT_AGENT_FOUNDATION_V1");
assert.match(decision.decisionHash, /^0x[0-9a-f]{64}$/);
const prediction = engine.submitPrediction({
  agentId: agent.id,
  strategyVersion: 1,
  assetId: "NVDA",
  condition: "reference price closes higher",
  forecastProbability: 0.8,
  createdAt: 2_000,
  resolvesAt: 3_000,
});
engine.resolvePrediction(prediction.predictionId, 1, 3_000);
const order = engine.submitPaperOrder({
  agentId: agent.id,
  strategyVersion: 1,
  accountId: account.accountId,
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "1000000",
  maximumSlippageBps: 75,
  createdAt: 4_000,
});
const earlyQuotePayload = {
  quoteId: "early",
  inputAssetId: "USDG",
  outputAssetId: "NVDA",
  inputAmountAtomic: "1000000",
  outputAmountAtomic: "500000",
  providerId: "verified-rmt-paper-provider",
  priceImpactBps: 80,
  observedAt: 4_999,
};
const earlyQuote: VerifiedPaperQuoteEvidence = { ...earlyQuotePayload, evidenceHash: hashPaperQuoteEvidence(earlyQuotePayload) };
assert.throws(() => engine.fillPaperOrder(order.orderId, earlyQuote));
const validQuotePayload = { ...earlyQuotePayload, quoteId: "valid", observedAt: 5_000 };
const quote: VerifiedPaperQuoteEvidence = { ...validQuotePayload, evidenceHash: hashPaperQuoteEvidence(validQuotePayload) };
assert.throws(() => engine.fillPaperOrder(order.orderId, { ...quote, outputAmountAtomic: "999999" }));
const fill = engine.fillPaperOrder(order.orderId, quote, { feeAssetId: "USDG", feeAmountAtomic: "2500", gasAssetId: "ETH", gasCostAtomic: "500" });
assert.equal(fill.feeAmountAtomic, "2500");
const updated = engine.getPaperAccount(account.accountId);
assert.equal(updated.balances.USDG, "8997500");
assert.equal(updated.balances.NVDA, "500000");
assert.equal(updated.balances.ETH, "9500");
const summary = engine.getAgentSummary(agent.id);
assert.equal(summary.resolvedPredictions, 1);
assert.ok(Math.abs(summary.brierScore - 0.04) < 1e-12);
assert.equal(summary.paperFills, 1);
assert.equal(summary.agent.executionMode, "PAPER_ONLY");
assert.equal("executeLive" in engine, false);
const snapshot = engine.exportSnapshot();
const restored = AgentEngine.fromSnapshot({ safetyEnvelope, paperFillDelayMs: 1_000, policyVersion: "RMT_AGENT_FOUNDATION_V1" }, snapshot);
assert.deepEqual(restored.getPaperAccount(account.accountId).balances, updated.balances);
console.log("agent-engine smoke: ok");
