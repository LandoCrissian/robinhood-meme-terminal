import assert from "node:assert/strict";
import {
  hashPaperQuoteEvidence,
  type PaperAccountRecord,
  type PaperFillRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperLiquidationValuationRecord,
  buildPaperLiquidationValuation,
} from "./paper-liquidation-valuation.ts";
import { buildPaperPositionBook } from "./paper-position-book.ts";
import {
  RmtPaperQuoteService,
  type RmtPaperQuoteReader,
  type RmtPaperQuoteReaderInput,
} from "./rmt-paper-quote.ts";

const accountId = "account-1";
const quoteAddress = "0x1111111111111111111111111111111111111111";
const positionAddress = "0x2222222222222222222222222222222222222222";
const otherAddress = "0x3333333333333333333333333333333333333333";
const quoteAssetId = `eip155:4663/contract:${quoteAddress}`;
const positionAssetId = `eip155:4663/contract:${positionAddress}`;
const nativeEth = "eip155:4663/native";

function fillEvidence(input: {
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
    expiresAt: input.observedAt + 10_000,
  };
  return { ...payload, evidenceHash: hashPaperQuoteEvidence(payload) };
}

function makeFill(input: {
  fillId: string;
  inputAssetId: string;
  outputAssetId: string;
  inputAmountAtomic: string;
  outputAmountAtomic: string;
  filledAt: number;
  gasCostAtomic?: string;
}): PaperFillRecord {
  const quoteEvidence = fillEvidence({
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
    feeAmountAtomic: "0",
    gasAssetId: input.gasCostAtomic ? nativeEth : undefined,
    gasCostAtomic: input.gasCostAtomic ?? "0",
    filledAt: input.filledAt,
    evidenceHash: quoteEvidence.evidenceHash,
    quoteEvidence,
  };
}

class QuoteReader implements RmtPaperQuoteReader {
  readonly sourceId = "rmt-vnext-normalized-quote-reader-v1";
  private readonly payload: unknown;
  constructor(payload: unknown) { this.payload = payload; }
  async compare(_input: RmtPaperQuoteReaderInput): Promise<unknown> { return structuredClone(this.payload); }
}

function quoteResponse(input: {
  inputAddress: string;
  outputAddress: string;
  inputAmountAtomic: string;
  protectedOutputAtomic: string;
  quotedAtMs: number;
}) {
  return {
    requestId: "123e4567-e89b-42d3-a456-426614174000",
    chainId: 4_663,
    inputAsset: input.inputAddress,
    outputAsset: input.outputAddress,
    inputAmountAtomic: input.inputAmountAtomic,
    requestedAtMs: input.quotedAtMs - 50,
    completedAtMs: input.quotedAtMs,
    attempts: [{
      provider: "uniswap-v3",
      adapterVersion: 1,
      status: "indicative",
      chainId: 4_663,
      inputAsset: input.inputAddress,
      outputAsset: input.outputAddress,
      inputAmountAtomic: input.inputAmountAtomic,
      expectedOutputAtomic: input.protectedOutputAtomic,
      protectedOutputAtomic: input.protectedOutputAtomic,
      outputDecimals: 6,
      priceImpact: 0.001,
      quotedAtMs: input.quotedAtMs,
      expiresAtMs: input.quotedAtMs + 5_000,
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

async function liquidationQuote(input: {
  inputAddress?: string;
  inputAmountAtomic?: string;
  protectedOutputAtomic?: string;
  quotedAtMs?: number;
}) {
  const inputAddress = input.inputAddress ?? positionAddress;
  const inputAmountAtomic = input.inputAmountAtomic ?? "100";
  const protectedOutputAtomic = input.protectedOutputAtomic ?? "50";
  const quotedAtMs = input.quotedAtMs ?? 9_900;
  return new RmtPaperQuoteService({
    reader: new QuoteReader(quoteResponse({ inputAddress, outputAddress: quoteAddress, inputAmountAtomic, protectedOutputAtomic, quotedAtMs })),
    policy: { maximumQuoteAgeMs: 5_000, maximumPriceImpactBps: 25 },
  }).quote({
    inputAsset: inputAddress,
    outputAsset: quoteAddress,
    inputAmountAtomic,
    observedAtMs: quotedAtMs,
  });
}

const buy = makeFill({
  fillId: "fill-buy",
  inputAssetId: quoteAssetId,
  outputAssetId: positionAssetId,
  inputAmountAtomic: "40",
  outputAmountAtomic: "100",
  filledAt: 1_000,
  gasCostAtomic: "2",
});
const openBook = buildPaperPositionBook({ accountId, quoteAssetId, fills: [buy] });
const openAccount: PaperAccountRecord = {
  accountId,
  seasonId: "season-1",
  participantType: "AGENT",
  participantId: "agent-1",
  balances: {
    [quoteAssetId]: "960",
    [positionAssetId]: "100",
    [nativeEth]: "999998",
  },
  openedAt: 0,
};
const quote = await liquidationQuote({});
const valuation = buildPaperLiquidationValuation({
  positionBook: openBook,
  account: openAccount,
  quoteResults: [quote],
  valuedAt: 10_000,
  maximumQuoteAgeMs: 500,
});
assert.equal(valuation.quoteBalanceAtomic, "960");
assert.equal(valuation.positionValues.length, 1);
assert.equal(valuation.positionValues[0]?.quantityAtomic, "100");
assert.equal(valuation.positionValues[0]?.costBasisQuoteAtomic, "40");
assert.equal(valuation.positionValues[0]?.liquidationValueQuoteAtomic, "50");
assert.equal(valuation.positionValues[0]?.unrealizedPnlQuoteAtomic, "10");
assert.equal(valuation.liquidationNavQuoteAtomic, "1010");
assert.equal(valuation.realizedPnlQuoteAtomic, "0");
assert.equal(valuation.unrealizedPnlQuoteAtomic, "10");
assert.equal(valuation.totalPnlQuoteAtomicExcludingExternalCosts, "10");
assert.equal(valuation.externalCostsByAsset[nativeEth], "2");
assert.equal(valuation.positionBook.bookHash, openBook.bookHash);
assert.match(valuation.valuationHash, /^0x[0-9a-f]{64}$/);
assert.doesNotThrow(() => assertPaperLiquidationValuationRecord(valuation));

const staleQuote = await liquidationQuote({ quotedAtMs: 8_000 });
assert.throws(
  () => buildPaperLiquidationValuation({ positionBook: openBook, account: openAccount, quoteResults: [staleQuote], valuedAt: 10_000, maximumQuoteAgeMs: 500 }),
  /quote is stale|expired before valuation/,
);

const partialQuote = await liquidationQuote({ inputAmountAtomic: "99" });
assert.throws(
  () => buildPaperLiquidationValuation({ positionBook: openBook, account: openAccount, quoteResults: [partialQuote], valuedAt: 10_000, maximumQuoteAgeMs: 500 }),
  /requires exactly one full-position quote/,
);

const wrongBalance: PaperAccountRecord = {
  ...structuredClone(openAccount),
  balances: { ...structuredClone(openAccount.balances), [positionAssetId]: "99" },
};
assert.throws(
  () => buildPaperLiquidationValuation({ positionBook: openBook, account: wrongBalance, quoteResults: [quote], valuedAt: 10_000, maximumQuoteAgeMs: 500 }),
  /current balance mismatch/,
);

const extraQuote = await liquidationQuote({ inputAddress: otherAddress, inputAmountAtomic: "1", protectedOutputAtomic: "1" });
assert.throws(
  () => buildPaperLiquidationValuation({ positionBook: openBook, account: openAccount, quoteResults: [quote, extraQuote], valuedAt: 10_000, maximumQuoteAgeMs: 500 }),
  /quote for non-open position/,
);

const tampered = structuredClone(valuation);
tampered.positionValues[0]!.liquidationValueQuoteAtomic = "999";
assert.throws(() => assertPaperLiquidationValuationRecord(tampered), /quote does not exactly value|NAV mismatch|valuation hash mismatch/);

const sell = makeFill({
  fillId: "fill-sell",
  inputAssetId: positionAssetId,
  outputAssetId: quoteAssetId,
  inputAmountAtomic: "100",
  outputAmountAtomic: "50",
  filledAt: 2_000,
  gasCostAtomic: "1",
});
const closedBook = buildPaperPositionBook({ accountId, quoteAssetId, fills: [buy, sell] });
const closedAccount: PaperAccountRecord = {
  ...structuredClone(openAccount),
  balances: {
    [quoteAssetId]: "1010",
    [positionAssetId]: "0",
    [nativeEth]: "999997",
  },
};
const closedValuation = buildPaperLiquidationValuation({
  positionBook: closedBook,
  account: closedAccount,
  quoteResults: [],
  valuedAt: 10_000,
  maximumQuoteAgeMs: 500,
});
assert.equal(closedValuation.positionValues.length, 0);
assert.equal(closedValuation.liquidationNavQuoteAtomic, "1010");
assert.equal(closedValuation.realizedPnlQuoteAtomic, "10");
assert.equal(closedValuation.unrealizedPnlQuoteAtomic, "0");
assert.equal(closedValuation.totalPnlQuoteAtomicExcludingExternalCosts, "10");
assert.equal(closedValuation.externalCostsByAsset[nativeEth], "3");
assert.doesNotThrow(() => assertPaperLiquidationValuationRecord(closedValuation));

console.log("paper-liquidation-valuation smoke: ok");
