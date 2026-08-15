import {
  assertNonEmptyString,
  hashCanonicalPayload,
  type PaperAccountRecord,
  type ParticipantType,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaEntryRecord,
  type PaperArenaEntryRecord,
} from "./paper-arena-entry.ts";
import {
  assertPaperCanonicalValuationRecord,
  type PaperCanonicalValuationRecord,
} from "./paper-canonical-valuation.ts";
import {
  assertPaperRiskSnapshot,
  buildPaperRiskSnapshot,
  type PaperRiskSnapshot,
} from "./paper-risk-capacity.ts";
import type { AgentEngineSnapshot } from "./snapshot.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface PaperCanonicalRiskSnapshotRecord {
  schemaVersion: 1;
  streamId: string;
  currentRevision: number;
  currentEngineSnapshot: AgentEngineSnapshot;
  currentEngineStateHash: string;
  entry: PaperArenaEntryRecord;
  valuations: PaperCanonicalValuationRecord[];
  positionAssetId: string;
  rollingTradeWindowMs: number;
  snapshot: PaperRiskSnapshot;
  sourceHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertParticipantType(value: ParticipantType): void {
  if (value !== "AGENT" && value !== "HUMAN") fail("canonical paper risk participant type is invalid");
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) fail("invalid canonical paper risk division operands");
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

function lossBps(baseline: bigint, current: bigint): number {
  if (baseline <= 0n) fail("canonical paper risk baseline NAV must be positive");
  if (current >= baseline) return 0;
  const value = ceilDiv((baseline - current) * 10_000n, baseline);
  return Number(value > 10_000n ? 10_000n : value);
}

function currentAccount(snapshot: AgentEngineSnapshot, accountId: string): PaperAccountRecord {
  const matches = snapshot.paperAccounts.filter((account) => account.accountId === accountId);
  if (matches.length !== 1) fail("canonical paper risk requires exactly one current paper account");
  return matches[0]!;
}

