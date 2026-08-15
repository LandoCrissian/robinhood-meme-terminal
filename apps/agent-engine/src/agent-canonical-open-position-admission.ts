import {
  assertAgentRunRecord,
  assertNonEmptyString,
  hashCanonicalPayload,
  type AgentRecord,
  type AgentRunRecord,
  type AgentSafetyEnvelope,
  type PaperAccountRecord,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  AgentCanonicalRiskSnapshotService,
  assertAgentCanonicalRiskSnapshotRecord,
  type AgentCanonicalRiskSnapshotRecord,
} from "./agent-canonical-risk-snapshot.ts";
import {
  PaperOpenPositionAdmissionService,
  assertPaperOpenPositionAdmissionRecord,
  type PaperOpenPositionAdmissionRecord,
} from "./paper-open-position-admission.ts";
import type { PaperOrderAdmissionPolicy } from "./paper-order-admission.ts";
import { PaperRiskCapacityPlanner } from "./paper-risk-capacity.ts";
import { PaperTradeCapacityService } from "./paper-trade-capacity.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import type { PaperCanonicalValuationRecord } from "./paper-canonical-valuation.ts";
import type { AgentEngineSnapshot } from "./snapshot.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface AgentCanonicalOpenPositionAdmissionConfig {
  safetyEnvelope: AgentSafetyEnvelope;
  riskCapacityPolicyVersion: string;
  tradeRequestPolicyVersion: string;
  maximumRiskSnapshotAgeMs: number;
  orderAdmissionPolicy: PaperOrderAdmissionPolicy;
  rollingTradeWindowMs?: number;
}

export interface AgentCanonicalOpenPositionAdmissionRecord {
  schemaVersion: 1;
  riskSource: AgentCanonicalRiskSnapshotRecord;
  admission: PaperOpenPositionAdmissionRecord;
  resultHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function currentAgent(snapshot: AgentEngineSnapshot, agentId: string): AgentRecord {
  const matches = snapshot.agents.filter((agent) => agent.id === agentId);
  if (matches.length !== 1) fail("agent canonical admission requires exactly one current agent");
  return matches[0]!;
}

function currentAccount(snapshot: AgentEngineSnapshot, accountId: string): PaperAccountRecord {
  const matches = snapshot.paperAccounts.filter((account) => account.accountId === accountId);
  if (matches.length !== 1) fail("agent canonical admission requires exactly one current paper account");
  return matches[0]!;
}

function currentStrategy(snapshot: AgentEngineSnapshot, run: AgentRunRecord): StrategyVersionRecord {
  const matches = snapshot.strategyVersions.filter((strategy) => (
    strategy.agentId === run.agentId
    && strategy.version === run.strategyVersion
    && strategy.strategyHash === run.strategyHash
  ));
  if (matches.length !== 1) fail("agent canonical admission requires exactly one current strategy version");
  return matches[0]!;
}

function assertBinding(record: AgentCanonicalOpenPositionAdmissionRecord): void {
  assertAgentCanonicalRiskSnapshotRecord(record.riskSource);
  assertPaperOpenPositionAdmissionRecord(record.admission);
  const source = record.riskSource;
  const admission = record.admission;
  const run = admission.tradeRequest.run;
  assertAgentRunRecord(run);
  if (source.entry.participantId !== run.agentId) fail("agent canonical admission entry agent mismatch");
  if (source.entry.account.accountId !== run.accountId) fail("agent canonical admission entry account mismatch");
  if (run.proposal.action !== "OPEN_POSITION" || !run.proposal.openPosition) {
    fail("agent canonical admission requires an OPEN_POSITION run");
  }
  if (source.positionAssetId.toLowerCase() !== run.proposal.openPosition.assetId.toLowerCase()) {
    fail("agent canonical admission target asset mismatch");
  }
  if (hashCanonicalPayload(admission.tradeRequest.riskSnapshot) !== hashCanonicalPayload(source.snapshot)) {
    fail("agent canonical admission risk snapshot differs from canonical source");
  }

  const agent = currentAgent(source.currentEngineSnapshot, run.agentId);
  const account = currentAccount(source.currentEngineSnapshot, run.accountId);
  const strategy = currentStrategy(source.currentEngineSnapshot, run);
  if (account.participantType !== "AGENT" || account.participantId !== agent.id) {
    fail("agent canonical admission current account does not belong to agent");
  }
  if (account.seasonId !== source.entry.season.seasonId) fail("agent canonical admission current account season mismatch");
  if (hashCanonicalPayload(admission.tradeCapacity.agentSnapshot) !== hashCanonicalPayload(agent)) {
    fail("agent canonical admission agent snapshot is not current");
  }
  if (hashCanonicalPayload(admission.tradeCapacity.accountSnapshot) !== hashCanonicalPayload(account)) {
    fail("agent canonical admission account snapshot is not current");
  }
  if (hashCanonicalPayload(admission.tradeRequest.strategy) !== hashCanonicalPayload(strategy)) {
    fail("agent canonical admission strategy snapshot is not current");
  }
}

export function assertAgentCanonicalOpenPositionAdmissionRecord(record: AgentCanonicalOpenPositionAdmissionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported agent canonical open-position admission schema version");
  assertBinding(record);
  assertHash(record.resultHash, "agent canonical open-position admission resultHash");
  const { resultHash, ...payload } = record;
  if (resultHash !== hashCanonicalPayload(payload)) fail("agent canonical open-position admission result hash mismatch");
}

export class AgentCanonicalOpenPositionAdmissionService {
  private readonly riskSource: AgentCanonicalRiskSnapshotService;
  private readonly admission: PaperOpenPositionAdmissionService;

