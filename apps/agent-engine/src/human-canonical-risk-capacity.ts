import {
  hashCanonicalPayload,
  type AgentSafetyEnvelope,
  type MarketObservationDraft,
} from "../../../packages/agent-core/src/index.ts";
import {
  HumanCanonicalRiskSnapshotService,
  assertHumanCanonicalRiskSnapshotRecord,
  type HumanCanonicalRiskSnapshotRecord,
} from "./human-canonical-risk-snapshot.ts";
import {
  HumanPaperRiskCapacityPlanner,
  assertHumanPaperRiskCapacityPlan,
  type HumanPaperRiskCapacityPlan,
  type HumanPaperRiskPolicy,
} from "./human-paper-risk-capacity.ts";
import type { PaperArenaEntryRecord } from "./paper-arena-entry.ts";
import type { PaperCanonicalValuationRecord } from "./paper-canonical-valuation.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface HumanCanonicalRiskCapacityRecord {
  schemaVersion: 1;
  riskSource: HumanCanonicalRiskSnapshotRecord;
  capacityPlan: HumanPaperRiskCapacityPlan;
  resultHash: string;
}

export interface HumanCanonicalRiskCapacityConfig {
  safetyEnvelope: AgentSafetyEnvelope;
  riskPolicy: HumanPaperRiskPolicy;
  maximumRiskSnapshotAgeMs: number;
  rollingTradeWindowMs?: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertLink(record: HumanCanonicalRiskCapacityRecord): void {
  assertHumanCanonicalRiskSnapshotRecord(record.riskSource);
  assertHumanPaperRiskCapacityPlan(record.capacityPlan);
  const source = record.riskSource;
  const plan = record.capacityPlan;
  if (plan.participantId !== source.entry.participantId) fail("human canonical capacity participant mismatch");
  if (hashCanonicalPayload(plan.accountSnapshot) !== hashCanonicalPayload(source.snapshot.accountId === plan.accountSnapshot.accountId
    ? source.currentEngineSnapshot.paperAccounts.find((account) => account.accountId === source.snapshot.accountId)
    : null)) {
    fail("human canonical capacity account differs from canonical risk source");
  }
  if (hashCanonicalPayload(plan.riskSnapshot) !== hashCanonicalPayload(source.snapshot)) fail("human canonical capacity risk snapshot differs from canonical source");
  if (plan.outputAssetId.toLowerCase() !== source.positionAssetId.toLowerCase()) fail("human canonical capacity target asset mismatch");
  if (plan.inputAssetId !== source.entry.quoteAssetId) fail("human canonical capacity quote asset mismatch");
}

export function assertHumanCanonicalRiskCapacityRecord(record: HumanCanonicalRiskCapacityRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported human canonical risk-capacity schema version");
  assertLink(record);
  assertHash(record.resultHash, "human canonical risk-capacity resultHash");
  const { resultHash, ...payload } = record;
  if (resultHash !== hashCanonicalPayload(payload)) fail("human canonical risk-capacity result hash mismatch");
}

export class HumanCanonicalRiskCapacityService {
  private readonly riskSource: HumanCanonicalRiskSnapshotService;
  private readonly planner: HumanPaperRiskCapacityPlanner;

  constructor(input: {
    store: AgentStateStore;
    streamId: string;
    config: HumanCanonicalRiskCapacityConfig;
  }) {
    this.riskSource = new HumanCanonicalRiskSnapshotService({
      store: input.store,
      streamId: input.streamId,
      rollingTradeWindowMs: input.config.rollingTradeWindowMs,
    });
    this.planner = new HumanPaperRiskCapacityPlanner({
      safetyEnvelope: input.config.safetyEnvelope,
      policy: input.config.riskPolicy,
      maximumRiskSnapshotAgeMs: input.config.maximumRiskSnapshotAgeMs,
    });
  }

  async plan(input: {
    entry: PaperArenaEntryRecord;
    valuations: PaperCanonicalValuationRecord[];
    marketObservation: MarketObservationDraft;
    requestedInputAmountAtomic: string;
    requestedMaximumSlippageBps: number;
    plannedAt?: number;
  }): Promise<HumanCanonicalRiskCapacityRecord> {
    const riskSource = await this.riskSource.derive({
      entry: input.entry,
      valuations: input.valuations,
      positionAssetId: input.marketObservation.assetId,
    });
    const account = riskSource.currentEngineSnapshot.paperAccounts.find((candidate) => candidate.accountId === riskSource.snapshot.accountId);
    if (!account) fail("human canonical capacity current account is missing");
    const capacityPlan = this.planner.plan({
      account,
      riskSnapshot: riskSource.snapshot,
      marketObservation: input.marketObservation,
      requestedInputAmountAtomic: input.requestedInputAmountAtomic,
      requestedMaximumSlippageBps: input.requestedMaximumSlippageBps,
      plannedAt: input.plannedAt,
    });
    const payload: Omit<HumanCanonicalRiskCapacityRecord, "resultHash"> = {
      schemaVersion: 1,
      riskSource,
      capacityPlan,
    };
    const record: HumanCanonicalRiskCapacityRecord = { ...payload, resultHash: hashCanonicalPayload(payload) };
    assertHumanCanonicalRiskCapacityRecord(record);
    return record;
  }
}
