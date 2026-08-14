import assert from "node:assert/strict";
import {
  assertPerformanceTransition,
  assertStrategyWithinSafetyEnvelope,
  calculateMaxDrawdownBps,
  calculateSimpleReturnBps,
  calculateTimeDecayedBrier,
  canTransitionPerformanceState,
  type AgentSafetyEnvelope,
  type PredictionRecord,
  type StrategySpec,
} from "./index.ts";

const envelope: AgentSafetyEnvelope = {
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
  universe: { assetClasses: ["RWA"], minimumLiquidityUsd: 25_000 },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 86_400 },
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

assert.doesNotThrow(() => assertStrategyWithinSafetyEnvelope(strategy, envelope));
assert.throws(() => assertStrategyWithinSafetyEnvelope({ ...strategy, risk: { ...strategy.risk, maximumPositionBps: 2_000 } }, envelope));
assert.equal(canTransitionPerformanceState("INCUBATING", "PAPER_ACTIVE"), true);
assert.equal(canTransitionPerformanceState("INCUBATING", "ELITE"), false);
assert.doesNotThrow(() => assertPerformanceTransition("PAPER_ACTIVE", "QUALIFIED"));

const prediction: PredictionRecord = {
  predictionId: "prediction-1",
  agentId: "agent-1",
  strategyVersion: 1,
  assetId: "NVDA",
  condition: "closes higher",
  forecastProbability: 0.8,
  createdAt: 1,
  resolvesAt: 2,
  resolvedOutcome: 1,
  resolvedAt: 2,
};
assert.ok(Math.abs(calculateTimeDecayedBrier([prediction]) - 0.04) < 1e-12);
assert.equal(calculateSimpleReturnBps("1000000", "1100000"), 1000n);
assert.equal(calculateMaxDrawdownBps(["1000000", "1200000", "900000", "1100000"]), 2500n);
console.log("agent-core smoke: ok");
