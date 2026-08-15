import {
  hashCanonicalPayload,
  type PaperOrderIntent,
  type PaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertAgentAuthoritativeOpenPositionAdmissionRecord,
  type AgentAuthoritativeOpenPositionAdmissionRecord,
} from "./agent-authoritative-open-position-admission.ts";
import {
  assertPaperCanonicalValuationRecord,
  type PaperCanonicalValuationRecord,
} from "./paper-canonical-valuation.ts";
import type { PaperCanonicalValuationHistoryStore } from "./paper-canonical-valuation-store.ts";
import type { AgentStateStore } from "./persistence/store.ts";
import { hashDurableRequest } from "./persistence/store.ts";

export interface AgentOpenPositionOrderWriter {
  getRevision(): number;
  submitPaperOrder(intent: PaperOrderIntent, idempotencyKey: string): Promise<PaperOrderRecord>;
}

export interface AgentAuthoritativeOpenPositionSubmissionRecord {
  schemaVersion: 1;
  authoritativeAdmission: AgentAuthoritativeOpenPositionAdmissionRecord;
  authorizationHash: string;
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

function admittedIntent(admission: AgentAuthoritativeOpenPositionAdmissionRecord): PaperOrderIntent {
  assertAgentAuthoritativeOpenPositionAdmissionRecord(admission);
  const inner = admission.canonicalAdmission.admission;
  if (inner.status !== "ADMITTED" || !inner.orderAdmission) {
    fail("agent authoritative submission requires an admitted open-position authorization");
  }
  return structuredClone(inner.orderAdmission.intent);
}

function historyDigest(valuations: PaperCanonicalValuationRecord[]): string {
  valuations.forEach(assertPaperCanonicalValuationRecord);
  return hashCanonicalPayload(valuations.map((valuation) => ({
    valuedAt: valuation.valuation.valuedAt,
    revision: valuation.revision,
    engineStateHash: valuation.engineStateHash,
    recordHash: hashCanonicalPayload(valuation),
  })));
}

function assertOrderMatches(
  order: PaperOrderRecord,
  admission: AgentAuthoritativeOpenPositionAdmissionRecord,
): void {
  const intent = admittedIntent(admission);
  if (order.status !== "PENDING") fail("agent authoritative submission requires a PENDING paper order");
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
    fail("agent authoritative paper order differs from admitted intent");
  }
}

export function agentOpenPositionSubmissionIdempotencyKey(
  admission: AgentAuthoritativeOpenPositionAdmissionRecord,
): string {
  assertAgentAuthoritativeOpenPositionAdmissionRecord(admission);
  return `agent-paper-open-position:${admission.resultHash}`;
}

export function assertAgentAuthoritativeOpenPositionSubmissionRecord(
  record: AgentAuthoritativeOpenPositionSubmissionRecord,
): void {
  if (record.schemaVersion !== 1) fail("unsupported agent authoritative open-position submission schema version");
  assertAgentAuthoritativeOpenPositionAdmissionRecord(record.authoritativeAdmission);
  assertHash(record.authorizationHash, "agent authoritative submission authorizationHash");
  if (record.authorizationHash !== record.authoritativeAdmission.resultHash) {
    fail("agent authoritative submission authorization hash mismatch");
  }
  const expectedKey = agentOpenPositionSubmissionIdempotencyKey(record.authoritativeAdmission);
  if (record.idempotencyKey !== expectedKey) fail("agent authoritative submission idempotency key mismatch");
  assertOrderMatches(record.order, record.authoritativeAdmission);
  assertHash(record.submissionHash, "agent authoritative submissionHash");
  const { submissionHash, ...payload } = record;
  if (submissionHash !== hashCanonicalPayload(payload)) fail("agent authoritative submission hash mismatch");
}

export class AgentAuthoritativeOpenPositionSubmissionService {
  private readonly writer: AgentOpenPositionOrderWriter;
  private readonly stateStore: AgentStateStore;
  private readonly valuationHistoryStore: PaperCanonicalValuationHistoryStore;
  private readonly streamId: string;

  constructor(input: {
    writer: AgentOpenPositionOrderWriter;
    stateStore: AgentStateStore;
    valuationHistoryStore: PaperCanonicalValuationHistoryStore;
    streamId: string;
  }) {
    this.writer = input.writer;
    this.stateStore = input.stateStore;
    this.valuationHistoryStore = input.valuationHistoryStore;
    this.streamId = input.streamId;
  }

  async submit(
    admission: AgentAuthoritativeOpenPositionAdmissionRecord,
  ): Promise<AgentAuthoritativeOpenPositionSubmissionRecord> {
    assertAgentAuthoritativeOpenPositionAdmissionRecord(admission);
    const source = admission.canonicalAdmission.riskSource;
    if (source.streamId !== this.streamId) fail("agent authoritative admission belongs to a different stream");
    const intent = admittedIntent(admission);
    const idempotencyKey = agentOpenPositionSubmissionIdempotencyKey(admission);
    const requestHash = hashDurableRequest("submitPaperOrder", intent);
    const replay = await this.stateStore.lookupMutation(this.streamId, idempotencyKey, requestHash);
    let order: PaperOrderRecord;

    if (replay) {
      if (replay.operation !== "submitPaperOrder") {
        fail("agent authoritative submission idempotency key belongs to another operation");
      }
      order = structuredClone(replay.result as PaperOrderRecord);
    } else {
      const state = await this.stateStore.load(this.streamId);
      if (!state) fail("agent authoritative submission requires persisted engine state");
      if (state.revision !== source.currentRevision) {
        fail("agent authoritative admission is stale because engine revision changed");
      }
      if (hashCanonicalPayload(state.snapshot) !== source.currentEngineStateHash) {
        fail("agent authoritative admission is stale because engine state changed");
      }
      if (this.writer.getRevision() !== source.currentRevision) {
        fail("agent authoritative submission writer is not synchronized to admitted revision");
      }
      const currentHistory = await this.valuationHistoryStore.list(
        this.streamId,
        source.entry.account.accountId,
      );
      if (historyDigest(currentHistory) !== admission.valuationHistoryDigest) {
        fail("agent authoritative valuation history changed after admission");
      }
      order = await this.writer.submitPaperOrder(intent, idempotencyKey);
    }

    assertOrderMatches(order, admission);
    const payload: Omit<AgentAuthoritativeOpenPositionSubmissionRecord, "submissionHash"> = {
      schemaVersion: 1,
      authoritativeAdmission: structuredClone(admission),
      authorizationHash: admission.resultHash,
      idempotencyKey,
      order: structuredClone(order),
    };
    const record: AgentAuthoritativeOpenPositionSubmissionRecord = {
      ...payload,
      submissionHash: hashCanonicalPayload(payload),
    };
    assertAgentAuthoritativeOpenPositionSubmissionRecord(record);
    return record;
  }
}
