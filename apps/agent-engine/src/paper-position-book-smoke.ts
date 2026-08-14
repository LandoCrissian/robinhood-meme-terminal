import assert from "node:assert/strict";
import {
  hashPaperQuoteEvidence,
  type PaperFillRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperPositionBookRecord,
  buildPaperPositionBook,
} from "./paper-position-book.ts";

const accountId = "account-1";
const quoteAssetId = "eip155:4663/contract:0x1111111111111111111111111111111111111111";
const positionAssetId = "eip155:4663/contract:0x2222222222222222222222222222222222222222";
const nativeEth = "eip155:4663/native";

function evidence(input: {
  quoteId: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmountAtomic: string;
  outputAmountAtomic: string;
  observedAt: number;
}): VerifiedPaperQuoteEvidence {
  const payload: Omit<VerifiedPaperQuoteEvidence, "evidenceHash"> = {
    quoteId: input.quoteId,
    inputAssetId: input.inputAssetId,
    outputAssetId: input.outputAssetId,
    inputAmountAtomic: input.inputAmountAtomic,
    outputAmountAtomic: input.outputAmountAtomic,
    providerId: "rmt-vnext:uniswap-v3:adapter-v1",
    priceImpactBps: 10,
    observedAt: input.observedAt,
    expiresAt: input.observedAt + 5_000,
  };
  return { ...payload, evidenceHash: hashPaperQuoteEvidence(payload) };
}

function fill(input: {
  fillId: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmountAtomic: string;
  outputAmountAtomic: string;
  filledAt: number;
  gasCostAtomic?: string;
  gasAssetId?: string;
  feeAmountAtomic?: string;
  feeAssetId?: string;
}): PaperFillRecord {
  const quoteEvidence = evidence({
    quoteId: `quote-${input.fillId}`,
    inputAssetId: input.inputAssetId,
    outputAssetId: input.outputAssetId,
    inputAmountAtomic: input.inputAmountAtomic,
    outputAmountAtomic: input.outputAmountAtomic,
    observedAt: input.filledAt,
  });
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
    feeAssetId: input.feeAssetId,
    feeAmountAtomic: input.feeAmountAtomic ?? "0",
    gasAssetId: input.gasAssetId,
    gasCostAtomic: input.gasCostAtomic ?? "0",
    filledAt: input.filledAt,
    evidenceHash: quoteEvidence.evidenceHash,
    quoteEvidence,
  };
}

const buyOne = fill({
  fillId: "fill-1",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  outputAmountAtomic: "100",
  gasAssetId: nativeEth,
  gasCostAtomic: "2",
  filledAt: 1_000,
});
const buyTwo = fill({
  fillId: "fill-2",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "30",
  outputAmountAtomic: "50",
  gasAssetId: nativeEth,
  gasCostAtomic: "3",
  filledAt: 2_000,
});
const sellPartial = fill({
  fillId: "fill-3",
  inputAssetId: positionAssetId,
  outputAssetId: quoteAssetId,
  inputAmountAtomic: "60",
  outputAmountAtomic: "36",
  gasAssetId: nativeEth,
  gasCostAtomic: "1",
  filledAt: 3_000,
});
const sellRest = fill({
  fillId: "fill-4",
  inputAssetId: positionAssetId,
  outputAssetId: quoteAssetId,
  inputAmountAtomic: "90",
  outputAmountAtomic: "54",
  gasAssetId: nativeEth,
  gasCostAtomic: "1",
  filledAt: 4_000,
});

const openBook = buildPaperPositionBook({ accountId, quoteAssetId, fills: [buyTwo, buyOne] });
assert.equal(openBook.positions.length, 1);
assert.equal(openBook.positions[0]?.quantityAtomic, "150");
assert.equal(openBook.positions[0]?.costBasisQuoteAtomic, "70");
assert.equal(openBook.positions[0]?.realizedPnlQuoteAtomic, "0");
assert.equal(openBook.externalCostsByAsset[nativeEth], "5");
assert.doesNotThrow(() => assertPaperPositionBookRecord(openBook));

const partialBook = buildPaperPositionBook({ accountId, quoteAssetId, fills: [sellPartial, buyTwo, buyOne] });
assert.equal(partialBook.positions[0]?.quantityAtomic, "90");
assert.equal(partialBook.positions[0]?.costBasisQuoteAtomic, "42");
assert.equal(partialBook.positions[0]?.realizedPnlQuoteAtomic, "8");
assert.equal(partialBook.totalRealizedPnlQuoteAtomic, "8");
assert.equal(partialBook.externalCostsByAsset[nativeEth], "6");

const closedBook = buildPaperPositionBook({ accountId, quoteAssetId, fills: [sellRest, buyOne, sellPartial, buyTwo] });
assert.equal(closedBook.fillCount, 4);
assert.equal(closedBook.positions[0]?.quantityAtomic, "0");
assert.equal(closedBook.positions[0]?.costBasisQuoteAtomic, "0");
assert.equal(closedBook.positions[0]?.realizedPnlQuoteAtomic, "20");
assert.equal(closedBook.totalRealizedPnlQuoteAtomic, "20");
assert.equal(closedBook.positions[0]?.buyFillCount, 2);
assert.equal(closedBook.positions[0]?.sellFillCount, 2);
assert.equal(closedBook.externalCostsByAsset[nativeEth], "7");
assert.match(closedBook.bookHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperPositionBookRecord(closedBook));

const quoteFeeBuy = fill({
  fillId: "fill-fee",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  outputAmountAtomic: "100",
  feeAssetId: quoteAssetId,
  feeAmountAtomic: "2",
  filledAt: 5_000,
});
const feeBook = buildPaperPositionBook({ accountId, quoteAssetId, fills: [quoteFeeBuy] });
assert.equal(feeBook.positions[0]?.costBasisQuoteAtomic, "42");
assert.deepEqual(feeBook.externalCostsByAsset, {});

const oversell = fill({
  fillId: "fill-oversell",
  inputAssetId: positionAssetId,
  outputAssetId: quoteAssetId,
  inputAmountAtomic: "101",
  outputAmountAtomic: "50",
  filledAt: 6_000,
});
assert.throws(
  () => buildPaperPositionBook({ accountId, quoteAssetId, fills: [buyOne, oversell] }),
  /sell exceeds derived position quantity/,
);

assert.throws(
  () => buildPaperPositionBook({ accountId, quoteAssetId, fills: [buyOne, structuredClone(buyOne)] }),
  /duplicate fillId/,
);

const tamperedEvidence = structuredClone(buyOne);
tamperedEvidence.quoteEvidence.outputAmountAtomic = "101";
assert.throws(
  () => buildPaperPositionBook({ accountId, quoteAssetId, fills: [tamperedEvidence] }),
  /does not match retained quote evidence|evidence hash mismatch/,
);

const positionFee = fill({
  fillId: "fill-position-fee",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  outputAmountAtomic: "100",
  feeAssetId: positionAssetId,
  feeAmountAtomic: "1",
  filledAt: 7_000,
});
assert.throws(
  () => buildPaperPositionBook({ accountId, quoteAssetId, fills: [positionFee] }),
  /does not admit non-zero costs paid in the traded position asset/,
);

const wrongAccount = { ...structuredClone(buyOne), accountId: "account-2" };
assert.throws(
  () => buildPaperPositionBook({ accountId, quoteAssetId, fills: [wrongAccount] }),
  /fill account mismatch/,
);

console.log("paper-position-book smoke: ok");
