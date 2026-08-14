import {
  assertAgentRunRecord,
  assertStrategyWithinSafetyEnvelope,
  hashCanonicalPayload,
  type AgentRunRecord,
  type AgentSafetyEnvelope,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import type { PaperCanonicalValuationHistoryStore } from "./paper-canonical-valuation-store.ts";
import {
  assertPaperCanonicalValuationRecord,
  type PaperCanonicalValuationRecord,
} from "./paper-canonical-valuation.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface AgentAuthoritativePositionReductionConfig {
  safetyEnvelope: AgentSafetyEnvelope;
  maximumRunAgeMs: number;
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
}

export interface AgentAuthoritativePositionReductionRecord {
  schemaVersion: 1;
  streamId: string;
  agentId: string;
  accountId: string;
  run: AgentRunRecord;
  strategy: StrategyVersionRecord;
  entryHash: string;
  positionAssetId: string;
  quoteAssetId: string;
  currentRevision: number;
  currentEngineStateHash: string;
  valuationHistory: PaperCanonicalValuationRecord[];
  valuationHistoryDigest: string;
  maximumRunAgeMs: number;
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
  currentPositionQuantityAtomic: string;
  requestedReductionBps: number;
  requestedInputAmountAtomic: string;
  remainingPositionQuantityAtomic: string;
  closesPosition: boolean;
  maximumSlippageBps: number;
  maximumPriceImpactBps: number;
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

function assertAtomic(value: string, field: string, positive = false): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail(`${field} must be a canonical atomic amount`);
  if (positive && BigInt(value) <= 0n) fail(`${field} must be positive`);
}

function historyDigest(valuations: PaperCanonicalValuationRecord[]): string {
  return hashCanonicalPayload(valuations.map((valuation) => ({
    valuedAt: valuation.valuation.valuedAt,
    revision: valuation.revision,
    engineStateHash: valuation.engineStateHash,
    recordHash: hashCanonicalPayload(valuation),
  })));
}

function latestStrategyForAgent(strategies: StrategyVersionRecord[], agentId: string): StrategyVersionRecord {
  const matches = strategies.filter((strategy) => strategy.agentId === agentId).sort((a, b) => b.version - a.version);
  if (matches.length === 0) fail("agent reduction requires a current strategy");
  return matches[0]!;
}

function assertTimeline(input: {
  entry: PaperArenaEntryRecord;
  valuations: PaperCanonicalValuationRecord[];
  maximumValuationGapMs: number;
  maximumLatestValuationAgeMs: number;
  plannedAt: number;
}): void {
  assertPositiveSafeInteger(input.maximumValuationGapMs, "agent reduction maximumValuationGapMs");
  assertPositiveSafeInteger(input.maximumLatestValuationAgeMs, "agent reduction maximumLatestValuationAgeMs");
  if (input.valuations.length === 0) fail("agent reduction requires authoritative valuation history");
  let previous = input.entry.enteredAt;
  for (const valuation of input.valuations) {
    assertPaperCanonicalValuationRecord(valuation);
    if (valuation.streamId !== input.entry.streamId || valuation.valuation.accountId !== input.entry.account.accountId) {
      fail("agent reduction valuation belongs to a different Arena account");
    }
    if (valuation.valuation.valuedAt <= previous && previous !== input.entry.enteredAt) fail("agent reduction valuation history is not strictly increasing");
    const gap = valuation.valuation.valuedAt - previous;
    if (gap < 0) fail("agent reduction valuation predates Arena entry");
    if (gap > input.maximumValuationGapMs) fail("agent reduction valuation history contains a gap above policy");
    previous = valuation.valuation.valuedAt;
  }
  const latest = input.valuations[input.valuations.length - 1]!;
  if (latest.valuation.valuedAt > input.plannedAt) fail("agent reduction latest valuation is from the future");
  if (input.plannedAt - latest.valuation.valuedAt > input.maximumLatestValuationAgeMs) fail("agent reduction latest valuation is stale");
}

function deriveReductionAmount(current: bigint, bps: number): bigint {
  if (!Number.isInteger(bps) || bps <= 0 || bps > 10_000) fail("agent reduction requestedReductionBps must be from 1 to 10000");
  if (bps === 10_000) return current;
  const amount = current * BigInt(bps) / 10_000n;
  if (amount <= 0n) fail("agent reduction requested bps rounds to zero atomic quantity");
  return amount;
}

