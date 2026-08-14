import {
  assertBps,
  assertNonEmptyString,
  assertPositiveAtomicAmount,
  hashCanonicalPayload,
  type PaperOrderIntent,
  type PaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperOrderAdmissionRecord,
  type PaperOrderAdmissionRecord,
} from "./paper-order-admission.ts";

export interface PaperOrderSubmissionWriter {
  submitPaperOrder(intent: PaperOrderIntent, idempotencyKey: string): Promise<PaperOrderRecord>;
}

export interface PaperOrderSubmissionRecord {
  schemaVersion: 1;
  admission: PaperOrderAdmissionRecord;
  idempotencyKey: string;
  order: PaperOrderRecord;
  submissionHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertIntent(intent: PaperOrderIntent): void {
  assertNonEmptyString(intent.agentId, "paper submission agentId");
  if (!Number.isSafeInteger(intent.strategyVersion) || intent.strategyVersion <= 0) {
    fail("paper submission strategyVersion must be a positive safe integer");
  }
  assertNonEmptyString(intent.accountId, "paper submission accountId");
  assertNonEmptyString(intent.inputAssetId, "paper submission inputAssetId");
  assertNonEmptyString(intent.outputAssetId, "paper submission outputAssetId");
  if (intent.inputAssetId.toLowerCase() === intent.outputAssetId.toLowerCase()) fail("paper submission assets must differ");
  assertPositiveAtomicAmount(intent.inputAmountAtomic, "paper submission inputAmountAtomic");
  assertBps(intent.maximumSlippageBps, "paper submission maximumSlippageBps");
  if (!Number.isSafeInteger(intent.createdAt) || intent.createdAt < 0) fail("paper submission createdAt must be a non-negative safe integer");
}

function assertOrderMatchesIntent(order: PaperOrderRecord, intent: PaperOrderIntent): void {
  assertNonEmptyString(order.orderId, "paper submission orderId");
  if (order.status !== "PENDING") fail("new paper order must be returned in PENDING state");
  assertIntent(order);
  if (
    order.agentId !== intent.agentId
    || order.strategyVersion !== intent.strategyVersion
    || order.accountId !== intent.accountId
    || order.inputAssetId !== intent.inputAssetId
    || order.outputAssetId !== intent.outputAssetId
    || order.inputAmountAtomic !== intent.inputAmountAtomic
    || order.maximumSlippageBps !== intent.maximumSlippageBps
    || order.createdAt !== intent.createdAt
  ) {
    fail("paper order writer returned an order that differs from admitted intent");
  }
}

export function paperOrderSubmissionIdempotencyKey(admission: PaperOrderAdmissionRecord): string {
  assertPaperOrderAdmissionRecord(admission);
  return `paper-order-admission:${admission.admissionId}`;
}

export function assertPaperOrderSubmissionRecord(record: PaperOrderSubmissionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper order submission schema version");
  assertPaperOrderAdmissionRecord(record.admission);
  assertNonEmptyString(record.idempotencyKey, "paper submission idempotencyKey");
  if (record.idempotencyKey !== paperOrderSubmissionIdempotencyKey(record.admission)) fail("paper submission idempotency key mismatch");
  assertOrderMatchesIntent(record.order, record.admission.intent);
  assertHash(record.submissionHash, "paper submissionHash");
  const { submissionHash, ...payload } = record;
  if (submissionHash !== hashCanonicalPayload(payload)) fail("paper order submission hash mismatch");
}

export class PaperOrderSubmissionService {
  private readonly writer: PaperOrderSubmissionWriter;

  constructor(writer: PaperOrderSubmissionWriter) {
    this.writer = writer;
  }

  async submit(admission: PaperOrderAdmissionRecord): Promise<PaperOrderSubmissionRecord> {
    assertPaperOrderAdmissionRecord(admission);
    const idempotencyKey = paperOrderSubmissionIdempotencyKey(admission);
    const intent = structuredClone(admission.intent);
    const order = await this.writer.submitPaperOrder(intent, idempotencyKey);
    assertOrderMatchesIntent(order, intent);
    const payload: Omit<PaperOrderSubmissionRecord, "submissionHash"> = {
      schemaVersion: 1,
      admission: structuredClone(admission),
      idempotencyKey,
      order: structuredClone(order),
    };
    const record: PaperOrderSubmissionRecord = {
      ...payload,
      submissionHash: hashCanonicalPayload(payload),
    };
    assertPaperOrderSubmissionRecord(record);
    return record;
  }
}
