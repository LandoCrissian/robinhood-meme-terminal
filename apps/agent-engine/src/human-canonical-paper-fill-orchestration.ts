import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  HumanPaperFillOrchestrationService,
  assertHumanPaperFillOrchestrationRecord,
  type HumanPaperFillOrchestrationRecord,
  type HumanPaperFillWriter,
} from "./human-paper-fill-orchestration.ts";
import {
  assertHumanCanonicalPaperOrderSubmissionRecord,
  type HumanCanonicalPaperOrderSubmissionRecord,
} from "./human-canonical-paper-order-submission.ts";
import {
  assertPaperFillCostPlan,
  type PaperFillCostPlan,
} from "./paper-fill-cost.ts";
import {
  assertRmtPaperQuoteResult,
  type RmtPaperQuoteResult,
} from "./rmt-paper-quote.ts";

export interface HumanCanonicalPaperFillOrchestrationRecord {
  schemaVersion: 1;
  canonicalSubmission: HumanCanonicalPaperOrderSubmissionRecord;
  fillOrchestration: HumanPaperFillOrchestrationRecord;
  maximumPriceImpactBps: number;
  recordHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertPriceImpact(
  submission: HumanCanonicalPaperOrderSubmissionRecord,
  quoteResult: RmtPaperQuoteResult,
): number {
  const maximum = submission.canonicalRiskCapacity.capacityPlan.maximumPriceImpactBps;
  if (quoteResult.evidence.priceImpactBps > maximum) {
    fail("human paper quote price impact exceeds admitted Human risk policy");
  }
  return maximum;
}

export function assertHumanCanonicalPaperFillOrchestrationRecord(record: HumanCanonicalPaperFillOrchestrationRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported canonical human fill orchestration schema version");
  assertHumanCanonicalPaperOrderSubmissionRecord(record.canonicalSubmission);
  assertHumanPaperFillOrchestrationRecord(record.fillOrchestration);
  if (record.fillOrchestration.orderSubmission.submissionHash !== record.canonicalSubmission.submission.submissionHash) {
    fail("canonical human fill references a different order submission");
  }
  const expectedMaximum = assertPriceImpact(record.canonicalSubmission, record.fillOrchestration.quoteResult);
  if (record.maximumPriceImpactBps !== expectedMaximum) fail("canonical human fill maximum price impact mismatch");
  if (!/^0x[0-9a-f]{64}$/.test(record.recordHash)) fail("canonical human fill recordHash must be a sha256 hex hash");
  const { recordHash, ...payload } = record;
  if (recordHash !== hashCanonicalPayload(payload)) fail("canonical human fill record hash mismatch");
}

export class HumanCanonicalPaperFillOrchestrationService {
  private readonly inner: HumanPaperFillOrchestrationService;

  constructor(writer: HumanPaperFillWriter) {
    this.inner = new HumanPaperFillOrchestrationService(writer);
  }

  async fill(input: {
    canonicalSubmission: HumanCanonicalPaperOrderSubmissionRecord;
    quoteResult: RmtPaperQuoteResult;
    costPlan: PaperFillCostPlan;
  }): Promise<HumanCanonicalPaperFillOrchestrationRecord> {
    assertHumanCanonicalPaperOrderSubmissionRecord(input.canonicalSubmission);
    assertRmtPaperQuoteResult(input.quoteResult);
    assertPaperFillCostPlan(input.costPlan, input.quoteResult);
    const maximumPriceImpactBps = assertPriceImpact(input.canonicalSubmission, input.quoteResult);
    const fillOrchestration = await this.inner.fill({
      submission: input.canonicalSubmission.submission,
      quoteResult: input.quoteResult,
      costPlan: input.costPlan,
    });
    const payload: Omit<HumanCanonicalPaperFillOrchestrationRecord, "recordHash"> = {
      schemaVersion: 1,
      canonicalSubmission: structuredClone(input.canonicalSubmission),
      fillOrchestration,
      maximumPriceImpactBps,
    };
    const record: HumanCanonicalPaperFillOrchestrationRecord = { ...payload, recordHash: hashCanonicalPayload(payload) };
    assertHumanCanonicalPaperFillOrchestrationRecord(record);
    return record;
  }
}
