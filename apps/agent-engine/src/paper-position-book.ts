import {
  assertAtomicAmount,
  assertNonEmptyString,
  assertPositiveAtomicAmount,
  hashCanonicalPayload,
  hashPaperQuoteEvidence,
  type PaperFillRecord,
} from "../../../packages/agent-core/src/index.ts";

export interface PaperPositionRecord {
  assetId: string;
  quantityAtomic: string;
  costBasisQuoteAtomic: string;
  realizedPnlQuoteAtomic: string;
  buyFillCount: number;
  sellFillCount: number;
}

export interface PaperExternalCostEvent {
  fillId: string;
  kind: "FEE" | "GAS";
  assetId: string;
  amountAtomic: string;
  occurredAt: number;
}

export interface PaperPositionBookRecord {
  schemaVersion: 1;
  accountId: string;
  quoteAssetId: string;
  fillCount: number;
  positions: PaperPositionRecord[];
  totalRealizedPnlQuoteAtomic: string;
  externalCostEvents: PaperExternalCostEvent[];
  externalCostsByAsset: Record<string, string>;
  bookHash: string;
}

type MutablePosition = {
  assetId: string;
  quantity: bigint;
  costBasis: bigint;
  realizedPnl: bigint;
  buyFillCount: number;
  sellFillCount: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function assertSignedAtomic(value: string, field: string): void {
  if (!/^-?(0|[1-9]\d*)$/.test(value) || value === "-0") fail(`${field} must be a canonical signed base-10 integer string`);
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertFillEvidence(fill: PaperFillRecord): void {
  assertNonEmptyString(fill.fillId, "paper position fillId");
  assertNonEmptyString(fill.orderId, "paper position orderId");
  assertNonEmptyString(fill.quoteId, "paper position quoteId");
  assertNonEmptyString(fill.accountId, "paper position accountId");
  assertNonEmptyString(fill.inputAssetId, "paper position inputAssetId");
  assertNonEmptyString(fill.outputAssetId, "paper position outputAssetId");
  if (fill.inputAssetId.toLowerCase() === fill.outputAssetId.toLowerCase()) fail("paper position fill assets must differ");
  assertPositiveAtomicAmount(fill.inputAmountAtomic, "paper position input amount");
  assertPositiveAtomicAmount(fill.outputAmountAtomic, "paper position output amount");
  assertAtomicAmount(fill.feeAmountAtomic, "paper position fee amount");
  assertAtomicAmount(fill.gasCostAtomic, "paper position gas amount");
  assertNonNegativeSafeInteger(fill.filledAt, "paper position filledAt");
  if (BigInt(fill.feeAmountAtomic) > 0n && !fill.feeAssetId) fail("paper position non-zero fee requires fee asset");
  if (BigInt(fill.gasCostAtomic) > 0n && !fill.gasAssetId) fail("paper position non-zero gas requires gas asset");
  const evidence = fill.quoteEvidence;
  if (
    evidence.quoteId !== fill.quoteId
    || evidence.inputAssetId !== fill.inputAssetId
    || evidence.outputAssetId !== fill.outputAssetId
    || evidence.inputAmountAtomic !== fill.inputAmountAtomic
    || evidence.outputAmountAtomic !== fill.outputAmountAtomic
    || evidence.providerId !== fill.providerId
    || evidence.observedAt !== fill.filledAt
    || evidence.evidenceHash !== fill.evidenceHash
  ) fail("paper position fill does not match retained quote evidence");
  const { evidenceHash, ...payload } = evidence;
  if (evidenceHash !== hashPaperQuoteEvidence(payload)) fail("paper position quote evidence hash mismatch");
}

function addCost(input: {
  aggregate: Map<string, bigint>;
  events: PaperExternalCostEvent[];
  fill: PaperFillRecord;
  kind: "FEE" | "GAS";
  assetId: string | undefined;
  amount: string;
  quoteAssetId: string;
  positionAssetId: string;
}): bigint {
  const value = BigInt(input.amount);
  if (value === 0n) return 0n;
  if (!input.assetId) fail("paper position non-zero cost omitted asset");
  assertNonEmptyString(input.assetId, "paper position cost assetId");
  if (input.assetId.toLowerCase() === input.positionAssetId.toLowerCase()) {
    fail("paper position v1 does not admit non-zero costs paid in the traded position asset");
  }
  if (input.assetId.toLowerCase() === input.quoteAssetId.toLowerCase()) return value;
  input.aggregate.set(input.assetId, (input.aggregate.get(input.assetId) ?? 0n) + value);
  input.events.push({
    fillId: input.fill.fillId,
    kind: input.kind,
    assetId: input.assetId,
    amountAtomic: input.amount,
    occurredAt: input.fill.filledAt,
  });
  return 0n;
}

function positionFor(positions: Map<string, MutablePosition>, assetId: string): MutablePosition {
  const key = assetId.toLowerCase();
  let position = positions.get(key);
  if (!position) {
    position = { assetId, quantity: 0n, costBasis: 0n, realizedPnl: 0n, buyFillCount: 0, sellFillCount: 0 };
    positions.set(key, position);
  }
  return position;
}

export function assertPaperPositionBookRecord(record: PaperPositionBookRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper position book schema version");
  assertNonEmptyString(record.accountId, "paper position book accountId");
  assertNonEmptyString(record.quoteAssetId, "paper position book quoteAssetId");
  assertNonNegativeSafeInteger(record.fillCount, "paper position book fillCount");
  assertSignedAtomic(record.totalRealizedPnlQuoteAtomic, "paper position total realized PnL");
  const identities = new Set<string>();
  let realized = 0n;
  for (const position of record.positions) {
    assertNonEmptyString(position.assetId, "paper position assetId");
    const key = position.assetId.toLowerCase();
    if (key === record.quoteAssetId.toLowerCase()) fail("paper position book cannot contain quote asset as a position");
    if (identities.has(key)) fail("paper position book contains duplicate position asset");
    identities.add(key);
    assertAtomicAmount(position.quantityAtomic, "paper position quantity");
    assertAtomicAmount(position.costBasisQuoteAtomic, "paper position cost basis");
    assertSignedAtomic(position.realizedPnlQuoteAtomic, "paper position realized PnL");
    assertNonNegativeSafeInteger(position.buyFillCount, "paper position buyFillCount");
    assertNonNegativeSafeInteger(position.sellFillCount, "paper position sellFillCount");
    if (position.quantityAtomic === "0" && position.costBasisQuoteAtomic !== "0") fail("closed paper position must have zero remaining cost basis");
    realized += BigInt(position.realizedPnlQuoteAtomic);
  }
  if (realized.toString() !== record.totalRealizedPnlQuoteAtomic) fail("paper position total realized PnL mismatch");

  const eventKeys = new Set<string>();
  const eventTotals = new Map<string, bigint>();
  for (const event of record.externalCostEvents) {
    assertNonEmptyString(event.fillId, "paper position external cost fillId");
    if (event.kind !== "FEE" && event.kind !== "GAS") fail("paper position external cost kind is invalid");
    assertNonEmptyString(event.assetId, "paper position external cost assetId");
    if (event.assetId.toLowerCase() === record.quoteAssetId.toLowerCase()) fail("quote-denominated cost cannot be an external cost event");
    assertPositiveAtomicAmount(event.amountAtomic, "paper position external cost amount");
    assertNonNegativeSafeInteger(event.occurredAt, "paper position external cost occurredAt");
    const eventKey = `${event.fillId}:${event.kind}`;
    if (eventKeys.has(eventKey)) fail("paper position contains duplicate external cost event");
    eventKeys.add(eventKey);
    eventTotals.set(event.assetId, (eventTotals.get(event.assetId) ?? 0n) + BigInt(event.amountAtomic));
  }
  const aggregateEntries = Object.entries(record.externalCostsByAsset).sort(([left], [right]) => left.localeCompare(right));
  for (const [assetId, amount] of aggregateEntries) {
    assertNonEmptyString(assetId, "paper position external cost assetId");
    if (assetId.toLowerCase() === record.quoteAssetId.toLowerCase()) fail("quote-denominated costs must be reflected in position PnL, not external costs");
    assertAtomicAmount(amount, "paper position external cost amount");
    if ((eventTotals.get(assetId) ?? 0n).toString() !== amount) fail("paper position external cost aggregate differs from events");
  }
  if (eventTotals.size !== aggregateEntries.length) fail("paper position external cost events contain unaggregated asset");
  if (!/^0x[0-9a-f]{64}$/.test(record.bookHash)) fail("paper position bookHash must be a sha256 hex hash");
  const { bookHash, ...payload } = record;
  if (bookHash !== hashCanonicalPayload(payload)) fail("paper position book hash mismatch");
}

export function buildPaperPositionBook(input: {
  accountId: string;
  quoteAssetId: string;
  fills: PaperFillRecord[];
}): PaperPositionBookRecord {
  assertNonEmptyString(input.accountId, "paper position accountId");
  assertNonEmptyString(input.quoteAssetId, "paper position quoteAssetId");
  const quoteKey = input.quoteAssetId.toLowerCase();
  const positions = new Map<string, MutablePosition>();
  const externalCosts = new Map<string, bigint>();
  const externalCostEvents: PaperExternalCostEvent[] = [];
  const fills = [...input.fills].sort((left, right) => left.filledAt - right.filledAt || left.fillId.localeCompare(right.fillId));
  const fillIds = new Set<string>();

  for (const fill of fills) {
    assertFillEvidence(fill);
    if (fill.accountId !== input.accountId) fail("paper position fill account mismatch");
    if (fillIds.has(fill.fillId)) fail("paper position book contains duplicate fillId");
    fillIds.add(fill.fillId);
    const inputIsQuote = fill.inputAssetId.toLowerCase() === quoteKey;
    const outputIsQuote = fill.outputAssetId.toLowerCase() === quoteKey;
    if (inputIsQuote === outputIsQuote) fail("paper position fill must exchange exactly one quote asset side");
    const positionAssetId = inputIsQuote ? fill.outputAssetId : fill.inputAssetId;
    const position = positionFor(positions, positionAssetId);
    const quoteFee = addCost({ aggregate: externalCosts, events: externalCostEvents, fill, kind: "FEE", assetId: fill.feeAssetId, amount: fill.feeAmountAtomic, quoteAssetId: input.quoteAssetId, positionAssetId });
    const quoteGas = addCost({ aggregate: externalCosts, events: externalCostEvents, fill, kind: "GAS", assetId: fill.gasAssetId, amount: fill.gasCostAtomic, quoteAssetId: input.quoteAssetId, positionAssetId });
    const quoteCosts = quoteFee + quoteGas;

    if (inputIsQuote) {
      position.quantity += BigInt(fill.outputAmountAtomic);
      position.costBasis += BigInt(fill.inputAmountAtomic) + quoteCosts;
      position.buyFillCount += 1;
      continue;
    }

    const quantitySold = BigInt(fill.inputAmountAtomic);
    if (quantitySold > position.quantity) fail("paper position sell exceeds derived position quantity");
    const grossProceeds = BigInt(fill.outputAmountAtomic);
    if (quoteCosts > grossProceeds) fail("paper position quote-denominated sell costs exceed proceeds");
    const allocatedCost = quantitySold === position.quantity
      ? position.costBasis
      : position.costBasis * quantitySold / position.quantity;
    const netProceeds = grossProceeds - quoteCosts;
    position.quantity -= quantitySold;
    position.costBasis -= allocatedCost;
    position.realizedPnl += netProceeds - allocatedCost;
    position.sellFillCount += 1;
    if (position.quantity === 0n && position.costBasis !== 0n) fail("paper position close left non-zero cost basis");
  }

  const positionRecords = [...positions.values()]
    .sort((left, right) => left.assetId.localeCompare(right.assetId))
    .map((position): PaperPositionRecord => ({
      assetId: position.assetId,
      quantityAtomic: position.quantity.toString(),
      costBasisQuoteAtomic: position.costBasis.toString(),
      realizedPnlQuoteAtomic: position.realizedPnl.toString(),
      buyFillCount: position.buyFillCount,
      sellFillCount: position.sellFillCount,
    }));
  const totalRealized = positionRecords.reduce((sum, position) => sum + BigInt(position.realizedPnlQuoteAtomic), 0n);
  const externalCostsByAsset = Object.fromEntries([...externalCosts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([assetId, amount]) => [assetId, amount.toString()]));
  externalCostEvents.sort((left, right) => left.occurredAt - right.occurredAt || left.fillId.localeCompare(right.fillId) || left.kind.localeCompare(right.kind));
  const payload: Omit<PaperPositionBookRecord, "bookHash"> = {
    schemaVersion: 1,
    accountId: input.accountId,
    quoteAssetId: input.quoteAssetId,
    fillCount: fills.length,
    positions: positionRecords,
    totalRealizedPnlQuoteAtomic: totalRealized.toString(),
    externalCostEvents,
    externalCostsByAsset,
  };
  const record: PaperPositionBookRecord = { ...payload, bookHash: hashCanonicalPayload(payload) };
  assertPaperPositionBookRecord(record);
  return record;
}
