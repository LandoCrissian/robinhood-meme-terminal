import assert from "node:assert/strict";
import {
  hashPaperQuoteEvidence,
  type AgentSafetyEnvelope,
  type StrategySpec,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import { InMemoryAgentRunStore } from "./agent-run-store.ts";
import {
  AgentAuthoritativePositionReductionFillService,
  assertAgentAuthoritativePositionReductionFillRecord,
} from "./agent-authoritative-position-reduction-fill.ts";
import {
  AgentAuthoritativePositionReductionService,
  assertAgentAuthoritativePositionReductionRecord,
} from "./agent-authoritative-position-reduction.ts";
import {
  AgentAuthoritativePositionReductionSubmissionService,
  assertAgentAuthoritativePositionReductionSubmissionRecord,
} from "./agent-authoritative-position-reduction-submission.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import {
  PaperEvaluationService,
  type PaperDecisionAdapter,
  type PaperDecisionAdapterInput,
  type PaperEvaluationMarketSource,
  type PaperEvaluationMarketSourceInput,
} from "./paper-evaluation.ts";
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
import { InMemoryAgentStateStore } from "./persistence/store.ts";

const quoteAddress = "0x1111111111111111111111111111111111111111";
const positionAddress = "0x2222222222222222222222222222222222222222";
const quoteAssetId = `eip155:4663/contract:${quoteAddress}`;
const positionAssetId = `eip155:4663/contract:${positionAddress}`;
const streamId = "agent-authoritative-reduction";

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
const strategySpec: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: ["NVDA"] },
  timeframe: { evaluationIntervalSeconds: 60, predictionHorizonSeconds: 120 },
  signals: [{ type: "momentum", weight: 1 }],
  prediction: { enabled: true, minimumConfidence: 0.65 },
  risk: {
    maximumPositionBps: 2_500,
    maximumPortfolioExposureBps: 5_000,
    maximumOpenPositions: 5,
    maximumDailyLossBps: 500,
    maximumDrawdownBps: 1_000,
    maximumTradesPerDay: 20,
  },
  execution: { venuePolicy: "RMT_BEST_VERIFIED", maximumSlippageBps: 75, maximumPriceImpactBps: 150 },
  prohibitedActions: ["ARBITRARY_CALL", "UNVERIFIED_VENUE"],
};
const engineConfig = { safetyEnvelope, paperFillDelayMs: 1_000, policyVersion: "RMT_AGENT_FOUNDATION_V1" };
const stateStore = new InMemoryAgentStateStore();
const historyStore = new InMemoryPaperCanonicalValuationHistoryStore();
const engine = await DurableAgentEngine.initialize({ config: engineConfig, store: stateStore, streamId });
await engine.createSeason({ seasonId: "season-1", name: "Agent Reduction", startsAt: 1_000, endsAt: 20_000, createdAt: 900 }, "season");
const agent = await engine.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "HoodHound",
  thesis: "Trade verified liquid technology RWAs.",
  createdAt: 1_050,
}, "agent");
const strategy = await engine.createStrategyVersion(agent.id, strategySpec, "strategy", 1_075);
await engine.activatePaperAgent(agent.id, "activate");
const account = await engine.openPaperAccount({
  agentId: agent.id,
  seasonId: "season-1",
  initialBalances: { [quoteAssetId]: "1000" },
  openedAt: 1_100,
}, "account");
const entry = await new PaperArenaEntryService({ store: stateStore, streamId }).enter({ accountId: account.accountId, quoteAssetId });

const buyOrder = await engine.submitPaperOrder({
  agentId: agent.id,
  strategyVersion: strategy.version,
  accountId: account.accountId,
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  createdAt: 1_500,
}, "buy-order");
const buyQuotePayload: Omit<VerifiedPaperQuoteEvidence, "evidenceHash"> = {
  quoteId: "buy-quote",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "200",
  outputAmountAtomic: "490",
  providerId: "rmt-vnext:uniswap-v3:adapter-v1",
  priceImpactBps: 10,
  observedAt: 2_500,
  expiresAt: 3_000,
};
await engine.fillPaperOrder(buyOrder.orderId, { ...buyQuotePayload, evidenceHash: hashPaperQuoteEvidence(buyQuotePayload) }, "buy-fill");
assert.equal(engine.getPaperAccount(account.accountId).balances[quoteAssetId], "800");
assert.equal(engine.getPaperAccount(account.accountId).balances[positionAssetId], "490");

