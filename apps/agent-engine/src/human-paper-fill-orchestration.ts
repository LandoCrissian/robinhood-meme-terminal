import {
  assertAtomicAmount,
  assertNonEmptyString,
  hashCanonicalPayload,
  type HumanPaperFillRecord,
  type PaperExecutionCosts,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertHumanPaperOrderSubmissionRecord,
  type HumanPaperOrderSubmissionRecord,
} from "./human-paper-order-submission.ts";
import {
  assertPaperFillCostPlan,
  type PaperFillCostPlan,
} from "./paper-fill-cost.ts";
import {
  assertRmtPaperQuoteResult,
  type RmtPaperQuoteResult,
} from "./rmt-paper-quote.ts";

export interface HumanPaperFillWriter {
  fillHumanPaperOrder(
    orderId: string,
    quote: VerifiedPaperQuoteEvidence,
    idempotencyKey: string,
    costs?: PaperExecutionCosts,
  ): Promise<HumanPaperFillRecord>;
}

export interface HumanPaperFillOrchestrationRecord {
  schemaVersion: 1;
  orderSubmission: HumanPaperOrderSubmissionRecord;
  quoteResult: RmtPaperQuoteResult;
  costPlan: PaperFillCostPlan;
  idempotencyKey: string;
  fill: HumanPaperFillRecord;
  orchestrationHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertQuoteMatchesPendingOrder(submission: HumanPaperOrderSubmissionRecord, quoteResult: RmtPaperQuoteResult): void {
  const order = submission.order;
  const evidence = quoteResult.evidence;
  if (order.status !== "PENDING") fail("human paper fill orchestration requires a PENDING order");
  if (
    evidence.inputAssetId !== order.inputAssetId
    || evidence.outputAssetId !== order.outputAssetId
    || evidence.inputAmountAtomic !== order.inputAmountAtomic
  ) fail("human paper fill quote evidence does not exactly match pending order");
  if (evidence.observedAt < order.createdAt) fail("human paper fill quote predates pending order");
}

function assertFillMatchesEvidence(
  fill: HumanPaperFillRecord,
  submission: HumanPaperOrderSubmissionRecord,
  quoteResult: RmtPaperQuoteResult,
  costs: PaperExecutionCosts,
): void {
  const order = submission.order;
  const evidence = quoteResult.evidence;
  assertNonEmptyString(fill.fillId, "human paper fill fillId");
  assertNonEmptyString(fill.orderId, "human paper fill orderId");
  assertAtomicAmount(fill.inputAmountAtomic, "human paper fill input amount");
  assertAtomicAmount(fill.outputAmountAtomic, "human paper fill output amount");
  assertAtomicAmount(fill.feeAmountAtomic, "human paper fill fee amount");
  assertAtomicAmount(fill.gasCostAtomic, "human paper fill gas amount");
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
  ) fail("human paper fill writer returned data that differs from admitted order/quote evidence");
  if (
    fill.feeAssetId !== costs.feeAssetId
    || fill.feeAmountAtomic !== costs.feeAmountAtomic
    || fill.gasAssetId !== costs.gasAssetId
    || fill.gasCostAtomic !== costs.gasCostAtomic
  ) fail("human paper fill writer returned cost data that differs from ready cost plan");
  if (hashCanonicalPayload(fill.quoteEvidence) !== hashCanonicalPayload(evidence)) fail("human paper fill writer returned different quote evidence");
}

export function humanPaperFillIdempotencyKey(input: {
  submission: HumanPaperOrderSubmissionRecord;
  quoteResult: RmtPaperQuoteResult;
  costPlan: PaperFillCostPlan;
}): string {
  assertHumanPaperOrderSubmissionRecord(input.submission);
  assertRmtPaperQuoteResult(input.quoteResult);
  assertPaperFillCostPlan(input.costPlan, input.quoteResult);
  return `human-paper-fill:${hashCanonicalPayload({
    schemaVersion: 1,
    orderId: input.submission.order.orderId,
    submissionHash: input.submission.submissionHash,
    quoteEvidenceHash: input.quoteResult.evidence.evidenceHash,
    costHash: input.costPlan.costHash,
  })}`;
}

export function assertHumanPaperFillOrchestrationRecord(record: HumanPaperFillOrchestrationRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported human paper fill orchestration schema version");
  assertHumanPaperOrderSubmissionRecord(record.orderSubmission);
  assertRmtPaperQuoteResult(record.quoteResult);
  assertPaperFillCostPlan(record.costPlan, record.quoteResult);
  if (record.costPlan.status !== "READY" || !record.costPlan.costs) fail("human paper fill orchestration requires READY costs");
  assertQuoteMatchesPendingOrder(record.orderSubmission, record.quoteResult);
  const expectedKey = humanPaperFillIdempotencyKey({
    submission: record.orderSubmission,
    quoteResult: record.quoteResult,
    costPlan: record.costPlan,
  });
  if (record.idempotencyKey !== expectedKey) fail("human paper fill idempotency key mismatch");
  assertFillMatchesEvidence(record.fill, record.orderSubmission, record.quoteResult, record.costPlan.costs);
  assertHash(record.orchestrationHash, "human paper fill orchestrationHash");
  const { orchestrationHash, ...payload } = record;
  if (record.orchestrationHash !== hashCanonicalPayload(payload)) fail("human paper fill orchestration hash mismatch");
}

export class HumanPaperFillOrchestrationService {
  private readonly writer: HumanPaperFillWriter;

  constructor(writer: HumanPaperFillWriter) {
    this.writer = writer;
  }

  async fill(input: {
    submission: HumanPaperOrderSubmissionRecord;
    quoteResult: RmtPaperQuoteResult;
    costPlan: PaperFillCostPlan;
  }): Promise<HumanPaperFillOrchestrationRecord> {
    assertHumanPaperOrderSubmissionRecord(input.submission);
    assertRmtPaperQuoteResult(input.quoteResult);
    assertPaperFillCostPlan(input.costPlan, input.quoteResult);
    if (input.costPlan.status !== "READY" || !input.costPlan.costs) fail("human paper fill blocked until network fee costs are ready");
    assertQuoteMatchesPendingOrder(input.submission, input.quoteResult);
    const idempotencyKey = humanPaperFillIdempotencyKey(input);
    const fill = await this.writer.fillHumanPaperOrder(
      input.submission.order.orderId,
      structuredClone(input.quoteResult.evidence),
      idempotencyKey,
      structuredClone(input.costPlan.costs),
    );
    assertFillMatchesEvidence(fill, input.submission, input.quoteResult, input.costPlan.costs);
    const payload: Omit<HumanPaperFillOrchestrationRecord, "orchestrationHash"> = {
      schemaVersion: 1,
      orderSubmission: structuredClone(input.submission),
      quoteResult: structuredClone(input.quoteResult),
      costPlan: structuredClone(input.costPlan),
      idempotencyKey,
      fill: structuredClone(fill),
    };
    const record: HumanPaperFillOrchestrationRecord = { ...payload, orchestrationHash: hashCanonicalPayload(payload) };
    assertHumanPaperFillOrchestrationRecord(record);
    return record;
  }
}
