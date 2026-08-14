import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type HumanPaperFillRecord,
  type HumanPaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  HumanCanonicalRiskSnapshotService,
  assertHumanCanonicalRiskSnapshotRecord,
} from "./human-canonical-risk-snapshot.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import { PaperCanonicalValuationService } from "./paper-canonical-valuation.ts";
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
const wallet = "0x00000000000000000000000000000000000000aa";
const streamId = "human-canonical-risk-smoke";
const accountId = "human-account";

const preTrade = emptyAgentEngineSnapshot();
preTrade.seasons = [{ seasonId: "season-1", name: "Arena", startsAt: 1_000, endsAt: 100_000, createdAt: 900 }];
preTrade.paperAccounts = [{
  accountId,
  seasonId: "season-1",
  participantType: "HUMAN",
  participantId: wallet,
  balances: { [quoteAssetId]: "1000" },
  openedAt: 1_100,
}];

const store = new InMemoryAgentStateStore();
await store.commit({
  streamId,
  expectedRevision: 0,
  idempotencyKey: "entry-state",
  operation: "canonicalRiskEntryState",
  requestHash: hashCanonicalPayload({ operation: "canonicalRiskEntryState" }),
  result: { ok: true },
  snapshot: preTrade,
  createdAt: 1_200,
});
const entry = await new PaperArenaEntryService({ store, streamId }).enter({ accountId, quoteAssetId });
assert.equal(entry.startingNavQuoteAtomic, "1000");
assert.equal(entry.participantType, "HUMAN");

const order: HumanPaperOrderRecord = {
  orderId: "human-order-1",
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
  quoteId: "buy-quote-1",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "200",
  outputAmountAtomic: "490",
  providerId: "rmt-vnext:uniswap-v3:adapter-v1",
  priceImpactBps: 10,
  observedAt: 3_100,
  expiresAt: 4_000,
};
const buyEvidence = { ...buyEvidencePayload, evidenceHash: hashPaperQuoteEvidence(buyEvidencePayload) };
const fill: HumanPaperFillRecord = {
  fillId: "human-fill-1",
  orderId: order.orderId,
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

const postTrade = structuredClone(preTrade);
postTrade.paperAccounts[0]!.balances = { [quoteAssetId]: "800", [positionAssetId]: "490" };
postTrade.paperOrders = [order];
postTrade.paperFills = [fill];
await store.commit({
  streamId,
  expectedRevision: 1,
  idempotencyKey: "post-trade-state",
  operation: "canonicalRiskPostTradeState",
  requestHash: hashCanonicalPayload({ operation: "canonicalRiskPostTradeState" }),
  result: { ok: true },
  snapshot: postTrade,
  createdAt: 3_200,
});

class StaticReader implements RmtPaperQuoteReader {
  readonly sourceId = "canonical-risk-liquidation-reader";
  private readonly outputAmountAtomic: string;
  private readonly quotedAtMs: number;

  constructor(outputAmountAtomic: string, quotedAtMs: number) {
    this.outputAmountAtomic = outputAmountAtomic;
    this.quotedAtMs = quotedAtMs;
  }

  async compare(input: RmtPaperQuoteReaderInput): Promise<unknown> {
    return {
      requestId: `123e4567-e89b-42d3-a456-${String(this.quotedAtMs).padStart(12, "0")}`,
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
        priceImpact: 0.001,
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

async function liquidationQuote(outputAmountAtomic: string, valuedAt: number) {
  return new RmtPaperQuoteService({
    reader: new StaticReader(outputAmountAtomic, valuedAt),
    policy: { maximumQuoteAgeMs: 1_000, maximumPriceImpactBps: 100 },
  }).quote({
    inputAsset: positionAddress,
    outputAsset: quoteAddress,
    inputAmountAtomic: "490",
    observedAtMs: valuedAt,
  });
}

const valuationService = new PaperCanonicalValuationService({ store, streamId });
const valuation1010 = await valuationService.value({
  accountId,
  quoteAssetId,
  quoteResults: [await liquidationQuote("210", 4_000)],
  valuedAt: 4_000,
  maximumQuoteAgeMs: 1_000,
});
assert.equal(valuation1010.valuation.liquidationNavQuoteAtomic, "1010");

const valuation950 = await valuationService.value({
  accountId,
  quoteAssetId,
  quoteResults: [await liquidationQuote("150", 5_000)],
  valuedAt: 5_000,
  maximumQuoteAgeMs: 1_000,
});
assert.equal(valuation950.valuation.liquidationNavQuoteAtomic, "950");

const riskService = new HumanCanonicalRiskSnapshotService({ store, streamId });
const risk = await riskService.derive({
  entry,
  valuations: [valuation1010, valuation950],
  positionAssetId,
});
assert.equal(risk.snapshot.markNavAtomic, "950");
assert.equal(risk.snapshot.currentPortfolioExposureAtomic, "200");
assert.equal(risk.snapshot.currentPositionExposureAtomic, "200");
assert.equal(risk.snapshot.openPositionCount, 1);
assert.equal(risk.snapshot.tradesToday, 1);
assert.equal(risk.snapshot.dailyLossBps, 500);
assert.equal(risk.snapshot.drawdownBps, 595);
assert.equal(risk.snapshot.capturedAt, 5_000);
assert.match(risk.sourceHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertHumanCanonicalRiskSnapshotRecord(risk));

const tampered = structuredClone(risk);
tampered.snapshot.currentPortfolioExposureAtomic = "1";
tampered.sourceHash = hashCanonicalPayload((() => {
  const { sourceHash: _hash, ...payload } = tampered;
  return payload;
})());
assert.throws(
  () => assertHumanCanonicalRiskSnapshotRecord(tampered),
  /payload is not correctly derived/,
);

const valuationLate = await valuationService.value({
  accountId,
  quoteAssetId,
  quoteResults: [await liquidationQuote("160", 4_700)],
  valuedAt: 4_700,
  maximumQuoteAgeMs: 1_000,
});
await assert.rejects(
  () => new HumanCanonicalRiskSnapshotService({ store, streamId, rollingTradeWindowMs: 1_000 }).derive({
    entry,
    valuations: [valuationLate, valuation950],
    positionAssetId,
  }),
  /lacks a valuation baseline for rolling daily loss/,
);

console.log("human-canonical-risk-snapshot smoke: ok");