export function assertAgentAuthoritativePositionReductionRecord(record: AgentAuthoritativePositionReductionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported agent authoritative reduction schema version");
  assertAgentRunRecord(record.run);
  if (record.run.proposal.action !== "CLOSE_POSITION" || !record.run.proposal.closePosition) fail("agent reduction requires a CLOSE_POSITION run");
  if (record.run.agentId !== record.agentId || record.run.accountId !== record.accountId) fail("agent reduction run identity mismatch");
  if (record.run.strategyVersion !== record.strategy.version || record.run.strategyHash !== record.strategy.strategyHash) fail("agent reduction strategy/run mismatch");
  if (record.run.proposal.closePosition.assetId.toLowerCase() !== record.positionAssetId.toLowerCase()) fail("agent reduction close asset mismatch");
  if (record.run.proposal.closePosition.requestedReductionBps !== record.requestedReductionBps) fail("agent reduction bps differs from run proposal");
  assertHash(record.entryHash, "agent reduction entryHash");
  assertHash(record.currentEngineStateHash, "agent reduction currentEngineStateHash");
  assertHash(record.valuationHistoryDigest, "agent reduction valuationHistoryDigest");
  if (record.valuationHistoryDigest !== historyDigest(record.valuationHistory)) fail("agent reduction valuation history digest mismatch");
  assertAtomic(record.currentPositionQuantityAtomic, "agent reduction current quantity", true);
  assertAtomic(record.requestedInputAmountAtomic, "agent reduction requested quantity", true);
  assertAtomic(record.remainingPositionQuantityAtomic, "agent reduction remaining quantity");
  const expectedAmount = deriveReductionAmount(BigInt(record.currentPositionQuantityAtomic), record.requestedReductionBps);
  if (expectedAmount.toString() !== record.requestedInputAmountAtomic) fail("agent reduction requested quantity is not correctly derived from bps");
  if (BigInt(record.currentPositionQuantityAtomic) - expectedAmount !== BigInt(record.remainingPositionQuantityAtomic)) fail("agent reduction remaining quantity mismatch");
  if (record.closesPosition !== (record.remainingPositionQuantityAtomic === "0")) fail("agent reduction close flag mismatch");
  if (record.maximumSlippageBps !== record.strategy.spec.execution.maximumSlippageBps) fail("agent reduction slippage differs from strategy");
  if (record.maximumPriceImpactBps !== record.strategy.spec.execution.maximumPriceImpactBps) fail("agent reduction price impact differs from strategy");
  assertTimestamp(record.plannedAt, "agent reduction plannedAt");
  assertPositiveSafeInteger(record.maximumRunAgeMs, "agent reduction maximumRunAgeMs");
  if (record.run.evaluatedAt > record.plannedAt || record.plannedAt - record.run.evaluatedAt > record.maximumRunAgeMs) fail("agent reduction run freshness mismatch");
  assertHash(record.resultHash, "agent reduction resultHash");
  const { resultHash, ...payload } = record;
  if (resultHash !== hashCanonicalPayload(payload)) fail("agent reduction result hash mismatch");
}

export class AgentAuthoritativePositionReductionService {
  private readonly stateStore: AgentStateStore;
  private readonly historyStore: PaperCanonicalValuationHistoryStore;
  private readonly streamId: string;
  private readonly config: AgentAuthoritativePositionReductionConfig;

  constructor(input: {
    stateStore: AgentStateStore;
    valuationHistoryStore: PaperCanonicalValuationHistoryStore;
    streamId: string;
    config: AgentAuthoritativePositionReductionConfig;
  }) {
    this.stateStore = input.stateStore;
    this.historyStore = input.valuationHistoryStore;
    this.streamId = input.streamId;
    this.config = structuredClone(input.config);
    assertPositiveSafeInteger(this.config.maximumRunAgeMs, "agent reduction maximumRunAgeMs");
    assertPositiveSafeInteger(this.config.maximumValuationGapMs, "agent reduction maximumValuationGapMs");
    assertPositiveSafeInteger(this.config.maximumLatestValuationAgeMs, "agent reduction maximumLatestValuationAgeMs");
  }

