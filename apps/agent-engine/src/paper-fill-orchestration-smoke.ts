import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  type AgentRecord,
  type AgentSafetyEnvelope,
  type MarketObservationDraft,
  type PaperAccountRecord,
  type PaperExecutionCosts,
  type PaperFillRecord,
  type PaperOrderIntent,
  type PaperOrderRecord,
  type StrategySpec,
  type StrategyVersionRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import { buildPaperFillCostPlan } from "./paper-fill-cost.ts";
import {
  PaperFillOrchestrationService,
  assertPaperFillOrchestrationRecord,
  type PaperFillWriter,
} from "./paper-fill-orchestration.ts";
import { buildPaperOrderAdmission } from "./paper-order-admission.ts";
import {
  PaperOrderSubmissionService,
  type PaperOrderSubmissionWriter,
} from "./paper-order-submission.ts";
import { PaperRiskCapacityPlanner, buildPaperRiskSnapshot } from "./paper-risk-capacity.ts";
import {
  RmtPaperQuoteService,
  type RmtPaperQuoteReader,
  type RmtPaperQuoteReaderInput,
} from "./rmt-paper-quote.ts";

const inputAddress = "0x1111111111111111111111111111111111111111";
const outputAddress = "0x2222222222222222222222222222222222222222";
const inputAssetId = `eip155:4663/contract:${inputAddress}`;
const outputAssetId = `eip155:4663/contract:${outputAddress}`;
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
  balances: { [inputAssetId]: "1000000000" },
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
  quoteAssetId: inputAssetId,
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

class OrderWriter implements PaperOrderSubmissionWriter {
  private readonly byKey = new Map<string, PaperOrderRecord>();
  async submitPaperOrder(intent: PaperOrderIntent, key: string): Promise<PaperOrderRecord> {
    const prior = this.byKey.get(key);
    if (prior) return structuredClone(prior);
    const order: PaperOrderRecord = { ...structuredClone(intent), orderId: "order-1", status: "PENDING" };
    this.byKey.set(key, order);
    return structuredClone(order);
  }
}
const submission = await new PaperOrderSubmissionService(new OrderWriter()).submit(admission);

function quoteResponse(input: { userPaysGas: boolean; networkFeeNativeAtomic?: string | null; outputAsset?: string }) {
  return {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    chainId: 4_663,
    inputAsset: inputAddress,
    outputAsset: input.outputAsset ?? outputAddress,
    inputAmountAtomic: "40000000",
    requestedAtMs: 100_850,
    completedAtMs: 100_950,
    attempts: [{
      provider: "uniswap-v3",
      adapterVersion: 1,
      status: "indicative",
      chainId: 4_663,
      inputAsset: inputAddress,
      outputAsset: input.outputAsset ?? outputAddress,
      inputAmountAtomic: "40000000",
      expectedOutputAtomic: "985000000000000000",
      protectedOutputAtomic: "980000000000000000",
      outputDecimals: 18,
      priceImpact: 0.001,
      quotedAtMs: 101_000,
      expiresAtMs: 120_000,
      latencyMs: 20,
      strictVerificationAvailable: true,
      authorizationReady: false,
      userPaysGas: input.userPaysGas,
      networkFeeNativeAtomic: input.userPaysGas ? (input.networkFeeNativeAtomic ?? null) : null,
      networkFeeNativeSymbol: input.userPaysGas ? "ETH" : null,
      costState: input.userPaysGas ? "network_fee_pending" : null,
    }],
  };
}
class QuoteReader implements RmtPaperQuoteReader {
  readonly sourceId = "rmt-vnext-normalized-quote-reader-v1";
  private readonly payload: unknown;
  constructor(payload: unknown) { this.payload = payload; }
  async compare(_input: RmtPaperQuoteReaderInput): Promise<unknown> { return structuredClone(this.payload); }
}
async function makeQuote(payload: unknown, outputAsset = outputAddress) {
  return new RmtPaperQuoteService({
    reader: new QuoteReader(payload),
    policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
  }).quote({ inputAsset: inputAddress, outputAsset, inputAmountAtomic: "40000000", observedAtMs: 101_000 });
}

const quote = await makeQuote(quoteResponse({ userPaysGas: false }));
const costs = buildPaperFillCostPlan(quote);
assert.equal(costs.status, "READY");

