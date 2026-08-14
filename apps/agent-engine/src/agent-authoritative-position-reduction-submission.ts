import {
  hashCanonicalPayload,
  type PaperOrderIntent,
  type PaperOrderRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertAgentAuthoritativePositionReductionRecord,
  type AgentAuthoritativePositionReductionRecord,
} from "./agent-authoritative-position-reduction.ts";
import type { AgentStateStore } from "./persistence/store.ts";
import { hashDurableRequest } from "./persistence/store.ts";

export interface AgentReductionOrderWriter {
  getRevision(): number;
  submitPaperOrder(intent: PaperOrderIntent, idempotencyKey: string): Promise<PaperOrderRecord>;
}

export interface AgentAuthoritativePositionReductionSubmissionRecord {
  schemaVersion: 1;
  reduction: AgentAuthoritativePositionReductionRecord;
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

function intentFor(reduction: AgentAuthoritativePositionReductionRecord): PaperOrderIntent {
  return {
    agentId: reduction.agentId,
    strategyVersion: reduction.strategy.version,
    accountId: reduction.accountId,
    inputAssetId: reduction.positionAssetId,
    outputAssetId: reduction.quoteAssetId,
    inputAmountAtomic: reduction.requestedInputAmountAtomic,
    maximumSlippageBps: reduction.maximumSlippageBps,
    createdAt: reduction.plannedAt,
  };
}

function assertOrderMatches(order: PaperOrderRecord, reduction: AgentAuthoritativePositionReductionRecord): void {
  const intent = intentFor(reduction);
  if (order.status !== "PENDING") fail("agent reduction submission requires a PENDING order");
  if (
    order.agentId !== intent.agentId
    || order.strategyVersion !== intent.strategyVersion
    || order.accountId !== intent.accountId
    || order.inputAssetId !== intent.inputAssetId
    || order.outputAssetId !== intent.outputAssetId
    || order.inputAmountAtomic !== intent.inputAmountAtomic
    || order.maximumSlippageBps !== intent.maximumSlippageBps
    || order.createdAt !== intent.createdAt
  ) fail("agent reduction order differs from authoritative reduction intent");
}

export function agentReductionSubmissionIdempotencyKey(reduction: AgentAuthoritativePositionReductionRecord): string {
  assertAgentAuthoritativePositionReductionRecord(reduction);
  return `agent-paper-reduction:${reduction.resultHash}`;
}

export function assertAgentAuthoritativePositionReductionSubmissionRecord(record: AgentAuthoritativePositionReductionSubmissionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported agent reduction submission schema version");
  assertAgentAuthoritativePositionReductionRecord(record.reduction);
  const expectedKey = agentReductionSubmissionIdempotencyKey(record.reduction);
  if (record.idempotencyKey !== expectedKey) fail("agent reduction submission idempotency key mismatch");
  assertOrderMatches(record.order, record.reduction);
  assertHash(record.submissionHash, "agent reduction submissionHash");
  const { submissionHash, ...payload } = record;
  if (submissionHash !== hashCanonicalPayload(payload)) fail("agent reduction submission hash mismatch");
}

export class AgentAuthoritativePositionReductionSubmissionService {
  private readonly writer: AgentReductionOrderWriter;
  private readonly store: AgentStateStore;
  private readonly streamId: string;

  constructor(input: { writer: AgentReductionOrderWriter; store: AgentStateStore; streamId: string }) {
    this.writer = input.writer;
    this.store = input.store;
    this.streamId = input.streamId;
  }

  async submit(reduction: AgentAuthoritativePositionReductionRecord): Promise<AgentAuthoritativePositionReductionSubmissionRecord> {
    assertAgentAuthoritativePositionReductionRecord(reduction);
    if (reduction.streamId !== this.streamId) fail("agent reduction belongs to a different stream");
    const intent = intentFor(reduction);
    const idempotencyKey = agentReductionSubmissionIdempotencyKey(reduction);
    const requestHash = hashDurableRequest("submitPaperOrder", intent);
    const replay = await this.store.lookupMutation(this.streamId, idempotencyKey, requestHash);
    let order: PaperOrderRecord;
    if (replay) {
      if (replay.operation !== "submitPaperOrder") fail("agent reduction idempotency key belongs to another operation");
      order = structuredClone(replay.result as PaperOrderRecord);
    } else {
      const state = await this.store.load(this.streamId);
      if (!state) fail("agent reduction submission requires persisted engine state");
      if (state.revision !== reduction.currentRevision) fail("agent reduction is stale because engine revision changed");
      if (hashCanonicalPayload(state.snapshot) !== reduction.currentEngineStateHash) fail("agent reduction is stale because engine state changed");
      if (this.writer.getRevision() !== reduction.currentRevision) fail("agent reduction writer is not synchronized to planned revision");
      order = await this.writer.submitPaperOrder(intent, idempotencyKey);
    }
    assertOrderMatches(order, reduction);
    const payload: Omit<AgentAuthoritativePositionReductionSubmissionRecord, "submissionHash"> = {
      schemaVersion: 1,
      reduction: structuredClone(reduction),
      idempotencyKey,
      order: structuredClone(order),
    };
    const record: AgentAuthoritativePositionReductionSubmissionRecord = { ...payload, submissionHash: hashCanonicalPayload(payload) };
    assertAgentAuthoritativePositionReductionSubmissionRecord(record);
    return record;
  }
}
