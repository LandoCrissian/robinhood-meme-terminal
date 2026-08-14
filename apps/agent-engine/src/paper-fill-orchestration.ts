import {
  assertAtomicAmount,
  assertNonEmptyString,
  hashCanonicalPayload,
  type PaperExecutionCosts,
  type PaperFillRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperFillCostPlan,
  type PaperFillCostPlan,
} from "./paper-fill-cost.ts";
import {
  assertPaperOrderSubmissionRecord,
  type PaperOrderSubmissionRecord,
} from "./paper-order-submission.ts";
import {
  assertRmtPaperQuoteResult,
  type RmtPaperQuoteResult,
} from "./rmt-paper-quote.ts";

export interface PaperFillWriter {
  fillPaperOrder(
    orderId: string,
    quote: VerifiedPaperQuoteEvidence,
    idempotencyKey: string,
    costs?: PaperExecutionCosts,
  ): Promise<PaperFillRecord>;
}

export interface PaperFillOrchestrationRecord {
  schemaVersion: 1;
  orderSubmission: PaperOrderSubmissionRecord;
  quoteResult: RmtPaperQuoteResult;
  costPlan: PaperFillCostPlan;
  idempotencyKey: string;
  fill: PaperFillRecord;
  orchestrationHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertQuoteMatchesPendingOrder(submission: PaperOrderSubmissionRecord, quoteResult: RmtPaperQuoteResult): void {
  const order = submission.order;
  const evidence = quoteResult.evidence;
  if (order.status !== "PENDING") fail("paper fill orchestration requires a PENDING order");
  if (
    evidence.inputAssetId !== order.inputAssetId
    || evidence.outputAssetId !== order.outputAssetId
    || evidence.inputAmountAtomic !== order.inputAmountAtomic
  ) {
    fail("paper fill quote evidence does not exactly match pending order");
  }
  if (evidence.observedAt < order.createdAt) fail("paper fill quote predates pending order");
}

function assertFillMatchesEvidence(
  fill: PaperFillRecord,
  submission: PaperOrderSubmissionRecord,
  quoteResult: RmtPaperQuoteResult,
  costs: PaperExecutionCosts,
): void {
  const order = submission.order;
  const evidence = quoteResult.evidence;
  assertNonEmptyString(fill.fillId, "paper fill fillId");
  assertNonEmptyString(fill.orderId, "paper fill orderId");
  assertAtomicAmount(fill.inputAmountAtomic, "paper fill input amount");
  assertAtomicAmount(fill.outputAmountAtomic, "paper fill output amount");
  assertAtomicAmount(fill.feeAmountAtomic, "paper fill fee amount");
  assertAtomicAmount(fill.gasCostAtomic, "paper fill gas amount");
  if (
    fill.orderId !== order.orderId
    || fill.quoteId !== evidence.quoteId
    || fill.agentId !== order.agentId
    || fill.accountId !== order.accountId
    || fill.inputAssetId !== order.inputAssetId
    || fill.outputAssetId !== order.outputAssetId
    || fill.inputAmountAtomic !== order.inputAmountAtomic
    || fill.outputAmountAtomic !== evidence.outputAmountAtomic
    || fill.providerId !== evidence.providerId
    || fill.filledAt !== evidence.observedAt
    || fill.evidenceHash !== evidence.evidenceHash
  ) {
    fail("paper fill writer returned fill data that differs from admitted order/quote evidence");
  }
  if (
    fill.feeAssetId !== costs.feeAssetId
    || fill.feeAmountAtomic !== costs.feeAmountAtomic
    || fill.gasAssetId !== costs.gasAssetId
    || fill.gasCostAtomic !== costs.gasCostAtomic
  ) {
    fail("paper fill writer returned cost data that differs from ready cost plan");
  }
  if (hashCanonicalPayload(fill.quoteEvidence) !== hashCanonicalPayload(evidence)) {
    fail("paper fill writer returned different quote evidence");
  }
}

export function paperFillIdempotencyKey(input: {
  submission: PaperOrderSubmissionRecord;
  quoteResult: RmtPaperQuoteResult;
  costPlan: PaperFillCostPlan;
}): string {
  assertPaperOrderSubmissionRecord(input.submission);
  assertRmtPaperQuoteResult(input.quoteResult);
  assertPaperFillCostPlan(input.costPlan, input.quoteResult);
  return `paper-fill:${hashCanonicalPayload({
    schemaVersion: 1,
    orderId: input.submission.order.orderId,
    submissionHash: input.submission.submissionHash,
    quoteEvidenceHash: input.quoteResult.evidence.evidenceHash,
    costHash: input.costPlan.costHash,
  })}`;
}

export function assertPaperFillOrchestrationRecord(record: PaperFillOrchestrationRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper fill orchestration schema version");
  assertPaperOrderSubmissionRecord(record.orderSubmission);
  assertRmtPaperQuoteResult(record.quoteResult);
  assertPaperFillCostPlan(record.costPlan, record.quoteResult);
  if (record.costPlan.status !== "READY" || !record.costPlan.costs) fail("paper fill orchestration requires READY costs");
  assertQuoteMatchesPendingOrder(record.orderSubmission, record.quoteResult);
  const expectedKey = paperFillIdempotencyKey({
    submission: record.orderSubmission,
    quoteResult: record.quoteResult,
    costPlan: record.costPlan,
  });
  if (record.idempotencyKey !== expectedKey) fail("paper fill idempotency key mismatch");
  assertFillMatchesEvidence(record.fill, record.orderSubmission, record.quoteResult, record.costPlan.costs);
  assertHash(record.orchestrationHash, "paper fill orchestrationHash");
  const { orchestrationHash, ...payload } = record;
  if (orchestrationHash !== hashCanonicalPayload(payload)) fail("paper fill orchestration hash mismatch");
}

export class PaperFillOrchestrationService {
  private readonly writer: PaperFillWriter;

  constructor(writer: PaperFillWriter) {
    this.writer = writer;
  }

  async fill(input: {
    submission: PaperOrderSubmissionRecord;
    quoteResult: RmtPaperQuoteResult;
    costPlan: PaperFillCostPlan;
  }): Promise<PaperFillOrchestrationRecord> {
    assertPaperOrderSubmissionRecord(input.submission);
    assertRmtPaperQuoteResult(input.quoteResult);
    assertPaperFillCostPlan(input.costPlan, input.quoteResult);
    if (input.costPlan.status !== "READY" || !input.costPlan.costs) {
      fail("paper fill blocked until network fee costs are ready");
    }
    assertQuoteMatchesPendingOrder(input.submission, input.quoteResult);
    const idempotencyKey = paperFillIdempotencyKey(input);
    const fill = await this.writer.fillPaperOrder(
      input.submission.order.orderId,
      structuredClone(input.quoteResult.evidence),
      idempotencyKey,
      structuredClone(input.costPlan.costs),
    );
    assertFillMatchesEvidence(fill, input.submission, input.quoteResult, input.costPlan.costs);
    const payload: Omit<PaperFillOrchestrationRecord, "orchestrationHash"> = {
      schemaVersion: 1,
      orderSubmission: structuredClone(input.submission),
      quoteResult: structuredClone(input.quoteResult),
      costPlan: structuredClone(input.costPlan),
      idempotencyKey,
      fill: structuredClone(fill),
    };
    const record: PaperFillOrchestrationRecord = {
      ...payload,
      orchestrationHash: hashCanonicalPayload(payload),
    };
    assertPaperFillOrchestrationRecord(record);
    return record;
  }
}
