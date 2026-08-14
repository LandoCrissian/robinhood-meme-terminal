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

export interface HumanPaperOrderSubmissionWriter {
  submitHumanPaperOrder(
    intent: HumanPaperOrderAdmissionRecord["intent"],
    idempotencyKey: string,
    expectedRevision: number,
  ): Promise<HumanPaperOrderRecord>;
}

export interface HumanPaperOrderSubmissionRecord {
  schemaVersion: 1;
  admission: HumanPaperOrderAdmissionRecord;
  gate: HumanPaperOrderSubmissionGateRecord;
  idempotencyKey: string;
  order: HumanPaperOrderRecord;
  submissionHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

export function humanPaperOrderSubmissionIdempotencyKey(admission: HumanPaperOrderAdmissionRecord): string {
  assertHumanPaperOrderAdmissionRecord(admission);
  return `human-paper-admission:${admission.admissionId}`;
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
  if (record.schemaVersion !== 1) fail("unsupported human paper submission schema version");
  assertHumanPaperOrderAdmissionRecord(record.admission);
  assertHumanPaperOrderSubmissionGateRecord(record.gate);
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

  constructor(writer: HumanPaperOrderSubmissionWriter) {
    this.writer = writer;
  }

  async submit(input: {
    admission: HumanPaperOrderAdmissionRecord;
    gate: HumanPaperOrderSubmissionGateRecord;
  }): Promise<HumanPaperOrderSubmissionRecord> {
    assertHumanPaperOrderAdmissionRecord(input.admission);
    assertHumanPaperOrderSubmissionGateRecord(input.gate);
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
    );
    assertOrderMatchesAdmission(order, input.admission);
    const payload: Omit<HumanPaperOrderSubmissionRecord, "submissionHash"> = {
      schemaVersion: 1,
      admission: structuredClone(input.admission),
      gate: structuredClone(input.gate),
      idempotencyKey,
      order: structuredClone(order),
    };
    const record: HumanPaperOrderSubmissionRecord = { ...payload, submissionHash: hashCanonicalPayload(payload) };
    assertHumanPaperOrderSubmissionRecord(record);
    return record;
  }
}
