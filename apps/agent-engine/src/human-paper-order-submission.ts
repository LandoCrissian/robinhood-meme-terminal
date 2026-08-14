import {
  assertNonEmptyString,
  hashCanonicalPayload,
  type HumanPaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertHumanPaperOrderAdmissionRecord,
  type HumanPaperOrderAdmissionRecord,
} from "./human-paper-order-admission.ts";
import {
  assertHumanPaperOrderSubmissionGateRecord,
  type HumanPaperOrderSubmissionGateRecord,
} from "./human-paper-order-submission-gate.ts";
import {
  assertHumanPaperRiskCapacityPlan,
  type HumanPaperRiskCapacityPlan,
} from "./human-paper-risk-capacity.ts";

export interface HumanPaperOrderSubmissionWriter {
  submitHumanPaperOrder(
    intent: HumanPaperOrderAdmissionRecord["intent"],
    idempotencyKey: string,
    expectedRevision: number,
    authorizationHash: string,
  ): Promise<HumanPaperOrderRecord>;
}

export interface HumanPaperOrderSubmissionRecord {
  schemaVersion: 2;
  admission: HumanPaperOrderAdmissionRecord;
  gate: HumanPaperOrderSubmissionGateRecord;
  riskCapacityPlan: HumanPaperRiskCapacityPlan;
  maximumRiskPlanAgeMs: number;
  idempotencyKey: string;
  order: HumanPaperOrderRecord;
  submissionHash: string;
}

export interface HumanPaperOrderSubmissionConfig {
  maximumRiskPlanAgeMs: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertPositiveAge(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail("human paper maximumRiskPlanAgeMs must be a positive safe integer");
}

export function humanPaperOrderSubmissionIdempotencyKey(admission: HumanPaperOrderAdmissionRecord): string {
  assertHumanPaperOrderAdmissionRecord(admission);
  return `human-paper-admission:${admission.admissionId}`;
}

function assertRiskPlanMatchesAdmission(
  plan: HumanPaperRiskCapacityPlan,
  admission: HumanPaperOrderAdmissionRecord,
  maximumRiskPlanAgeMs: number,
): void {
  assertPositiveAge(maximumRiskPlanAgeMs);
  assertHumanPaperRiskCapacityPlan(plan);
  if (plan.status !== "ADMITTED" || plan.admittedInputAmountAtomic === null) fail("human paper submission requires ADMITTED risk capacity");
  if (plan.participantId !== admission.intent.participantId) fail("human paper risk participant differs from admission");
  if (hashCanonicalPayload(plan.accountSnapshot) !== hashCanonicalPayload(admission.accountSnapshot)) fail("human paper risk account snapshot differs from admission");
  if (
    plan.inputAssetId !== admission.intent.inputAssetId
    || plan.outputAssetId !== admission.intent.outputAssetId
    || plan.requestedInputAmountAtomic !== admission.intent.inputAmountAtomic
    || plan.admittedInputAmountAtomic !== admission.intent.inputAmountAtomic
  ) fail("human paper risk capacity differs from admitted order amount/assets");
  if (plan.requestedMaximumSlippageBps !== admission.intent.maximumSlippageBps) fail("human paper risk slippage differs from admission");
  if (plan.plannedAt > admission.admittedAt) fail("human paper risk plan cannot be created after admission");
  if (admission.admittedAt - plan.plannedAt > maximumRiskPlanAgeMs) fail("human paper risk plan is stale at admission");
}

function assertOrderMatchesAdmission(order: HumanPaperOrderRecord, admission: HumanPaperOrderAdmissionRecord): void {
  if (order.status !== "PENDING") fail("new human paper order must be PENDING");
  assertNonEmptyString(order.orderId, "human paper orderId");
  const intent = admission.intent;
  if (
    order.participantType !== "HUMAN"
    || order.participantId !== intent.participantId
    || order.manualPolicyVersion !== intent.manualPolicyVersion
    || order.accountId !== intent.accountId
    || order.inputAssetId !== intent.inputAssetId
    || order.outputAssetId !== intent.outputAssetId
    || order.inputAmountAtomic !== intent.inputAmountAtomic
    || order.maximumSlippageBps !== intent.maximumSlippageBps
    || order.createdAt !== intent.createdAt
  ) fail("human paper order differs from admitted manual intent");
}

export function assertHumanPaperOrderSubmissionRecord(record: HumanPaperOrderSubmissionRecord): void {
  if (record.schemaVersion !== 2) fail("unsupported human paper submission schema version");
  assertHumanPaperOrderAdmissionRecord(record.admission);
  assertHumanPaperOrderSubmissionGateRecord(record.gate);
  assertPositiveAge(record.maximumRiskPlanAgeMs);
  assertRiskPlanMatchesAdmission(record.riskCapacityPlan, record.admission, record.maximumRiskPlanAgeMs);
  if (record.gate.streamId !== record.admission.streamId) fail("human paper submission gate stream mismatch");
  if (record.gate.admissionId !== record.admission.admissionId || record.gate.admissionHash !== record.admission.admissionHash) {
    fail("human paper submission gate does not belong to admission");
  }
  if (record.gate.expectedRevision !== record.admission.revision || record.gate.expectedStateHash !== record.admission.engineStateHash) {
    fail("human paper submission gate state boundary mismatch");
  }
  const expectedKey = humanPaperOrderSubmissionIdempotencyKey(record.admission);
  if (record.idempotencyKey !== expectedKey) fail("human paper submission idempotency key mismatch");
  assertOrderMatchesAdmission(record.order, record.admission);
  assertHash(record.submissionHash, "human paper submissionHash");
  const { submissionHash, ...payload } = record;
  if (record.submissionHash !== hashCanonicalPayload(payload)) fail("human paper submission hash mismatch");
}

export class HumanPaperOrderSubmissionService {
  private readonly writer: HumanPaperOrderSubmissionWriter;
  private readonly config: HumanPaperOrderSubmissionConfig;