class FillWriter implements PaperFillWriter {
  calls = 0;
  readonly keys: string[] = [];
  private readonly byKey = new Map<string, PaperFillRecord>();
  async fillPaperOrder(orderId: string, evidence: VerifiedPaperQuoteEvidence, key: string, executionCosts: PaperExecutionCosts = { feeAmountAtomic: "0", gasCostAtomic: "0" }): Promise<PaperFillRecord> {
    this.calls += 1;
    this.keys.push(key);
    const prior = this.byKey.get(key);
    if (prior) return structuredClone(prior);
    const fill: PaperFillRecord = {
      fillId: "fill-1",
      orderId,
      quoteId: evidence.quoteId,
      agentId: submission.order.agentId,
      accountId: submission.order.accountId,
      inputAssetId: evidence.inputAssetId,
      outputAssetId: evidence.outputAssetId,
      inputAmountAtomic: evidence.inputAmountAtomic,
      outputAmountAtomic: evidence.outputAmountAtomic,
      providerId: evidence.providerId,
      feeAssetId: executionCosts.feeAssetId,
      feeAmountAtomic: executionCosts.feeAmountAtomic,
      gasAssetId: executionCosts.gasAssetId,
      gasCostAtomic: executionCosts.gasCostAtomic,
      filledAt: evidence.observedAt,
      evidenceHash: evidence.evidenceHash,
      quoteEvidence: structuredClone(evidence),
    };
    this.byKey.set(key, fill);
    return structuredClone(fill);
  }
}
const writer = new FillWriter();
const service = new PaperFillOrchestrationService(writer);
const first = await service.fill({ submission, quoteResult: quote, costPlan: costs });
assert.equal(first.fill.fillId, "fill-1");
assert.equal(first.fill.orderId, "order-1");
assert.equal(first.fill.outputAmountAtomic, quote.evidence.outputAmountAtomic);
assert.match(first.orchestrationHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperFillOrchestrationRecord(first));

const retry = await service.fill({ submission, quoteResult: quote, costPlan: costs });
assert.equal(retry.fill.fillId, first.fill.fillId);
assert.equal(retry.orchestrationHash, first.orchestrationHash);
assert.equal(writer.calls, 2);
assert.equal(writer.keys[0], writer.keys[1]);

const pendingGasQuote = await makeQuote(quoteResponse({ userPaysGas: true, networkFeeNativeAtomic: null }));
const pendingCosts = buildPaperFillCostPlan(pendingGasQuote);
const callsBeforeBlocked = writer.calls;
await assert.rejects(() => service.fill({ submission, quoteResult: pendingGasQuote, costPlan: pendingCosts }), /blocked until network fee costs are ready/);
assert.equal(writer.calls, callsBeforeBlocked);

const otherOutput = "0x3333333333333333333333333333333333333333";
const mismatchedQuote = await makeQuote(quoteResponse({ userPaysGas: false, outputAsset: otherOutput }), otherOutput);
const mismatchedCosts = buildPaperFillCostPlan(mismatchedQuote);
await assert.rejects(() => service.fill({ submission, quoteResult: mismatchedQuote, costPlan: mismatchedCosts }), /does not exactly match pending order/);

class BadFillWriter implements PaperFillWriter {
  async fillPaperOrder(orderId: string, evidence: VerifiedPaperQuoteEvidence, _key: string, executionCosts: PaperExecutionCosts = { feeAmountAtomic: "0", gasCostAtomic: "0" }): Promise<PaperFillRecord> {
    return {
      fillId: "bad-fill",
      orderId,
      quoteId: evidence.quoteId,
      agentId: submission.order.agentId,
      accountId: submission.order.accountId,
      inputAssetId: evidence.inputAssetId,
      outputAssetId: evidence.outputAssetId,
      inputAmountAtomic: evidence.inputAmountAtomic,
      outputAmountAtomic: evidence.outputAmountAtomic,
      providerId: evidence.providerId,
      feeAmountAtomic: executionCosts.feeAmountAtomic,
      gasCostAtomic: "1",
      filledAt: evidence.observedAt,
      evidenceHash: evidence.evidenceHash,
      quoteEvidence: structuredClone(evidence),
    };
  }
}
await assert.rejects(() => new PaperFillOrchestrationService(new BadFillWriter()).fill({ submission, quoteResult: quote, costPlan: costs }), /cost data that differs/);

const tampered = structuredClone(first);
tampered.fill.outputAmountAtomic = "1";
assert.throws(() => assertPaperFillOrchestrationRecord(tampered), /differs from admitted order\/quote evidence/);

assert.equal("sign" in service, false);
assert.equal("executeLive" in service, false);
console.log("paper-fill-orchestration smoke: ok");