class CloseMarketSource implements PaperEvaluationMarketSource {
  readonly sourceId = "agent-close-market-v1";
  async capture(input: PaperEvaluationMarketSourceInput): Promise<unknown> {
    return {
      chainId: 4_663,
      capturedAt: input.evaluatedAt - 100,
      observations: [{
        assetId: positionAssetId,
        aliases: ["NVDA"],
        quoteAssetId,
        referencePriceAtomic: "150000000",
        referencePriceDecimals: 6,
      }],
    };
  }
}
class CloseDecisionAdapter implements PaperDecisionAdapter {
  readonly adapterId = "agent-close-adapter-v1";
  readonly modelIdentity = "agent-close-model-v1";
  async evaluate(input: PaperDecisionAdapterInput): Promise<unknown> {
    assert.ok(input.allowedActions.includes("CLOSE_POSITION"));
    return {
      action: "CLOSE_POSITION",
      confidence: 0.9,
      reasoningSummary: "Exit conditions are met; close the full current NVDA paper position.",
      closePosition: { assetId: "NVDA", requestedReductionBps: 10_000 },
    };
  }
}
const evaluation = await new PaperEvaluationService({
  config: {
    streamId,
    chainId: 4_663,
    runnerVersion: "RMT_PAPER_EVALUATION_V2",
    maximumSnapshotAgeMs: 1_000,
    maximumObservations: 8,
    maximumFeaturesPerObservation: 8,
  },
  marketSource: new CloseMarketSource(),
  decisionAdapter: new CloseDecisionAdapter(),
  runStore: new InMemoryAgentRunStore(),
  writer: engine,
}).evaluate({ agentId: agent.id, accountId: account.accountId, evaluationKey: "close-slot", evaluatedAt: 3_000 });
assert.equal(evaluation.run.proposal.action, "CLOSE_POSITION");
assert.equal(evaluation.run.proposal.closePosition?.assetId, positionAssetId);
assert.equal(evaluation.run.proposal.closePosition?.requestedReductionBps, 10_000);
assert.equal(evaluation.decision.action, "CLOSE_POSITION");

class StaticQuoteReader implements RmtPaperQuoteReader {
  readonly sourceId: string;
  private readonly inputAddress: string;
  private readonly outputAddress: string;
  private readonly inputAmount: string;
  private readonly outputAmount: string;
  private readonly impact: number;
  private readonly at: number;

  constructor(inputAddress: string, outputAddress: string, inputAmount: string, outputAmount: string, impact: number, at: number, suffix: string) {
    this.inputAddress = inputAddress;
    this.outputAddress = outputAddress;
    this.inputAmount = inputAmount;
    this.outputAmount = outputAmount;
    this.impact = impact;
    this.at = at;
    this.sourceId = `agent-reduction-${suffix}`;
  }