function derive(input: {
  expectedParticipantType: ParticipantType;
  streamId: string;
  currentRevision: number;
  currentEngineSnapshot: AgentEngineSnapshot;
  entry: PaperArenaEntryRecord;
  valuations: PaperCanonicalValuationRecord[];
  positionAssetId: string;
  rollingTradeWindowMs: number;
}): Omit<PaperCanonicalRiskSnapshotRecord, "sourceHash"> {
  assertParticipantType(input.expectedParticipantType);
  assertNonEmptyString(input.streamId, "canonical paper risk streamId");
  assertPositiveSafeInteger(input.currentRevision, "canonical paper risk currentRevision");
  if (input.currentEngineSnapshot.schemaVersion !== 1) fail("canonical paper risk engine snapshot version is unsupported");
  assertPaperArenaEntryRecord(input.entry);
  if (input.entry.streamId !== input.streamId) fail("canonical paper risk entry belongs to a different stream");
  if (input.entry.participantType !== input.expectedParticipantType) fail("canonical paper risk entry participant type mismatch");
  assertNonEmptyString(input.positionAssetId, "canonical paper risk positionAssetId");
  assertPositiveSafeInteger(input.rollingTradeWindowMs, "canonical paper risk rollingTradeWindowMs");
  if (!Array.isArray(input.valuations) || input.valuations.length === 0) fail("canonical paper risk requires valuation history");

  const valuations = input.valuations.map((valuation) => structuredClone(valuation));
  let previousAt = -1;
  let previousRevision = input.entry.revision;
  for (const valuation of valuations) {
    assertPaperCanonicalValuationRecord(valuation);
    if (valuation.streamId !== input.streamId) fail("canonical paper risk valuation belongs to a different stream");
    if (valuation.valuation.accountId !== input.entry.account.accountId) fail("canonical paper risk valuation account mismatch");
    if (valuation.valuation.quoteAssetId !== input.entry.quoteAssetId) fail("canonical paper risk valuation quote asset mismatch");
    if (
      valuation.valuation.accountSnapshot.participantType !== input.expectedParticipantType
      || valuation.valuation.accountSnapshot.participantId !== input.entry.participantId
    ) {
      fail("canonical paper risk valuation participant mismatch");
    }
    if (valuation.valuation.accountSnapshot.seasonId !== input.entry.season.seasonId) {
      fail("canonical paper risk valuation season mismatch");
    }
    if (valuation.valuation.valuedAt <= previousAt) fail("canonical paper risk valuations must be strictly increasing");
    if (valuation.revision < previousRevision) fail("canonical paper risk valuation revision moved backward");
    previousAt = valuation.valuation.valuedAt;
    previousRevision = valuation.revision;
  }

  const latest = valuations[valuations.length - 1]!;
  const currentStateHash = hashCanonicalPayload(input.currentEngineSnapshot);
  if (latest.revision !== input.currentRevision) fail("canonical paper risk latest valuation is not at current engine revision");
  if (latest.engineStateHash !== currentStateHash) fail("canonical paper risk latest valuation does not match current engine state");
  const account = currentAccount(input.currentEngineSnapshot, input.entry.account.accountId);
  if (account.participantType !== input.expectedParticipantType || account.participantId !== input.entry.participantId) {
    fail("canonical paper risk current account identity mismatch");
  }
  if (account.seasonId !== input.entry.season.seasonId) fail("canonical paper risk current account season mismatch");
  if (hashCanonicalPayload(account) !== hashCanonicalPayload(latest.valuation.accountSnapshot)) {
    fail("canonical paper risk latest account snapshot is stale");
  }

  const latestNav = BigInt(latest.valuation.liquidationNavQuoteAtomic);
  if (latestNav <= 0n) fail("canonical paper risk latest liquidation NAV must be positive");
  const positionValues = latest.valuation.positionValues;
  let currentPortfolioExposure = 0n;
  let currentPositionExposure = 0n;
  for (const position of positionValues) {
    const costBasis = BigInt(position.costBasisQuoteAtomic);
    const liquidation = BigInt(position.liquidationValueQuoteAtomic);
    const conservativeExposure = costBasis > liquidation ? costBasis : liquidation;
    currentPortfolioExposure += conservativeExposure;
    if (position.assetId.toLowerCase() === input.positionAssetId.toLowerCase()) {
      currentPositionExposure += conservativeExposure;
    }
  }

  let peakNav = BigInt(input.entry.startingNavQuoteAtomic);
  for (const valuation of valuations) {
    const nav = BigInt(valuation.valuation.liquidationNavQuoteAtomic);
    if (nav > peakNav) peakNav = nav;
  }
  const drawdownBps = lossBps(peakNav, latestNav);

  const windowStart = latest.valuation.valuedAt - input.rollingTradeWindowMs;
  const beforeWindow = valuations.filter((valuation) => valuation.valuation.valuedAt <= windowStart);
  let dailyBaseline: bigint;
  if (beforeWindow.length > 0) {
    dailyBaseline = BigInt(beforeWindow[beforeWindow.length - 1]!.valuation.liquidationNavQuoteAtomic);
  } else if (input.entry.enteredAt >= windowStart) {
    dailyBaseline = BigInt(input.entry.startingNavQuoteAtomic);
  } else {
    fail("canonical paper risk lacks a valuation baseline for rolling daily loss");
  }
  const dailyLossBps = lossBps(dailyBaseline, latestNav);

  const tradesToday = input.currentEngineSnapshot.paperFills.filter((fill) => (
    fill.accountId === account.accountId
    && fill.filledAt > windowStart
    && fill.filledAt <= latest.valuation.valuedAt
  )).length;

  const snapshot = buildPaperRiskSnapshot({
    accountId: account.accountId,
    quoteAssetId: input.entry.quoteAssetId,
    positionAssetId: input.positionAssetId,
    markNavAtomic: latest.valuation.liquidationNavQuoteAtomic,
    currentPortfolioExposureAtomic: currentPortfolioExposure.toString(),
    currentPositionExposureAtomic: currentPositionExposure.toString(),
    openPositionCount: positionValues.length,
    tradesToday,
    dailyLossBps,
    drawdownBps,
    capturedAt: latest.valuation.valuedAt,
  });
  assertPaperRiskSnapshot(snapshot);

  return {
    schemaVersion: 1,
    streamId: input.streamId,
    currentRevision: input.currentRevision,
    currentEngineSnapshot: structuredClone(input.currentEngineSnapshot),
    currentEngineStateHash: currentStateHash,
    entry: structuredClone(input.entry),
    valuations,
    positionAssetId: input.positionAssetId,
    rollingTradeWindowMs: input.rollingTradeWindowMs,
    snapshot,
  };
}

