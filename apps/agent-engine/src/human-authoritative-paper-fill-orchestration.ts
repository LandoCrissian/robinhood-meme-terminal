import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  HumanCanonicalPaperFillOrchestrationService,
  assertHumanCanonicalPaperFillOrchestrationRecord,
  type HumanCanonicalPaperFillOrchestrationRecord,
} from "./human-canonical-paper-fill-orchestration.ts";
import {
  assertHumanAuthoritativePaperOrderSubmissionRecord,
  type HumanAuthoritativePaperOrderSubmissionRecord,
} from "./human-authoritative-paper-order-submission.ts";
import type { HumanPaperFillWriter } from "./human-paper-fill-orchestration.ts";
import type { PaperFillCostPlan } from "./paper-fill-cost.ts";
import type { RmtPaperQuoteResult } from "./rmt-paper-quote.ts";

export interface HumanAuthoritativePaperFillOrchestrationRecord {
  schemaVersion: 1;
  authoritativeSubmission: HumanAuthoritativePaperOrderSubmissionRecord;
  canonicalFill: HumanCanonicalPaperFillOrchestrationRecord;
  recordHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

export function assertHumanAuthoritativePaperFillOrchestrationRecord(record: HumanAuthoritativePaperFillOrchestrationRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported authoritative human fill schema version");
  assertHumanAuthoritativePaperOrderSubmissionRecord(record.authoritativeSubmission);
  assertHumanCanonicalPaperFillOrchestrationRecord(record.canonicalFill);
  if (record.canonicalFill.canonicalSubmission.recordHash !== record.authoritativeSubmission.canonicalSubmission.recordHash) {
    fail("authoritative human fill canonical submission mismatch");
  }
  if (!/^0x[0-9a-f]{64}$/.test(record.recordHash)) fail("authoritative human fill recordHash must be a sha256 hex hash");
  const { recordHash, ...payload } = record;
  if (recordHash !== hashCanonicalPayload(payload)) fail("authoritative human fill record hash mismatch");
}

export class HumanAuthoritativePaperFillOrchestrationService {
  private readonly canonical: HumanCanonicalPaperFillOrchestrationService;

  constructor(writer: HumanPaperFillWriter) {
    this.canonical = new HumanCanonicalPaperFillOrchestrationService(writer);
  }

  async fill(input: {
    authoritativeSubmission: HumanAuthoritativePaperOrderSubmissionRecord;
    quoteResult: RmtPaperQuoteResult;
    costPlan: PaperFillCostPlan;
  }): Promise<HumanAuthoritativePaperFillOrchestrationRecord> {
    assertHumanAuthoritativePaperOrderSubmissionRecord(input.authoritativeSubmission);
    const canonicalFill = await this.canonical.fill({
      canonicalSubmission: input.authoritativeSubmission.canonicalSubmission,
      quoteResult: input.quoteResult,
      costPlan: input.costPlan,
    });
    const payload: Omit<HumanAuthoritativePaperFillOrchestrationRecord, "recordHash"> = {
      schemaVersion: 1,
      authoritativeSubmission: structuredClone(input.authoritativeSubmission),
      canonicalFill,
    };
    const record: HumanAuthoritativePaperFillOrchestrationRecord = { ...payload, recordHash: hashCanonicalPayload(payload) };
    assertHumanAuthoritativePaperFillOrchestrationRecord(record);
    return record;
  }
}
