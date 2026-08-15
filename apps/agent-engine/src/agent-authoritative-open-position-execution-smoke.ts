import assert from "node:assert/strict";
import {
  buildMarketSnapshot,
  hashAgentRunPayload,
  hashCanonicalPayload,
  type AgentRunRecord,
  type AgentSafetyEnvelope,
  type StrategySpec,
} from "../../../packages/agent-core/src/index.ts";
import {
  AgentAuthoritativeOpenPositionAdmissionService,
  assertAgentAuthoritativeOpenPositionAdmissionRecord,
  type AgentAuthoritativeOpenPositionAdmissionConfig,
} from "./agent-authoritative-open-position-admission.ts";
import {
  AgentAuthoritativeOpenPositionFillService,
  assertAgentAuthoritativeOpenPositionFillRecord,
} from "./agent-authoritative-open-position-fill.ts";
import {
  AgentAuthoritativeOpenPositionSubmissionService,
  assertAgentAuthoritativeOpenPositionSubmissionRecord,
} from "./agent-authoritative-open-position-submission.ts";
import { DurableAgentEngine } from "./durable-engine.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import {
  InMemoryPaperCanonicalValuationHistoryStore,
} from "./paper-canonical-valuation-store.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
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
const streamId = "agent-authoritative-open-position-execution";