export function assertPaperCanonicalRiskSnapshotRecord(record: PaperCanonicalRiskSnapshotRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported canonical paper risk schema version");
  assertHash(record.currentEngineStateHash, "canonical paper risk currentEngineStateHash");
  if (record.currentEngineStateHash !== hashCanonicalPayload(record.currentEngineSnapshot)) {
    fail("canonical paper risk current engine state hash mismatch");
  }
  const rebuilt = derive({
    expectedParticipantType: record.entry.participantType,
    streamId: record.streamId,
    currentRevision: record.currentRevision,
    currentEngineSnapshot: record.currentEngineSnapshot,
    entry: record.entry,
    valuations: record.valuations,
    positionAssetId: record.positionAssetId,
    rollingTradeWindowMs: record.rollingTradeWindowMs,
  });
  assertHash(record.sourceHash, "canonical paper risk sourceHash");
  const { sourceHash, ...payload } = record;
  if (hashCanonicalPayload(rebuilt) !== hashCanonicalPayload(payload)) {
    fail("canonical paper risk payload is not correctly derived");
  }
  if (sourceHash !== hashCanonicalPayload(payload)) fail("canonical paper risk source hash mismatch");
}

export class PaperCanonicalRiskSnapshotService {
  private readonly store: AgentStateStore;
  private readonly streamId: string;
  private readonly participantType: ParticipantType;
  private readonly rollingTradeWindowMs: number;

  constructor(input: {
    store: AgentStateStore;
    streamId: string;
    participantType: ParticipantType;
    rollingTradeWindowMs?: number;
  }) {
    this.store = input.store;
    assertNonEmptyString(input.streamId, "canonical paper risk streamId");
    this.streamId = input.streamId;
    assertParticipantType(input.participantType);
    this.participantType = input.participantType;
    this.rollingTradeWindowMs = input.rollingTradeWindowMs ?? 86_400_000;
    assertPositiveSafeInteger(this.rollingTradeWindowMs, "canonical paper risk rollingTradeWindowMs");
  }

  async derive(input: {
    entry: PaperArenaEntryRecord;
    valuations: PaperCanonicalValuationRecord[];
    positionAssetId: string;
  }): Promise<PaperCanonicalRiskSnapshotRecord> {
    const state = await this.store.load(this.streamId);
    if (!state) fail("canonical paper risk requires persisted engine state");
    const payload = derive({
      expectedParticipantType: this.participantType,
      streamId: this.streamId,
      currentRevision: state.revision,
      currentEngineSnapshot: state.snapshot,
      entry: input.entry,
      valuations: input.valuations,
      positionAssetId: input.positionAssetId,
      rollingTradeWindowMs: this.rollingTradeWindowMs,
    });
    const record: PaperCanonicalRiskSnapshotRecord = { ...payload, sourceHash: hashCanonicalPayload(payload) };
    assertPaperCanonicalRiskSnapshotRecord(record);
    return record;
  }
}
