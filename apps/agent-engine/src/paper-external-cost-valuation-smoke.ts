import assert from "node:assert/strict";
import {
  hashPaperQuoteEvidence,
  type PaperFillRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperExternalCostValuationRecord,
  buildPaperExternalCostConversionEvidence,
  buildPaperExternalCostValuation,
} from "./paper-external-cost-valuation.ts";
import { buildPaperPositionBook } from "./paper-position-book.ts";

const accountId = "account-1";
const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const positionAssetId = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const nativeEth = "eip155:4663/native";

function quoteEvidence(): VerifiedPaperQuoteEvidence {
  const payload: Omit<VerifiedPaperQuoteEvidence, "evidenceHash"> = {
    quoteId: "quote-1",
    inputAssetId: quoteAssetId,
    outputAssetId: positionAssetId,
    inputAmountAtomic: "40",
    outputAmountAtomic: "100",
    providerId: "rmt-vnext:uniswap-v3:adapter-v1",
    priceImpactBps: 10,
    observedAt: 1_000,
    expiresAt: 10_000,
  };
  return { ...payload, evidenceHash: hashPaperQuoteEvidence(payload) };
}

const evidence = quoteEvidence();
const fill: PaperFillRecord = {
  fillId: "fill-1",
  orderId: "order-1",
  quoteId: evidence.quoteId,
  agentId: "agent-1",
  accountId,
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  outputAmountAtomic: "100",
  providerId: evidence.providerId,
  feeAmountAtomic: "0",
  gasAssetId: nativeEth,
  gasCostAtomic: "21000000000000",
  filledAt: 1_000,
  evidenceHash: evidence.evidenceHash,
  quoteEvidence: evidence,
};
const book = buildPaperPositionBook({ accountId, quoteAssetId, fills: [fill] });
assert.equal(book.externalCostEvents.length, 1);
assert.equal(book.externalCostEvents[0]?.kind, "GAS");
assert.equal(book.externalCostsByAsset[nativeEth], "21000000000000");
const event = book.externalCostEvents[0]!;
const policy = { policyVersion: "RMT_EXTERNAL_COST_FX_V1", maximumObservationDistanceMs: 2_000 };
const conversion = buildPaperExternalCostConversionEvidence({
  event,
  quoteAssetId,
  quoteEquivalentAtomic: "75",
  sourceId: "verified-historical-eth-usd-v1",
  sourceObservedAt: 1_250,
  sourceEvidence: {
    feed: "ETH/USD",
    roundId: "123456",
    answer: "3571428571",
    decimals: 8,
    verified: true,
  },
});
const valuation = buildPaperExternalCostValuation({
  positionBook: book,
  quoteAssetId,
  conversions: [conversion],
  policy,
});
assert.equal(valuation.totalExternalCostQuoteAtomic, "75");
assert.equal(valuation.conversions.length, 1);
assert.equal(valuation.conversions[0]?.fillId, "fill-1");
assert.match(valuation.valuationHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperExternalCostValuationRecord(valuation));

assert.throws(
  () => buildPaperExternalCostValuation({ positionBook: book, quoteAssetId, conversions: [], policy }),
  /requires one conversion per external cost event/,
);

const wrongAmount = { ...structuredClone(conversion), amountAtomic: "1" };
assert.throws(
  () => buildPaperExternalCostValuation({ positionBook: book, quoteAssetId, conversions: [wrongAmount], policy }),
  /conversion evidence hash mismatch|differs from cost event/,
);

const wrongAsset = { ...structuredClone(conversion), assetId: "eip155:4663/native-wrong" };
assert.throws(
  () => buildPaperExternalCostValuation({ positionBook: book, quoteAssetId, conversions: [wrongAsset], policy }),
  /conversion evidence hash mismatch|differs from cost event/,
);

const farConversion = buildPaperExternalCostConversionEvidence({
  event,
  quoteAssetId,
  quoteEquivalentAtomic: "75",
  sourceId: "verified-historical-eth-usd-v1",
  sourceObservedAt: 10_000,
  sourceEvidence: { feed: "ETH/USD", roundId: "later", answer: "3571428571", decimals: 8 },
});
assert.throws(
  () => buildPaperExternalCostValuation({ positionBook: book, quoteAssetId, conversions: [farConversion], policy }),
  /observation is too far from cost event/,
);

const tamperedSource = structuredClone(conversion);
tamperedSource.sourceEvidence.answer = "9999999999";
assert.throws(
  () => buildPaperExternalCostValuation({ positionBook: book, quoteAssetId, conversions: [tamperedSource], policy }),
  /source evidence hash mismatch/,
);

const duplicated = [structuredClone(conversion), structuredClone(conversion)];
assert.throws(
  () => buildPaperExternalCostValuation({ positionBook: book, quoteAssetId, conversions: duplicated, policy }),
  /requires one conversion per external cost event|duplicate conversion event/,
);

const noCostFill: PaperFillRecord = { ...structuredClone(fill), fillId: "fill-2", gasAssetId: undefined, gasCostAtomic: "0" };
const noCostBook = buildPaperPositionBook({ accountId, quoteAssetId, fills: [noCostFill] });
const zeroValuation = buildPaperExternalCostValuation({ positionBook: noCostBook, quoteAssetId, conversions: [], policy });
assert.equal(zeroValuation.totalExternalCostQuoteAtomic, "0");
assert.deepEqual(zeroValuation.conversions, []);
assert.doesNotThrow(() => assertPaperExternalCostValuationRecord(zeroValuation));

const tamperedTotal = structuredClone(valuation);
tamperedTotal.totalExternalCostQuoteAtomic = "74";
assert.throws(() => assertPaperExternalCostValuationRecord(tamperedTotal), /total mismatch|valuation hash mismatch/);

console.log("paper-external-cost-valuation smoke: ok");
