import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type AgentSafetyEnvelope,
  type HumanPaperFillRecord,
  type HumanPaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import {
  HumanAuthoritativePositionReductionFillService,
  assertHumanAuthoritativePositionReductionFillRecord,
} from "./human-authoritative-position-reduction-fill.ts";
import {
  HumanAuthoritativePositionReductionService,
  assertHumanAuthoritativePositionReductionRecord,
} from "./human-authoritative-position-reduction.ts";
import {
  HumanAuthoritativePositionReductionSubmissionService,
  assertHumanAuthoritativePositionReductionSubmissionRecord,
} from "./human-authoritative-position-reduction-submission.ts";
import { HumanPaperOrderAdmissionService } from "./human-paper-order-admission.ts";
import { HumanPaperOrderSubmissionGateService } from "./human-paper-order-submission-gate.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { InMemoryPaperCanonicalValuationHistoryStore } from "./paper-canonical-valuation-store.ts";
import { buildPaperFillCostPlan } from "./paper-fill-cost.ts";
import { buildPaperPositionBook } from "./paper-position-book.ts";
import {
  RmtPaperQuoteService,
  type RmtPaperQuoteReader,
  type RmtPaperQuoteReaderInput,
} from "./rmt-paper-quote.ts";
import { emptyAgentEngineSnapshot } from "./snapshot.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const quoteAddress = "0x1111111111111111111111111111111111111111";
const positionAddress = "0x2222222222222222222222222222222222222222";
const quoteAssetId = `eip155:4663/contract:${quoteAddress}`;
const positionAssetId = `eip155:4663/contract:${positionAddress}`;
const streamId = "human-position-reduction";
const accountId = "human-account";
const wallet = "0x00000000000000000000000000000000000000ae";

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
const riskPolicy = {
  policyVersion: "RMT_HUMAN_RISK_V1",
  maximumPositionBps: 2_500,
  maximumPortfolioExposureBps: 5_000,
  maximumOpenPositions: 5,
  maximumDailyLossBps: 500,
  maximumDrawdownBps: 1_000,
  maximumTradesPerDay: 20,
  maximumSlippageBps: 75,
  maximumPriceImpactBps: 150,
};
const engineConfig = { safetyEnvelope, paperFillDelayMs: 1_000, policyVersion: "RMT_AGENT_FOUNDATION_V1" };

const preTrade = emptyAgentEngineSnapshot();
preTrade.seasons = [{ seasonId: "season-1", name: "Reduction", startsAt: 1_000, endsAt: 20_000, createdAt: 900 }];
preTrade.paperAccounts = [{
  accountId,
  seasonId: "season-1",
  participantType: "HUMAN",
  participantId: wallet,
  balances: { [quoteAssetId]: "1000" },
  openedAt: 1_100,
}];
const stateStore = new InMemoryAgentStateStore();
await stateStore.commit({
  streamId,
  expectedRevision: 0,
  idempotencyKey: "pre-trade",
  operation: "reductionPreTrade",
  requestHash: hashCanonicalPayload({ operation: "reductionPreTrade" }),
  result: { ok: true },
  snapshot: preTrade,
  createdAt: 1_200,
});
const entry = await new PaperArenaEntryService({ store: stateStore, streamId }).enter({ accountId, quoteAssetId });

