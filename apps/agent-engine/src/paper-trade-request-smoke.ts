import assert from "node:assert/strict";
import {
  buildMarketSnapshot,
  hashAgentRunPayload,
  hashCanonicalPayload,
  type AgentRunRecord,
  type PaperAccountRecord,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import { buildPaperRiskSnapshot } from "./paper-risk-capacity.ts";
import {
  assertPaperTradeRequestRecord,
  buildPaperTradeRequest,
} from "./paper-trade-request.ts";

const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const outputAssetId = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
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
const strategy: StrategyVersionRecord = {
  id: "strategy-1",
  agentId: "agent-1",
  version: 1,
  spec,
  strategyHash: hashCanonicalPayload({ agentId: "agent-1", version: 1, spec }),
  createdAt: 1_000,
};
const account: PaperAccountRecord = {
  accountId: "account-1",
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: "agent-1",
  balances: { [quoteAssetId]: "1000000000" },
  openedAt: 2_000,
};
const marketSnapshot = buildMarketSnapshot({
  chainId: 4_663,
  sourceId: "verified-rmt-paper-market-v1",
  capturedAt: 9_900,
  observations: [{
    assetId: outputAssetId,
    quoteAssetId: "fiat:USD",
    aliases: ["NVDA", "robinhood-nvda"],
    referencePriceAtomic: "150000000",
    referencePriceDecimals: 6,
  }],
});
const proposal = {
  action: "OPEN_POSITION" as const,
  confidence: 0.8,
  reasoningSummary: "Momentum and liquidity satisfy the admitted strategy.",
  openPosition: { assetId: outputAssetId, requestedPositionBps: 400 },
};
const runPayload: Omit<AgentRunRecord, "runHash"> = {
  runId: "run-1",
  evaluationKey: "agent-1:slot-1",
  requestHash: hashCanonicalPayload({ request: "slot-1" }),
  agentId: "agent-1",
  accountId: account.accountId,
  accountSnapshot: account,
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
  accountId: account.accountId,
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
const policy = { policyVersion: "RMT_PAPER_TRADE_REQUEST_V1", maximumRiskSnapshotAgeMs: 1_000 };
const request = buildPaperTradeRequest({ run, strategy, riskSnapshot: risk, policy, requestedAt: 10_200 });
assert.equal(request.requestedPositionBps, 400);
assert.equal(request.requestedInputAmountAtomic, "40000000");
assert.equal(request.inputAssetId, quoteAssetId);
assert.equal(request.outputAssetId, outputAssetId);
assert.equal(request.marketObservation.assetId, outputAssetId);
assert.match(request.requestHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperTradeRequestRecord(request));

const tampered = structuredClone(request);
tampered.requestedInputAmountAtomic = "40000001";
assert.throws(() => assertPaperTradeRequestRecord(tampered), /does not match NAV bps request/);

assert.throws(
  () => buildPaperTradeRequest({ run, strategy, riskSnapshot: { ...risk, capturedAt: 9_999, riskHash: risk.riskHash }, policy, requestedAt: 10_200 }),
  /risk snapshot hash mismatch|predates agent decision/,
);

const olderRisk = buildPaperRiskSnapshot({
  accountId: account.accountId,
  quoteAssetId,
  positionAssetId: outputAssetId,
  markNavAtomic: "1000000000",
  currentPortfolioExposureAtomic: "100000000",
  currentPositionExposureAtomic: "10000000",
  openPositionCount: 1,
  tradesToday: 2,
  dailyLossBps: 50,
  drawdownBps: 100,
  capturedAt: 10_050,
});
assert.throws(
  () => buildPaperTradeRequest({ run, strategy, riskSnapshot: olderRisk, policy: { ...policy, maximumRiskSnapshotAgeMs: 100 }, requestedAt: 10_200 }),
  /risk snapshot is stale/,
);

const wrongAssetRisk = buildPaperRiskSnapshot({
  accountId: account.accountId,
  quoteAssetId,
  positionAssetId: "eip155:4663/contract:0x3333333333333333333333333333333333333333",
  markNavAtomic: "1000000000",
  currentPortfolioExposureAtomic: "100000000",
  currentPositionExposureAtomic: "10000000",
  openPositionCount: 1,
  tradesToday: 2,
  dailyLossBps: 50,
  drawdownBps: 100,
  capturedAt: 10_100,
});
assert.throws(
  () => buildPaperTradeRequest({ run, strategy, riskSnapshot: wrongAssetRisk, policy, requestedAt: 10_200 }),
  /risk position asset mismatch/,
);

const wrongStrategy = { ...structuredClone(strategy), strategyHash: hashCanonicalPayload({ wrong: true }) };
assert.throws(
  () => buildPaperTradeRequest({ run, strategy: wrongStrategy, riskSnapshot: risk, policy, requestedAt: 10_200 }),
  /strategy hash mismatch/,
);

const predictionProposal = {
  action: "PREDICTION" as const,
  confidence: 0.8,
  reasoningSummary: "Forecast only.",
  prediction: { assetId: outputAssetId, condition: "higher", forecastProbability: 0.7, resolvesAt: 20_000 },
};
const predictionPayload: Omit<AgentRunRecord, "runHash"> = {
  ...runPayload,
  runId: "run-2",
  proposal: predictionProposal,
  proposalHash: hashCanonicalPayload(predictionProposal),
};
const predictionRun: AgentRunRecord = { ...predictionPayload, runHash: hashAgentRunPayload(predictionPayload) };
assert.throws(
  () => buildPaperTradeRequest({ run: predictionRun, strategy, riskSnapshot: risk, policy, requestedAt: 10_200 }),
  /requires an OPEN_POSITION run/,
);

console.log("paper-trade-request smoke: ok");