  constructor(writer: HumanPaperOrderSubmissionWriter, config: HumanPaperOrderSubmissionConfig) {
    this.writer = writer;
    this.config = structuredClone(config);
    assertPositiveAge(this.config.maximumRiskPlanAgeMs);
  }

  async submit(input: {
    admission: HumanPaperOrderAdmissionRecord;
    gate: HumanPaperOrderSubmissionGateRecord;
    riskCapacityPlan: HumanPaperRiskCapacityPlan;
  }): Promise<HumanPaperOrderSubmissionRecord> {
    assertHumanPaperOrderAdmissionRecord(input.admission);
    assertHumanPaperOrderSubmissionGateRecord(input.gate);
    assertRiskPlanMatchesAdmission(input.riskCapacityPlan, input.admission, this.config.maximumRiskPlanAgeMs);
    if (input.gate.streamId !== input.admission.streamId) fail("human paper submission gate stream mismatch");
    if (input.gate.admissionId !== input.admission.admissionId || input.gate.admissionHash !== input.admission.admissionHash) {
      fail("human paper submission gate does not belong to admission");
    }
    if (input.gate.expectedRevision !== input.admission.revision || input.gate.expectedStateHash !== input.admission.engineStateHash) {
      fail("human paper submission gate state boundary mismatch");
    }
    const idempotencyKey = humanPaperOrderSubmissionIdempotencyKey(input.admission);
    const order = await this.writer.submitHumanPaperOrder(
      structuredClone(input.admission.intent),
      idempotencyKey,
      input.gate.expectedRevision,
      input.riskCapacityPlan.planHash,
    );
    assertOrderMatchesAdmission(order, input.admission);
    const payload: Omit<HumanPaperOrderSubmissionRecord, "submissionHash"> = {
      schemaVersion: 2,
      admission: structuredClone(input.admission),
      gate: structuredClone(input.gate),
      riskCapacityPlan: structuredClone(input.riskCapacityPlan),
      maximumRiskPlanAgeMs: this.config.maximumRiskPlanAgeMs,
      idempotencyKey,
      order: structuredClone(order),
    };
    const record: HumanPaperOrderSubmissionRecord = { ...payload, submissionHash: hashCanonicalPayload(payload) };
    assertHumanPaperOrderSubmissionRecord(record);
    return record;
  }
}