const buyOrder: HumanPaperOrderRecord = {
  orderId: "buy-order",
  status: "FILLED",
  participantType: "HUMAN",
  participantId: wallet,
  manualPolicyVersion: "RMT_HUMAN_MANUAL_V1",
  accountId,
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  createdAt: 2_000,
};
const buyEvidencePayload = {
  quoteId: "buy-quote",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "200",
  outputAmountAtomic: "490",
  providerId: "rmt-vnext:uniswap-v3:adapter-v1",
  priceImpactBps: 10,
  observedAt: 3_100,
  expiresAt: 3_900,
};
const buyEvidence = { ...buyEvidencePayload, evidenceHash: hashPaperQuoteEvidence(buyEvidencePayload) };
const buyFill: HumanPaperFillRecord = {
  fillId: "buy-fill",
  orderId: buyOrder.orderId,
  quoteId: buyEvidence.quoteId,
  participantType: "HUMAN",
  participantId: wallet,
  accountId,
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "200",
  outputAmountAtomic: "490",
  providerId: buyEvidence.providerId,
  feeAmountAtomic: "0",
  gasCostAtomic: "0",
  filledAt: buyEvidence.observedAt,
  evidenceHash: buyEvidence.evidenceHash,
  quoteEvidence: buyEvidence,
};
const afterBuy = structuredClone(preTrade);
afterBuy.paperAccounts[0]!.balances = { [quoteAssetId]: "800", [positionAssetId]: "490" };
afterBuy.paperOrders = [buyOrder];
afterBuy.paperFills = [buyFill];
await stateStore.commit({
  streamId,
  expectedRevision: 1,
  idempotencyKey: "after-buy",
  operation: "reductionAfterBuy",
  requestHash: hashCanonicalPayload({ operation: "reductionAfterBuy" }),
  result: { ok: true },
  snapshot: afterBuy,
  createdAt: 3_200,
});

class StaticQuoteReader implements RmtPaperQuoteReader {
  readonly sourceId: string;
  private readonly inputAddress: string;
  private readonly outputAddress: string;
  private readonly inputAmountAtomic: string;
  private readonly outputAmountAtomic: string;
  private readonly priceImpact: number;
  private readonly quotedAtMs: number;

  constructor(
    inputAddress: string,
    outputAddress: string,
    inputAmountAtomic: string,
    outputAmountAtomic: string,
    priceImpact: number,
    quotedAtMs: number,
    suffix: string,
  ) {
    this.inputAddress = inputAddress;
    this.outputAddress = outputAddress;
    this.inputAmountAtomic = inputAmountAtomic;
    this.outputAmountAtomic = outputAmountAtomic;
    this.priceImpact = priceImpact;
    this.quotedAtMs = quotedAtMs;
    this.sourceId = `reduction-${suffix}`;
  }

