import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  type AgentRecord,
  type AgentSafetyEnvelope,
  type MarketObservationDraft,
  type PaperAccountRecord,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  HumanPaperRiskCapacityPlanner,
  assertHumanPaperRiskCapacityPlan,
} from "./human-paper-risk-capacity.ts";
import {
  PaperRiskCapacityPlanner,
  buildPaperRiskSnapshot,
} from "./paper-risk-capacity.ts";

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
const riskLimits = {
  maximumPositionBps: 1_500,
  maximumPortfolioExposureBps: 5_000,
  maximumOpenPositions: 4,
  maximumDailyLossBps: 800,
  maximumDrawdownBps: 1_500,
  maximumTradesPerDay: 20,
};
const strategySpec: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA"] },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 600 },
  signals: [{ type: "momentum", weight: 1 }],
  prediction: { enabled: true, minimumConfidence: 0.65 },
  risk: riskLimits,
  execution: { venuePolicy: "RMT_BEST_VERIFIED", maximumSlippageBps: 75, maximumPriceImpactBps: 150 },
  prohibitedActions: ["ARBITRARY_CALL", "UNVERIFIED_VENUE"],
};
const agent: AgentRecord = {
  id: "agent-1",
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Agent One",
  thesis: "Parity test",
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
  createdAt: 1_100,
};
const agentAccount: PaperAccountRecord = {
  accountId: "agent-account",
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: agent.id,
  balances: { USDG: "700" },
  openedAt: 1_200,
};
const humanAccount: PaperAccountRecord = {
  accountId: "human-account",
  seasonId: "season-1",
  participantType: "HUMAN",
  participantId: "0x00000000000000000000000000000000000000aa",
  balances: { USDG: "700" },
  openedAt: 1_200,
};
const observation: MarketObservationDraft = {
  assetId: "NVDA",
  quoteAssetId: "USDG",
  aliases: ["NVDA"],
  referencePriceAtomic: "150000000",
  referencePriceDecimals: 6,
};

function risk(accountId: string, overrides: Partial<Parameters<typeof buildPaperRiskSnapshot>[0]> = {}) {
  return buildPaperRiskSnapshot({
    accountId,
    quoteAssetId: "USDG",
    positionAssetId: "NVDA",
    markNavAtomic: "1000",
    currentPortfolioExposureAtomic: "300",
    currentPositionExposureAtomic: "50",
    openPositionCount: 2,
    tradesToday: 3,
    dailyLossBps: 100,
    drawdownBps: 200,
    capturedAt: 2_000,
    ...overrides,
  });
}

const agentPlanner = new PaperRiskCapacityPlanner({
  safetyEnvelope,
  policyVersion: "PARITY_V1",
  maximumRiskSnapshotAgeMs: 1_000,
});
const humanPlanner = new HumanPaperRiskCapacityPlanner({
  safetyEnvelope,
  policy: {
    policyVersion: "PARITY_V1",
    ...riskLimits,
    maximumSlippageBps: 75,
    maximumPriceImpactBps: 150,
  },
  maximumRiskSnapshotAgeMs: 1_000,
});

const agentPlan = agentPlanner.plan({
  agent,
  strategy,
  account: agentAccount,
  riskSnapshot: risk(agentAccount.accountId),
  marketObservation: observation,
  requestedInputAmountAtomic: "100",
  plannedAt: 2_100,
});
const humanPlan = humanPlanner.plan({
  account: humanAccount,
  riskSnapshot: risk(humanAccount.accountId),
  marketObservation: observation,
  requestedInputAmountAtomic: "100",
  requestedMaximumSlippageBps: 75,
  plannedAt: 2_100,
});

assert.equal(humanPlan.status, agentPlan.status);
assert.equal(humanPlan.maximumInputAmountAtomic, agentPlan.maximumInputAmountAtomic);
assert.deepEqual(humanPlan.capacity, agentPlan.capacity);
assert.deepEqual(humanPlan.reasons, agentPlan.reasons);
assert.equal(humanPlan.admittedInputAmountAtomic, agentPlan.admittedInputAmountAtomic);
assert.equal(humanPlan.maximumPriceImpactBps, strategySpec.execution.maximumPriceImpactBps);
assert.doesNotThrow(() => assertHumanPaperRiskCapacityPlan(humanPlan));

const blockedAgent = agentPlanner.plan({
  agent,
  strategy,
  account: agentAccount,
  riskSnapshot: risk(agentAccount.accountId, { dailyLossBps: 800 }),
  marketObservation: observation,
  requestedInputAmountAtomic: "10",
  plannedAt: 2_100,
});
const blockedHuman = humanPlanner.plan({
  account: humanAccount,
  riskSnapshot: risk(humanAccount.accountId, { dailyLossBps: 800 }),
  marketObservation: observation,
  requestedInputAmountAtomic: "10",
  requestedMaximumSlippageBps: 75,
  plannedAt: 2_100,
});
assert.equal(blockedHuman.status, "BLOCKED");
assert.equal(blockedHuman.status, blockedAgent.status);
assert.deepEqual(blockedHuman.reasons, blockedAgent.reasons);
assert.equal(blockedHuman.maximumInputAmountAtomic, "0");

const overCapacity = humanPlanner.plan({
  account: humanAccount,
  riskSnapshot: risk(humanAccount.accountId),
  marketObservation: observation,
  requestedInputAmountAtomic: "101",
  requestedMaximumSlippageBps: 75,
  plannedAt: 2_100,
});
assert.equal(overCapacity.status, "BLOCKED");
assert.ok(overCapacity.reasons.includes("REQUEST_EXCEEDS_CAPACITY"));

assert.throws(
  () => humanPlanner.plan({
    account: humanAccount,
    riskSnapshot: risk(humanAccount.accountId),
    marketObservation: observation,
    requestedInputAmountAtomic: "10",
    requestedMaximumSlippageBps: 76,
    plannedAt: 2_100,
  }),
  /requested slippage exceeds risk policy/,
);

console.log("human-paper-risk-capacity smoke: ok");
