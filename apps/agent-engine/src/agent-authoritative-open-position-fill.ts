import {
  assertAtomicAmount,
  assertNonEmptyString,
  hashCanonicalPayload,
  type PaperExecutionCosts,
  type PaperFillRecord,
  type VerifiedPaperQuoteEvidence,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertAgentAuthoritativeOpenPositionSubmissionRecord,
  type AgentAuthoritativeOpenPositionSubmissionRecord,
} from "./agent-authoritative-open-position-submission.ts";
import {
  assertPaperFillCostPlan,
  type PaperFillCostPlan,
} from "./paper-fill-cost.ts";
import {
  assertRmtPaperQuoteResult,
  type RmtPaperQuoteResult,
} from "./rmt-paper-quote.ts";

export interface AgentOpenPositionFillWriter {
  fillPaperOrder(
    orderId: string,
    quote: VerifiedPaperQuoteEvidence,
    idempotencyKey: string,
    costs?: PaperExecutionCosts,
  ): Promise<PaperFillRecord>;
}

export interface AgentAuthoritativeOpenPositionFillRecord {
  schemaVersion: 1;
  submission: AgentAuthoritativeOpenPositionSubmissionRecord;
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

function assertQuote(
  submission: AgentAuthoritativeOpenPositionSubmissionRecord,
  quote: RmtPaperQuoteResult,
): void {
  assertRmtPaperQuoteResult(quote);
  const order = submission.order;
  const authorization = submission.authoritativeAdmission;
  const riskSource = authorization.canonicalAdmission.riskSource;
  const tradeRequest = authorization.canonicalAdmission.admission.tradeRequest;
  const proposal = tradeRequest.run.proposal.openPosition;
  if (order.status !== "PENDING") fail("agent authoritative fill requires a PENDING paper order");
  if (!proposal || tradeRequest.run.proposal.action !== "OPEN_POSITION") {
    fail("agent authoritative fill requires an OPEN_POSITION authorization");
  }
  if (
    quote.evidence.inputAssetId !== order.inputAssetId
    || quote.evidence.outputAssetId !== order.outputAssetId
    || quote.evidence.inputAmountAtomic !== order.inputAmountAtomic
  ) {
    fail("agent authoritative quote does not exactly match pending order");
  }
  if (quote.evidence.inputAssetId !== riskSource.entry.quoteAssetId) {
    fail("agent authoritative quote input is not the Arena quote asset");
  }
  if (quote.evidence.outputAssetId.toLowerCase() !== proposal.assetId.toLowerCase()) {
    fail("agent authoritative quote output is not the admitted position asset");
  }
  if (quote.evidence.observedAt < order.createdAt) fail("agent authoritative quote predates pending order");
  if (quote.evidence.priceImpactBps > tradeRequest.strategy.spec.execution.maximumPriceImpactBps) {
    fail("agent authoritative quote price impact exceeds strategy policy");
  }
}

function assertFill(
  fill: PaperFillRecord,
  submission: AgentAuthoritativeOpenPositionSubmissionRecord,
  quote: RmtPaperQuoteResult,
  costs: PaperExecutionCosts,
): void {
  const order = submission.order;
  const evidence = quote.evidence;
  assertNonEmptyString(fill.fillId, "agent authoritative fillId");
  assertNonEmptyString(fill.orderId, "agent authoritative fill orderId");
  assertAtomicAmount(fill.inputAmountAtomic, "agent authoritative fill input amount");
  assertAtomicAmount(fill.outputAmountAtomic, "agent authoritative fill output amount");
  assertAtomicAmount(fill.feeAmountAtomic, "agent authoritative fill fee amount");
  assertAtomicAmount(fill.gasCostAtomic, "agent authoritative fill gas amount");
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
    fail("agent authoritative fill differs from pending order/quote evidence");
  }
  if (
    fill.feeAssetId !== costs.feeAssetId
    || fill.feeAmountAtomic !== costs.feeAmountAtomic
    || fill.gasAssetId !== costs.gasAssetId
    || fill.gasCostAtomic !== costs.gasCostAtomic
  ) {
    fail("agent authoritative fill costs differ from ready cost plan");
  }
  if (hashCanonicalPayload(fill.quoteEvidence) !== hashCanonicalPayload(evidence)) {
    fail("agent authoritative fill retained different quote evidence");
  }
}