  async compare(input: RmtPaperQuoteReaderInput): Promise<unknown> {
    assert.equal(input.inputAsset, this.inputAddress);
    assert.equal(input.outputAsset, this.outputAddress);
    assert.equal(input.inputAmountAtomic, this.inputAmountAtomic);
    return {
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      chainId: 4_663,
      inputAsset: input.inputAsset,
      outputAsset: input.outputAsset,
      inputAmountAtomic: input.inputAmountAtomic,
      requestedAtMs: this.quotedAtMs - 100,
      completedAtMs: this.quotedAtMs - 50,
      attempts: [{
        provider: "uniswap-v3",
        adapterVersion: 1,
        status: "indicative",
        chainId: 4_663,
        inputAsset: input.inputAsset,
        outputAsset: input.outputAsset,
        inputAmountAtomic: input.inputAmountAtomic,
        expectedOutputAtomic: this.outputAmountAtomic,
        protectedOutputAtomic: this.outputAmountAtomic,
        outputDecimals: 6,
        priceImpact: this.priceImpact,
        quotedAtMs: this.quotedAtMs,
        expiresAtMs: this.quotedAtMs + 2_000,
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
}
async function makeQuote(inputAddress: string, outputAddress: string, inputAmount: string, outputAmount: string, impact: number, at: number, suffix: string) {
  return new RmtPaperQuoteService({
    reader: new StaticQuoteReader(inputAddress, outputAddress, inputAmount, outputAmount, impact, at, suffix),
    policy: { maximumQuoteAgeMs: 1_000, maximumPriceImpactBps: 250 },
  }).quote({ inputAsset: inputAddress, outputAsset: outputAddress, inputAmountAtomic: inputAmount, observedAtMs: at });
}

const liquidationQuote = await makeQuote(positionAddress, quoteAddress, "490", "210", 0.001, 4_000, "liquidation");
const valuation = await new PaperCanonicalValuationService({ store: stateStore, streamId }).value({
  accountId,
  quoteAssetId,
  quoteResults: [liquidationQuote],
  valuedAt: 4_000,
  maximumQuoteAgeMs: 1_000,
});
assert.equal(valuation.valuation.liquidationNavQuoteAtomic, "1010");
const historyStore = new InMemoryPaperCanonicalValuationHistoryStore();
await historyStore.put(valuation);

const reduction = await new HumanAuthoritativePositionReductionService({
  stateStore,
  valuationHistoryStore: historyStore,
  streamId,
  config: {
    safetyEnvelope,
    riskPolicy,
    maximumValuationGapMs: 3_000,
    maximumLatestValuationAgeMs: 500,
  },
}).plan({
  entry,
  positionAssetId,
  requestedInputAmountAtomic: "490",
  requestedMaximumSlippageBps: 50,
  plannedAt: 4_100,
});
assert.equal(reduction.currentPositionQuantityAtomic, "490");
assert.equal(reduction.remainingPositionQuantityAtomic, "0");
assert.equal(reduction.closesPosition, true);
assert.doesNotThrow(() => assertHumanAuthoritativePositionReductionRecord(reduction));

const admission = await new HumanPaperOrderAdmissionService({
  store: stateStore,
  streamId,
  policy: {
    policyVersion: "RMT_HUMAN_REDUCTION_V1",
    maximumSlippageBps: 75,
    maximumInputBalanceBps: 10_000,
  },
}).admit({
  accountId,
  inputAssetId: positionAssetId,
  outputAssetId: quoteAssetId,
  inputAmountAtomic: "490",
  maximumSlippageBps: 50,
  admittedAt: 4_150,
});
const gate = await new HumanPaperOrderSubmissionGateService({ store: stateStore, streamId }).check({ admission, checkedAt: 4_175 });
const engine = await DurableAgentEngine.initialize({ config: engineConfig, store: stateStore, streamId });
const submission = await new HumanAuthoritativePositionReductionSubmissionService(engine).submit({ reduction, admission, gate });
assert.equal(submission.order.status, "PENDING");
assert.equal(submission.authorizationHash, reduction.resultHash);
assert.doesNotThrow(() => assertHumanAuthoritativePositionReductionSubmissionRecord(submission));

const fillService = new HumanAuthoritativePositionReductionFillService(engine);
const highImpact = await makeQuote(positionAddress, quoteAddress, "490", "220", 0.02, 5_200, "high-impact");
await assert.rejects(
  () => fillService.fill({ submission, quoteResult: highImpact, costPlan: buildPaperFillCostPlan(highImpact) }),
  /price impact exceeds admitted Human risk policy/,
);
assert.equal((await stateStore.load(streamId))?.snapshot.paperFills.length, 1);

const allowed = await makeQuote(positionAddress, quoteAddress, "490", "220", 0.001, 5_300, "allowed");
const closed = await fillService.fill({ submission, quoteResult: allowed, costPlan: buildPaperFillCostPlan(allowed) });
assert.equal(closed.fill.inputAmountAtomic, "490");
assert.equal(closed.fill.outputAmountAtomic, "220");
assert.doesNotThrow(() => assertHumanAuthoritativePositionReductionFillRecord(closed));
const account = engine.getPaperAccount(accountId);
assert.equal(account.balances[positionAssetId], "0");
assert.equal(account.balances[quoteAssetId], "1020");

const finalState = await stateStore.load(streamId);
assert.ok(finalState);
const book = buildPaperPositionBook({
  accountId,
  quoteAssetId,
  fills: finalState.snapshot.paperFills.filter((candidate) => candidate.accountId === accountId),
});
assert.equal(book.fillCount, 2);
assert.equal(book.positions[0]?.quantityAtomic, "0");
assert.equal(book.positions[0]?.costBasisQuoteAtomic, "0");
assert.equal(book.positions[0]?.realizedPnlQuoteAtomic, "20");
assert.equal(book.totalRealizedPnlQuoteAtomic, "20");
assert.equal("executeLive" in fillService, false);
assert.equal("sign" in fillService, false);

console.log("human-authoritative-position-reduction smoke: ok");
