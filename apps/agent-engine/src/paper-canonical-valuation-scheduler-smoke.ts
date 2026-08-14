import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type HumanPaperFillRecord,
  type HumanPaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import { PaperArenaEntryService } from "./paper-arena-entry.ts";
import {
  InMemoryPaperCanonicalValuationHistoryStore,
} from "./paper-canonical-valuation-store.ts";
import {
  PaperCanonicalValuationScheduler,
  type PaperCanonicalLiquidationQuoteSource,
  type PaperCanonicalLiquidationQuoteSourceInput,
} from "./paper-canonical-valuation-scheduler.ts";
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
const streamId = "valuation-scheduler-smoke";
const accountId = "human-account";
const wallet = "0x00000000000000000000000000000000000000ad";

const initial = emptyAgentEngineSnapshot();
initial.seasons = [{ seasonId: "season-1", name: "Scheduler", startsAt: 1_000, endsAt: 20_000, createdAt: 900 }];
initial.paperAccounts = [{
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
  idempotencyKey: "initial",
  operation: "schedulerInitial",
  requestHash: hashCanonicalPayload({ operation: "schedulerInitial" }),
  result: { ok: true },
  snapshot: initial,
  createdAt: 1_150,
});
const entry = await new PaperArenaEntryService({ store: stateStore, streamId }).enter({ accountId, quoteAssetId });
const historyStore = new InMemoryPaperCanonicalValuationHistoryStore();

class QuoteSource implements PaperCanonicalLiquidationQuoteSource {
  readonly sourceId = "scheduler-verified-quote-source";
  calls = 0;
  async quote(input: PaperCanonicalLiquidationQuoteSourceInput) {
    this.calls += 1;
    assert.equal(input.inputAssetId, positionAssetId);
    assert.equal(input.outputAssetId, quoteAssetId);
    assert.equal(input.inputAmountAtomic, "490");
    class Reader implements RmtPaperQuoteReader {
      readonly sourceId = "scheduler-rmt-reader";
      async compare(readerInput: RmtPaperQuoteReaderInput): Promise<unknown> {
        return {
          requestId: "123e4567-e89b-42d3-a456-426614174000",
          chainId: 4_663,
          inputAsset: readerInput.inputAsset,
          outputAsset: readerInput.outputAsset,
          inputAmountAtomic: readerInput.inputAmountAtomic,
          requestedAtMs: input.observedAtMs - 100,
          completedAtMs: input.observedAtMs - 50,
          attempts: [{
            provider: "uniswap-v3",
            adapterVersion: 1,
            status: "indicative",
            chainId: 4_663,
            inputAsset: readerInput.inputAsset,
            outputAsset: readerInput.outputAsset,
            inputAmountAtomic: readerInput.inputAmountAtomic,
            expectedOutputAtomic: "210",
            protectedOutputAtomic: "210",
            outputDecimals: 6,
            priceImpact: 0.001,
            quotedAtMs: input.observedAtMs,
            expiresAtMs: input.observedAtMs + 2_000,
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
    return new RmtPaperQuoteService({
      reader: new Reader(),
      policy: { maximumQuoteAgeMs: 1_000, maximumPriceImpactBps: 100 },
    }).quote({
      inputAsset: positionAddress,
      outputAsset: quoteAddress,
      inputAmountAtomic: input.inputAmountAtomic,
      observedAtMs: input.observedAtMs,
    });
  }
}

const quoteSource = new QuoteSource();
const scheduler = new PaperCanonicalValuationScheduler({
  stateStore,
  historyStore,
  quoteSource,
  streamId,
  config: {
    cadenceMs: 500,
    maximumLatenessMs: 100,
    maximumQuoteAgeMs: 1_000,
    maximumOpenPositions: 5,
  },
});

const early = await scheduler.runOnce({ entry, nowMs: 1_500 });
assert.equal(early.status, "NOT_DUE");
assert.equal(early.nextDueAt, 1_600);
assert.equal(quoteSource.calls, 0);

const first = await scheduler.runOnce({ entry, nowMs: 1_600 });
assert.equal(first.status, "STORED");
if (first.status !== "STORED") throw new Error("expected stored first valuation");
assert.equal(first.valuation.valuation.liquidationNavQuoteAtomic, "1000");
assert.equal(first.nextDueAt, 2_100);
assert.equal(quoteSource.calls, 0);
assert.equal((await historyStore.list(streamId, accountId)).length, 1);

const buyEvidencePayload = {
  quoteId: "scheduler-buy-quote",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "200",
  outputAmountAtomic: "490",
  providerId: "rmt-vnext:uniswap-v3:adapter-v1",
  priceImpactBps: 10,
  observedAt: 1_800,
  expiresAt: 2_500,
};
const buyEvidence = { ...buyEvidencePayload, evidenceHash: hashPaperQuoteEvidence(buyEvidencePayload) };
const order: HumanPaperOrderRecord = {
  orderId: "scheduler-order",
  status: "FILLED",
  participantType: "HUMAN",
  participantId: wallet,
  manualPolicyVersion: "RMT_HUMAN_MANUAL_V1",
  accountId,
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "200",
  maximumSlippageBps: 50,
  createdAt: 1_700,
};
const fill: HumanPaperFillRecord = {
  fillId: "scheduler-fill",
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
const current = await stateStore.load(streamId);
assert.ok(current);
const afterFill = structuredClone(current.snapshot);
afterFill.paperAccounts[0]!.balances = { [quoteAssetId]: "800", [positionAssetId]: "490" };
afterFill.paperOrders = [order];
afterFill.paperFills = [fill];
await stateStore.commit({
  streamId,
  expectedRevision: current.revision,
  idempotencyKey: "filled-state",
  operation: "schedulerFilledState",
  requestHash: hashCanonicalPayload({ operation: "schedulerFilledState" }),
  result: { ok: true },
  snapshot: afterFill,
  createdAt: 1_850,
});

const beforeSecond = await scheduler.runOnce({ entry, nowMs: 2_050 });
assert.equal(beforeSecond.status, "NOT_DUE");
assert.equal(quoteSource.calls, 0);

const second = await scheduler.runOnce({ entry, nowMs: 2_100 });
assert.equal(second.status, "STORED");
if (second.status !== "STORED") throw new Error("expected stored second valuation");
assert.equal(quoteSource.calls, 1);
assert.equal(second.valuation.valuation.liquidationNavQuoteAtomic, "1010");
assert.equal(second.valuation.valuation.positionValues[0]?.quantityAtomic, "490");
assert.equal(second.nextDueAt, 2_600);
assert.equal((await historyStore.list(streamId, accountId)).length, 2);

await assert.rejects(
  () => scheduler.runOnce({ entry, nowMs: 2_701 }),
  /checkpoint was missed beyond lateness policy; historical backfill is forbidden/,
);
assert.equal(quoteSource.calls, 1);
assert.equal((await historyStore.list(streamId, accountId)).length, 2);

console.log("paper-canonical-valuation-scheduler smoke: ok");