  async compare(input: RmtPaperQuoteReaderInput): Promise<unknown> {
    assert.equal(input.inputAsset, this.inputAddress);
    assert.equal(input.outputAsset, this.outputAddress);
    assert.equal(input.inputAmountAtomic, this.inputAmount);
    return {
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      chainId: 4_663,
      inputAsset: input.inputAsset,
      outputAsset: input.outputAsset,
      inputAmountAtomic: input.inputAmountAtomic,
      requestedAtMs: this.at - 100,
      completedAtMs: this.at - 50,
      attempts: [{
        provider: "uniswap-v3",
        adapterVersion: 1,
        status: "indicative",
        chainId: 4_663,
        inputAsset: input.inputAsset,
        outputAsset: input.outputAsset,
        inputAmountAtomic: input.inputAmountAtomic,
        expectedOutputAtomic: this.outputAmount,
        protectedOutputAtomic: this.outputAmount,
        outputDecimals: 6,
        priceImpact: this.impact,
        quotedAtMs: this.at,
        expiresAtMs: this.at + 2_000,
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
async function quote(inputAddress: string, outputAddress: string, inputAmount: string, outputAmount: string, impact: number, at: number, suffix: string) {
  return new RmtPaperQuoteService({
    reader: new StaticQuoteReader(inputAddress, outputAddress, inputAmount, outputAmount, impact, at, suffix),
    policy: { maximumQuoteAgeMs: 1_000, maximumPriceImpactBps: 300 },
  }).quote({ inputAsset: inputAddress, outputAsset: outputAddress, inputAmountAtomic: inputAmount, observedAtMs: at });
}

const liquidationQuote = await quote(positionAddress, quoteAddress, "490", "210", 0.001, 3_100, "valuation");
const valuation = await new PaperCanonicalValuationService({ store: stateStore, streamId }).value({
  accountId: account.accountId,
  quoteAssetId,
  quoteResults: [liquidationQuote],
  valuedAt: 3_100,
  maximumQuoteAgeMs: 1_000,
});
await historyStore.put(valuation);

const reduction = await new AgentAuthoritativePositionReductionService({
  stateStore,
  valuationHistoryStore: historyStore,
  streamId,
  config: {
    safetyEnvelope,
    maximumRunAgeMs: 500,
    maximumValuationGapMs: 3_000,
    maximumLatestValuationAgeMs: 500,
  },
}).plan({ entry, run: evaluation.run, plannedAt: 3_200 });
assert.equal(reduction.currentPositionQuantityAtomic, "490");
assert.equal(reduction.requestedReductionBps, 10_000);
assert.equal(reduction.requestedInputAmountAtomic, "490");
assert.equal(reduction.remainingPositionQuantityAtomic, "0");
assert.equal(reduction.closesPosition, true);
assert.equal(reduction.maximumPriceImpactBps, 150);
assert.doesNotThrow(() => assertAgentAuthoritativePositionReductionRecord(reduction));

const submissionService = new AgentAuthoritativePositionReductionSubmissionService({ writer: engine, store: stateStore, streamId });
const submission = await submissionService.submit(reduction);
assert.equal(submission.order.status, "PENDING");
assert.equal(submission.order.inputAssetId, positionAssetId);
assert.equal(submission.order.outputAssetId, quoteAssetId);
assert.doesNotThrow(() => assertAgentAuthoritativePositionReductionSubmissionRecord(submission));
const replay = await submissionService.submit(reduction);
assert.equal(replay.order.orderId, submission.order.orderId);

const fillService = new AgentAuthoritativePositionReductionFillService(engine);
const highImpact = await quote(positionAddress, quoteAddress, "490", "220", 0.02, 4_300, "high-impact");
await assert.rejects(
  () => fillService.fill({ submission, quoteResult: highImpact, costPlan: buildPaperFillCostPlan(highImpact) }),
  /price impact exceeds strategy policy/,
);
assert.equal((await stateStore.load(streamId))?.snapshot.paperFills.length, 1);

const allowed = await quote(positionAddress, quoteAddress, "490", "220", 0.001, 4_400, "allowed");
const closed = await fillService.fill({ submission, quoteResult: allowed, costPlan: buildPaperFillCostPlan(allowed) });
assert.equal(closed.fill.inputAmountAtomic, "490");
assert.equal(closed.fill.outputAmountAtomic, "220");
assert.doesNotThrow(() => assertAgentAuthoritativePositionReductionFillRecord(closed));
assert.equal(engine.getPaperAccount(account.accountId).balances[positionAssetId], "0");
assert.equal(engine.getPaperAccount(account.accountId).balances[quoteAssetId], "1020");

const finalState = await stateStore.load(streamId);
assert.ok(finalState);
const book = buildPaperPositionBook({
  accountId: account.accountId,
  quoteAssetId,
  fills: finalState.snapshot.paperFills.filter((fill) => fill.accountId === account.accountId),
});
assert.equal(book.fillCount, 2);
assert.equal(book.positions[0]?.quantityAtomic, "0");
assert.equal(book.positions[0]?.realizedPnlQuoteAtomic, "20");
assert.equal(book.totalRealizedPnlQuoteAtomic, "20");
assert.equal("executeLive" in fillService, false);
assert.equal("sign" in fillService, false);

console.log("agent-authoritative-position-reduction smoke: ok");
