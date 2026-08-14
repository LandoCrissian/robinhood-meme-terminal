import {
  hashCanonicalPayload,
  type HumanPaperOrderIntent,
  type HumanPaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertHumanAuthoritativePositionReductionRecord,
  type HumanAuthoritativePositionReductionRecord,
} from "./human-authoritative-position-reduction.ts";
import {
  assertHumanPaperOrderAdmissionRecord,
  type HumanPaperOrderAdmissionRecord,
} from "./human-paper-order-admission.ts";
import {
  assertHumanPaperOrderSubmissionGateRecord,
  type HumanPaperOrderSubmissionGateRecord,
} from "./human-paper-order-submission-gate.ts";
import type { HumanPaperOrderSubmissionWriter } from "./human-paper-order-submission.ts";
import { assertPaperCanonicalValuationRecord } from "./paper-canonical-valuation.ts";

export interface HumanAuthoritativePositionReductionSubmissionRecord {
  schemaVersion: 1;
  reduction: HumanAuthoritativePositionReductionRecord;
  admission: HumanPaperOrderAdmissionRecord;
  gate: HumanPaperOrderSubmissionGateRecord;
  idempotencyKey: string;
  authorizationHash: string;
  order: HumanPaperOrderRecord;
  recordHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertReductionEvidence(reduction: HumanAuthoritativePositionReductionRecord): void {
  assertHumanAuthoritativePositionReductionRecord(reduction);
  if (reduction.valuationHistory.length === 0) fail("human reduction submission requires valuation history");
  let previousAt = -1;
  for (const valuation of reduction.valuationHistory) {
    assertPaperCanonicalValuationRecord(valuation);
    if (valuation.streamId !== reduction.streamId || valuation.valuation.accountId !== reduction.accountId) {
      fail("human reduction submission valuation account mismatch");
    }
    if (valuation.valuation.valuedAt <= previousAt) fail("human reduction submission valuations are not strictly increasing");
    previousAt = valuation.valuation.valuedAt;
  }
  const latest = reduction.valuationHistory[reduction.valuationHistory.length - 1]!;
  if (latest.revision !== reduction.currentRevision || latest.engineStateHash !== reduction.currentEngineStateHash) {
    fail("human reduction submission latest valuation is not current-state bound");
  }
  if (
    latest.valuation.accountSnapshot.participantType !== "HUMAN"
    || latest.valuation.accountSnapshot.participantId !== reduction.participantId
    || latest.valuation.accountSnapshot.accountId !== reduction.accountId
    || latest.valuation.quoteAssetId !== reduction.quoteAssetId
  ) fail("human reduction submission latest valuation identity mismatch");
  const positions = latest.valuation.positionBook.positions.filter((position) => (
    position.assetId.toLowerCase() === reduction.positionAssetId.toLowerCase()
    && BigInt(position.quantityAtomic) > 0n
  ));
  if (positions.length !== 1) fail("human reduction submission requires one canonical open position");
  const position = positions[0]!;
  if (position.quantityAtomic !== reduction.currentPositionQuantityAtomic) fail("human reduction current quantity differs from canonical position");
  if (latest.valuation.accountSnapshot.balances[position.assetId] !== position.quantityAtomic) {
    fail("human reduction canonical account balance differs from position quantity");
  }
  const requested = BigInt(reduction.requestedInputAmountAtomic);
  const current = BigInt(reduction.currentPositionQuantityAtomic);
  if (requested <= 0n || requested > current) fail("human reduction requested amount exceeds canonical position quantity");
  if ((current - requested).toString() !== reduction.remainingPositionQuantityAtomic) fail("human reduction remaining quantity mismatch");
}

function assertAdmissionMatchesReduction(
  admission: HumanPaperOrderAdmissionRecord,
  gate: HumanPaperOrderSubmissionGateRecord,
  reduction: HumanAuthoritativePositionReductionRecord,
): void {
  assertHumanPaperOrderAdmissionRecord(admission);
  assertHumanPaperOrderSubmissionGateRecord(gate);
  assertReductionEvidence(reduction);
  if (admission.streamId !== reduction.streamId) fail("human reduction admission stream mismatch");
  if (admission.revision !== reduction.currentRevision || admission.engineStateHash !== reduction.currentEngineStateHash) {
    fail("human reduction admission state boundary mismatch");
  }
  if (
    admission.intent.participantType !== "HUMAN"
    || admission.intent.participantId !== reduction.participantId
    || admission.intent.accountId !== reduction.accountId
    || admission.intent.inputAssetId.toLowerCase() !== reduction.positionAssetId.toLowerCase()
    || admission.intent.outputAssetId !== reduction.quoteAssetId
    || admission.intent.inputAmountAtomic !== reduction.requestedInputAmountAtomic
    || admission.intent.maximumSlippageBps !== reduction.requestedMaximumSlippageBps
  ) fail("human reduction admission differs from authoritative reduction plan");
  if (gate.admissionId !== admission.admissionId || gate.admissionHash !== admission.admissionHash) {
    fail("human reduction gate does not belong to admission");
  }
  if (gate.expectedRevision !== reduction.currentRevision || gate.expectedStateHash !== reduction.currentEngineStateHash) {
    fail("human reduction gate state boundary mismatch");
  }
}

function assertOrderMatchesAdmission(order: HumanPaperOrderRecord, admission: HumanPaperOrderAdmissionRecord): void {
  const intent = admission.intent;
  if (
    order.status !== "PENDING"
    || order.participantType !== "HUMAN"
    || order.participantId !== intent.participantId
    || order.manualPolicyVersion !== intent.manualPolicyVersion
    || order.accountId !== intent.accountId
    || order.inputAssetId !== intent.inputAssetId
    || order.outputAssetId !== intent.outputAssetId
    || order.inputAmountAtomic !== intent.inputAmountAtomic
    || order.maximumSlippageBps !== intent.maximumSlippageBps
    || order.createdAt !== intent.createdAt
  ) fail("human reduction pending order differs from admission");
}

export function assertHumanAuthoritativePositionReductionSubmissionRecord(record: HumanAuthoritativePositionReductionSubmissionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported human reduction submission schema version");
  assertAdmissionMatchesReduction(record.admission, record.gate, record.reduction);
  const expectedKey = `human-paper-reduction:${record.admission.admissionId}`;
  if (record.idempotencyKey !== expectedKey) fail("human reduction idempotency key mismatch");
  assertHash(record.authorizationHash, "human reduction authorizationHash");
  if (record.authorizationHash !== record.reduction.resultHash) fail("human reduction authorization hash mismatch");
  assertOrderMatchesAdmission(record.order, record.admission);
  assertHash(record.recordHash, "human reduction submission recordHash");
  const { recordHash, ...payload } = record;
  if (recordHash !== hashCanonicalPayload(payload)) fail("human reduction submission record hash mismatch");
}

export class HumanAuthoritativePositionReductionSubmissionService {
  private readonly writer: HumanPaperOrderSubmissionWriter;

