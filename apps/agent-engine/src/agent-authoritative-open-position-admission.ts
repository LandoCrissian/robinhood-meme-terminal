import { hashCanonicalPayload, type AgentRunRecord } from "../../../packages/agent-core/src/index.ts";
import {
  AgentCanonicalOpenPositionAdmissionService,
  assertAgentCanonicalOpenPositionAdmissionRecord,
  type AgentCanonicalOpenPositionAdmissionConfig,
  type AgentCanonicalOpenPositionAdmissionRecord,
} from "./agent-canonical-open-position-admission.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import type { PaperCanonicalValuationHistoryStore } from "./paper-canonical-valuation-store.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface AgentAuthoritativeOpenPositionAdmissionConfig extends AgentCanonicalOpenPositionAdmissionConfig {
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
}

export interface AgentAuthoritativeOpenPositionAdmissionRecord {
  schemaVersion: 1;
  canonicalAdmission: AgentCanonicalOpenPositionAdmissionRecord;
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
  valuationHistoryDigest: string;
  requestedAt: number;
  resultHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function historyDigest(record: AgentCanonicalOpenPositionAdmissionRecord): string {
  return hashCanonicalPayload(record.riskSource.valuations.map((valuation) => ({
    valuedAt: valuation.valuation.valuedAt,
    revision: valuation.revision,
    engineStateHash: valuation.engineStateHash,
    recordHash: hashCanonicalPayload(valuation),
  })));
}

function assertCadence(input: {
  canonicalAdmission: AgentCanonicalOpenPositionAdmissionRecord;
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
  requestedAt: number;
}): void {
  assertPositiveSafeInteger(input.maximumValuationGapMs, "agent authoritative maximumValuationGapMs");
  assertPositiveSafeInteger(input.maximumLatestValuationAgeMs, "agent authoritative maximumLatestValuationAgeMs");
  assertTimestamp(input.requestedAt, "agent authoritative requestedAt");
  const source = input.canonicalAdmission.riskSource;
  const valuations = source.valuations;
  if (valuations.length === 0) fail("agent authoritative admission requires valuation history");
  const first = valuations[0]!;
  if (first.valuation.valuedAt < source.entry.enteredAt) fail("agent authoritative valuation predates Arena entry");
  if (first.valuation.valuedAt - source.entry.enteredAt > input.maximumValuationGapMs) {
    fail("agent authoritative valuation history starts after maximum gap");
  }
  for (let index = 1; index < valuations.length; index += 1) {
    const previous = valuations[index - 1]!;
    const current = valuations[index]!;
    const gap = current.valuation.valuedAt - previous.valuation.valuedAt;
    if (gap <= 0) fail("agent authoritative valuation history is not strictly increasing");
    if (gap > input.maximumValuationGapMs) fail("agent authoritative valuation history contains a gap above policy");
  }
  const latest = valuations[valuations.length - 1]!;
  if (latest.valuation.valuedAt > input.requestedAt) fail("agent authoritative latest valuation is from the future");
  if (input.requestedAt - latest.valuation.valuedAt > input.maximumLatestValuationAgeMs) {
    fail("agent authoritative latest valuation is stale");
  }
  if (input.canonicalAdmission.admission.tradeRequest.requestedAt !== input.requestedAt) {
    fail("agent authoritative requestedAt differs from canonical admission");
  }
}

export function assertAgentAuthoritativeOpenPositionAdmissionRecord(
  record: AgentAuthoritativeOpenPositionAdmissionRecord,
): void {
  if (record.schemaVersion !== 1) fail("unsupported agent authoritative open-position admission schema version");
  assertAgentCanonicalOpenPositionAdmissionRecord(record.canonicalAdmission);
  assertCadence({
    canonicalAdmission: record.canonicalAdmission,
    maximumValuationGapMs: record.maximumValuationGapMs,
    maximumLatestValuationAgeMs: record.maximumLatestValuationAgeMs,
    requestedAt: record.requestedAt,
  });
  assertHash(record.valuationHistoryDigest, "agent authoritative valuationHistoryDigest");
  if (record.valuationHistoryDigest !== historyDigest(record.canonicalAdmission)) {
    fail("agent authoritative valuation history digest mismatch");
  }
  assertHash(record.resultHash, "agent authoritative admission resultHash");
  const { resultHash, ...payload } = record;
  if (resultHash !== hashCanonicalPayload(payload)) fail("agent authoritative admission result hash mismatch");
}

export class AgentAuthoritativeOpenPositionAdmissionService {
  private readonly historyStore: PaperCanonicalValuationHistoryStore;
  private readonly canonical: AgentCanonicalOpenPositionAdmissionService;
  private readonly config: AgentAuthoritativeOpenPositionAdmissionConfig;

  constructor(input: {
    stateStore: AgentStateStore;
    valuationHistoryStore: PaperCanonicalValuationHistoryStore;
    streamId: string;
    config: AgentAuthoritativeOpenPositionAdmissionConfig;
  }) {
    this.historyStore = input.valuationHistoryStore;
    this.config = structuredClone(input.config);
    assertPositiveSafeInteger(this.config.maximumValuationGapMs, "agent authoritative maximumValuationGapMs");
    assertPositiveSafeInteger(this.config.maximumLatestValuationAgeMs, "agent authoritative maximumLatestValuationAgeMs");
    this.canonical = new AgentCanonicalOpenPositionAdmissionService({
      stateStore: input.stateStore,
      streamId: input.streamId,
      config: this.config,
    });
  }

  async admit(input: {
    entry: PaperArenaEntryRecord;
    run: AgentRunRecord;
    requestedAt?: number;
    admittedAt?: number;
  }): Promise<AgentAuthoritativeOpenPositionAdmissionRecord> {
    const requestedAt = input.requestedAt ?? Date.now();
    assertTimestamp(requestedAt, "agent authoritative requestedAt");
    const valuations = await this.historyStore.list(input.entry.streamId, input.entry.account.accountId);
    const canonicalAdmission = await this.canonical.admit({
      entry: input.entry,
      valuations,
      run: input.run,
      requestedAt,
      admittedAt: input.admittedAt,
    });
    assertCadence({
      canonicalAdmission,
      maximumValuationGapMs: this.config.maximumValuationGapMs,
      maximumLatestValuationAgeMs: this.config.maximumLatestValuationAgeMs,
      requestedAt,
    });
    const payload: Omit<AgentAuthoritativeOpenPositionAdmissionRecord, "resultHash"> = {
      schemaVersion: 1,
      canonicalAdmission,
      maximumValuationGapMs: this.config.maximumValuationGapMs,
      maximumLatestValuationAgeMs: this.config.maximumLatestValuationAgeMs,
      valuationHistoryDigest: historyDigest(canonicalAdmission),
      requestedAt,
    };
    const record: AgentAuthoritativeOpenPositionAdmissionRecord = {
      ...payload,
      resultHash: hashCanonicalPayload(payload),
    };
    assertAgentAuthoritativeOpenPositionAdmissionRecord(record);
    return record;
  }
}
