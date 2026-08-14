import {
  assertNonEmptyString,
  assertPositiveAtomicAmount,
  hashCanonicalPayload,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperPositionBookRecord,
  type PaperExternalCostEvent,
  type PaperPositionBookRecord,
} from "./paper-position-book.ts";

export interface PaperExternalCostConversionEvidence {
  fillId: string;
  kind: "FEE" | "GAS";
  assetId: string;
  amountAtomic: string;
  quoteAssetId: string;
  quoteEquivalentAtomic: string;
  sourceId: string;
  sourceObservedAt: number;
  sourceEvidence: Record<string, string | number | boolean>;
  sourceEvidenceHash: string;
  evidenceHash: string;
}

export interface PaperExternalCostValuationPolicy {
  policyVersion: string;
  maximumObservationDistanceMs: number;
}

export interface PaperExternalCostValuationRecord {
  schemaVersion: 1;
  policy: PaperExternalCostValuationPolicy;
  positionBook: PaperPositionBookRecord;
  quoteAssetId: string;
  conversions: PaperExternalCostConversionEvidence[];
  totalExternalCostQuoteAtomic: string;
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

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function eventKey(event: Pick<PaperExternalCostEvent, "fillId" | "kind">): string {
  return `${event.fillId}:${event.kind}`;
}

function assertSourceEvidence(value: Record<string, string | number | boolean>): void {
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 32) fail("paper external cost source evidence requires 1 to 32 fields");
  for (const [key, field] of entries) {
    assertNonEmptyString(key, "paper external cost source evidence key");
    if (key.length > 128) fail("paper external cost source evidence key exceeds 128 characters");
    if (typeof field === "string") {
      if (!field.trim() || field.length > 512) fail("paper external cost source evidence string is invalid");
    } else if (typeof field === "number") {
      if (!Number.isFinite(field)) fail("paper external cost source evidence number must be finite");
    } else if (typeof field !== "boolean") {
      fail("paper external cost source evidence value type is unsupported");
    }
  }
}

function assertConversionEvidence(evidence: PaperExternalCostConversionEvidence, policy: PaperExternalCostValuationPolicy): void {
  assertNonEmptyString(evidence.fillId, "paper external cost fillId");
  if (evidence.kind !== "FEE" && evidence.kind !== "GAS") fail("paper external cost kind is invalid");
  assertNonEmptyString(evidence.assetId, "paper external cost assetId");
  assertPositiveAtomicAmount(evidence.amountAtomic, "paper external cost amountAtomic");
  assertNonEmptyString(evidence.quoteAssetId, "paper external cost quoteAssetId");
  if (evidence.assetId.toLowerCase() === evidence.quoteAssetId.toLowerCase()) fail("paper external cost conversion requires a non-quote source asset");
  assertPositiveAtomicAmount(evidence.quoteEquivalentAtomic, "paper external cost quoteEquivalentAtomic");
  assertNonEmptyString(evidence.sourceId, "paper external cost sourceId");
  assertTimestamp(evidence.sourceObservedAt, "paper external cost sourceObservedAt");
  assertSourceEvidence(evidence.sourceEvidence);
  assertHash(evidence.sourceEvidenceHash, "paper external cost sourceEvidenceHash");
  if (evidence.sourceEvidenceHash !== hashCanonicalPayload(evidence.sourceEvidence)) fail("paper external cost source evidence hash mismatch");
  assertHash(evidence.evidenceHash, "paper external cost evidenceHash");
  const { evidenceHash, ...payload } = evidence;
  if (evidenceHash !== hashCanonicalPayload(payload)) fail("paper external cost conversion evidence hash mismatch");
  assertPositiveSafeInteger(policy.maximumObservationDistanceMs, "paper external cost maximumObservationDistanceMs");
}

function matchEvent(
  evidence: PaperExternalCostConversionEvidence,
  events: PaperExternalCostEvent[],
  quoteAssetId: string,
  policy: PaperExternalCostValuationPolicy,
): PaperExternalCostEvent {
  const matches = events.filter((event) => eventKey(event) === eventKey(evidence));
  if (matches.length !== 1) fail("paper external cost evidence does not match exactly one cost event");
  const event = matches[0]!;
  if (
    evidence.assetId !== event.assetId
    || evidence.amountAtomic !== event.amountAtomic
    || evidence.quoteAssetId !== quoteAssetId
  ) fail("paper external cost evidence differs from cost event");
  const distance = Math.abs(evidence.sourceObservedAt - event.occurredAt);
  if (distance > policy.maximumObservationDistanceMs) fail("paper external cost source observation is too far from cost event");
  return event;
}

