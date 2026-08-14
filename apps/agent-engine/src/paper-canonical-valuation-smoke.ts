import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type AgentSafetyEnvelope,
  type StrategySpec,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import { AgentEngine } from "./engine.ts";
import {
  PaperCanonicalValuationService,
  assertPaperCanonicalValuationRecord,
} from "./paper-canonical-valuation.ts";
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
engine.createSeason({ seasonId: "season-1", name: "Season 1", startsAt: 0, createdAt: 0 });
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
  openedAt: 3,
});
const order = engine.submitPaperOrder({
  agentId: agent.id,
  strategyVersion: strategy.version,
  accountId: account.accountId,
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  maximumSlippageBps: 100,
  createdAt: 10,
});
const fillPayload: Omit<VerifiedPaperQuoteEvidence, "evidenceHash"> = {
  quoteId: "quote-buy",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  outputAmountAtomic: "100",
  providerId: "rmt-vnext:uniswap-v3:adapter-v1",
  priceImpactBps: 10,
  observedAt: 20,
  expiresAt: 1_000,
};
const fillEvidence: VerifiedPaperQuoteEvidence = { ...fillPayload, evidenceHash: hashPaperQuoteEvidence(fillPayload) };
engine.fillPaperOrder(order.orderId, fillEvidence);
const snapshot = engine.exportSnapshot();

const store = new InMemoryAgentStateStore();
const committed = await store.commit({
  streamId: "paper-default",
  expectedRevision: 0,
  idempotencyKey: "seed-state",
  operation: "seed",
  requestHash: hashCanonicalPayload({ seed: true }),
  result: { seeded: true },
  snapshot,
  createdAt: 30,
});
assert.equal(committed.status, "COMMITTED");
assert.equal(committed.revision, 1);

class QuoteReader implements RmtPaperQuoteReader {
  readonly sourceId = "rmt-vnext-normalized-quote-reader-v1";
  async compare(input: RmtPaperQuoteReaderInput): Promise<unknown> {
    return {
      requestId: "123e4567-e89b-42d3-a456-426614174000",
      chainId: 4_663,
      inputAsset: input.inputAsset,
      outputAsset: input.outputAsset,
      inputAmountAtomic: input.inputAmountAtomic,
      requestedAtMs: 9_850,
      completedAtMs: 9_900,
      attempts: [{
        provider: "uniswap-v3",
        adapterVersion: 1,
        status: "indicative",
        chainId: 4_663,
        inputAsset: input.inputAsset,
        outputAsset: input.outputAsset,
        inputAmountAtomic: input.inputAmountAtomic,
        expectedOutputAtomic: "50",
        protectedOutputAtomic: "50",
        outputDecimals: 6,
        priceImpact: 0.001,
        quotedAtMs: 9_900,
        expiresAtMs: 12_000,
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
const quote = await new RmtPaperQuoteService({
  reader: new QuoteReader(),
  policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
}).quote({ inputAsset: positionAddress, outputAsset: quoteAddress, inputAmountAtomic: "100", observedAtMs: 10_000 });

const service = new PaperCanonicalValuationService({ store, streamId: "paper-default" });
const record = await service.value({
  accountId: account.accountId,
  quoteAssetId,
  quoteResults: [quote],
  valuedAt: 10_000,
  maximumQuoteAgeMs: 500,
});
assert.equal(record.revision, 1);
assert.equal(record.valuation.quoteBalanceAtomic, "960");
assert.equal(record.valuation.positionValues[0]?.quantityAtomic, "100");
assert.equal(record.valuation.liquidationNavQuoteAtomic, "1010");
assert.equal(record.valuation.totalPnlQuoteAtomicExcludingExternalCosts, "10");
assert.equal(record.engineStateHash, hashCanonicalPayload(record.engineSnapshot));
assert.match(record.recordHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperCanonicalValuationRecord(record));

const tamperedState = structuredClone(record);
const accountIndex = tamperedState.engineSnapshot.paperAccounts.findIndex((candidate) => candidate.accountId === account.accountId);
tamperedState.engineSnapshot.paperAccounts[accountIndex]!.balances[quoteAssetId] = "999";
tamperedState.engineStateHash = hashCanonicalPayload(tamperedState.engineSnapshot);
const { recordHash: _oldHash, ...tamperedPayload } = tamperedState;
tamperedState.recordHash = hashCanonicalPayload(tamperedPayload);
assert.throws(
  () => assertPaperCanonicalValuationRecord(tamperedState),
  /account differs from engine snapshot|position book differs from engine fills/,
);

const tamperedFillState = structuredClone(record);
tamperedFillState.engineSnapshot.paperFills[0]!.outputAmountAtomic = "101";
tamperedFillState.engineStateHash = hashCanonicalPayload(tamperedFillState.engineSnapshot);
const { recordHash: _oldFillHash, ...tamperedFillPayload } = tamperedFillState;
tamperedFillState.recordHash = hashCanonicalPayload(tamperedFillPayload);
assert.throws(
  () => assertPaperCanonicalValuationRecord(tamperedFillState),
  /fill does not match retained quote evidence|position book differs from engine fills/,
);

await assert.rejects(
  () => new PaperCanonicalValuationService({ store: new InMemoryAgentStateStore(), streamId: "empty" }).value({
    accountId: account.accountId,
    quoteAssetId,
    quoteResults: [quote],
    valuedAt: 10_000,
    maximumQuoteAgeMs: 500,
  }),
  /requires persisted engine state/,
);

console.log("paper-canonical-valuation smoke: ok");
