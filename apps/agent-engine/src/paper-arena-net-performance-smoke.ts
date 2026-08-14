import assert from "node:assert/strict";
import {
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type PaperAccountRecord,
  type PaperFillRecord,
  type SeasonRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  buildPaperArenaNetPerformance,
  assertPaperArenaNetPerformanceRecord,
} from "./paper-arena-net-performance.ts";
import {
  buildPaperArenaPerformance,
} from "./paper-arena-performance.ts";
import {
  assertPaperArenaEntryRecord,
  type PaperArenaEntryRecord,
} from "./paper-arena-entry.ts";
import {
  assertPaperCanonicalValuationRecord,
  type PaperCanonicalValuationRecord,
} from "./paper-canonical-valuation.ts";
import {
  buildPaperExternalCostConversionEvidence,
  buildPaperExternalCostValuation,
} from "./paper-external-cost-valuation.ts";
import { buildPaperLiquidationValuation } from "./paper-liquidation-valuation.ts";
import { buildPaperPositionBook } from "./paper-position-book.ts";
import { emptyAgentEngineSnapshot, type AgentEngineSnapshot } from "./snapshot.ts";

const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const positionAssetId = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const nativeEth = "eip155:4663/native";
const accountId = "account-1";
const season: SeasonRecord = { seasonId: "season-1", name: "Season 1", startsAt: 0, endsAt: 10_000, createdAt: 0 };

function fill(input: {
  fillId: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmountAtomic: string;
  outputAmountAtomic: string;
  filledAt: number;
  gasCostAtomic: string;
}): PaperFillRecord {
  const quotePayload: Omit<VerifiedPaperQuoteEvidence, "evidenceHash"> = {
    quoteId: `quote-${input.fillId}`,
    inputAssetId: input.inputAssetId,
    outputAssetId: input.outputAssetId,
    inputAmountAtomic: input.inputAmountAtomic,
    outputAmountAtomic: input.outputAmountAtomic,
    providerId: "rmt-vnext:uniswap-v3:adapter-v1",
    priceImpactBps: 10,
    observedAt: input.filledAt,
    expiresAt: input.filledAt + 10_000,
  };
  const quoteEvidence: VerifiedPaperQuoteEvidence = { ...quotePayload, evidenceHash: hashPaperQuoteEvidence(quotePayload) };
  return {
    fillId: input.fillId,
    orderId: `order-${input.fillId}`,
    quoteId: quoteEvidence.quoteId,
    agentId: "agent-1",
    accountId,
    inputAssetId: input.inputAssetId,
    outputAssetId: input.outputAssetId,
    inputAmountAtomic: input.inputAmountAtomic,
    outputAmountAtomic: input.outputAmountAtomic,
    providerId: quoteEvidence.providerId,
    feeAmountAtomic: "0",
    gasAssetId: nativeEth,
    gasCostAtomic: input.gasCostAtomic,
    filledAt: input.filledAt,
    evidenceHash: quoteEvidence.evidenceHash,
    quoteEvidence,
  };
}

const buy = fill({
  fillId: "fill-buy",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  outputAmountAtomic: "100",
  filledAt: 110,
  gasCostAtomic: "2",
});
const sell = fill({
  fillId: "fill-sell",
  inputAssetId: positionAssetId,
  outputAssetId: quoteAssetId,
  inputAmountAtomic: "100",
  outputAmountAtomic: "50",
  filledAt: 120,
  gasCostAtomic: "1",
});

function snapshot(account: PaperAccountRecord, fills: PaperFillRecord[]): AgentEngineSnapshot {
  const value = emptyAgentEngineSnapshot();
  value.seasons = [structuredClone(season)];
  value.paperAccounts = [structuredClone(account)];
  value.paperFills = fills.map((item) => structuredClone(item));
  return value;
}

const entryAccount: PaperAccountRecord = {
  accountId,
  seasonId: season.seasonId,
  participantType: "AGENT",
  participantId: "agent-1",
  balances: { [quoteAssetId]: "1000" },
  openedAt: 10,
};
const entrySnapshot = snapshot(entryAccount, []);
const entryPayload: Omit<PaperArenaEntryRecord, "entryHash"> = {
  schemaVersion: 1,
  streamId: "paper-default",
  revision: 1,
  engineSnapshot: entrySnapshot,
  engineStateHash: hashCanonicalPayload(entrySnapshot),
  season,
  account: entryAccount,
  participantType: "AGENT",
  participantId: "agent-1",
  quoteAssetId,
  startingNavQuoteAtomic: "1000",
  enteredAt: 10,
};
const entry: PaperArenaEntryRecord = { ...entryPayload, entryHash: hashCanonicalPayload(entryPayload) };
assert.doesNotThrow(() => assertPaperArenaEntryRecord(entry));

function canonicalValuation(input: {
  revision: number;
  account: PaperAccountRecord;
  fills: PaperFillRecord[];
  valuedAt: number;
}): PaperCanonicalValuationRecord {
  const engineSnapshot = snapshot(input.account, input.fills);
  const book = buildPaperPositionBook({ accountId, quoteAssetId, fills: input.fills });
  const valuation = buildPaperLiquidationValuation({
    positionBook: book,
    account: input.account,
    quoteResults: [],
    valuedAt: input.valuedAt,
    maximumQuoteAgeMs: 100,
  });
  const payload: Omit<PaperCanonicalValuationRecord, "recordHash"> = {
    schemaVersion: 1,
    streamId: "paper-default",
    revision: input.revision,
    engineSnapshot,
    engineStateHash: hashCanonicalPayload(engineSnapshot),
    valuation,
  };
  const record: PaperCanonicalValuationRecord = { ...payload, recordHash: hashCanonicalPayload(payload) };
  assertPaperCanonicalValuationRecord(record);
  return record;
}

