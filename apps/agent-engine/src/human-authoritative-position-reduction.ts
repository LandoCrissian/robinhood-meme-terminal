import {
  hashCanonicalPayload,
  type AgentSafetyEnvelope,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertHumanPaperRiskPolicyWithinSafety,
  type HumanPaperRiskPolicy,
} from "./human-paper-risk-capacity.ts";
import {
  type PaperCanonicalValuationHistoryStore,
} from "./paper-canonical-valuation-store.ts";
import {
  assertPaperCanonicalValuationRecord,
  type PaperCanonicalValuationRecord,
} from "./paper-canonical-valuation.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface HumanAuthoritativePositionReductionRecord {
  schemaVersion: 1;
  streamId: string;
  participantId: string;
  accountId: string;
  positionAssetId: string;
  quoteAssetId: string;
  currentRevision: number;
  currentEngineStateHash: string;
  safetyEnvelope: AgentSafetyEnvelope;
  riskPolicy: HumanPaperRiskPolicy;
  valuationHistory: PaperCanonicalValuationRecord[];
  valuationHistoryDigest: string;
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
  currentPositionQuantityAtomic: string;
  requestedInputAmountAtomic: string;
  remainingPositionQuantityAtomic: string;
  closesPosition: boolean;
  requestedMaximumSlippageBps: number;
  maximumPriceImpactBps: number;
  plannedAt: number;
  resultHash: string;
}

