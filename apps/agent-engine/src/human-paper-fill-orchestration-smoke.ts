import assert from "node:assert/strict";
import type { AgentSafetyEnvelope, MarketObservationDraft, PaperAccountRecord } from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import {
  HumanPaperFillOrchestrationService,
  assertHumanPaperFillOrchestrationRecord,
} from "./human-paper-fill-orchestration.ts";
import { HumanPaperOrderAdmissionService } from "./human-paper-order-admission.ts";
import { HumanPaperOrderSubmissionGateService } from "./human-paper-order-submission-gate.ts";
import { HumanPaperOrderSubmissionService } from "./human-paper-order-submission.ts";
import { HumanPaperRiskCapacityPlanner } from "./human-paper-risk-capacity.ts";
import { buildPaperFillCostPlan } from "./paper-fill-cost.ts";
import { buildPaperPositionBook } from "./paper-position-book.ts";
import { buildPaperRiskSnapshot } from "./paper-risk-capacity.ts";
import {
  RmtPaperQuoteService,
  type RmtPaperQuoteReader,
  type RmtPaperQuoteReaderInput,
} from "./rmt-paper-quote.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const inputAddress = "0x1111111111111111111111111111111111111111";
const outputAddress = "0x2222222222222222222222222222222222222222";
const inputAssetId = `eip155:4663/contract:${inputAddress}`;
const outputAssetId = `eip155:4663/contract:${outputAddress}`;

const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 5_000,
  maximumPortfolioExposureBps: 8_000,
  maximumOpenPositions: 10,
  maximumDailyLossBps: 1_000,
  maximumDrawdownBps: 2_000,
  maximumTradesPerDay: 50,
  maximumSlippageBps: 200,
  maximumPriceImpactBps: 300,
  minimumEvaluationIntervalSeconds: 30,
};
const humanRiskPolicy = {
  policyVersion: "RMT_HUMAN_RISK_V1",
  maximumPositionBps: 5_000,
  maximumPortfolioExposureBps: 8_000,
  maximumOpenPositions: 5,
  maximumDailyLossBps: 500,
  maximumDrawdownBps: 1_000,
  maximumTradesPerDay: 20,
  maximumSlippageBps: 75,
  maximumPriceImpactBps: 250,
};
const marketObservation: MarketObservationDraft = {
  assetId: outputAssetId,
  quoteAssetId: inputAssetId,
  referencePriceAtomic: "1000000",
  referencePriceDecimals: 6,
};
const config = { safetyEnvelope, paperFillDelayMs: 1_000, policyVersion: "RMT_AGENT_FOUNDATION_V1" };
const store = new InMemoryAgentStateStore();
const streamId = "human-fill-smoke";
const engine = await DurableAgentEngine.initialize({ config, store, streamId });
await engine.createSeason({ seasonId: "season-1", name: "Human Paper", startsAt: 1_000, endsAt: 20_000, createdAt: 900 }, "season");
const human = await engine.openHumanPaperAccount({
  walletAddress: "0x00000000000000000000000000000000000000ff",
  seasonId: "season-1",
  initialBalances: { [inputAssetId]: "1000" },
  openedAt: 1_100,
}, "human");

function buildRiskPlan(input: {
  account: PaperAccountRecord;
  amount: string;
  plannedAt: number;
  currentPortfolioExposureAtomic: string;
  currentPositionExposureAtomic: string;
  openPositionCount: number;
  tradesToday: number;
}) {
  return new HumanPaperRiskCapacityPlanner({
    safetyEnvelope,
    policy: humanRiskPolicy,
    maximumRiskSnapshotAgeMs: 1_000,
  }).plan({
    account: input.account,
    riskSnapshot: buildPaperRiskSnapshot({
      accountId: input.account.accountId,
      quoteAssetId: inputAssetId,
      positionAssetId: outputAssetId,
      markNavAtomic: "1000",
      currentPortfolioExposureAtomic: input.currentPortfolioExposureAtomic,
      currentPositionExposureAtomic: input.currentPositionExposureAtomic,
      openPositionCount: input.openPositionCount,
      tradesToday: input.tradesToday,
      dailyLossBps: 0,
      drawdownBps: 0,
      capturedAt: input.plannedAt - 50,
    }),
    marketObservation,
    requestedInputAmountAtomic: input.amount,
    requestedMaximumSlippageBps: 50,
    plannedAt: input.plannedAt,
  });
}

const admissionService = new HumanPaperOrderAdmissionService({
  store,
  streamId,
  policy: { policyVersion: "RMT_HUMAN_MANUAL_V1", maximumSlippageBps: 75, maximumInputBalanceBps: 5_000 },
});
const gateService = new HumanPaperOrderSubmissionGateService({ store, streamId });
const submissionService = new HumanPaperOrderSubmissionService(engine, { maximumRiskPlanAgeMs: 500 });

const firstRisk = buildRiskPlan({
  account: human,
  amount: "200",
  plannedAt: 1_950,
  currentPortfolioExposureAtomic: "0",
  currentPositionExposureAtomic: "0",
  openPositionCount: 0,
  tradesToday: 0,
});
assert.equal(firstRisk.status, "ADMITTED");
const admission = await admissionService.admit({
  accountId: human.accountId,
  inputAssetId,
  outputAssetId,
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  admittedAt: 2_000,
});
const gate = await gateService.check({ admission, checkedAt: 2_050 });
const submission = await submissionService.submit({ admission, gate, riskCapacityPlan: firstRisk });
assert.equal(submission.order.status, "PENDING");