const valuationOne = canonicalValuation({ revision: 1, account: entryAccount, fills: [], valuedAt: 100 });
const tradedAccount: PaperAccountRecord = {
  ...structuredClone(entryAccount),
  balances: { [quoteAssetId]: "1010", [positionAssetId]: "0" },
};
const valuationTwo = canonicalValuation({ revision: 2, account: tradedAccount, fills: [buy, sell], valuedAt: 220 });
const valuationThree = canonicalValuation({ revision: 2, account: tradedAccount, fills: [buy, sell], valuedAt: 300 });
const basePerformance = buildPaperArenaPerformance({
  entry,
  valuations: [valuationOne, valuationTwo, valuationThree],
  policy: { policyVersion: "RMT_ARENA_PERFORMANCE_V1", minimumValuations: 3, minimumElapsedMs: 200 },
});
assert.equal(basePerformance.eligibility, "PROVISIONAL");
assert.deepEqual(basePerformance.eligibilityReasons, ["UNCONVERTED_EXTERNAL_COSTS"]);
assert.equal(basePerformance.metrics.returnQuoteAtomicExcludingExternalCosts, "10");
assert.equal(basePerformance.metrics.returnBpsExcludingExternalCosts, "100");
assert.equal(basePerformance.metrics.tradingPnlQuoteAtomicExcludingExternalCosts, "10");

const costBook = valuationThree.valuation.positionBook;
assert.equal(costBook.externalCostEvents.length, 2);
const conversions = costBook.externalCostEvents.map((event) => buildPaperExternalCostConversionEvidence({
  event,
  quoteAssetId,
  quoteEquivalentAtomic: event.kind === "GAS" && event.fillId === "fill-buy" ? "3" : "1",
  sourceId: "verified-historical-native-eth-quote-v1",
  sourceObservedAt: event.occurredAt + 1,
  sourceEvidence: {
    feed: "native-ETH/quote",
    event: `${event.fillId}:${event.kind}`,
    answer: event.fillId === "fill-buy" ? "3" : "1",
    verified: true,
  },
}));
const costValuation = buildPaperExternalCostValuation({
  positionBook: costBook,
  quoteAssetId,
  conversions,
  policy: { policyVersion: "RMT_EXTERNAL_COST_FX_V1", maximumObservationDistanceMs: 10 },
});
assert.equal(costValuation.totalExternalCostQuoteAtomic, "4");

const netPerformance = buildPaperArenaNetPerformance({
  basePerformance,
  externalCostValuations: [costValuation],
});
assert.equal(netPerformance.eligibility, "ELIGIBLE");
assert.deepEqual(netPerformance.eligibilityReasons, []);
assert.equal(netPerformance.metrics.latestGrossLiquidationNavQuoteAtomic, "1010");
assert.equal(netPerformance.metrics.latestExternalCostQuoteAtomic, "4");
assert.equal(netPerformance.metrics.latestNetLiquidationNavQuoteAtomic, "1006");
assert.equal(netPerformance.metrics.netReturnQuoteAtomic, "6");
assert.equal(netPerformance.metrics.netReturnBps, "60");
assert.equal(netPerformance.metrics.grossTradingPnlQuoteAtomicExcludingExternalCosts, "10");
assert.equal(netPerformance.metrics.netTradingPnlQuoteAtomic, "6");
assert.match(netPerformance.netPerformanceHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperArenaNetPerformanceRecord(netPerformance));

assert.throws(
  () => buildPaperArenaNetPerformance({ basePerformance, externalCostValuations: [] }),
  /requires exactly one external-cost valuation/,
);

const wrongBookCost = structuredClone(costValuation);
wrongBookCost.positionBook.bookHash = hashCanonicalPayload({ wrong: true });
assert.throws(
  () => buildPaperArenaNetPerformance({ basePerformance, externalCostValuations: [wrongBookCost] }),
  /position book hash mismatch|does not belong to performance history/,
);

const tampered = structuredClone(netPerformance);
tampered.metrics.netReturnQuoteAtomic = "999";
assert.throws(() => assertPaperArenaNetPerformanceRecord(tampered), /payload mismatch|hash mismatch/);

const noCostBase = buildPaperArenaPerformance({
  entry,
  valuations: [valuationOne, canonicalValuation({ revision: 1, account: entryAccount, fills: [], valuedAt: 220 }), canonicalValuation({ revision: 1, account: entryAccount, fills: [], valuedAt: 300 })],
  policy: { policyVersion: "RMT_ARENA_PERFORMANCE_V1", minimumValuations: 3, minimumElapsedMs: 200 },
});
const noCostNet = buildPaperArenaNetPerformance({ basePerformance: noCostBase });
assert.equal(noCostNet.eligibility, "ELIGIBLE");
assert.equal(noCostNet.metrics.latestExternalCostQuoteAtomic, "0");
assert.equal(noCostNet.metrics.netReturnQuoteAtomic, "0");

console.log("paper-arena-net-performance smoke: ok");
