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
  PaperRiskCapacityPlanner,
  buildPaperRiskSnapshot,
} from "./paper-risk-capacity.ts";
import {
  assertPaperOrderAdmissionRecord,
  buildPaperOrderAdmission,
} from "./paper-order-admission.ts";

const outputAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const quoteAssetId = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
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
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA"], minimumLiquidityUsd: 25_000 },
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
const account: PaperAccountRecord = {
  accountId: "account-1",
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: agent.id,
  balances: { [quoteAssetId]: "1000000000" },
  openedAt: 3_000,
};
const observation: MarketObservationDraft = {
  assetId: outputAssetId,
  aliases: ["NVDA", "robinhood-nvda"],
  quoteAssetId: "fiat:USD",
  referencePriceAtomic: "150000000",
  referencePriceDecimals: 6,
  liquidityUsdAtomic: "1000000000000",
  liquidityUsdDecimals: 6,
  features: { assetClass: "RWA" },
};
const riskSnapshot = buildPaperRiskSnapshot({
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
  capturedAt: 99_900,
});
const planner = new PaperRiskCapacityPlanner({
  safetyEnvelope,
  policyVersion: "RMT_PAPER_RISK_V1",
  maximumRiskSnapshotAgeMs: 5_000,
});
const capacity = planner.plan({
  agent,
  strategy,
  account,
  riskSnapshot,
  marketObservation: observation,
  requestedInputAmountAtomic: "40000000",
  plannedAt: 100_000,
});
assert.equal(capacity.status, "ADMITTED");
assert.equal(capacity.maximumInputAmountAtomic, "40000000");
assert.equal(capacity.admittedInputAmountAtomic, "40000000");

const admission = buildPaperOrderAdmission({
  capacityPlan: capacity,
  policy: { policyVersion: "RMT_PAPER_ORDER_ADMISSION_V1", maximumCapacityPlanAgeMs: 1_000 },
  admittedAt: 100_500,
});
assert.equal(admission.intent.agentId, agent.id);
assert.equal(admission.intent.strategyVersion, 1);
assert.equal(admission.intent.accountId, account.accountId);
assert.equal(admission.intent.inputAssetId, quoteAssetId);
assert.equal(admission.intent.outputAssetId, outputAssetId);
assert.equal(admission.intent.inputAmountAtomic, "40000000");
assert.equal(admission.intent.maximumSlippageBps, 100);
assert.equal(admission.intent.createdAt, 100_500);
assert.equal(admission.capacityPlanHash, capacity.planHash);
assert.match(admission.admissionId, /^0x[0-9a-f]{64}$/);
assert.match(admission.admissionHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperOrderAdmissionRecord(admission));

const tamperedIntent = structuredClone(admission);
tamperedIntent.intent.inputAmountAtomic = "39999999";
assert.throws(() => assertPaperOrderAdmissionRecord(tamperedIntent), /does not exactly match/);

const tamperedCapacity = structuredClone(capacity);
tamperedCapacity.maximumInputAmountAtomic = "50000000";
assert.throws(
  () => buildPaperOrderAdmission({
    capacityPlan: tamperedCapacity,
    policy: { policyVersion: "RMT_PAPER_ORDER_ADMISSION_V1", maximumCapacityPlanAgeMs: 1_000 },
    admittedAt: 100_500,
  }),
  /capacity plan hash mismatch/,
);

assert.throws(
  () => buildPaperOrderAdmission({
    capacityPlan: capacity,
    policy: { policyVersion: "RMT_PAPER_ORDER_ADMISSION_V1", maximumCapacityPlanAgeMs: 100 },
    admittedAt: 100_500,
  }),
  /capacity plan is stale/,
);

const oversized = planner.plan({
  agent,
  strategy,
  account,
  riskSnapshot,
  marketObservation: observation,
  requestedInputAmountAtomic: "50000000",
  plannedAt: 100_000,
});
assert.equal(oversized.status, "BLOCKED");
assert.equal(oversized.admittedInputAmountAtomic, null);
assert.ok(oversized.reasons.includes("REQUEST_EXCEEDS_CAPACITY"));
assert.throws(
  () => buildPaperOrderAdmission({
    capacityPlan: oversized,
    policy: { policyVersion: "RMT_PAPER_ORDER_ADMISSION_V1", maximumCapacityPlanAgeMs: 1_000 },
    admittedAt: 100_500,
  }),
  /requires an admitted capacity plan/,
);

assert.equal("submitPaperOrder" in admission, false);
assert.equal("fill" in admission, false);
assert.equal("execute" in admission, false);
console.log("paper-order-admission smoke: ok");
