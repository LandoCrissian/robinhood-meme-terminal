import assert from "node:assert/strict";
import type { AgentSafetyEnvelope, MarketObservationDraft } from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import {
  HumanCanonicalPaperFillOrchestrationService,
  assertHumanCanonicalPaperFillOrchestrationRecord,
} from "./human-canonical-paper-fill-orchestration.ts";
import {
  HumanCanonicalPaperOrderSubmissionService,
  assertHumanCanonicalPaperOrderSubmissionRecord,
} from "./human-canonical-paper-order-submission.ts";
import {
  HumanCanonicalRiskCapacityService,
  assertHumanCanonicalRiskCapacityRecord,
} from "./human-canonical-risk-capacity.ts";
import { HumanPaperOrderAdmissionService } from "./human-paper-order-admission.ts";
import { HumanPaperOrderSubmissionGateService } from "./human-paper-order-submission-gate.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import { buildPaperFillCostPlan } from "./paper-fill-cost.ts";
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
const streamId = "human-canonical-execution";

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
const store = new InMemoryAgentStateStore();
const engine = await DurableAgentEngine.initialize({ config: engineConfig, store, streamId });
await engine.createSeason({ seasonId: "season-1", name: "Canonical Human", startsAt: 1_000, endsAt: 20_000, createdAt: 900 }, "season");
const human = await engine.openHumanPaperAccount({
  walletAddress: "0x00000000000000000000000000000000000000ab",
  seasonId: "season-1",
  initialBalances: { [quoteAssetId]: "1000" },
  openedAt: 1_100,
}, "human");

const entry = await new PaperArenaEntryService({ store, streamId }).enter({
  accountId: human.accountId,
  quoteAssetId,
});
const valuation = await new PaperCanonicalValuationService({ store, streamId }).value({
  accountId: human.accountId,
  quoteAssetId,
  quoteResults: [],
  valuedAt: 1_800,
  maximumQuoteAgeMs: 1_000,
});
assert.equal(valuation.valuation.liquidationNavQuoteAtomic, "1000");

const marketObservation: MarketObservationDraft = {
  assetId: positionAssetId,
  quoteAssetId,
  referencePriceAtomic: "150000000",
  referencePriceDecimals: 6,
};
const canonicalRisk = await new HumanCanonicalRiskCapacityService({
  store,
  streamId,
  config: {
    safetyEnvelope,
    riskPolicy,
    maximumRiskSnapshotAgeMs: 1_000,
  },
}).plan({
  entry,
  valuations: [valuation],
  marketObservation,
  requestedInputAmountAtomic: "200",
  requestedMaximumSlippageBps: 50,
  plannedAt: 1_900,
});
assert.equal(canonicalRisk.capacityPlan.status, "ADMITTED");
assert.equal(canonicalRisk.capacityPlan.maximumInputAmountAtomic, "250");
assert.equal(canonicalRisk.riskSource.snapshot.currentPortfolioExposureAtomic, "0");
assert.equal(canonicalRisk.riskSource.snapshot.tradesToday, 0);
assert.doesNotThrow(() => assertHumanCanonicalRiskCapacityRecord(canonicalRisk));

const admission = await new HumanPaperOrderAdmissionService({
  store,
  streamId,
  policy: {
    policyVersion: "RMT_HUMAN_MANUAL_V1",
    maximumSlippageBps: 75,
    maximumInputBalanceBps: 2_500,
  },
}).admit({
  accountId: human.accountId,
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  admittedAt: 1_950,
});
const gate = await new HumanPaperOrderSubmissionGateService({ store, streamId }).check({
  admission,
  checkedAt: 1_975,
});
const canonicalSubmission = await new HumanCanonicalPaperOrderSubmissionService(engine, {
  maximumRiskPlanAgeMs: 500,
  safetyEnvelope,
  riskPolicy,
}).submit({
  admission,
  gate,
  canonicalRiskCapacity: canonicalRisk,
});
assert.equal(canonicalSubmission.submission.order.status, "PENDING");
assert.equal(canonicalSubmission.authorizationHash, canonicalRisk.resultHash);
assert.doesNotThrow(() => assertHumanCanonicalPaperOrderSubmissionRecord(canonicalSubmission));

class QuoteReader implements RmtPaperQuoteReader {
  readonly sourceId: string;
  private readonly outputAmountAtomic: string;
  private readonly priceImpact: number;
  private readonly quotedAtMs: number;

  constructor(outputAmountAtomic: string, priceImpact: number, quotedAtMs: number, suffix: string) {
    this.outputAmountAtomic = outputAmountAtomic;
    this.priceImpact = priceImpact;
    this.quotedAtMs = quotedAtMs;
    this.sourceId = `human-canonical-quote-${suffix}`;
  }

  async compare(input: RmtPaperQuoteReaderInput): Promise<unknown> {
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
        outputDecimals: 18,
        priceImpact: this.priceImpact,
        quotedAtMs: this.quotedAtMs,
        expiresAtMs: this.quotedAtMs + 3_000,
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

async function quote(priceImpact: number, at: number, suffix: string) {
  return new RmtPaperQuoteService({
    reader: new QuoteReader("490", priceImpact, at, suffix),
    policy: { maximumQuoteAgeMs: 1_000, maximumPriceImpactBps: 250 },
  }).quote({
    inputAsset: quoteAddress,
    outputAsset: positionAddress,
    inputAmountAtomic: "200",
    observedAtMs: at,
  });
}

const canonicalFillService = new HumanCanonicalPaperFillOrchestrationService(engine);
const tooMuchImpact = await quote(0.02, 3_100, "high-impact");
assert.equal(tooMuchImpact.evidence.priceImpactBps, 200);
await assert.rejects(
  () => canonicalFillService.fill({
    canonicalSubmission,
    quoteResult: tooMuchImpact,
    costPlan: buildPaperFillCostPlan(tooMuchImpact),
  }),
  /price impact exceeds admitted Human risk policy/,
);
let state = await store.load(streamId);
assert.equal(state?.snapshot.paperFills.length, 0);
assert.equal(state?.snapshot.paperOrders[0]?.status, "PENDING");

const permittedQuote = await quote(0.001, 3_200, "permitted");
assert.equal(permittedQuote.evidence.priceImpactBps, 10);
const fill = await canonicalFillService.fill({
  canonicalSubmission,
  quoteResult: permittedQuote,
  costPlan: buildPaperFillCostPlan(permittedQuote),
});
assert.equal(fill.fillOrchestration.fill.participantType, "HUMAN");
assert.equal(fill.fillOrchestration.fill.inputAmountAtomic, "200");
assert.equal(fill.fillOrchestration.fill.outputAmountAtomic, "490");
assert.equal(fill.maximumPriceImpactBps, 150);
assert.doesNotThrow(() => assertHumanCanonicalPaperFillOrchestrationRecord(fill));

state = await store.load(streamId);
assert.equal(state?.snapshot.paperFills.length, 1);
assert.equal(state?.snapshot.paperOrders[0]?.status, "FILLED");
assert.equal(engine.getPaperAccount(human.accountId).balances[quoteAssetId], "800");
assert.equal(engine.getPaperAccount(human.accountId).balances[positionAssetId], "490");
assert.equal("executeLive" in canonicalFillService, false);
assert.equal("sign" in canonicalFillService, false);

console.log("human-canonical-paper-execution smoke: ok");
