import {
  hashCanonicalPayload,
  type AgentRecord,
  type PaperAccountRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  PaperRiskCapacityPlanner,
  assertPaperRiskCapacityPlan,
  type PaperRiskCapacityPlan,
} from "./paper-risk-capacity.ts";
import {
  assertPaperTradeRequestRecord,
  type PaperTradeRequestRecord,
} from "./paper-trade-request.ts";

export interface PaperTradeCapacityRecord {
  schemaVersion: 1;
  tradeRequest: PaperTradeRequestRecord;
  agentSnapshot: AgentRecord;
  accountSnapshot: PaperAccountRecord;
  capacityPlan: PaperRiskCapacityPlan;
  capacityHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function assertMapping(record: PaperTradeCapacityRecord): void {
  const request = record.tradeRequest;
  const plan = record.capacityPlan;
  if (record.agentSnapshot.id !== request.run.agentId) fail("paper trade capacity agent snapshot mismatch");
  if (record.accountSnapshot.accountId !== request.run.accountId) fail("paper trade capacity account snapshot mismatch");
  if (record.accountSnapshot.participantType !== "AGENT" || record.accountSnapshot.participantId !== record.agentSnapshot.id) {
    fail("paper trade capacity account does not belong to agent");
  }
  if (
    plan.agentId !== request.run.agentId
    || plan.strategyVersion !== request.run.strategyVersion
    || plan.strategyHash !== request.run.strategyHash
    || plan.accountSnapshot.accountId !== record.accountSnapshot.accountId
    || plan.inputAssetId !== request.inputAssetId
    || plan.outputAssetId !== request.outputAssetId
    || plan.requestedInputAmountAtomic !== request.requestedInputAmountAtomic
    || plan.riskSnapshot.riskHash !== request.riskSnapshot.riskHash
    || plan.plannedAt !== request.requestedAt
  ) {
    fail("paper trade capacity plan does not exactly map from trade request");
  }
  if (hashCanonicalPayload(plan.marketObservation) !== hashCanonicalPayload(request.marketObservation)) {
    fail("paper trade capacity market observation changed from trade request");
  }
}

export function assertPaperTradeCapacityRecord(record: PaperTradeCapacityRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper trade capacity schema version");
  assertPaperTradeRequestRecord(record.tradeRequest);
  assertPaperRiskCapacityPlan(record.capacityPlan);
  assertMapping(record);
  assertHash(record.capacityHash, "paper trade capacityHash");
  const { capacityHash, ...payload } = record;
  if (capacityHash !== hashCanonicalPayload(payload)) fail("paper trade capacity hash mismatch");
}

export class PaperTradeCapacityService {
  private readonly planner: PaperRiskCapacityPlanner;

  constructor(planner: PaperRiskCapacityPlanner) {
    this.planner = planner;
  }

  plan(input: {
    tradeRequest: PaperTradeRequestRecord;
    agent: AgentRecord;
    account: PaperAccountRecord;
  }): PaperTradeCapacityRecord {
    assertPaperTradeRequestRecord(input.tradeRequest);
    if (input.agent.id !== input.tradeRequest.run.agentId) fail("paper trade capacity agent snapshot mismatch");
    if (input.account.accountId !== input.tradeRequest.run.accountId) fail("paper trade capacity account snapshot mismatch");
    if (input.account.participantType !== "AGENT" || input.account.participantId !== input.agent.id) {
      fail("paper trade capacity account does not belong to agent");
    }
    const capacityPlan = this.planner.plan({
      agent: structuredClone(input.agent),
      strategy: structuredClone(input.tradeRequest.strategy),
      account: structuredClone(input.account),
      riskSnapshot: structuredClone(input.tradeRequest.riskSnapshot),
      marketObservation: structuredClone(input.tradeRequest.marketObservation),
      requestedInputAmountAtomic: input.tradeRequest.requestedInputAmountAtomic,
      plannedAt: input.tradeRequest.requestedAt,
    });
    const payload: Omit<PaperTradeCapacityRecord, "capacityHash"> = {
      schemaVersion: 1,
      tradeRequest: structuredClone(input.tradeRequest),
      agentSnapshot: structuredClone(input.agent),
      accountSnapshot: structuredClone(input.account),
      capacityPlan,
    };
    const record: PaperTradeCapacityRecord = { ...payload, capacityHash: hashCanonicalPayload(payload) };
    assertPaperTradeCapacityRecord(record);
    return record;
  }
}
