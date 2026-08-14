import {
  assertAtomicAmount,
  assertNonEmptyString,
  hashCanonicalPayload,
  type PaperAccountRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperPositionBookRecord,
  type PaperPositionBookRecord,
  type PaperPositionRecord,
} from "./paper-position-book.ts";
import {
  assertRmtPaperQuoteResult,
  type RmtPaperQuoteResult,
} from "./rmt-paper-quote.ts";

export interface PaperPositionLiquidationValue {
  assetId: string;
  quantityAtomic: string;
  costBasisQuoteAtomic: string;
  liquidationValueQuoteAtomic: string;
  unrealizedPnlQuoteAtomic: string;
  quoteResult: RmtPaperQuoteResult;
}

export interface PaperLiquidationValuationRecord {
  schemaVersion: 1;
  accountId: string;
  quoteAssetId: string;
  positionBook: PaperPositionBookRecord;
  accountSnapshot: PaperAccountRecord;
  valuedAt: number;
  maximumQuoteAgeMs: number;
  quoteBalanceAtomic: string;
  positionValues: PaperPositionLiquidationValue[];
  liquidationNavQuoteAtomic: string;
  realizedPnlQuoteAtomic: string;
  unrealizedPnlQuoteAtomic: string;
  totalPnlQuoteAtomicExcludingExternalCosts: string;
  externalCostsByAsset: Record<string, string>;
  valuationHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
}

function assertSignedAtomic(value: string, field: string): void {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") fail(`${field} must be a canonical signed base-10 integer string`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function openPositions(book: PaperPositionBookRecord): PaperPositionRecord[] {
  return book.positions.filter((position) => BigInt(position.quantityAtomic) > 0n);
}

function quoteForPosition(
  position: PaperPositionRecord,
  quoteAssetId: string,
  quoteResults: RmtPaperQuoteResult[],
  valuedAt: number,
  maximumQuoteAgeMs: number,
): RmtPaperQuoteResult {
  const matches = quoteResults.filter((quote) => (
    quote.evidence.inputAssetId === position.assetId
    && quote.evidence.outputAssetId === quoteAssetId
    && quote.evidence.inputAmountAtomic === position.quantityAtomic
  ));
  if (matches.length !== 1) fail(`paper liquidation requires exactly one full-position quote for ${position.assetId}`);
  const quote = matches[0]!;
  assertRmtPaperQuoteResult(quote);
  if (quote.evidence.observedAt > valuedAt) fail("paper liquidation quote is from the future");
  if (valuedAt - quote.evidence.observedAt > maximumQuoteAgeMs) fail("paper liquidation quote is stale");
  if (quote.evidence.expiresAt !== undefined && quote.evidence.expiresAt <= valuedAt) fail("paper liquidation quote expired before valuation");
  return quote;
}

function assertExternalCostsEqual(left: Record<string, string>, right: Record<string, string>): void {
  if (hashCanonicalPayload(left) !== hashCanonicalPayload(right)) fail("paper liquidation external costs differ from position book");
}

