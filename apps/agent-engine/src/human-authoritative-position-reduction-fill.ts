import {
  assertAtomicAmount,
  hashCanonicalPayload,
  type HumanPaperFillRecord,
  type PaperExecutionCosts,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertHumanAuthoritativePositionReductionSubmissionRecord,
  type HumanAuthoritativePositionReductionSubmissionRecord,
} from "./human-authoritative-position-reduction-submission.ts";
import type { HumanPaperFillWriter } from "./human-paper-fill-orchestration.ts";
import {
  assertPaperFillCostPlan,
  type PaperFillCostPlan,
} from "./paper-fill-cost.ts";
import {
  assertRmtPaperQuoteResult,
  type RmtPaperQuoteResult,
} from "./rmt-paper-quote.ts";

export interface HumanAuthoritativePositionReductionFillRecord {
  schemaVersion: 1;
  submission: HumanAuthoritativePositionReductionSubmissionRecord;
  quoteResult: RmtPaperQuoteResult;
  costPlan: PaperFillCostPlan;
  idempotencyKey: string;
  fill: HumanPaperFillRecord;
  recordHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertQuote(
  submission: HumanAuthoritativePositionReductionSubmissionRecord,
  quote: RmtPaperQuoteResult,
): void {
  assertRmtPaperQuoteResult(quote);
  const order = submission.order;
  const reduction = submission.reduction;
  if (order.status !== "PENDING") fail("human reduction fill requires a PENDING order");
  if (
    quote.evidence.inputAssetId !== order.inputAssetId
    || quote.evidence.outputAssetId !== order.outputAssetId
    || quote.evidence.inputAmountAtomic !== order.inputAmountAtomic
  ) fail("human reduction quote does not exactly match pending order");
  if (quote.evidence.inputAssetId.toLowerCase() !== reduction.positionAssetId.toLowerCase()) fail("human reduction quote input is not the canonical position asset");
  if (quote.evidence.outputAssetId !== reduction.quoteAssetId) fail("human reduction quote output is not the Arena quote asset");
  if (quote.evidence.observedAt < order.createdAt) fail("human reduction quote predates pending order");
  if (quote.evidence.priceImpactBps > reduction.maximumPriceImpactBps) fail("human reduction quote price impact exceeds admitted Human risk policy");
}

function assertFill(
  fill: HumanPaperFillRecord,
  submission: HumanAuthoritativePositionReductionSubmissionRecord,
  quote: RmtPaperQuoteResult,
  costs: PaperExecutionCosts,
): void {
  const order = submission.order;
  const evidence = quote.evidence;
  assertAtomicAmount(fill.inputAmountAtomic, "human reduction fill input amount");
  assertAtomicAmount(fill.outputAmountAtomic, "human reduction fill output amount");
  assertAtomicAmount(fill.feeAmountAtomic, "human reduction fill fee amount");
  assertAtomicAmount(fill.gasCostAtomic, "human reduction fill gas amount");
  if (
    fill.participantType !== "HUMAN"
    || fill.participantId !== order.participantId
    || fill.orderId !== order.orderId
    || fill.quoteId !== evidence.quoteId
    || fill.accountId !== order.accountId
    || fill.inputAssetId !== order.inputAssetId
    || fill.outputAssetId !== order.outputAssetId
    || fill.inputAmountAtomic !== order.inputAmountAtomic
    || fill.outputAmountAtomic !== evidence.outputAmountAtomic
    || fill.providerId !== evidence.providerId
    || fill.filledAt !== evidence.observedAt
    || fill.evidenceHash !== evidence.evidenceHash
  ) fail("human reduction fill differs from pending order/quote evidence");
  if (
    fill.feeAssetId !== costs.feeAssetId
    || fill.feeAmountAtomic !== costs.feeAmountAtomic
    || fill.gasAssetId !== costs.gasAssetId
    || fill.gasCostAtomic !== costs.gasCostAtomic
  ) fail("human reduction fill costs differ from ready cost plan");
  if (hashCanonicalPayload(fill.quoteEvidence) !== hashCanonicalPayload(evidence)) fail("human reduction fill retained different quote evidence");
}

export function assertHumanAuthoritativePositionReductionFillRecord(record: HumanAuthoritativePositionReductionFillRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported human reduction fill schema version");
  assertHumanAuthoritativePositionReductionSubmissionRecord(record.submission);
  assertQuote(record.submission, record.quoteResult);
  assertPaperFillCostPlan(record.costPlan, record.quoteResult);
  if (record.costPlan.status !== "READY" || !record.costPlan.costs) fail("human reduction fill requires READY costs");
  const expectedKey = `human-paper-reduction-fill:${hashCanonicalPayload({
    orderId: record.submission.order.orderId,
    submissionHash: record.submission.recordHash,
    quoteEvidenceHash: record.quoteResult.evidence.evidenceHash,
    costHash: record.costPlan.costHash,
  })}`;
  if (record.idempotencyKey !== expectedKey) fail("human reduction fill idempotency key mismatch");
  assertFill(record.fill, record.submission, record.quoteResult, record.costPlan.costs);
  if (!/^0x[0-9a-f]{64}$/.test(record.recordHash)) fail("human reduction fill recordHash must be a sha256 hex hash");
  const { recordHash, ...payload } = record;
  if (recordHash !== hashCanonicalPayload(payload)) fail("human reduction fill record hash mismatch");
}

export class HumanAuthoritativePositionReductionFillService {
  private readonly writer: HumanPaperFillWriter;

  constructor(writer: HumanPaperFillWriter) {
    this.writer = writer;
  }

  async fill(input: {
    submission: HumanAuthoritativePositionReductionSubmissionRecord;
    quoteResult: RmtPaperQuoteResult;
    costPlan: PaperFillCostPlan;
  }): Promise<HumanAuthoritativePositionReductionFillRecord> {
    assertHumanAuthoritativePositionReductionSubmissionRecord(input.submission);
    assertQuote(input.submission, input.quoteResult);
    assertPaperFillCostPlan(input.costPlan, input.quoteResult);
    if (input.costPlan.status !== "READY" || !input.costPlan.costs) fail("human reduction fill blocked until costs are ready");
    const idempotencyKey = `human-paper-reduction-fill:${hashCanonicalPayload({
      orderId: input.submission.order.orderId,
      submissionHash: input.submission.recordHash,
      quoteEvidenceHash: input.quoteResult.evidence.evidenceHash,
      costHash: input.costPlan.costHash,
    })}`;
    const fill = await this.writer.fillHumanPaperOrder(
      input.submission.order.orderId,
      structuredClone(input.quoteResult.evidence) as VerifiedPaperQuoteEvidence,
      idempotencyKey,
      structuredClone(input.costPlan.costs),
    );
    assertFill(fill, input.submission, input.quoteResult, input.costPlan.costs);
    const payload: Omit<HumanAuthoritativePositionReductionFillRecord, "recordHash"> = {
      schemaVersion: 1,
      submission: structuredClone(input.submission),
      quoteResult: structuredClone(input.quoteResult),
      costPlan: structuredClone(input.costPlan),
      idempotencyKey,
      fill: structuredClone(fill),
    };
    const record: HumanAuthoritativePositionReductionFillRecord = { ...payload, recordHash: hashCanonicalPayload(payload) };
    assertHumanAuthoritativePositionReductionFillRecord(record);
    return record;
  }
}
