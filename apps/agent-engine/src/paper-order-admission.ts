import {
  assertAtomicAmount,
  assertBps,
  assertNonEmptyString,
  assertPositiveAtomicAmount,
  hashCanonicalPayload,
  type PaperOrderIntent,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperRiskCapacityPlan,
  type PaperRiskCapacityPlan,
} from "./paper-risk-capacity.ts";

export interface PaperOrderAdmissionPolicy {
  policyVersion: string;
  maximumCapacityPlanAgeMs: number;
}

export interface PaperOrderAdmissionRecord {
  schemaVersion: 1;
  admissionId: string;
  policyVersion: string;
  maximumCapacityPlanAgeMs: number;
  capacityPlanHash: string;
  capacityPlan: PaperRiskCapacityPlan;
  intent: PaperOrderIntent;
  admittedAt: number;
  admissionHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertIntent(intent: PaperOrderIntent): void {
  assertNonEmptyString(intent.agentId, "paper order intent agentId");
  if (!Number.isSafeInteger(intent.strategyVersion) || intent.strategyVersion <= 0) {
    fail("paper order intent strategyVersion must be a positive safe integer");
  }
  assertNonEmptyString(intent.accountId, "paper order intent accountId");
  assertNonEmptyString(intent.inputAssetId, "paper order intent inputAssetId");
  assertNonEmptyString(intent.outputAssetId, "paper order intent outputAssetId");
  if (intent.inputAssetId.toLowerCase() === intent.outputAssetId.toLowerCase()) {
    fail("paper order intent assets must differ");
  }
  assertPositiveAtomicAmount(intent.inputAmountAtomic, "paper order intent inputAmountAtomic");
  assertBps(intent.maximumSlippageBps, "paper order intent maximumSlippageBps");
  assertTimestamp(intent.createdAt, "paper order intent createdAt");
}

export function assertPaperOrderAdmissionRecord(record: PaperOrderAdmissionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper order admission schema version");
  assertHash(record.admissionId, "paper order admissionId");
  assertNonEmptyString(record.policyVersion, "paper order policyVersion");
  assertPositiveSafeInteger(record.maximumCapacityPlanAgeMs, "maximumCapacityPlanAgeMs");
  assertHash(record.capacityPlanHash, "paper order capacityPlanHash");
  assertPaperRiskCapacityPlan(record.capacityPlan);
  if (record.capacityPlanHash !== record.capacityPlan.planHash) fail("paper order capacity plan hash mismatch");
  if (record.capacityPlan.status !== "ADMITTED") fail("paper order admission requires an admitted capacity plan");
  if (record.capacityPlan.admittedInputAmountAtomic === null) fail("admitted capacity plan is missing admitted input amount");
  if (record.capacityPlan.admittedInputAmountAtomic !== record.capacityPlan.requestedInputAmountAtomic) {
    fail("paper order admission refuses silently resized capacity plans");
  }
  if (record.capacityPlan.reasons.length !== 0) fail("admitted capacity plan must not contain blocking reasons");
  assertIntent(record.intent);
  assertTimestamp(record.admittedAt, "paper order admittedAt");
  if (record.admittedAt < record.capacityPlan.plannedAt) fail("paper order admission predates capacity plan");
  if (record.admittedAt - record.capacityPlan.plannedAt > record.maximumCapacityPlanAgeMs) {
    fail("paper order capacity plan is stale");
  }
  if (
    record.intent.agentId !== record.capacityPlan.agentId
    || record.intent.strategyVersion !== record.capacityPlan.strategyVersion
    || record.intent.accountId !== record.capacityPlan.accountSnapshot.accountId
    || record.intent.inputAssetId !== record.capacityPlan.inputAssetId
    || record.intent.outputAssetId !== record.capacityPlan.outputAssetId
    || record.intent.inputAmountAtomic !== record.capacityPlan.admittedInputAmountAtomic
    || record.intent.maximumSlippageBps !== record.capacityPlan.maximumSlippageBps
    || record.intent.createdAt !== record.admittedAt
  ) {
    fail("paper order intent does not exactly match admitted capacity evidence");
  }
  const expectedAdmissionId = hashCanonicalPayload({
    schemaVersion: 1,
    policyVersion: record.policyVersion,
    maximumCapacityPlanAgeMs: record.maximumCapacityPlanAgeMs,
    capacityPlanHash: record.capacityPlanHash,
    intent: record.intent,
  });
  if (record.admissionId !== expectedAdmissionId) fail("paper order admissionId mismatch");
  assertHash(record.admissionHash, "paper order admissionHash");
  const { admissionHash, ...payload } = record;
  if (record.admissionHash !== hashCanonicalPayload(payload)) fail("paper order admission hash mismatch");
}

export function buildPaperOrderAdmission(input: {
  capacityPlan: PaperRiskCapacityPlan;
  policy: PaperOrderAdmissionPolicy;
  admittedAt?: number;
}): PaperOrderAdmissionRecord {
  assertPaperRiskCapacityPlan(input.capacityPlan);
  assertNonEmptyString(input.policy.policyVersion, "paper order policyVersion");
  assertPositiveSafeInteger(input.policy.maximumCapacityPlanAgeMs, "maximumCapacityPlanAgeMs");
  const admittedAt = input.admittedAt ?? Date.now();
  assertTimestamp(admittedAt, "paper order admittedAt");
  if (input.capacityPlan.status !== "ADMITTED" || input.capacityPlan.admittedInputAmountAtomic === null) {
    fail("paper order admission requires an admitted capacity plan");
  }
  if (input.capacityPlan.admittedInputAmountAtomic !== input.capacityPlan.requestedInputAmountAtomic) {
    fail("paper order admission refuses silently resized capacity plans");
  }
  if (input.capacityPlan.reasons.length !== 0) fail("admitted capacity plan must not contain blocking reasons");
  if (admittedAt < input.capacityPlan.plannedAt) fail("paper order admission predates capacity plan");
  if (admittedAt - input.capacityPlan.plannedAt > input.policy.maximumCapacityPlanAgeMs) {
    fail("paper order capacity plan is stale");
  }
  assertPositiveAtomicAmount(input.capacityPlan.admittedInputAmountAtomic, "paper order admittedInputAmountAtomic");
  assertAtomicAmount(input.capacityPlan.maximumInputAmountAtomic, "paper order maximumInputAmountAtomic");
  if (BigInt(input.capacityPlan.admittedInputAmountAtomic) > BigInt(input.capacityPlan.maximumInputAmountAtomic)) {
    fail("paper order admitted amount exceeds capacity maximum");
  }
  const intent: PaperOrderIntent = {
    agentId: input.capacityPlan.agentId,
    strategyVersion: input.capacityPlan.strategyVersion,
    accountId: input.capacityPlan.accountSnapshot.accountId,
    inputAssetId: input.capacityPlan.inputAssetId,
    outputAssetId: input.capacityPlan.outputAssetId,
    inputAmountAtomic: input.capacityPlan.admittedInputAmountAtomic,
    maximumSlippageBps: input.capacityPlan.maximumSlippageBps,
    createdAt: admittedAt,
  };
  assertIntent(intent);
  const admissionId = hashCanonicalPayload({
    schemaVersion: 1,
    policyVersion: input.policy.policyVersion,
    maximumCapacityPlanAgeMs: input.policy.maximumCapacityPlanAgeMs,
    capacityPlanHash: input.capacityPlan.planHash,
    intent,
  });
  const payload: Omit<PaperOrderAdmissionRecord, "admissionHash"> = {
    schemaVersion: 1,
    admissionId,
    policyVersion: input.policy.policyVersion,
    maximumCapacityPlanAgeMs: input.policy.maximumCapacityPlanAgeMs,
    capacityPlanHash: input.capacityPlan.planHash,
    capacityPlan: structuredClone(input.capacityPlan),
    intent,
    admittedAt,
  };
  const record: PaperOrderAdmissionRecord = {
    ...payload,
    admissionHash: hashCanonicalPayload(payload),
  };
  assertPaperOrderAdmissionRecord(record);
  return record;
}