export function assertPaperLiquidationValuationRecord(record: PaperLiquidationValuationRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper liquidation valuation schema version");
  assertNonEmptyString(record.accountId, "paper liquidation accountId");
  assertNonEmptyString(record.quoteAssetId, "paper liquidation quoteAssetId");
  assertPaperPositionBookRecord(record.positionBook);
  if (record.positionBook.accountId !== record.accountId || record.positionBook.quoteAssetId !== record.quoteAssetId) {
    fail("paper liquidation position book identity mismatch");
  }
  assertTimestamp(record.valuedAt, "paper liquidation valuedAt");
  assertPositiveSafeInteger(record.maximumQuoteAgeMs, "paper liquidation maximumQuoteAgeMs");
  assertAtomicAmount(record.quoteBalanceAtomic, "paper liquidation quote balance");
  assertAtomicAmount(record.liquidationNavQuoteAtomic, "paper liquidation NAV");
  assertSignedAtomic(record.realizedPnlQuoteAtomic, "paper liquidation realized PnL");
  assertSignedAtomic(record.unrealizedPnlQuoteAtomic, "paper liquidation unrealized PnL");
  assertSignedAtomic(record.totalPnlQuoteAtomicExcludingExternalCosts, "paper liquidation total PnL");
  if (record.accountSnapshot.accountId !== record.accountId) fail("paper liquidation account snapshot mismatch");
  if ((record.accountSnapshot.balances[record.quoteAssetId] ?? "0") !== record.quoteBalanceAtomic) fail("paper liquidation quote balance does not match account snapshot");
  if (record.realizedPnlQuoteAtomic !== record.positionBook.totalRealizedPnlQuoteAtomic) fail("paper liquidation realized PnL differs from position book");
  assertExternalCostsEqual(record.externalCostsByAsset, record.positionBook.externalCostsByAsset);

  const expectedOpen = openPositions(record.positionBook);
  const expectedByAsset = new Map(expectedOpen.map((position) => [position.assetId.toLowerCase(), position]));
  if (record.positionValues.length !== expectedOpen.length) fail("paper liquidation position valuation count differs from open position book");
  const positionIds = new Set<string>();
  let liquidation = BigInt(record.quoteBalanceAtomic);
  let unrealized = 0n;
  for (const position of record.positionValues) {
    assertNonEmptyString(position.assetId, "paper liquidation position assetId");
    const key = position.assetId.toLowerCase();
    if (positionIds.has(key)) fail("paper liquidation contains duplicate position valuation");
    positionIds.add(key);
    const bookPosition = expectedByAsset.get(key);
    if (!bookPosition) fail("paper liquidation contains valuation for non-open position");
    assertAtomicAmount(position.quantityAtomic, "paper liquidation position quantity");
    if (BigInt(position.quantityAtomic) <= 0n) fail("paper liquidation position quantity must be positive");
    assertAtomicAmount(position.costBasisQuoteAtomic, "paper liquidation position cost basis");
    assertAtomicAmount(position.liquidationValueQuoteAtomic, "paper liquidation position value");
    assertSignedAtomic(position.unrealizedPnlQuoteAtomic, "paper liquidation position unrealized PnL");
    if (position.quantityAtomic !== bookPosition.quantityAtomic || position.costBasisQuoteAtomic !== bookPosition.costBasisQuoteAtomic) {
      fail("paper liquidation position differs from position book");
    }
    if ((record.accountSnapshot.balances[position.assetId] ?? "0") !== position.quantityAtomic) fail("paper liquidation position quantity does not match current account balance");
    assertRmtPaperQuoteResult(position.quoteResult);
    if (
      position.quoteResult.evidence.inputAssetId !== position.assetId
      || position.quoteResult.evidence.outputAssetId !== record.quoteAssetId
      || position.quoteResult.evidence.inputAmountAtomic !== position.quantityAtomic
      || position.quoteResult.evidence.outputAmountAtomic !== position.liquidationValueQuoteAtomic
    ) fail("paper liquidation quote does not exactly value the full position");
    if (position.quoteResult.evidence.observedAt > record.valuedAt) fail("paper liquidation retained quote is from the future");
    if (record.valuedAt - position.quoteResult.evidence.observedAt > record.maximumQuoteAgeMs) fail("paper liquidation retained quote is stale");
    if (position.quoteResult.evidence.expiresAt !== undefined && position.quoteResult.evidence.expiresAt <= record.valuedAt) fail("paper liquidation retained quote is expired");
    const expectedUnrealized = BigInt(position.liquidationValueQuoteAtomic) - BigInt(position.costBasisQuoteAtomic);
    if (position.unrealizedPnlQuoteAtomic !== expectedUnrealized.toString()) fail("paper liquidation position unrealized PnL mismatch");
    liquidation += BigInt(position.liquidationValueQuoteAtomic);
    unrealized += expectedUnrealized;
  }
  if (record.liquidationNavQuoteAtomic !== liquidation.toString()) fail("paper liquidation NAV mismatch");
  if (record.unrealizedPnlQuoteAtomic !== unrealized.toString()) fail("paper liquidation unrealized PnL mismatch");
  const expectedTotal = BigInt(record.realizedPnlQuoteAtomic) + unrealized;
  if (record.totalPnlQuoteAtomicExcludingExternalCosts !== expectedTotal.toString()) fail("paper liquidation total PnL mismatch");
  for (const [assetId, amount] of Object.entries(record.externalCostsByAsset)) {
    assertNonEmptyString(assetId, "paper liquidation external cost assetId");
    assertAtomicAmount(amount, "paper liquidation external cost amount");
  }
  assertHash(record.valuationHash, "paper liquidation valuationHash");
  const { valuationHash, ...payload } = record;
  if (valuationHash !== hashCanonicalPayload(payload)) fail("paper liquidation valuation hash mismatch");
}

