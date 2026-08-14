import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  type AgentRecord,
  type AgentSafetyEnvelope,
  type MarketObservationDraft,
  type PaperAccountRecord,
  type PaperOrderIntent,
  type PaperOrderRecord,
  type StrategySpec,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import { buildPaperOrderAdmission } from "./paper-order-admission.ts";
import {
  PaperOrderSubmissionService,
  assertPaperOrderSubmissionRecord,
  paperOrderSubmissionIdempotencyKey,
  type PaperOrderSubmissionWriter,
} from "./paper-order-submission.ts";
import { PaperRiskCapacityPlanner, buildPaperRiskSnapshot } from "./paper-risk-capacity.ts";

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
const observation: MarketObservationDraft = {
  assetId: outputAssetId,
  aliases: ["NVDA"],
  quoteAssetId: "fiat:USD",
  referencePriceAtomic: "150000000",
  referencePriceDecimals: 6,
};
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
  capturedAt: 99_900,
});
const capacity = new PaperRiskCapacityPlanner({
  safetyEnvelope,
  policyVersion: "RMT_PAPER_RISK_V1",
  maximumRiskSnapshotAgeMs: 5_000,
}).plan({
  agent,
  strategy,
  account,
  riskSnapshot: risk,
  marketObservation: observation,
  requestedInputAmountAtomic: "40000000",
  plannedAt: 100_000,
});
const admission = buildPaperOrderAdmission({
  capacityPlan: capacity,
  policy: { policyVersion: "RMT_PAPER_ORDER_ADMISSION_V1", maximumCapacityPlanAgeMs: 1_000 },
  admittedAt: 100_500,
});

class FakeWriter implements PaperOrderSubmissionWriter {
  calls = 0;
  readonly keys: string[] = [];
  private readonly orders = new Map<string, PaperOrderRecord>();

  async submitPaperOrder(intent: PaperOrderIntent, idempotencyKey: string): Promise<PaperOrderRecord> {
    this.calls += 1;
    this.keys.push(idempotencyKey);
    const prior = this.orders.get(idempotencyKey);
    if (prior) return structuredClone(prior);
    const order: PaperOrderRecord = { ...structuredClone(intent), orderId: `order-${this.orders.size + 1}`, status: "PENDING" };
    this.orders.set(idempotencyKey, order);
    return structuredClone(order);
  }
}

const writer = new FakeWriter();
const service = new PaperOrderSubmissionService(writer);
const first = await service.submit(admission);
assert.equal(first.order.orderId, "order-1");
assert.equal(first.order.status, "PENDING");
assert.equal(first.order.inputAmountAtomic, "40000000");
assert.equal(first.admission.admissionHash, admission.admissionHash);
assert.equal(first.idempotencyKey, paperOrderSubmissionIdempotencyKey(admission));
assert.match(first.submissionHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperOrderSubmissionRecord(first));

const retry = await service.submit(admission);
assert.equal(retry.order.orderId, first.order.orderId);
assert.equal(retry.submissionHash, first.submissionHash);
assert.equal(writer.calls, 2);
assert.deepEqual(writer.keys, [first.idempotencyKey, first.idempotencyKey]);

const tampered = structuredClone(first);
tampered.order.inputAmountAtomic = "39999999";
assert.throws(() => assertPaperOrderSubmissionRecord(tampered), /differs from admitted intent/);

class BadWriter implements PaperOrderSubmissionWriter {
  async submitPaperOrder(intent: PaperOrderIntent): Promise<PaperOrderRecord> {
    return { ...structuredClone(intent), inputAmountAtomic: "1", orderId: "bad-order", status: "PENDING" };
  }
}
await assert.rejects(() => new PaperOrderSubmissionService(new BadWriter()).submit(admission), /differs from admitted intent/);

const tamperedAdmission = structuredClone(admission);
tamperedAdmission.intent.inputAmountAtomic = "1";
await assert.rejects(() => service.submit(tamperedAdmission), /does not exactly match admitted capacity evidence/);

assert.equal("fill" in service, false);
assert.equal("execute" in service, false);
assert.equal("sign" in service, false);
console.log("paper-order-submission smoke: ok");
