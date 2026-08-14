import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type AgentSafetyEnvelope,
  type StrategySpec,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  PaperArenaEntryService,
  assertPaperArenaEntryRecord,
} from "./paper-arena-entry.ts";
import {
  buildPaperArenaPerformance,
  assertPaperArenaPerformanceRecord,
} from "./paper-arena-performance.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { AgentEngine } from "./engine.ts";
import { InMemoryAgentStateStore } from "./persistence/store.ts";
import {
  RmtPaperQuoteService,
  type RmtPaperQuoteReader,
  type RmtPaperQuoteReaderInput,
} from "./rmt-paper-quote.ts";

const quoteAddress = "0x1111111111111111111111111111111111111111";
const positionAddress = "0x2222222222222222222222222222222222222222";
const quoteAssetId = `eip155:4663/contract:${quoteAddress}`;
const positionAssetId = `eip155:4663/contract:${positionAddress}`;
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
const strategySpec: StrategySpec = {
  schemaVersion: 1,
  universe: { assetClasses: ["RWA"], includeAssets: [positionAssetId] },
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

const engine = new AgentEngine({ safetyEnvelope, paperFillDelayMs: 0, policyVersion: "RMT_AGENT_FOUNDATION_V1" });
engine.createSeason({ seasonId: "season-1", name: "Season 1", startsAt: 0, endsAt: 10_000, createdAt: 0 });
const agent = engine.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "HoodHound",
  thesis: "Trade verified liquid technology RWAs.",
  createdAt: 1,
});
const strategy = engine.createStrategyVersion(agent.id, strategySpec, 2);
engine.activatePaperAgent(agent.id);
const account = engine.openPaperAccount({
  agentId: agent.id,
  seasonId: "season-1",
  initialBalances: { [quoteAssetId]: "1000" },
  openedAt: 10,
});
const store = new InMemoryAgentStateStore();
const initialState = await store.commit({
  streamId: "paper-default",
  expectedRevision: 0,
  idempotencyKey: "arena-entry-state",
  operation: "arenaEntry",
  requestHash: hashCanonicalPayload({ state: "entry" }),
  result: { state: "entry" },
  snapshot: engine.exportSnapshot(),
  createdAt: 20,
});
assert.equal(initialState.revision, 1);

const entry = await new PaperArenaEntryService({ store, streamId: "paper-default" }).enter({
  accountId: account.accountId,
  quoteAssetId,
});
assert.equal(entry.startingNavQuoteAtomic, "1000");
assert.equal(entry.enteredAt, 10);
assert.equal(entry.participantType, "AGENT");
assert.equal(entry.revision, 1);
assert.doesNotThrow(() => assertPaperArenaEntryRecord(entry));

const canonicalValuation = new PaperCanonicalValuationService({ store, streamId: "paper-default" });
const valuationOne = await canonicalValuation.value({
  accountId: account.accountId,
  quoteAssetId,
  quoteResults: [],
  valuedAt: 100,
  maximumQuoteAgeMs: 50,
});
assert.equal(valuationOne.valuation.liquidationNavQuoteAtomic, "1000");

const order = engine.submitPaperOrder({
  agentId: agent.id,
  strategyVersion: strategy.version,
  accountId: account.accountId,
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  maximumSlippageBps: 100,
  createdAt: 110,
});
const buyPayload: Omit<VerifiedPaperQuoteEvidence, "evidenceHash"> = {
  quoteId: "quote-buy",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  outputAmountAtomic: "100",
  providerId: "rmt-vnext:uniswap-v3:adapter-v1",
  priceImpactBps: 10,
  observedAt: 120,
  expiresAt: 1_000,
};
engine.fillPaperOrder(order.orderId, { ...buyPayload, evidenceHash: hashPaperQuoteEvidence(buyPayload) });
const tradingState = await store.commit({
  streamId: "paper-default",
  expectedRevision: 1,
  idempotencyKey: "arena-trading-state",
  operation: "arenaTrading",
  requestHash: hashCanonicalPayload({ state: "trading" }),
  result: { state: "trading" },
  snapshot: engine.exportSnapshot(),
  createdAt: 130,
});
assert.equal(tradingState.revision, 2);