function quoteResponse(inputAmountAtomic: string, outputAmountAtomic: string, quotedAtMs: number) {
  return {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    chainId: 4_663,
    inputAsset: inputAddress,
    outputAsset: outputAddress,
    inputAmountAtomic,
    requestedAtMs: quotedAtMs - 100,
    completedAtMs: quotedAtMs - 50,
    attempts: [{
      provider: "uniswap-v3",
      adapterVersion: 1,
      status: "indicative",
      chainId: 4_663,
      inputAsset: inputAddress,
      outputAsset: outputAddress,
      inputAmountAtomic,
      expectedOutputAtomic: outputAmountAtomic,
      protectedOutputAtomic: outputAmountAtomic,
      outputDecimals: 18,
      priceImpact: 0.001,
      quotedAtMs,
      expiresAtMs: quotedAtMs + 5_000,
      latencyMs: 20,
      strictVerificationAvailable: true,
      authorizationReady: false,
      userPaysGas: false,
      networkFeeNativeAtomic: null,
      networkFeeNativeSymbol: null,
      costState: null,
    }],
  };
}

class QuoteReader implements RmtPaperQuoteReader {
  readonly sourceId = "rmt-vnext-normalized-quote-reader-v1";
  private readonly payload: unknown;
  constructor(payload: unknown) { this.payload = payload; }
  async compare(_input: RmtPaperQuoteReaderInput): Promise<unknown> { return structuredClone(this.payload); }
}

const quote = await new RmtPaperQuoteService({
  reader: new QuoteReader(quoteResponse("200", "490", 3_100)),
  policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
}).quote({ inputAsset: inputAddress, outputAsset: outputAddress, inputAmountAtomic: "200", observedAtMs: 3_100 });
const costPlan = buildPaperFillCostPlan(quote);
assert.equal(costPlan.status, "READY");

const fillService = new HumanPaperFillOrchestrationService(engine);
const filled = await fillService.fill({ submission, quoteResult: quote, costPlan });
assert.equal(filled.fill.participantType, "HUMAN");
assert.equal(filled.fill.participantId, human.participantId);
assert.equal(filled.fill.inputAmountAtomic, "200");
assert.equal(filled.fill.outputAmountAtomic, "490");
assert.doesNotThrow(() => assertHumanPaperFillOrchestrationRecord(filled));

const accountAfterFill = engine.getPaperAccount(human.accountId);
assert.equal(accountAfterFill.balances[inputAssetId], "800");
assert.equal(accountAfterFill.balances[outputAssetId], "490");

const stateAfterFill = await store.load(streamId);
assert.ok(stateAfterFill);
assert.equal(stateAfterFill.snapshot.paperOrders.length, 1);
assert.equal(stateAfterFill.snapshot.paperFills.length, 1);
const persistedFill = stateAfterFill.snapshot.paperFills[0]!;
assert.ok("participantType" in persistedFill);
assert.equal("participantType" in persistedFill ? persistedFill.participantType : null, "HUMAN");

const restored = await DurableAgentEngine.initialize({ config, store, streamId });
assert.deepEqual(restored.getPaperAccount(human.accountId), accountAfterFill);
const positionBook = buildPaperPositionBook({
  accountId: human.accountId,
  quoteAssetId: inputAssetId,
  fills: stateAfterFill.snapshot.paperFills.filter((fill) => fill.accountId === human.accountId),
});
assert.equal(positionBook.fillCount, 1);
assert.equal(positionBook.positions.length, 1);
assert.equal(positionBook.positions[0]?.assetId, outputAssetId);
assert.equal(positionBook.positions[0]?.quantityAtomic, "490");
assert.equal(positionBook.positions[0]?.costBasisQuoteAtomic, "200");

await assert.rejects(
  () => gateService.check({ admission, checkedAt: 3_200 }),
  /stale because engine revision changed/,
);

const secondRisk = buildRiskPlan({
  account: accountAfterFill,
  amount: "100",
  plannedAt: 3_250,
  currentPortfolioExposureAtomic: "200",
  currentPositionExposureAtomic: "200",
  openPositionCount: 1,
  tradesToday: 1,
});
assert.equal(secondRisk.status, "ADMITTED");
const secondAdmission = await admissionService.admit({
  accountId: human.accountId,
  inputAssetId,
  outputAssetId,
  inputAmountAtomic: "100",
  maximumSlippageBps: 50,
  admittedAt: 3_300,
});
const secondGate = await gateService.check({ admission: secondAdmission, checkedAt: 3_350 });
const secondSubmission = await new HumanPaperOrderSubmissionService(restored, { maximumRiskPlanAgeMs: 500 }).submit({
  admission: secondAdmission,
  gate: secondGate,
  riskCapacityPlan: secondRisk,
});
assert.equal(secondSubmission.order.status, "PENDING");
assert.notEqual(secondSubmission.order.orderId, submission.order.orderId);
const finalState = await store.load(streamId);
assert.equal(finalState?.snapshot.paperOrders.length, 2);
assert.equal(finalState?.snapshot.paperFills.length, 1);

assert.equal("sign" in fillService, false);
assert.equal("executeLive" in fillService, false);
console.log("human-paper-fill-orchestration smoke: ok");