  constructor(writer: HumanPaperOrderSubmissionWriter) {
    this.writer = writer;
  }

  async submit(input: {
    reduction: HumanAuthoritativePositionReductionRecord;
    admission: HumanPaperOrderAdmissionRecord;
    gate: HumanPaperOrderSubmissionGateRecord;
  }): Promise<HumanAuthoritativePositionReductionSubmissionRecord> {
    assertAdmissionMatchesReduction(input.admission, input.gate, input.reduction);
    const idempotencyKey = `human-paper-reduction:${input.admission.admissionId}`;
    const authorizationHash = input.reduction.resultHash;
    const order = await this.writer.submitHumanPaperOrder(
      structuredClone(input.admission.intent) as HumanPaperOrderIntent,
      idempotencyKey,
      input.gate.expectedRevision,
      authorizationHash,
    );
    assertOrderMatchesAdmission(order, input.admission);
    const payload: Omit<HumanAuthoritativePositionReductionSubmissionRecord, "recordHash"> = {
      schemaVersion: 1,
      reduction: structuredClone(input.reduction),
      admission: structuredClone(input.admission),
      gate: structuredClone(input.gate),
      idempotencyKey,
      authorizationHash,
      order: structuredClone(order),
    };
    const record: HumanAuthoritativePositionReductionSubmissionRecord = { ...payload, recordHash: hashCanonicalPayload(payload) };
    assertHumanAuthoritativePositionReductionSubmissionRecord(record);
    return record;
  }
}