  async plan(input: {
    entry: PaperArenaEntryRecord;
    run: AgentRunRecord;
    plannedAt?: number;
  }): Promise<AgentAuthoritativePositionReductionRecord> {
    if (input.entry.streamId !== this.streamId) fail("agent reduction entry belongs to a different stream");
    if (input.entry.participantType !== "AGENT") fail("agent reduction requires an AGENT Arena entry");
    assertAgentRunRecord(input.run);
    if (input.run.proposal.action !== "CLOSE_POSITION" || !input.run.proposal.closePosition) fail("agent reduction requires a CLOSE_POSITION run");
    if (input.run.agentId !== input.entry.participantId || input.run.accountId !== input.entry.account.accountId) fail("agent reduction run does not belong to Arena entry");
    const plannedAt = input.plannedAt ?? Date.now();
    assertTimestamp(plannedAt, "agent reduction plannedAt");
    if (input.run.evaluatedAt > plannedAt) fail("agent reduction run is from the future");
    if (plannedAt - input.run.evaluatedAt > this.config.maximumRunAgeMs) fail("agent reduction run is stale");

    const state = await this.stateStore.load(this.streamId);
    if (!state) fail("agent reduction requires persisted engine state");
    const account = state.snapshot.paperAccounts.find((candidate) => candidate.accountId === input.entry.account.accountId);
    if (!account || account.participantType !== "AGENT" || account.participantId !== input.run.agentId) fail("agent reduction current account identity mismatch");
    const currentAgent = state.snapshot.agents.find((candidate) => candidate.id === input.run.agentId);
    if (!currentAgent) fail("agent reduction current Agent is missing");
    if (currentAgent.executionMode !== "PAPER_ONLY" || !["PAPER_ACTIVE", "QUALIFIED", "ELITE"].includes(currentAgent.performanceState)) {
      fail("agent reduction current Agent is not paper-active");
    }
    const strategy = latestStrategyForAgent(state.snapshot.strategyVersions, input.run.agentId);
    assertStrategyWithinSafetyEnvelope(strategy.spec, this.config.safetyEnvelope);
    if (strategy.version !== input.run.strategyVersion || strategy.strategyHash !== input.run.strategyHash) fail("agent reduction run is not bound to the current latest strategy");

    const valuations = await this.historyStore.list(this.streamId, account.accountId);
    assertTimeline({
      entry: input.entry,
      valuations,
      maximumValuationGapMs: this.config.maximumValuationGapMs,
      maximumLatestValuationAgeMs: this.config.maximumLatestValuationAgeMs,
      plannedAt,
    });
    const latest = valuations[valuations.length - 1]!;
    const currentStateHash = hashCanonicalPayload(state.snapshot);
    if (latest.revision !== state.revision || latest.engineStateHash !== currentStateHash) fail("agent reduction latest valuation is not bound to current engine state");
    if (latest.valuation.accountSnapshot.participantType !== "AGENT" || latest.valuation.accountSnapshot.participantId !== input.run.agentId) fail("agent reduction latest valuation participant mismatch");
    if (hashCanonicalPayload(latest.valuation.accountSnapshot.balances) !== hashCanonicalPayload(account.balances)) fail("agent reduction latest valuation account balances are stale");

    const positionAssetId = input.run.proposal.closePosition.assetId;
    const positions = latest.valuation.positionBook.positions.filter((position) => (
      position.assetId.toLowerCase() === positionAssetId.toLowerCase() && BigInt(position.quantityAtomic) > 0n
    ));
    if (positions.length !== 1) fail("agent reduction requires exactly one canonical open position for close asset");
    const position = positions[0]!;
    const balance = account.balances[position.assetId] ?? "0";
    assertAtomic(balance, "agent reduction current position balance");
    if (balance !== position.quantityAtomic) fail("agent reduction current balance differs from canonical position quantity");
    const current = BigInt(position.quantityAtomic);
    const requested = deriveReductionAmount(current, input.run.proposal.closePosition.requestedReductionBps);
    const remaining = current - requested;
    const payload: Omit<AgentAuthoritativePositionReductionRecord, "resultHash"> = {
      schemaVersion: 1,
      streamId: this.streamId,
      agentId: input.run.agentId,
      accountId: account.accountId,
      run: structuredClone(input.run),
      strategy: structuredClone(strategy),
      entryHash: input.entry.entryHash,
      positionAssetId: position.assetId,
      quoteAssetId: input.entry.quoteAssetId,
      currentRevision: state.revision,
      currentEngineStateHash: currentStateHash,
      valuationHistory: valuations.map((valuation) => structuredClone(valuation)),
      valuationHistoryDigest: historyDigest(valuations),
      maximumRunAgeMs: this.config.maximumRunAgeMs,
      maximumValuationGapMs: this.config.maximumValuationGapMs,
      maximumLatestValuationAgeMs: this.config.maximumLatestValuationAgeMs,
      currentPositionQuantityAtomic: position.quantityAtomic,
      requestedReductionBps: input.run.proposal.closePosition.requestedReductionBps,
      requestedInputAmountAtomic: requested.toString(),
      remainingPositionQuantityAtomic: remaining.toString(),
      closesPosition: remaining === 0n,
      maximumSlippageBps: strategy.spec.execution.maximumSlippageBps,
      maximumPriceImpactBps: strategy.spec.execution.maximumPriceImpactBps,
      plannedAt,
    };
    const record: AgentAuthoritativePositionReductionRecord = { ...payload, resultHash: hashCanonicalPayload(payload) };
    assertAgentAuthoritativePositionReductionRecord(record);
    return record;
  }
}
