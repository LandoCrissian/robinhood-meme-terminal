import assert from "node:assert/strict";
import type { AgentSafetyEnvelope, MarketObservationDraft } from "../../../packages/agent-core/src/index.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import {
  HumanAuthoritativePaperFillOrchestrationService,
  assertHumanAuthoritativePaperFillOrchestrationRecord,
} from "./human-authoritative-paper-fill-orchestration.ts";
import {
  HumanAuthoritativePaperOrderSubmissionService,
  assertHumanAuthoritativePaperOrderSubmissionRecord,
} from "./human-authoritative-paper-order-submission.ts";
import {
  HumanAuthoritativeRiskCapacityService,
  assertHumanAuthoritativeRiskCapacityRecord,
} from "./human-authoritative-risk-capacity.ts";
import { HumanPaperOrderAdmissionService } from "./human-paper-order-admission.ts";
import { HumanPaperOrderSubmissionGateService } from "./human-paper-order-submission-gate.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
import {
  InMemoryPaperCanonicalValuationHistoryStore,
  paperCanonicalValuationHistorySchemaSql,
} from "./paper-canonical-valuation-store.ts";
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
const streamId = "human-authoritative-execution";

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
const stateStore = new InMemoryAgentStateStore();
const historyStore = new InMemoryPaperCanonicalValuationHistoryStore();
const engine = await DurableAgentEngine.initialize({ config: engineConfig, store: stateStore, streamId });
await engine.createSeason({ seasonId: "season-1", name: "Authoritative Human", startsAt: 1_000, endsAt: 20_000, createdAt: 900 }, "season");
const human = await engine.openHumanPaperAccount({
  walletAddress: "0x00000000000000000000000000000000000000ac",
  seasonId: "season-1",
  initialBalances: { [quoteAssetId]: "1000" },
  openedAt: 1_100,
}, "human");
const entry = await new PaperArenaEntryService({ store: stateStore, streamId }).enter({
  accountId: human.accountId,
  quoteAssetId,
});
const valuationService = new PaperCanonicalValuationService({ store: stateStore, streamId });
async function cashValuation(valuedAt: number, maximumQuoteAgeMs = 1_000) {
  return valuationService.value({
    accountId: human.accountId,
    quoteAssetId,
    quoteResults: [],
    valuedAt,
    maximumQuoteAgeMs,
  });
}
const valuation1200 = await cashValuation(1_200);
const valuation1700 = await cashValuation(1_700);
const valuation1800 = await cashValuation(1_800);
await historyStore.put(valuation1200);
await historyStore.put(valuation1700);
await historyStore.put(valuation1800);
await historyStore.put(valuation1200);
assert.equal((await historyStore.list(streamId, human.accountId)).length, 3);

const conflicting1200 = await cashValuation(1_200, 2_000);
await assert.rejects(
  () => historyStore.put(conflicting1200),
  /timestamp already contains different evidence/,
);
assert.match(paperCanonicalValuationHistorySchemaSql, /PRIMARY KEY \(stream_id, account_id, valued_at_ms\)/);
assert.match(paperCanonicalValuationHistorySchemaSql, /record_hash TEXT NOT NULL/);

const marketObservation: MarketObservationDraft = {
  assetId: positionAssetId,
  quoteAssetId,
  referencePriceAtomic: "150000000",
  referencePriceDecimals: 6,
};
const authoritativeConfig = {
  safetyEnvelope,
  riskPolicy,
  maximumRiskSnapshotAgeMs: 1_000,
  maximumValuationGapMs: 600,
  maximumLatestValuationAgeMs: 300,
};
const authoritativeRisk = await new HumanAuthoritativeRiskCapacityService({
  stateStore,
  valuationHistoryStore: historyStore,
  streamId,
  config: authoritativeConfig,
}).plan({
  entry,
  marketObservation,
  requestedInputAmountAtomic: "200",
  requestedMaximumSlippageBps: 50,
  plannedAt: 1_900,
});
assert.equal(authoritativeRisk.canonicalRiskCapacity.capacityPlan.status, "ADMITTED");
assert.equal(authoritativeRisk.canonicalRiskCapacity.riskSource.valuations.length, 3);
assert.equal(authoritativeRisk.canonicalRiskCapacity.capacityPlan.maximumInputAmountAtomic, "250");
assert.match(authoritativeRisk.valuationHistoryDigest, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertHumanAuthoritativeRiskCapacityRecord(authoritativeRisk));

const gappedStore = new InMemoryPaperCanonicalValuationHistoryStore();
await gappedStore.put(valuation1200);
await gappedStore.put(valuation1800);
await assert.rejects(
  () => new HumanAuthoritativeRiskCapacityService({
    stateStore,
    valuationHistoryStore: gappedStore,
    streamId,
    config: { ...authoritativeConfig, maximumValuationGapMs: 500 },
  }).plan({
    entry,
    marketObservation,
    requestedInputAmountAtomic: "200",
    requestedMaximumSlippageBps: 50,
    plannedAt: 1_900,
  }),
  /valuation history contains a gap above policy/,
);

const admission = await new HumanPaperOrderAdmissionService({
  store: stateStore,
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
const gate = await new HumanPaperOrderSubmissionGateService({ store: stateStore, streamId }).check({
  admission,
  checkedAt: 1_975,
});
const authoritativeSubmission = await new HumanAuthoritativePaperOrderSubmissionService(engine, {
  maximumRiskPlanAgeMs: 500,
  safetyEnvelope,
  riskPolicy,
}).submit({
  admission,
  gate,
  authoritativeRiskCapacity: authoritativeRisk,
});
assert.equal(authoritativeSubmission.authorizationHash, authoritativeRisk.resultHash);
assert.equal(authoritativeSubmission.canonicalSubmission.submission.order.status, "PENDING");
assert.doesNotThrow(() => assertHumanAuthoritativePaperOrderSubmissionRecord(authoritativeSubmission));

class QuoteReader implements RmtPaperQuoteReader {
  readonly sourceId: string;
  constructor(
    private readonly outputAmountAtomic: string,
    private readonly priceImpact: number,
    private readonly quotedAtMs: number,
    suffix: string,
  ) {
    this.sourceId = `human-authoritative-${suffix}`;
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

const fillService = new HumanAuthoritativePaperFillOrchestrationService(engine);
const highImpact = await quote(0.02, 3_100, "high-impact");
await assert.rejects(
  () => fillService.fill({
    authoritativeSubmission,
    quoteResult: highImpact,
    costPlan: buildPaperFillCostPlan(highImpact),
  }),
  /price impact exceeds admitted Human risk policy/,
);
assert.equal((await stateStore.load(streamId))?.snapshot.paperFills.length, 0);

const allowed = await quote(0.001, 3_200, "allowed");
const filled = await fillService.fill({
  authoritativeSubmission,
  quoteResult: allowed,
  costPlan: buildPaperFillCostPlan(allowed),
});
assert.equal(filled.canonicalFill.fillOrchestration.fill.participantType, "HUMAN");
assert.equal(filled.canonicalFill.fillOrchestration.fill.outputAmountAtomic, "490");
assert.doesNotThrow(() => assertHumanAuthoritativePaperFillOrchestrationRecord(filled));
assert.equal(engine.getPaperAccount(human.accountId).balances[quoteAssetId], "800");
assert.equal(engine.getPaperAccount(human.accountId).balances[positionAssetId], "490");
assert.equal("executeLive" in fillService, false);
assert.equal("sign" in fillService, false);

console.log("human-authoritative-paper-execution smoke: ok");
