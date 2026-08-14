import {
  assertAtomicAmount,
  hashCanonicalPayload,
  type PaperExecutionCosts,
  type PaperFillRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertAgentAuthoritativePositionReductionSubmissionRecord,
  type AgentAuthoritativePositionReductionSubmissionRecord,
} from "./agent-authoritative-position-reduction-submission.ts";
import {
  assertPaperFillCostPlan,
  type PaperFillCostPlan,
} from "./paper-fill-cost.ts";
import {
  assertRmtPaperQuoteResult,
  type RmtPaperQuoteResult,
} from "./rmt-paper-quote.ts";

export interface AgentReductionFillWriter {
  fillPaperOrder(
    orderId: string,
    quote: VerifiedPaperQuoteEvidence,
    idempotencyKey: string,
    costs?: PaperExecutionCosts,
  ): Promise<PaperFillRecord>;
}

export interface AgentAuthoritativePositionReductionFillRecord {
  schemaVersion: 1;
  submission: AgentAuthoritativePositionReductionSubmissionRecord;
  quoteResult: RmtPaperQuoteResult;
  costPlan: PaperFillCostPlan;
  idempotencyKey: string;
  fill: PaperFillRecord;
  fillHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertQuote(submission: AgentAuthoritativePositionReductionSubmissionRecord, quote: RmtPaperQuoteResult): void {
  assertRmtPaperQuoteResult(quote);
  const order = submission.order;
  const reduction = submission.reduction;
  if (order.status !== "PENDING") fail("agent reduction fill requires a PENDING order");
  if (
    quote.evidence.inputAssetId !== order.inputAssetId
    || quote.evidence.outputAssetId !== order.outputAssetId
    || quote.evidence.inputAmountAtomic !== order.inputAmountAtomic
  ) fail("agent reduction quote does not exactly match pending order");
  if (quote.evidence.inputAssetId.toLowerCase() !== reduction.positionAssetId.toLowerCase()) fail("agent reduction quote input is not canonical position asset");
  if (quote.evidence.outputAssetId !== reduction.quoteAssetId) fail("agent reduction quote output is not Arena quote asset");
  if (quote.evidence.observedAt < order.createdAt) fail("agent reduction quote predates pending order");
  if (quote.evidence.priceImpactBps > reduction.maximumPriceImpactBps) fail("agent reduction quote price impact exceeds strategy policy");
}

function assertFill(
  fill: PaperFillRecord,
  submission: AgentAuthoritativePositionReductionSubmissionRecord,
  quote: RmtPaperQuoteResult,
  costs: PaperExecutionCosts,
): void {
  const order = submission.order;
  const evidence = quote.evidence;
  assertAtomicAmount(fill.inputAmountAtomic, "agent reduction fill input amount");
  assertAtomicAmount(fill.outputAmountAtomic, "agent reduction fill output amount");
  assertAtomicAmount(fill.feeAmountAtomic, "agent reduction fill fee amount");
  assertAtomicAmount(fill.gasCostAtomic, "agent reduction fill gas amount");
  if (
    fill.agentId !== order.agentId
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
  ) fail("agent reduction fill differs from pending order/quote evidence");
  if (
    fill.feeAssetId !== costs.feeAssetId
    || fill.feeAmountAtomic !== costs.feeAmountAtomic
    || fill.gasAssetId !== costs.gasAssetId
    || fill.gasCostAtomic !== costs.gasCostAtomic
  ) fail("agent reduction fill costs differ from ready cost plan");
  if (hashCanonicalPayload(fill.quoteEvidence) !== hashCanonicalPayload(evidence)) fail("agent reduction fill retained different quote evidence");
}

export function agentReductionFillIdempotencyKey(input: {
  submission: AgentAuthoritativePositionReductionSubmissionRecord;
  quoteResult: RmtPaperQuoteResult;
  costPlan: PaperFillCostPlan;
}): string {
  assertAgentAuthoritativePositionReductionSubmissionRecord(input.submission);
  assertRmtPaperQuoteResult(input.quoteResult);
  assertPaperFillCostPlan(input.costPlan, input.quoteResult);
  return `agent-paper-reduction-fill:${hashCanonicalPayload({
    orderId: input.submission.order.orderId,
    submissionHash: input.submission.submissionHash,
    quoteEvidenceHash: input.quoteResult.evidence.evidenceHash,
    costHash: input.costPlan.costHash,
  })}`;
}

export function assertAgentAuthoritativePositionReductionFillRecord(record: AgentAuthoritativePositionReductionFillRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported agent reduction fill schema version");
  assertAgentAuthoritativePositionReductionSubmissionRecord(record.submission);
  assertQuote(record.submission, record.quoteResult);
  assertPaperFillCostPlan(record.costPlan, record.quoteResult);
  if (record.costPlan.status !== "READY" || !record.costPlan.costs) fail("agent reduction fill requires READY costs");
  const expectedKey = agentReductionFillIdempotencyKey({ submission: record.submission, quoteResult: record.quoteResult, costPlan: record.costPlan });
  if (record.idempotencyKey !== expectedKey) fail("agent reduction fill idempotency key mismatch");
  assertFill(record.fill, record.submission, record.quoteResult, record.costPlan.costs);
  assertHash(record.fillHash, "agent reduction fillHash");
  const { fillHash, ...payload } = record;
  if (fillHash !== hashCanonicalPayload(payload)) fail("agent reduction fill hash mismatch");
}

export class AgentAuthoritativePositionReductionFillService {
  private readonly writer: AgentReductionFillWriter;

  constructor(writer: AgentReductionFillWriter) {
    this.writer = writer;
  }

  async fill(input: {
    submission: AgentAuthoritativePositionReductionSubmissionRecord;
    quoteResult: RmtPaperQuoteResult;
    costPlan: PaperFillCostPlan;
  }): Promise<AgentAuthoritativePositionReductionFillRecord> {
    assertAgentAuthoritativePositionReductionSubmissionRecord(input.submission);
    assertQuote(input.submission, input.quoteResult);
    assertPaperFillCostPlan(input.costPlan, input.quoteResult);
    if (input.costPlan.status !== "READY" || !input.costPlan.costs) fail("agent reduction fill blocked until costs are ready");
    const idempotencyKey = agentReductionFillIdempotencyKey(input);
    const fill = await this.writer.fillPaperOrder(
      input.submission.order.orderId,
      structuredClone(input.quoteResult.evidence),
      idempotencyKey,
      structuredClone(input.costPlan.costs),
    );
    assertFill(fill, input.submission, input.quoteResult, input.costPlan.costs);
    const payload: Omit<AgentAuthoritativePositionReductionFillRecord, "fillHash"> = {
      schemaVersion: 1,
      submission: structuredClone(input.submission),
      quoteResult: structuredClone(input.quoteResult),
      costPlan: structuredClone(input.costPlan),
      idempotencyKey,
      fill: structuredClone(fill),
    };
    const record: AgentAuthoritativePositionReductionFillRecord = { ...payload, fillHash: hashCanonicalPayload(payload) };
    assertAgentAuthoritativePositionReductionFillRecord(record);
    return record;
  }
}