export interface HumanAuthoritativePositionReductionConfig {
  safetyEnvelope: AgentSafetyEnvelope;
  riskPolicy: HumanPaperRiskPolicy;
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
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

function assertAtomic(value: string, field: string, positive = false): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail(`${field} must be a canonical atomic amount`);
  if (positive && BigInt(value) <= 0n) fail(`${field} must be positive`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function historyDigest(valuations: PaperCanonicalValuationRecord[]): string {
  return hashCanonicalPayload(valuations.map((valuation) => ({
    valuedAt: valuation.valuation.valuedAt,
    revision: valuation.revision,
    engineStateHash: valuation.engineStateHash,
    recordHash: hashCanonicalPayload(valuation),
  })));
}

function assertTimeline(input: {
  entry: PaperArenaEntryRecord;
  valuations: PaperCanonicalValuationRecord[];
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
  plannedAt: number;
}): void {
  assertPositiveSafeInteger(input.maximumValuationGapMs, "human reduction maximumValuationGapMs");
  assertPositiveSafeInteger(input.maximumLatestValuationAgeMs, "human reduction maximumLatestValuationAgeMs");
  assertTimestamp(input.plannedAt, "human reduction plannedAt");
  if (input.valuations.length === 0) fail("human position reduction requires authoritative valuation history");
  let previous = input.entry.enteredAt;
  for (const valuation of input.valuations) {
    assertPaperCanonicalValuationRecord(valuation);
    if (valuation.streamId !== input.entry.streamId || valuation.valuation.accountId !== input.entry.account.accountId) {
      fail("human reduction valuation belongs to a different Arena account");
    }
    if (valuation.valuation.valuedAt <= previous && previous !== input.entry.enteredAt) fail("human reduction valuation history is not strictly increasing");
    const gap = valuation.valuation.valuedAt - previous;
    if (gap < 0) fail("human reduction valuation predates Arena entry");
    if (gap > input.maximumValuationGapMs) fail("human reduction valuation history contains a gap above policy");
    previous = valuation.valuation.valuedAt;
  }
  const latest = input.valuations[input.valuations.length - 1]!;
  if (latest.valuation.valuedAt > input.plannedAt) fail("human reduction latest valuation is from the future");
  if (input.plannedAt - latest.valuation.valuedAt > input.maximumLatestValuationAgeMs) fail("human reduction latest valuation is stale");
}

function derive(input: {
  entry: PaperArenaEntryRecord;
  valuations: PaperCanonicalValuationRecord[];
  currentRevision: number;
  currentEngineStateHash: string;
  currentAccountBalances: Record<string, string>;
  positionAssetId: string;
  requestedInputAmountAtomic: string;
  requestedMaximumSlippageBps: number;
  plannedAt: number;
  config: HumanAuthoritativePositionReductionConfig;
}): Omit<HumanAuthoritativePositionReductionRecord, "resultHash"> {
  if (input.entry.participantType !== "HUMAN") fail("human position reduction requires a HUMAN Arena entry");
  assertHumanPaperRiskPolicyWithinSafety(input.config.riskPolicy, input.config.safetyEnvelope);
  assertTimeline({
    entry: input.entry,
    valuations: input.valuations,
    maximumValuationGapMs: input.config.maximumValuationGapMs,
    maximumLatestValuationAgeMs: input.config.maximumLatestValuationAgeMs,
    plannedAt: input.plannedAt,
  });
  const latest = input.valuations[input.valuations.length - 1]!;
  if (latest.revision !== input.currentRevision || latest.engineStateHash !== input.currentEngineStateHash) {
    fail("human reduction latest valuation is not bound to current engine state");
  }
  if (latest.valuation.accountSnapshot.participantType !== "HUMAN" || latest.valuation.accountSnapshot.participantId !== input.entry.participantId) {
    fail("human reduction latest valuation participant mismatch");
  }
  if (hashCanonicalPayload(latest.valuation.accountSnapshot.balances) !== hashCanonicalPayload(input.currentAccountBalances)) {
    fail("human reduction latest valuation account balances are stale");
  }
  if (!Number.isSafeInteger(input.requestedMaximumSlippageBps) || input.requestedMaximumSlippageBps < 0 || input.requestedMaximumSlippageBps > 10_000) {
    fail("human reduction requested slippage is invalid");
  }
  if (input.requestedMaximumSlippageBps > input.config.riskPolicy.maximumSlippageBps) fail("human reduction requested slippage exceeds risk policy");
  assertAtomic(input.requestedInputAmountAtomic, "human reduction requested amount", true);
  const positions = latest.valuation.positionBook.positions.filter((position) => (
    position.assetId.toLowerCase() === input.positionAssetId.toLowerCase()
    && BigInt(position.quantityAtomic) > 0n
  ));
  if (positions.length !== 1) fail("human reduction requires exactly one current open position");
  const position = positions[0]!;
  const balance = input.currentAccountBalances[position.assetId] ?? "0";
  assertAtomic(balance, "human reduction current position balance");
  if (balance !== position.quantityAtomic) fail("human reduction current balance differs from canonical position quantity");
  const current = BigInt(position.quantityAtomic);
  const requested = BigInt(input.requestedInputAmountAtomic);
  if (requested > current) fail("human reduction request exceeds canonical position quantity");
  const remaining = current - requested;
  return {
    schemaVersion: 1,
    streamId: input.entry.streamId,
    participantId: input.entry.participantId,
    accountId: input.entry.account.accountId,
    positionAssetId: position.assetId,
    quoteAssetId: input.entry.quoteAssetId,
    currentRevision: input.currentRevision,
    currentEngineStateHash: input.currentEngineStateHash,
    safetyEnvelope: structuredClone(input.config.safetyEnvelope),
    riskPolicy: structuredClone(input.config.riskPolicy),
    valuationHistory: input.valuations.map((valuation) => structuredClone(valuation)),
    valuationHistoryDigest: historyDigest(input.valuations),
    maximumValuationGapMs: input.config.maximumValuationGapMs,
    maximumLatestValuationAgeMs: input.config.maximumLatestValuationAgeMs,
    currentPositionQuantityAtomic: position.quantityAtomic,
    requestedInputAmountAtomic: input.requestedInputAmountAtomic,
    remainingPositionQuantityAtomic: remaining.toString(),
    closesPosition: remaining === 0n,
    requestedMaximumSlippageBps: input.requestedMaximumSlippageBps,
    maximumPriceImpactBps: input.config.riskPolicy.maximumPriceImpactBps,
    plannedAt: input.plannedAt,
  };
}

export function assertHumanAuthoritativePositionReductionRecord(record: HumanAuthoritativePositionReductionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported human authoritative reduction schema version");
  assertHash(record.currentEngineStateHash, "human reduction currentEngineStateHash");
  assertHash(record.valuationHistoryDigest, "human reduction valuationHistoryDigest");
  if (record.valuationHistoryDigest !== historyDigest(record.valuationHistory)) fail("human reduction valuation history digest mismatch");
  assertAtomic(record.currentPositionQuantityAtomic, "human reduction current quantity", true);
  assertAtomic(record.requestedInputAmountAtomic, "human reduction requested amount", true);
  assertAtomic(record.remainingPositionQuantityAtomic, "human reduction remaining quantity");
  if (BigInt(record.currentPositionQuantityAtomic) - BigInt(record.requestedInputAmountAtomic) !== BigInt(record.remainingPositionQuantityAtomic)) {
    fail("human reduction remaining quantity mismatch");
  }
  if (record.closesPosition !== (record.remainingPositionQuantityAtomic === "0")) fail("human reduction close flag mismatch");
  assertHash(record.resultHash, "human reduction resultHash");
  const { resultHash, ...payload } = record;
  if (resultHash !== hashCanonicalPayload(payload)) fail("human reduction result hash mismatch");
}

export class HumanAuthoritativePositionReductionService {
  private readonly stateStore: AgentStateStore;
  private readonly historyStore: PaperCanonicalValuationHistoryStore;
  private readonly streamId: string;
  private readonly config: HumanAuthoritativePositionReductionConfig;

  constructor(input: {
    stateStore: AgentStateStore;
    valuationHistoryStore: PaperCanonicalValuationHistoryStore;
    streamId: string;
    config: HumanAuthoritativePositionReductionConfig;
  }) {
    this.stateStore = input.stateStore;
    this.historyStore = input.valuationHistoryStore;
    this.streamId = input.streamId;
    this.config = structuredClone(input.config);
    assertHumanPaperRiskPolicyWithinSafety(this.config.riskPolicy, this.config.safetyEnvelope);
  }

  async plan(input: {
    entry: PaperArenaEntryRecord;
    positionAssetId: string;
    requestedInputAmountAtomic: string;
    requestedMaximumSlippageBps: number;
    plannedAt?: number;
  }): Promise<HumanAuthoritativePositionReductionRecord> {
    if (input.entry.streamId !== this.streamId) fail("human reduction entry belongs to a different stream");
    const plannedAt = input.plannedAt ?? Date.now();
    const state = await this.stateStore.load(this.streamId);
    if (!state) fail("human reduction requires persisted engine state");
    const account = state.snapshot.paperAccounts.find((candidate) => candidate.accountId === input.entry.account.accountId);
    if (!account) fail("human reduction current account is missing");
    if (account.participantType !== "HUMAN" || account.participantId !== input.entry.participantId) fail("human reduction current account identity mismatch");
    const valuations = await this.historyStore.list(this.streamId, account.accountId);
    const payload = derive({
      entry: input.entry,
      valuations,
      currentRevision: state.revision,
      currentEngineStateHash: hashCanonicalPayload(state.snapshot),
      currentAccountBalances: account.balances,
      positionAssetId: input.positionAssetId,
      requestedInputAmountAtomic: input.requestedInputAmountAtomic,
      requestedMaximumSlippageBps: input.requestedMaximumSlippageBps,
      plannedAt,
      config: this.config,
    });
    const record: HumanAuthoritativePositionReductionRecord = { ...payload, resultHash: hashCanonicalPayload(payload) };
    assertHumanAuthoritativePositionReductionRecord(record);
    return record;
  }
}
