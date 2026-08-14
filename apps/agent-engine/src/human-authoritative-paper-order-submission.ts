import {
  hashCanonicalPayload,
  type AgentSafetyEnvelope,
  type HumanPaperOrderIntent,
  type HumanPaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  HumanCanonicalPaperOrderSubmissionService,
  assertHumanCanonicalPaperOrderSubmissionRecord,
  type HumanCanonicalPaperOrderSubmissionRecord,
} from "./human-canonical-paper-order-submission.ts";
import {
  assertHumanAuthoritativeRiskCapacityRecord,
  type HumanAuthoritativeRiskCapacityRecord,
} from "./human-authoritative-risk-capacity.ts";
import type { HumanPaperOrderAdmissionRecord } from "./human-paper-order-admission.ts";
import type { HumanPaperOrderSubmissionGateRecord } from "./human-paper-order-submission-gate.ts";
import type { HumanPaperOrderSubmissionWriter } from "./human-paper-order-submission.ts";
import type { HumanPaperRiskPolicy } from "./human-paper-risk-capacity.ts";

export interface HumanAuthoritativePaperOrderSubmissionRecord {
  schemaVersion: 1;
  authoritativeRiskCapacity: HumanAuthoritativeRiskCapacityRecord;
  canonicalSubmission: HumanCanonicalPaperOrderSubmissionRecord;
  authorizationHash: string;
  recordHash: string;
}

export interface HumanAuthoritativePaperOrderSubmissionConfig {
  maximumRiskPlanAgeMs: number;
  safetyEnvelope: AgentSafetyEnvelope;
  riskPolicy: HumanPaperRiskPolicy;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertLink(
  authoritative: HumanAuthoritativeRiskCapacityRecord,
  canonicalSubmission: HumanCanonicalPaperOrderSubmissionRecord,
): void {
  assertHumanAuthoritativeRiskCapacityRecord(authoritative);
  assertHumanCanonicalPaperOrderSubmissionRecord(canonicalSubmission);
  if (canonicalSubmission.canonicalRiskCapacity.resultHash !== authoritative.canonicalRiskCapacity.resultHash) {
    fail("authoritative human submission canonical risk capacity mismatch");
  }
  if (canonicalSubmission.submission.riskCapacityPlan.planHash !== authoritative.canonicalRiskCapacity.capacityPlan.planHash) {
    fail("authoritative human submission risk plan mismatch");
  }
  const source = authoritative.canonicalRiskCapacity.riskSource;
  const admission = canonicalSubmission.submission.admission;
  if (source.currentRevision !== admission.revision || source.currentEngineStateHash !== admission.engineStateHash) {
    fail("authoritative human submission state boundary mismatch");
  }
}

export function assertHumanAuthoritativePaperOrderSubmissionRecord(record: HumanAuthoritativePaperOrderSubmissionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported authoritative human submission schema version");
  assertLink(record.authoritativeRiskCapacity, record.canonicalSubmission);
  assertHash(record.authorizationHash, "authoritative human authorizationHash");
  if (record.authorizationHash !== record.authoritativeRiskCapacity.resultHash) fail("authoritative human authorization hash mismatch");
  assertHash(record.recordHash, "authoritative human submission recordHash");
  const { recordHash, ...payload } = record;
  if (recordHash !== hashCanonicalPayload(payload)) fail("authoritative human submission record hash mismatch");
}

export class HumanAuthoritativePaperOrderSubmissionService {
  private readonly writer: HumanPaperOrderSubmissionWriter;
  private readonly config: HumanAuthoritativePaperOrderSubmissionConfig;

  constructor(writer: HumanPaperOrderSubmissionWriter, config: HumanAuthoritativePaperOrderSubmissionConfig) {
    this.writer = writer;
    this.config = structuredClone(config);
  }

  async submit(input: {
    admission: HumanPaperOrderAdmissionRecord;
    gate: HumanPaperOrderSubmissionGateRecord;
    authoritativeRiskCapacity: HumanAuthoritativeRiskCapacityRecord;
  }): Promise<HumanAuthoritativePaperOrderSubmissionRecord> {
    assertHumanAuthoritativeRiskCapacityRecord(input.authoritativeRiskCapacity);
    const authorizationHash = input.authoritativeRiskCapacity.resultHash;
    const authoritativeWriter: HumanPaperOrderSubmissionWriter = {
      submitHumanPaperOrder: (
        intent: HumanPaperOrderIntent,
        idempotencyKey: string,
        expectedRevision: number,
        _canonicalAuthorizationHash: string,
      ): Promise<HumanPaperOrderRecord> => this.writer.submitHumanPaperOrder(
        intent,
        idempotencyKey,
        expectedRevision,
        authorizationHash,
      ),
    };
    const canonicalSubmission = await new HumanCanonicalPaperOrderSubmissionService(authoritativeWriter, this.config).submit({
      admission: input.admission,
      gate: input.gate,
      canonicalRiskCapacity: input.authoritativeRiskCapacity.canonicalRiskCapacity,
    });
    assertLink(input.authoritativeRiskCapacity, canonicalSubmission);
    const payload: Omit<HumanAuthoritativePaperOrderSubmissionRecord, "recordHash"> = {
      schemaVersion: 1,
      authoritativeRiskCapacity: structuredClone(input.authoritativeRiskCapacity),
      canonicalSubmission,
      authorizationHash,
    };
    const record: HumanAuthoritativePaperOrderSubmissionRecord = { ...payload, recordHash: hashCanonicalPayload(payload) };
    assertHumanAuthoritativePaperOrderSubmissionRecord(record);
    return record;
  }
}
