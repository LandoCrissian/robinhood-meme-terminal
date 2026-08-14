import {
  hashCanonicalPayload,
  type AgentRecord,
  type AgentRunRecord,
  type PaperAccountRecord,
  type StrategyVersionRecord,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperOrderAdmissionRecord,
  buildPaperOrderAdmission,
  type PaperOrderAdmissionPolicy,
  type PaperOrderAdmissionRecord,
} from "./paper-order-admission.ts";
import {
  assertPaperRiskSnapshot,
  type PaperRiskSnapshot,
} from "./paper-risk-capacity.ts";
import {
  PaperTradeCapacityService,
  assertPaperTradeCapacityRecord,
  type PaperTradeCapacityRecord,
} from "./paper-trade-capacity.ts";
import {
  assertPaperTradeRequestRecord,
  buildPaperTradeRequest,
  type PaperTradeRequestPolicy,
  type PaperTradeRequestRecord,
} from "./paper-trade-request.ts";

export type PaperOpenPositionAdmissionStatus = "ADMITTED" | "BLOCKED";

export interface PaperOpenPositionAdmissionRecord {
  schemaVersion: 1;
  status: PaperOpenPositionAdmissionStatus;
  tradeRequest: PaperTradeRequestRecord;
  tradeCapacity: PaperTradeCapacityRecord;
  orderAdmission: PaperOrderAdmissionRecord | null;
  recordHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

export function assertPaperOpenPositionAdmissionRecord(record: PaperOpenPositionAdmissionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper open-position admission schema version");
  if (record.status !== "ADMITTED" && record.status !== "BLOCKED") fail("paper open-position admission status is invalid");
  assertPaperTradeRequestRecord(record.tradeRequest);
  assertPaperTradeCapacityRecord(record.tradeCapacity);
  if (record.tradeCapacity.tradeRequest.requestHash !== record.tradeRequest.requestHash) {
    fail("paper open-position capacity does not bind the same trade request");
  }
  const capacityStatus = record.tradeCapacity.capacityPlan.status;
  if (record.status === "ADMITTED") {
    if (capacityStatus !== "ADMITTED" || !record.orderAdmission) fail("admitted open-position record requires admitted capacity and order admission");
    assertPaperOrderAdmissionRecord(record.orderAdmission);
    if (record.orderAdmission.capacityPlanHash !== record.tradeCapacity.capacityPlan.planHash) {
      fail("paper open-position order admission does not bind capacity plan");
    }
  } else {
    if (capacityStatus !== "BLOCKED" || record.orderAdmission !== null) {
      fail("blocked open-position record cannot contain order admission");
    }
  }
  assertHash(record.recordHash, "paper open-position recordHash");
  const { recordHash, ...payload } = record;
  if (recordHash !== hashCanonicalPayload(payload)) fail("paper open-position admission hash mismatch");
}

export class PaperOpenPositionAdmissionService {
  private readonly capacityService: PaperTradeCapacityService;
  private readonly tradeRequestPolicy: PaperTradeRequestPolicy;
  private readonly orderAdmissionPolicy: PaperOrderAdmissionPolicy;

  constructor(input: {
    capacityService: PaperTradeCapacityService;
    tradeRequestPolicy: PaperTradeRequestPolicy;
    orderAdmissionPolicy: PaperOrderAdmissionPolicy;
  }) {
    this.capacityService = input.capacityService;
    this.tradeRequestPolicy = structuredClone(input.tradeRequestPolicy);
    this.orderAdmissionPolicy = structuredClone(input.orderAdmissionPolicy);
  }

  admit(input: {
    run: AgentRunRecord;
    strategy: StrategyVersionRecord;
    riskSnapshot: PaperRiskSnapshot;
    agent: AgentRecord;
    account: PaperAccountRecord;
    requestedAt?: number;
    admittedAt?: number;
  }): PaperOpenPositionAdmissionRecord {
    assertPaperRiskSnapshot(input.riskSnapshot);
    const tradeRequest = buildPaperTradeRequest({
      run: input.run,
      strategy: input.strategy,
      riskSnapshot: input.riskSnapshot,
      policy: this.tradeRequestPolicy,
      requestedAt: input.requestedAt,
    });
    const tradeCapacity = this.capacityService.plan({
      tradeRequest,
      agent: input.agent,
      account: input.account,
    });
    let orderAdmission: PaperOrderAdmissionRecord | null = null;
    let status: PaperOpenPositionAdmissionStatus = "BLOCKED";
    if (tradeCapacity.capacityPlan.status === "ADMITTED") {
      orderAdmission = buildPaperOrderAdmission({
        capacityPlan: tradeCapacity.capacityPlan,
        policy: this.orderAdmissionPolicy,
        admittedAt: input.admittedAt ?? tradeRequest.requestedAt,
      });
      status = "ADMITTED";
    }
    const payload: Omit<PaperOpenPositionAdmissionRecord, "recordHash"> = {
      schemaVersion: 1,
      status,
      tradeRequest,
      tradeCapacity,
      orderAdmission,
    };
    const record: PaperOpenPositionAdmissionRecord = { ...payload, recordHash: hashCanonicalPayload(payload) };
    assertPaperOpenPositionAdmissionRecord(record);
    return record;
  }
}