  constructor(input: {
    stateStore: AgentStateStore;
    streamId: string;
    config: AgentCanonicalOpenPositionAdmissionConfig;
  }) {
    assertNonEmptyString(input.streamId, "agent canonical admission streamId");
    assertNonEmptyString(input.config.riskCapacityPolicyVersion, "agent canonical riskCapacityPolicyVersion");
    assertNonEmptyString(input.config.tradeRequestPolicyVersion, "agent canonical tradeRequestPolicyVersion");
    assertPositiveSafeInteger(input.config.maximumRiskSnapshotAgeMs, "agent canonical maximumRiskSnapshotAgeMs");
    this.riskSource = new AgentCanonicalRiskSnapshotService({
      store: input.stateStore,
      streamId: input.streamId,
      rollingTradeWindowMs: input.config.rollingTradeWindowMs,
    });
    const capacityService = new PaperTradeCapacityService(new PaperRiskCapacityPlanner({
      safetyEnvelope: input.config.safetyEnvelope,
      policyVersion: input.config.riskCapacityPolicyVersion,
      maximumRiskSnapshotAgeMs: input.config.maximumRiskSnapshotAgeMs,
    }));
    this.admission = new PaperOpenPositionAdmissionService({
      capacityService,
      tradeRequestPolicy: {
        policyVersion: input.config.tradeRequestPolicyVersion,
        maximumRiskSnapshotAgeMs: input.config.maximumRiskSnapshotAgeMs,
      },
      orderAdmissionPolicy: structuredClone(input.config.orderAdmissionPolicy),
    });
  }

  async admit(input: {
    entry: PaperArenaEntryRecord;
    valuations: PaperCanonicalValuationRecord[];
    run: AgentRunRecord;
    requestedAt?: number;
    admittedAt?: number;
  }): Promise<AgentCanonicalOpenPositionAdmissionRecord> {
    assertAgentRunRecord(input.run);
    if (input.run.proposal.action !== "OPEN_POSITION" || !input.run.proposal.openPosition) {
      fail("agent canonical admission requires an OPEN_POSITION run");
    }
    if (input.entry.participantType !== "AGENT") fail("agent canonical admission requires an AGENT Arena entry");
    if (input.entry.participantId !== input.run.agentId) fail("agent canonical admission entry agent mismatch");
    if (input.entry.account.accountId !== input.run.accountId) fail("agent canonical admission entry account mismatch");

    const riskSource = await this.riskSource.derive({
      entry: input.entry,
      valuations: input.valuations,
      positionAssetId: input.run.proposal.openPosition.assetId,
    });
    const agent = currentAgent(riskSource.currentEngineSnapshot, input.run.agentId);
    const account = currentAccount(riskSource.currentEngineSnapshot, input.run.accountId);
    const strategy = currentStrategy(riskSource.currentEngineSnapshot, input.run);
    const admission = this.admission.admit({
      run: input.run,
      strategy,
      riskSnapshot: riskSource.snapshot,
      agent,
      account,
      requestedAt: input.requestedAt,
      admittedAt: input.admittedAt,
    });
    const payload: Omit<AgentCanonicalOpenPositionAdmissionRecord, "resultHash"> = {
      schemaVersion: 1,
      riskSource,
      admission,
    };
    const record: AgentCanonicalOpenPositionAdmissionRecord = { ...payload, resultHash: hashCanonicalPayload(payload) };
    assertAgentCanonicalOpenPositionAdmissionRecord(record);
    return record;
  }
}