class QuoteReader implements RmtPaperQuoteReader {
  readonly sourceId = "rmt-vnext-normalized-quote-reader-v1";
  private readonly output: string;
  private readonly quotedAt: number;
  constructor(output: string, quotedAt: number) { this.output = output; this.quotedAt = quotedAt; }
  async compare(input: RmtPaperQuoteReaderInput): Promise<unknown> {
    return {
      requestId: this.quotedAt === 200 ? "123e4567-e89b-42d3-a456-426614174000" : "223e4567-e89b-42d3-a456-426614174000",
      chainId: 4_663,
      inputAsset: input.inputAsset,
      outputAsset: input.outputAsset,
      inputAmountAtomic: input.inputAmountAtomic,
      requestedAtMs: this.quotedAt - 10,
      completedAtMs: this.quotedAt,
      attempts: [{
        provider: "uniswap-v3",
        adapterVersion: 1,
        status: "indicative",
        chainId: 4_663,
        inputAsset: input.inputAsset,
        outputAsset: input.outputAsset,
        inputAmountAtomic: input.inputAmountAtomic,
        expectedOutputAtomic: this.output,
        protectedOutputAtomic: this.output,
        outputDecimals: 6,
        priceImpact: 0.001,
        quotedAtMs: this.quotedAt,
        expiresAtMs: this.quotedAt + 1_000,
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
async function positionQuote(output: string, quotedAt: number) {
  return new RmtPaperQuoteService({
    reader: new QuoteReader(output, quotedAt),
    policy: { maximumQuoteAgeMs: 500, maximumPriceImpactBps: 25 },
  }).quote({ inputAsset: positionAddress, outputAsset: quoteAddress, inputAmountAtomic: "100", observedAtMs: quotedAt });
}

const valuationTwo = await canonicalValuation.value({
  accountId: account.accountId,
  quoteAssetId,
  quoteResults: [await positionQuote("60", 200)],
  valuedAt: 200,
  maximumQuoteAgeMs: 100,
});
assert.equal(valuationTwo.valuation.liquidationNavQuoteAtomic, "1020");
const valuationThree = await canonicalValuation.value({
  accountId: account.accountId,
  quoteAssetId,
  quoteResults: [await positionQuote("45", 300)],
  valuedAt: 300,
  maximumQuoteAgeMs: 100,
});
assert.equal(valuationThree.valuation.liquidationNavQuoteAtomic, "1005");

const performance = buildPaperArenaPerformance({
  entry,
  valuations: [valuationOne, valuationTwo, valuationThree],
  policy: { policyVersion: "RMT_ARENA_PERFORMANCE_V1", minimumValuations: 3, minimumElapsedMs: 200 },
});
assert.equal(performance.eligibility, "ELIGIBLE");
assert.deepEqual(performance.eligibilityReasons, []);
assert.equal(performance.metrics.startingNavQuoteAtomic, "1000");
assert.equal(performance.metrics.latestLiquidationNavQuoteAtomic, "1005");
assert.equal(performance.metrics.peakLiquidationNavQuoteAtomic, "1020");
assert.equal(performance.metrics.returnQuoteAtomicExcludingExternalCosts, "5");
assert.equal(performance.metrics.returnBpsExcludingExternalCosts, "50");
assert.equal(performance.metrics.maxDrawdownBps, 148);
assert.equal(performance.metrics.fillCount, 1);
assert.equal(performance.metrics.valuationCount, 3);
assert.equal(performance.metrics.elapsedMs, 290);
assert.match(performance.performanceHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperArenaPerformanceRecord(performance));

const provisional = buildPaperArenaPerformance({
  entry,
  valuations: [valuationOne],
  policy: { policyVersion: "RMT_ARENA_PERFORMANCE_V1", minimumValuations: 3, minimumElapsedMs: 200 },
});
assert.equal(provisional.eligibility, "PROVISIONAL");
assert.ok(provisional.eligibilityReasons.includes("INSUFFICIENT_VALUATIONS"));
assert.ok(provisional.eligibilityReasons.includes("INSUFFICIENT_ELAPSED_TIME"));

const tampered = structuredClone(performance);
tampered.metrics.returnBpsExcludingExternalCosts = "9999";
assert.throws(() => assertPaperArenaPerformanceRecord(tampered), /performance payload mismatch|performance hash mismatch/);

await assert.rejects(
  () => new PaperArenaEntryService({ store, streamId: "paper-default" }).enter({ accountId: account.accountId, quoteAssetId }),
  /quote-only positive starting capital|already submitted an order|already traded/,
);

console.log("paper-arena-performance smoke: ok");