export function buildPaperLiquidationValuation(input: {
  positionBook: PaperPositionBookRecord;
  account: PaperAccountRecord;
  quoteResults: RmtPaperQuoteResult[];
  valuedAt?: number;
  maximumQuoteAgeMs: number;
}): PaperLiquidationValuationRecord {
  assertPaperPositionBookRecord(input.positionBook);
  if (input.account.accountId !== input.positionBook.accountId) fail("paper liquidation account does not match position book");
  assertPositiveSafeInteger(input.maximumQuoteAgeMs, "paper liquidation maximumQuoteAgeMs");
  const valuedAt = input.valuedAt ?? Date.now();
  assertTimestamp(valuedAt, "paper liquidation valuedAt");
  const quoteBalance = input.account.balances[input.positionBook.quoteAssetId] ?? "0";
  assertAtomicAmount(quoteBalance, "paper liquidation quote balance");
  const open = openPositions(input.positionBook);
  const expectedAssets = new Set(open.map((position) => position.assetId.toLowerCase()));
  for (const quote of input.quoteResults) {
    assertRmtPaperQuoteResult(quote);
    if (!expectedAssets.has(quote.evidence.inputAssetId.toLowerCase())) fail("paper liquidation received quote for non-open position");
  }
  const quoteKeys = new Set(input.quoteResults.map((quote) => `${quote.evidence.inputAssetId.toLowerCase()}:${quote.evidence.inputAmountAtomic}`));
  if (quoteKeys.size !== input.quoteResults.length) fail("paper liquidation contains duplicate position quote evidence");

  const positionValues = open.map((position): PaperPositionLiquidationValue => {
    if ((input.account.balances[position.assetId] ?? "0") !== position.quantityAtomic) {
      fail(`paper liquidation current balance mismatch for ${position.assetId}`);
    }
    const quote = quoteForPosition(position, input.positionBook.quoteAssetId, input.quoteResults, valuedAt, input.maximumQuoteAgeMs);
    const liquidationValue = quote.evidence.outputAmountAtomic;
    const unrealized = BigInt(liquidationValue) - BigInt(position.costBasisQuoteAtomic);
    return {
      assetId: position.assetId,
      quantityAtomic: position.quantityAtomic,
      costBasisQuoteAtomic: position.costBasisQuoteAtomic,
      liquidationValueQuoteAtomic: liquidationValue,
      unrealizedPnlQuoteAtomic: unrealized.toString(),
      quoteResult: structuredClone(quote),
    };
  });
  if (positionValues.length !== input.quoteResults.length) fail("paper liquidation requires one quote for every open position and no extras");
  const liquidationNav = positionValues.reduce((sum, position) => sum + BigInt(position.liquidationValueQuoteAtomic), BigInt(quoteBalance));
  const unrealized = positionValues.reduce((sum, position) => sum + BigInt(position.unrealizedPnlQuoteAtomic), 0n);
  const realized = BigInt(input.positionBook.totalRealizedPnlQuoteAtomic);
  const payload: Omit<PaperLiquidationValuationRecord, "valuationHash"> = {
    schemaVersion: 1,
    accountId: input.account.accountId,
    quoteAssetId: input.positionBook.quoteAssetId,
    positionBook: structuredClone(input.positionBook),
    accountSnapshot: structuredClone(input.account),
    valuedAt,
    maximumQuoteAgeMs: input.maximumQuoteAgeMs,
    quoteBalanceAtomic: quoteBalance,
    positionValues,
    liquidationNavQuoteAtomic: liquidationNav.toString(),
    realizedPnlQuoteAtomic: realized.toString(),
    unrealizedPnlQuoteAtomic: unrealized.toString(),
    totalPnlQuoteAtomicExcludingExternalCosts: (realized + unrealized).toString(),
    externalCostsByAsset: structuredClone(input.positionBook.externalCostsByAsset),
  };
  const record: PaperLiquidationValuationRecord = { ...payload, valuationHash: hashCanonicalPayload(payload) };
  assertPaperLiquidationValuationRecord(record);
  return record;
}
