import assert from "node:assert/strict";
import {
  buildMarketSnapshot,
  hashAgentRunPayload,
  hashCanonicalPayload,
  type AgentRecord,
  type AgentRunRecord,
  type AgentSafetyEnvelope,
  type PaperAccountRecord,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import { PaperRiskCapacityPlanner, buildPaperRiskSnapshot } from "./paper-risk-capacity.ts";
import { PaperTradeCapacityService, assertPaperTradeCapacityRecord } from "./paper-trade-capacity.ts";
import { buildPaperTradeRequest } from "./paper-trade-request.ts";

const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const outputAssetId = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 1_000,
  maximumPortfolioExposureBps: 5_000,
  maximumOpenPositions: 10,
  maximumDailyLossBps: 500,
  maximumDrawdownBps: 2_000,
  maximumTradesPerDay: 50,
  maximumSlippageBps: 200,
  maximumPriceImpactBps: 300,
  minimumEvaluationIntervalSeconds: 30,
};
const spec: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA"] },
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
const agent: AgentRecord = {
  id: "agent-1",
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "HoodHound",
  thesis: "Trade verified liquid technology RWAs.",
  performanceState: "PAPER_ACTIVE",
  executionMode: "PAPER_ONLY",
  createdAt: 1_000,
};
const strategy: StrategyVersionRecord = {
  id: "strategy-1",
  agentId: agent.id,
  version: 1,
  spec,
  strategyHash: hashCanonicalPayload({ agentId: agent.id, version: 1, spec }),
  createdAt: 2_000,
};
const decisionAccount: PaperAccountRecord = {
  accountId: "account-1",
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: agent.id,
  balances: { [quoteAssetId]: "1000000000" },
  openedAt: 3_000,
};
const marketSnapshot = buildMarketSnapshot({
  chainId: 4_663,
  sourceId: "verified-rmt-paper-market-v1",
  capturedAt: 9_900,
  observations: [{
    assetId: outputAssetId,
    quoteAssetId: "fiat:USD",
    aliases: ["NVDA"],
    referencePriceAtomic: "150000000",
    referencePriceDecimals: 6,
  }],
});
const proposal = {
  action: "OPEN_POSITION" as const,
  confidence: 0.8,
  reasoningSummary: "Momentum and liquidity satisfy the strategy.",
  openPosition: { assetId: outputAssetId, requestedPositionBps: 400 },
};
const runPayload: Omit<AgentRunRecord, "runHash"> = {
  runId: "run-1",
  evaluationKey: "agent-1:slot-1",
  requestHash: hashCanonicalPayload({ request: "slot-1" }),
  agentId: agent.id,
  accountId: decisionAccount.accountId,
  accountSnapshot: decisionAccount,
  strategyVersion: strategy.version,
  strategyHash: strategy.strategyHash,
  runnerVersion: "RMT_PAPER_EVALUATION_V1",
  marketSourceId: marketSnapshot.sourceId,
  decisionAdapterId: "fake-decision-v1",
  modelIdentity: "fake-model-v1",
  marketSnapshot,
  proposal,
  proposalHash: hashCanonicalPayload(proposal),
  evaluatedAt: 10_000,
};
const run: AgentRunRecord = { ...runPayload, runHash: hashAgentRunPayload(runPayload) };
const risk = buildPaperRiskSnapshot({
  accountId: decisionAccount.accountId,
  quoteAssetId,
  positionAssetId: outputAssetId,
  markNavAtomic: "1000000000",
  currentPortfolioExposureAtomic: "100000000",
  currentPositionExposureAtomic: "10000000",
  openPositionCount: 1,
  tradesToday: 2,
  dailyLossBps: 50,
  drawdownBps: 100,
  capturedAt: 10_100,
});
const tradeRequest = buildPaperTradeRequest({
  run,
  strategy,
  riskSnapshot: risk,
  policy: { policyVersion: "RMT_PAPER_TRADE_REQUEST_V1", maximumRiskSnapshotAgeMs: 1_000 },
  requestedAt: 10_200,
});
const capacityService = new PaperTradeCapacityService(new PaperRiskCapacityPlanner({
  safetyEnvelope,
  policyVersion: "RMT_PAPER_RISK_V1",
  maximumRiskSnapshotAgeMs: 1_000,
}));
const capacity = capacityService.plan({ tradeRequest, agent, account: decisionAccount });
assert.equal(capacity.capacityPlan.status, "ADMITTED");
assert.equal(capacity.capacityPlan.requestedInputAmountAtomic, "40000000");
assert.equal(capacity.capacityPlan.admittedInputAmountAtomic, "40000000");
assert.equal(capacity.capacityPlan.accountSnapshot.balances[quoteAssetId], "1000000000");
assert.doesNotThrow(() => assertPaperTradeCapacityRecord(capacity));

const reducedBalance: PaperAccountRecord = {
  ...structuredClone(decisionAccount),
  balances: { [quoteAssetId]: "30000000" },
};
const reduced = capacityService.plan({ tradeRequest, agent, account: reducedBalance });
assert.equal(reduced.capacityPlan.status, "BLOCKED");
assert.equal(reduced.capacityPlan.maximumInputAmountAtomic, "30000000");
assert.equal(reduced.capacityPlan.admittedInputAmountAtomic, null);
assert.ok(reduced.capacityPlan.reasons.includes("REQUEST_EXCEEDS_CAPACITY"));
assert.equal(reduced.capacityPlan.accountSnapshot.balances[quoteAssetId], "30000000");

const tampered = structuredClone(capacity);
tampered.capacityPlan.requestedInputAmountAtomic = "1";
assert.throws(() => assertPaperTradeCapacityRecord(tampered), /capacity plan hash mismatch|does not exactly map/);

assert.throws(
  () => capacityService.plan({ tradeRequest, agent: { ...agent, id: "agent-2" }, account: decisionAccount }),
  /agent snapshot mismatch/,
);
assert.throws(
  () => capacityService.plan({ tradeRequest, agent, account: { ...decisionAccount, accountId: "account-2" } }),
  /account snapshot mismatch/,
);

const suspendedAgent: AgentRecord = { ...agent, executionMode: "SUSPENDED" };
assert.throws(
  () => capacityService.plan({ tradeRequest, agent: suspendedAgent, account: decisionAccount }),
  /foundation agent execution must remain PAPER_ONLY|paper capacity refuses non-paper execution mode/,
);

console.log("paper-trade-capacity smoke: ok");