export function agentOpenPositionFillIdempotencyKey(input: {
  submission: AgentAuthoritativeOpenPositionSubmissionRecord;
  quoteResult: RmtPaperQuoteResult;
  costPlan: PaperFillCostPlan;
}): string {
  assertAgentAuthoritativeOpenPositionSubmissionRecord(input.submission);
  assertRmtPaperQuoteResult(input.quoteResult);
  assertPaperFillCostPlan(input.costPlan, input.quoteResult);
  return `agent-paper-open-position-fill:${hashCanonicalPayload({
    schemaVersion: 1,
    orderId: input.submission.order.orderId,
    submissionHash: input.submission.submissionHash,
    authorizationHash: input.submission.authorizationHash,
    quoteEvidenceHash: input.quoteResult.evidence.evidenceHash,
    costHash: input.costPlan.costHash,
  })}`;
}

export function assertAgentAuthoritativeOpenPositionFillRecord(
  record: AgentAuthoritativeOpenPositionFillRecord,
): void {
  if (record.schemaVersion !== 1) fail("unsupported agent authoritative open-position fill schema version");
  assertAgentAuthoritativeOpenPositionSubmissionRecord(record.submission);
  assertQuote(record.submission, record.quoteResult);
  assertPaperFillCostPlan(record.costPlan, record.quoteResult);
  if (record.costPlan.status !== "READY" || !record.costPlan.costs) {
    fail("agent authoritative fill requires READY costs");
  }
  const expectedKey = agentOpenPositionFillIdempotencyKey({
    submission: record.submission,
    quoteResult: record.quoteResult,
    costPlan: record.costPlan,
  });
  if (record.idempotencyKey !== expectedKey) fail("agent authoritative fill idempotency key mismatch");
  assertFill(record.fill, record.submission, record.quoteResult, record.costPlan.costs);
  assertHash(record.fillHash, "agent authoritative fillHash");
  const { fillHash, ...payload } = record;
  if (fillHash !== hashCanonicalPayload(payload)) fail("agent authoritative fill hash mismatch");
}

export class AgentAuthoritativeOpenPositionFillService {
  private readonly writer: AgentOpenPositionFillWriter;

  constructor(writer: AgentOpenPositionFillWriter) {
    this.writer = writer;
  }

  async fill(input: {
    submission: AgentAuthoritativeOpenPositionSubmissionRecord;
    quoteResult: RmtPaperQuoteResult;
    costPlan: PaperFillCostPlan;
  }): Promise<AgentAuthoritativeOpenPositionFillRecord> {
    assertAgentAuthoritativeOpenPositionSubmissionRecord(input.submission);
    assertQuote(input.submission, input.quoteResult);
    assertPaperFillCostPlan(input.costPlan, input.quoteResult);
    if (input.costPlan.status !== "READY" || !input.costPlan.costs) {
      fail("agent authoritative fill blocked until costs are ready");
    }
    const idempotencyKey = agentOpenPositionFillIdempotencyKey(input);
    const fill = await this.writer.fillPaperOrder(
      input.submission.order.orderId,
      structuredClone(input.quoteResult.evidence),
      idempotencyKey,
      structuredClone(input.costPlan.costs),
    );
    assertFill(fill, input.submission, input.quoteResult, input.costPlan.costs);
    const payload: Omit<AgentAuthoritativeOpenPositionFillRecord, "fillHash"> = {
      schemaVersion: 1,
      submission: structuredClone(input.submission),
      quoteResult: structuredClone(input.quoteResult),
      costPlan: structuredClone(input.costPlan),
      idempotencyKey,
      fill: structuredClone(fill),
    };
    const record: AgentAuthoritativeOpenPositionFillRecord = {
      ...payload,
      fillHash: hashCanonicalPayload(payload),
    };
    assertAgentAuthoritativeOpenPositionFillRecord(record);
    return record;
  }
}