export function buildPaperExternalCostConversionEvidence(input: {
  event: PaperExternalCostEvent;
  quoteAssetId: string;
  quoteEquivalentAtomic: string;
  sourceId: string;
  sourceObservedAt: number;
  sourceEvidence: Record<string, string | number | boolean>;
}): PaperExternalCostConversionEvidence {
  assertNonEmptyString(input.quoteAssetId, "paper external cost quoteAssetId");
  assertPositiveAtomicAmount(input.quoteEquivalentAtomic, "paper external cost quoteEquivalentAtomic");
  assertNonEmptyString(input.sourceId, "paper external cost sourceId");
  assertTimestamp(input.sourceObservedAt, "paper external cost sourceObservedAt");
  assertSourceEvidence(input.sourceEvidence);
  const sourceEvidenceHash = hashCanonicalPayload(input.sourceEvidence);
  const payload: Omit<PaperExternalCostConversionEvidence, "evidenceHash"> = {
    fillId: input.event.fillId,
    kind: input.event.kind,
    assetId: input.event.assetId,
    amountAtomic: input.event.amountAtomic,
    quoteAssetId: input.quoteAssetId,
    quoteEquivalentAtomic: input.quoteEquivalentAtomic,
    sourceId: input.sourceId,
    sourceObservedAt: input.sourceObservedAt,
    sourceEvidence: structuredClone(input.sourceEvidence),
    sourceEvidenceHash,
  };
  return { ...payload, evidenceHash: hashCanonicalPayload(payload) };
}

export function assertPaperExternalCostValuationRecord(record: PaperExternalCostValuationRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper external cost valuation schema version");
  assertNonEmptyString(record.policy.policyVersion, "paper external cost policyVersion");
  assertPositiveSafeInteger(record.policy.maximumObservationDistanceMs, "paper external cost maximumObservationDistanceMs");
  assertPaperPositionBookRecord(record.positionBook);
  assertNonEmptyString(record.quoteAssetId, "paper external cost quoteAssetId");
  if (record.positionBook.quoteAssetId !== record.quoteAssetId) fail("paper external cost quote asset differs from position book");
  if (record.conversions.length !== record.positionBook.externalCostEvents.length) fail("paper external cost valuation requires one conversion per external cost event");
  const seen = new Set<string>();
  let total = 0n;
  for (const evidence of record.conversions) {
    assertConversionEvidence(evidence, record.policy);
    const key = eventKey(evidence);
    if (seen.has(key)) fail("paper external cost valuation contains duplicate conversion event");
    seen.add(key);
    matchEvent(evidence, record.positionBook.externalCostEvents, record.quoteAssetId, record.policy);
    total += BigInt(evidence.quoteEquivalentAtomic);
  }
  if (seen.size !== record.positionBook.externalCostEvents.length) fail("paper external cost valuation omitted an external cost event");
  assertPositiveAtomicAmount(record.totalExternalCostQuoteAtomic === "0" ? "1" : record.totalExternalCostQuoteAtomic, "paper external cost total validation sentinel");
  if (!/^(0|[1-9]\d*)$/.test(record.totalExternalCostQuoteAtomic)) fail("paper external cost total must be an unsigned integer string");
  if (record.totalExternalCostQuoteAtomic !== total.toString()) fail("paper external cost total mismatch");
  assertHash(record.valuationHash, "paper external cost valuationHash");
  const { valuationHash, ...payload } = record;
  if (valuationHash !== hashCanonicalPayload(payload)) fail("paper external cost valuation hash mismatch");
}

export function buildPaperExternalCostValuation(input: {
  positionBook: PaperPositionBookRecord;
  quoteAssetId: string;
  conversions: PaperExternalCostConversionEvidence[];
  policy: PaperExternalCostValuationPolicy;
}): PaperExternalCostValuationRecord {
  assertPaperPositionBookRecord(input.positionBook);
  assertNonEmptyString(input.policy.policyVersion, "paper external cost policyVersion");
  assertPositiveSafeInteger(input.policy.maximumObservationDistanceMs, "paper external cost maximumObservationDistanceMs");
  if (input.positionBook.quoteAssetId !== input.quoteAssetId) fail("paper external cost quote asset differs from position book");
  const conversions = input.conversions.map((evidence) => structuredClone(evidence));
  if (conversions.length !== input.positionBook.externalCostEvents.length) fail("paper external cost valuation requires one conversion per external cost event");
  const seen = new Set<string>();
  let total = 0n;
  for (const evidence of conversions) {
    assertConversionEvidence(evidence, input.policy);
    const key = eventKey(evidence);
    if (seen.has(key)) fail("paper external cost valuation contains duplicate conversion event");
    seen.add(key);
    matchEvent(evidence, input.positionBook.externalCostEvents, input.quoteAssetId, input.policy);
    total += BigInt(evidence.quoteEquivalentAtomic);
  }
  if (seen.size !== input.positionBook.externalCostEvents.length) fail("paper external cost valuation omitted an external cost event");
  conversions.sort((left, right) => left.sourceObservedAt - right.sourceObservedAt || eventKey(left).localeCompare(eventKey(right)));
  const payload: Omit<PaperExternalCostValuationRecord, "valuationHash"> = {
    schemaVersion: 1,
    policy: structuredClone(input.policy),
    positionBook: structuredClone(input.positionBook),
    quoteAssetId: input.quoteAssetId,
    conversions,
    totalExternalCostQuoteAtomic: total.toString(),
  };
  const record: PaperExternalCostValuationRecord = { ...payload, valuationHash: hashCanonicalPayload(payload) };
  assertPaperExternalCostValuationRecord(record);
  return record;
}
