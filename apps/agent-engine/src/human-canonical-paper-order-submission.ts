import {
  hashCanonicalPayload,
  type AgentSafetyEnvelope,
  type HumanPaperOrderIntent,
  type HumanPaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertHumanCanonicalRiskCapacityRecord,
  type HumanCanonicalRiskCapacityRecord,
} from "./human-canonical-risk-capacity.ts";
import {
  assertHumanPaperOrderAdmissionRecord,
  type HumanPaperOrderAdmissionRecord,
} from "./human-paper-order-admission.ts";
import {
  HumanPaperOrderSubmissionService,
  assertHumanPaperOrderSubmissionRecord,
  type HumanPaperOrderSubmissionRecord,
  type HumanPaperOrderSubmissionWriter,
} from "./human-paper-order-submission.ts";
import {
  assertHumanPaperOrderSubmissionGateRecord,
  type HumanPaperOrderSubmissionGateRecord,
} from "./human-paper-order-submission-gate.ts";
import type { HumanPaperRiskPolicy } from "./human-paper-risk-capacity.ts";

export interface HumanCanonicalPaperOrderSubmissionRecord {
  schemaVersion: 1;
  canonicalRiskCapacity: HumanCanonicalRiskCapacityRecord;
  submission: HumanPaperOrderSubmissionRecord;
  authorizationHash: string;
  recordHash: string;
}

export interface HumanCanonicalPaperOrderSubmissionConfig {
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

function assertCanonicalLink(
  admission: HumanPaperOrderAdmissionRecord,
  gate: HumanPaperOrderSubmissionGateRecord,
  canonicalRiskCapacity: HumanCanonicalRiskCapacityRecord,
): void {
  assertHumanPaperOrderAdmissionRecord(admission);
  assertHumanPaperOrderSubmissionGateRecord(gate);
  assertHumanCanonicalRiskCapacityRecord(canonicalRiskCapacity);
  const source = canonicalRiskCapacity.riskSource;
  const plan = canonicalRiskCapacity.capacityPlan;
  if (source.streamId !== admission.streamId) fail("canonical human risk source stream differs from admission");
  if (source.currentRevision !== admission.revision) fail("canonical human risk source revision differs from admission");
  if (source.currentEngineStateHash !== admission.engineStateHash) fail("canonical human risk source state differs from admission");
  if (source.entry.account.accountId !== admission.accountSnapshot.accountId) fail("canonical human risk source account differs from admission");
  if (source.entry.participantId !== admission.intent.participantId) fail("canonical human risk source participant differs from admission");
  if (plan.participantId !== admission.intent.participantId) fail("canonical human capacity participant differs from admission");
  if (plan.accountSnapshot.accountId !== admission.accountSnapshot.accountId) fail("canonical human capacity account differs from admission");
  if (gate.expectedRevision !== source.currentRevision || gate.expectedStateHash !== source.currentEngineStateHash) {
    fail("canonical human submission gate differs from canonical risk state");
  }
}

export function assertHumanCanonicalPaperOrderSubmissionRecord(record: HumanCanonicalPaperOrderSubmissionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported canonical human order submission schema version");
  assertHumanCanonicalRiskCapacityRecord(record.canonicalRiskCapacity);
  assertHumanPaperOrderSubmissionRecord(record.submission);
  assertCanonicalLink(record.submission.admission, record.submission.gate, record.canonicalRiskCapacity);
  if (record.submission.riskCapacityPlan.planHash !== record.canonicalRiskCapacity.capacityPlan.planHash) {
    fail("canonical human submission capacity plan differs from canonical wrapper");
  }
  assertHash(record.authorizationHash, "canonical human authorizationHash");
  if (record.authorizationHash !== record.canonicalRiskCapacity.resultHash) fail("canonical human authorization hash mismatch");
  assertHash(record.recordHash, "canonical human submission recordHash");
  const { recordHash, ...payload } = record;
  if (recordHash !== hashCanonicalPayload(payload)) fail("canonical human submission record hash mismatch");
}

export class HumanCanonicalPaperOrderSubmissionService {
  private readonly writer: HumanPaperOrderSubmissionWriter;
  private readonly config: HumanCanonicalPaperOrderSubmissionConfig;

  constructor(writer: HumanPaperOrderSubmissionWriter, config: HumanCanonicalPaperOrderSubmissionConfig) {
    this.writer = writer;
    this.config = structuredClone(config);
  }

  async submit(input: {
    admission: HumanPaperOrderAdmissionRecord;
    gate: HumanPaperOrderSubmissionGateRecord;
    canonicalRiskCapacity: HumanCanonicalRiskCapacityRecord;
  }): Promise<HumanCanonicalPaperOrderSubmissionRecord> {
    assertCanonicalLink(input.admission, input.gate, input.canonicalRiskCapacity);
    const authorizationHash = input.canonicalRiskCapacity.resultHash;
    const canonicalWriter: HumanPaperOrderSubmissionWriter = {
      submitHumanPaperOrder: (
        intent: HumanPaperOrderIntent,
        idempotencyKey: string,
        expectedRevision: number,
        _innerAuthorizationHash: string,
      ): Promise<HumanPaperOrderRecord> => this.writer.submitHumanPaperOrder(
        intent,
        idempotencyKey,
        expectedRevision,
        authorizationHash,
      ),
    };
    const submission = await new HumanPaperOrderSubmissionService(canonicalWriter, this.config).submit({
      admission: input.admission,
      gate: input.gate,
      riskCapacityPlan: input.canonicalRiskCapacity.capacityPlan,
    });
    const payload: Omit<HumanCanonicalPaperOrderSubmissionRecord, "recordHash"> = {
      schemaVersion: 1,
      canonicalRiskCapacity: structuredClone(input.canonicalRiskCapacity),
      submission,
      authorizationHash,
    };
    const record: HumanCanonicalPaperOrderSubmissionRecord = { ...payload, recordHash: hashCanonicalPayload(payload) };
    assertHumanCanonicalPaperOrderSubmissionRecord(record);
    return record;
  }
}