const safetyEnvelope: AgentSafetyEnvelope = {
  maximumPositionBps: 1_000,
  maximumPortfolioExposureBps: 5_000,
  maximumOpenPositions: 10,
  maximumDailyLossBps: 500,
  maximumDrawdownBps: 2_000,
  maximumTradesPerDay: 50,
  maximumSlippageBps: 200,
  maximumPriceImpactBps: 500,
  minimumEvaluationIntervalSeconds: 30,
};
const strategySpec: StrategySpec = {
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
const engineConfig = {
  safetyEnvelope,
  paperFillDelayMs: 1_000,
  policyVersion: "RMT_AGENT_FOUNDATION_V1",
};
const stateStore = new InMemoryAgentStateStore();
const valuationStore = new InMemoryPaperCanonicalValuationHistoryStore();
const engine = await DurableAgentEngine.initialize({ config: engineConfig, store: stateStore, streamId });
await engine.createSeason({
  seasonId: "season-1",
  name: "Authoritative Agent Entry",
  startsAt: 1_000,
  endsAt: 100_000,
  createdAt: 900,
}, "season");
const registeredAgent = await engine.registerAgent({
  ownerAddress: "0x0000000000000000000000000000000000000001",
  name: "Authoritative Hound",
  thesis: "Increase paper risk only from canonical valuation evidence.",
  createdAt: 1_050,
}, "agent");
const strategy = await engine.createStrategyVersion(registeredAgent.id, strategySpec, "strategy", 1_075);
await engine.activatePaperAgent(registeredAgent.id, "activate");
const account = await engine.openPaperAccount({
  agentId: registeredAgent.id,
  seasonId: "season-1",
  initialBalances: { [quoteAssetId]: "1000000" },
  openedAt: 1_100,
}, "account");
const entry = await new PaperArenaEntryService({ store: stateStore, streamId }).enter({
  accountId: account.accountId,
  quoteAssetId,
});
assert.equal(entry.participantType, "AGENT");

const valuationService = new PaperCanonicalValuationService({ store: stateStore, streamId });
const valuation = await valuationService.value({
  accountId: account.accountId,
  quoteAssetId,
  quoteResults: [],
  valuedAt: 9_950,
  maximumQuoteAgeMs: 1_000,
});
await valuationStore.put(valuation);
assert.equal(valuation.valuation.liquidationNavQuoteAtomic, "1000000");

const marketSnapshot = buildMarketSnapshot({
  chainId: 4_663,
  sourceId: "verified-rmt-paper-market-v1",
  capturedAt: 9_800,
  observations: [{
    assetId: positionAssetId,
    quoteAssetId: "fiat:USD",
    aliases: ["NVDA"],
    referencePriceAtomic: "150000000",
    referencePriceDecimals: 6,
  }],
});
const proposal = {
  action: "OPEN_POSITION" as const,
  confidence: 0.8,
  reasoningSummary: "The admitted strategy conditions are satisfied by canonical market evidence.",
  openPosition: { assetId: positionAssetId, requestedPositionBps: 400 },
};
const runPayload: Omit<AgentRunRecord, "runHash"> = {
  runId: "authoritative-open-run-1",
  evaluationKey: "authoritative-open:slot-1",
  requestHash: hashCanonicalPayload({ request: "authoritative-open-slot-1" }),
  agentId: registeredAgent.id,
  accountId: account.accountId,
  accountSnapshot: account,
  strategyVersion: strategy.version,
  strategyHash: strategy.strategyHash,
  runnerVersion: "RMT_PAPER_EVALUATION_V1",
  marketSourceId: marketSnapshot.sourceId,
  decisionAdapterId: "authoritative-open-adapter-v1",
  modelIdentity: "authoritative-open-model-v1",
  marketSnapshot,
  proposal,
  proposalHash: hashCanonicalPayload(proposal),
  evaluatedAt: 9_900,
};
const run: AgentRunRecord = { ...runPayload, runHash: hashAgentRunPayload(runPayload) };
const admissionConfig: AgentAuthoritativeOpenPositionAdmissionConfig = {
  safetyEnvelope,
  riskCapacityPolicyVersion: "RMT_AGENT_AUTHORITATIVE_RISK_V1",
  tradeRequestPolicyVersion: "RMT_AGENT_AUTHORITATIVE_TRADE_REQUEST_V1",
  maximumRiskSnapshotAgeMs: 200,
  orderAdmissionPolicy: {
    policyVersion: "RMT_AGENT_AUTHORITATIVE_ORDER_ADMISSION_V1",
    maximumCapacityPlanAgeMs: 100,
  },
  maximumValuationGapMs: 10_000,
  maximumLatestValuationAgeMs: 150,
};
const authorization = await new AgentAuthoritativeOpenPositionAdmissionService({
  stateStore,
  valuationHistoryStore: valuationStore,
  streamId,
  config: admissionConfig,
}).admit({ entry, run, requestedAt: 10_000, admittedAt: 10_050 });
assert.equal(authorization.canonicalAdmission.admission.status, "ADMITTED");
assert.equal(authorization.canonicalAdmission.admission.orderAdmission?.intent.inputAmountAtomic, "40000");
assert.doesNotThrow(() => assertAgentAuthoritativeOpenPositionAdmissionRecord(authorization));

const changedHistoryStore = new InMemoryPaperCanonicalValuationHistoryStore();
await changedHistoryStore.put(valuation);
await changedHistoryStore.put(await valuationService.value({
  accountId: account.accountId,
  quoteAssetId,
  quoteResults: [],
  valuedAt: 9_975,
  maximumQuoteAgeMs: 1_000,
}));
await assert.rejects(
  () => new AgentAuthoritativeOpenPositionSubmissionService({
    writer: engine,
    stateStore,
    valuationHistoryStore: changedHistoryStore,
    streamId,
  }).submit(authorization),
  /valuation history changed after admission/,
);
assert.equal(engine.getPaperAccount(account.accountId).balances[quoteAssetId], "1000000");

const submissionService = new AgentAuthoritativeOpenPositionSubmissionService({
  writer: engine,
  stateStore,
  valuationHistoryStore: valuationStore,
  streamId,
});
const submission = await submissionService.submit(authorization);
assert.equal(submission.order.status, "PENDING");
assert.equal(submission.order.inputAssetId, quoteAssetId);
assert.equal(submission.order.outputAssetId, positionAssetId);
assert.equal(submission.order.inputAmountAtomic, "40000");
assert.equal(submission.authorizationHash, authorization.resultHash);
assert.match(submission.idempotencyKey, /^agent-paper-open-position:/);
assert.doesNotThrow(() => assertAgentAuthoritativeOpenPositionSubmissionRecord(submission));
const submissionReplay = await submissionService.submit(authorization);
assert.equal(submissionReplay.order.orderId, submission.order.orderId);
assert.equal(submissionReplay.submissionHash, submission.submissionHash);

const tamperedSubmission = structuredClone(submission);
tamperedSubmission.authorizationHash = hashCanonicalPayload({ wrong: true });
tamperedSubmission.submissionHash = hashCanonicalPayload((() => {
  const { submissionHash: _hash, ...payload } = tamperedSubmission;
  return payload;
})());
assert.throws(
  () => assertAgentAuthoritativeOpenPositionSubmissionRecord(tamperedSubmission),
  /authorization hash mismatch/,
);

class StaticQuoteReader implements RmtPaperQuoteReader {
  readonly sourceId: string;
  private readonly outputAmountAtomic: string;
  private readonly impact: number;
  private readonly at: number;

  constructor(outputAmountAtomic: string, impact: number, at: number, suffix: string) {
    this.outputAmountAtomic = outputAmountAtomic;
    this.impact = impact;
    this.at = at;
    this.sourceId = `authoritative-open-${suffix}`;
  }

  async compare(input: RmtPaperQuoteReaderInput): Promise<unknown> {
    assert.equal(input.inputAsset, quoteAddress);
    assert.equal(input.outputAsset, positionAddress);
    assert.equal(input.inputAmountAtomic, "40000");
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
        expectedOutputAtomic: this.outputAmountAtomic,
        protectedOutputAtomic: this.outputAmountAtomic,
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

async function quote(outputAmountAtomic: string, impact: number, at: number, suffix: string) {
  return new RmtPaperQuoteService({
    reader: new StaticQuoteReader(outputAmountAtomic, impact, at, suffix),
    policy: { maximumQuoteAgeMs: 1_000, maximumPriceImpactBps: 500 },
  }).quote({
    inputAsset: quoteAddress,
    outputAsset: positionAddress,
    inputAmountAtomic: "40000",
    observedAtMs: at,
  });
}

const fillService = new AgentAuthoritativeOpenPositionFillService(engine);
const highImpact = await quote("250000", 0.03, 11_500, "high-impact");
await assert.rejects(
  () => fillService.fill({
    submission,
    quoteResult: highImpact,
    costPlan: buildPaperFillCostPlan(highImpact),
  }),
  /price impact exceeds strategy policy/,
);
assert.equal((await stateStore.load(streamId))?.snapshot.paperFills.length, 0);

const allowed = await quote("250000", 0.001, 11_600, "allowed");
const filled = await fillService.fill({
  submission,
  quoteResult: allowed,
  costPlan: buildPaperFillCostPlan(allowed),
});
assert.equal(filled.fill.inputAmountAtomic, "40000");
assert.equal(filled.fill.outputAmountAtomic, "250000");
assert.equal(filled.fill.accountId, account.accountId);
assert.equal(filled.submission.authorizationHash, authorization.resultHash);
assert.doesNotThrow(() => assertAgentAuthoritativeOpenPositionFillRecord(filled));
const fillReplay = await fillService.fill({
  submission,
  quoteResult: allowed,
  costPlan: buildPaperFillCostPlan(allowed),
});
assert.equal(fillReplay.fill.fillId, filled.fill.fillId);
assert.equal(fillReplay.fillHash, filled.fillHash);

const currentAccount = engine.getPaperAccount(account.accountId);
assert.equal(currentAccount.balances[quoteAssetId], "960000");
assert.equal(currentAccount.balances[positionAssetId], "250000");
const finalState = await stateStore.load(streamId);
assert.ok(finalState);
const book = buildPaperPositionBook({
  accountId: account.accountId,
  quoteAssetId,
  fills: finalState.snapshot.paperFills.filter((fill) => fill.accountId === account.accountId),
});
assert.equal(book.fillCount, 1);
assert.equal(book.positions[0]?.assetId, positionAssetId);
assert.equal(book.positions[0]?.quantityAtomic, "250000");
assert.equal(book.positions[0]?.costBasisQuoteAtomic, "40000");
assert.equal("executeLive" in submissionService, false);
assert.equal("sign" in submissionService, false);
assert.equal("executeLive" in fillService, false);
assert.equal("sign" in fillService, false);

console.log("agent-authoritative-open-position execution smoke: ok");
