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
import {
  PaperOpenPositionAdmissionService,
  assertPaperOpenPositionAdmissionRecord,
} from "./paper-open-position-admission.ts";
import { PaperRiskCapacityPlanner, buildPaperRiskSnapshot } from "./paper-risk-capacity.ts";
import { PaperTradeCapacityService } from "./paper-trade-capacity.ts";

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
const account: PaperAccountRecord = {
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
const service = new PaperOpenPositionAdmissionService({
  capacityService: new PaperTradeCapacityService(new PaperRiskCapacityPlanner({
    safetyEnvelope,
    policyVersion: "RMT_PAPER_RISK_V1",
    maximumRiskSnapshotAgeMs: 1_000,
  })),
  tradeRequestPolicy: { policyVersion: "RMT_PAPER_TRADE_REQUEST_V1", maximumRiskSnapshotAgeMs: 1_000 },
  orderAdmissionPolicy: { policyVersion: "RMT_PAPER_ORDER_ADMISSION_V1", maximumCapacityPlanAgeMs: 500 },
});

const admitted = service.admit({
  run,
  strategy,
  riskSnapshot: risk,
  agent,
  account,
  requestedAt: 10_200,
  admittedAt: 10_300,
});
assert.equal(admitted.status, "ADMITTED");
assert.equal(admitted.tradeRequest.requestedPositionBps, 400);
assert.equal(admitted.tradeRequest.requestedInputAmountAtomic, "40000000");
assert.equal(admitted.tradeCapacity.capacityPlan.status, "ADMITTED");
assert.equal(admitted.orderAdmission?.intent.inputAmountAtomic, "40000000");
assert.equal(admitted.orderAdmission?.intent.outputAssetId, outputAssetId);
assert.equal(admitted.orderAdmission?.capacityPlanHash, admitted.tradeCapacity.capacityPlan.planHash);
assert.match(admitted.recordHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperOpenPositionAdmissionRecord(admitted));

const reducedAccount: PaperAccountRecord = {
  ...structuredClone(account),
  balances: { [quoteAssetId]: "30000000" },
};
const blocked = service.admit({
  run,
  strategy,
  riskSnapshot: risk,
  agent,
  account: reducedAccount,
  requestedAt: 10_200,
  admittedAt: 10_300,
});
assert.equal(blocked.status, "BLOCKED");
assert.equal(blocked.tradeCapacity.capacityPlan.status, "BLOCKED");
assert.equal(blocked.tradeCapacity.capacityPlan.maximumInputAmountAtomic, "30000000");
assert.ok(blocked.tradeCapacity.capacityPlan.reasons.includes("REQUEST_EXCEEDS_CAPACITY"));
assert.equal(blocked.orderAdmission, null);
assert.doesNotThrow(() => assertPaperOpenPositionAdmissionRecord(blocked));

const blockedWithAdmission = structuredClone(blocked);
blockedWithAdmission.orderAdmission = structuredClone(admitted.orderAdmission);
assert.throws(() => assertPaperOpenPositionAdmissionRecord(blockedWithAdmission), /blocked open-position record cannot contain order admission/);

const admittedWithoutAdmission = structuredClone(admitted);
admittedWithoutAdmission.orderAdmission = null;
assert.throws(() => assertPaperOpenPositionAdmissionRecord(admittedWithoutAdmission), /requires admitted capacity and order admission/);

const tamperedLink = structuredClone(admitted);
tamperedLink.orderAdmission!.capacityPlanHash = hashCanonicalPayload({ wrong: true });
assert.throws(() => assertPaperOpenPositionAdmissionRecord(tamperedLink), /capacity plan hash mismatch|does not bind capacity plan/);

const tamperedStatus = structuredClone(admitted);
tamperedStatus.status = "BLOCKED";
assert.throws(() => assertPaperOpenPositionAdmissionRecord(tamperedStatus), /blocked open-position record cannot contain order admission/);

assert.equal("submitPaperOrder" in service, false);
assert.equal("fill" in service, false);
assert.equal("execute" in service, false);
assert.equal("sign" in service, false);
console.log("paper-open-position-admission smoke: ok");
