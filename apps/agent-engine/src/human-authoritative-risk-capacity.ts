import {
  hashCanonicalPayload,
  type AgentSafetyEnvelope,
  type MarketObservationDraft,
} from "../../../packages/agent-core/src/index.ts";
import {
  HumanCanonicalRiskCapacityService,
  assertHumanCanonicalRiskCapacityRecord,
  type HumanCanonicalRiskCapacityRecord,
} from "./human-canonical-risk-capacity.ts";
import type { HumanPaperRiskPolicy } from "./human-paper-risk-capacity.ts";
import {
  type PaperCanonicalValuationHistoryStore,
} from "./paper-canonical-valuation-store.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface HumanAuthoritativeRiskCapacityConfig {
  safetyEnvelope: AgentSafetyEnvelope;
  riskPolicy: HumanPaperRiskPolicy;
  maximumRiskSnapshotAgeMs: number;
  rollingTradeWindowMs?: number;
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
}

export interface HumanAuthoritativeRiskCapacityRecord {
  schemaVersion: 1;
  canonicalRiskCapacity: HumanCanonicalRiskCapacityRecord;
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
  valuationHistoryDigest: string;
  plannedAt: number;
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

function historyDigest(record: HumanCanonicalRiskCapacityRecord): string {
  return hashCanonicalPayload(record.riskSource.valuations.map((valuation) => ({
    valuedAt: valuation.valuation.valuedAt,
    revision: valuation.revision,
    engineStateHash: valuation.engineStateHash,
    recordHash: hashCanonicalPayload(valuation),
  })));
}

function assertCadence(input: {
  entry: PaperArenaEntryRecord;
  canonicalRiskCapacity: HumanCanonicalRiskCapacityRecord;
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
  plannedAt: number;
}): void {
  assertPositiveSafeInteger(input.maximumValuationGapMs, "human authoritative maximumValuationGapMs");
  assertPositiveSafeInteger(input.maximumLatestValuationAgeMs, "human authoritative maximumLatestValuationAgeMs");
  assertTimestamp(input.plannedAt, "human authoritative plannedAt");
  const valuations = input.canonicalRiskCapacity.riskSource.valuations;
  if (valuations.length === 0) fail("human authoritative risk requires valuation history");
  const first = valuations[0]!;
  if (first.valuation.valuedAt < input.entry.enteredAt) fail("human authoritative valuation predates Arena entry");
  if (first.valuation.valuedAt - input.entry.enteredAt > input.maximumValuationGapMs) {
    fail("human authoritative valuation history starts after maximum gap");
  }
  for (let index = 1; index < valuations.length; index += 1) {
    const previous = valuations[index - 1]!;
    const current = valuations[index]!;
    const gap = current.valuation.valuedAt - previous.valuation.valuedAt;
    if (gap <= 0) fail("human authoritative valuation history is not strictly increasing");
    if (gap > input.maximumValuationGapMs) fail("human authoritative valuation history contains a gap above policy");
  }
  const latest = valuations[valuations.length - 1]!;
  if (latest.valuation.valuedAt > input.plannedAt) fail("human authoritative latest valuation is from the future");
  if (input.plannedAt - latest.valuation.valuedAt > input.maximumLatestValuationAgeMs) {
    fail("human authoritative latest valuation is stale");
  }
}

export function assertHumanAuthoritativeRiskCapacityRecord(record: HumanAuthoritativeRiskCapacityRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported human authoritative risk-capacity schema version");
  assertHumanCanonicalRiskCapacityRecord(record.canonicalRiskCapacity);
  assertCadence({
    entry: record.canonicalRiskCapacity.riskSource.entry,
    canonicalRiskCapacity: record.canonicalRiskCapacity,
    maximumValuationGapMs: record.maximumValuationGapMs,
    maximumLatestValuationAgeMs: record.maximumLatestValuationAgeMs,
    plannedAt: record.plannedAt,
  });
  assertHash(record.valuationHistoryDigest, "human authoritative valuationHistoryDigest");
  if (record.valuationHistoryDigest !== historyDigest(record.canonicalRiskCapacity)) fail("human authoritative valuation history digest mismatch");
  assertHash(record.resultHash, "human authoritative risk-capacity resultHash");
  const { resultHash, ...payload } = record;
  if (resultHash !== hashCanonicalPayload(payload)) fail("human authoritative risk-capacity result hash mismatch");
}

export class HumanAuthoritativeRiskCapacityService {
  private readonly historyStore: PaperCanonicalValuationHistoryStore;
  private readonly canonical: HumanCanonicalRiskCapacityService;
  private readonly config: HumanAuthoritativeRiskCapacityConfig;

  constructor(input: {
    stateStore: AgentStateStore;
    valuationHistoryStore: PaperCanonicalValuationHistoryStore;
    streamId: string;
    config: HumanAuthoritativeRiskCapacityConfig;
  }) {
    this.historyStore = input.valuationHistoryStore;
    this.config = structuredClone(input.config);
    assertPositiveSafeInteger(this.config.maximumValuationGapMs, "human authoritative maximumValuationGapMs");
    assertPositiveSafeInteger(this.config.maximumLatestValuationAgeMs, "human authoritative maximumLatestValuationAgeMs");
    this.canonical = new HumanCanonicalRiskCapacityService({
      store: input.stateStore,
      streamId: input.streamId,
      config: {
        safetyEnvelope: this.config.safetyEnvelope,
        riskPolicy: this.config.riskPolicy,
        maximumRiskSnapshotAgeMs: this.config.maximumRiskSnapshotAgeMs,
        rollingTradeWindowMs: this.config.rollingTradeWindowMs,
      },
    });
  }

  async plan(input: {
    entry: PaperArenaEntryRecord;
    marketObservation: MarketObservationDraft;
    requestedInputAmountAtomic: string;
    requestedMaximumSlippageBps: number;
    plannedAt?: number;
  }): Promise<HumanAuthoritativeRiskCapacityRecord> {
    const plannedAt = input.plannedAt ?? Date.now();
    assertTimestamp(plannedAt, "human authoritative plannedAt");
    const valuations = await this.historyStore.list(input.entry.streamId, input.entry.account.accountId);
    const canonicalRiskCapacity = await this.canonical.plan({
      entry: input.entry,
      valuations,
      marketObservation: input.marketObservation,
      requestedInputAmountAtomic: input.requestedInputAmountAtomic,
      requestedMaximumSlippageBps: input.requestedMaximumSlippageBps,
      plannedAt,
    });
    assertCadence({
      entry: input.entry,
      canonicalRiskCapacity,
      maximumValuationGapMs: this.config.maximumValuationGapMs,
      maximumLatestValuationAgeMs: this.config.maximumLatestValuationAgeMs,
      plannedAt,
    });
    const payload: Omit<HumanAuthoritativeRiskCapacityRecord, "resultHash"> = {
      schemaVersion: 1,
      canonicalRiskCapacity,
      maximumValuationGapMs: this.config.maximumValuationGapMs,
      maximumLatestValuationAgeMs: this.config.maximumLatestValuationAgeMs,
      valuationHistoryDigest: historyDigest(canonicalRiskCapacity),
      plannedAt,
    };
    const record: HumanAuthoritativeRiskCapacityRecord = { ...payload, resultHash: hashCanonicalPayload(payload) };
    assertHumanAuthoritativeRiskCapacityRecord(record);
    return record;
  }
}
