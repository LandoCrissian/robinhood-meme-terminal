import {
  assertNonEmptyString,
  hashCanonicalPayload,
} from "../../../packages/agent-core/src/index.ts";
import {
  assertHumanPaperOrderAdmissionRecord,
  type HumanPaperOrderAdmissionRecord,
} from "./human-paper-order-admission.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface HumanPaperOrderSubmissionGateRecord {
  schemaVersion: 1;
  streamId: string;
  admissionId: string;
  admissionHash: string;
  expectedRevision: number;
  expectedStateHash: string;
  checkedAt: number;
  gateId: string;
  gateHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail("human paper submission revision must be a positive safe integer");
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

export function assertHumanPaperOrderSubmissionGateRecord(record: HumanPaperOrderSubmissionGateRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported human paper submission gate schema version");
  assertNonEmptyString(record.streamId, "human paper submission streamId");
  assertHash(record.admissionId, "human paper submission admissionId");
  assertHash(record.admissionHash, "human paper submission admissionHash");
  assertRevision(record.expectedRevision);
  assertHash(record.expectedStateHash, "human paper submission expectedStateHash");
  assertTimestamp(record.checkedAt, "human paper submission checkedAt");
  assertHash(record.gateId, "human paper submission gateId");
  const expectedGateId = hashCanonicalPayload({
    schemaVersion: 1,
    streamId: record.streamId,
    admissionId: record.admissionId,
    admissionHash: record.admissionHash,
    expectedRevision: record.expectedRevision,
    expectedStateHash: record.expectedStateHash,
    checkedAt: record.checkedAt,
  });
  if (record.gateId !== expectedGateId) fail("human paper submission gateId mismatch");
  assertHash(record.gateHash, "human paper submission gateHash");
  const { gateHash, ...payload } = record;
  if (record.gateHash !== hashCanonicalPayload(payload)) fail("human paper submission gate hash mismatch");
}

export class HumanPaperOrderSubmissionGateService {
  private readonly store: AgentStateStore;
  private readonly streamId: string;

  constructor(input: { store: AgentStateStore; streamId: string }) {
    this.store = input.store;
    assertNonEmptyString(input.streamId, "human paper submission streamId");
    this.streamId = input.streamId;
  }

  async check(input: {
    admission: HumanPaperOrderAdmissionRecord;
    checkedAt?: number;
  }): Promise<HumanPaperOrderSubmissionGateRecord> {
    assertHumanPaperOrderAdmissionRecord(input.admission);
    if (input.admission.streamId !== this.streamId) fail("human paper admission belongs to a different stream");
    const state = await this.store.load(this.streamId);
    if (!state) fail("human paper submission requires persisted engine state");
    if (state.revision !== input.admission.revision) fail("human paper admission is stale because engine revision changed");
    const currentStateHash = hashCanonicalPayload(state.snapshot);
    if (currentStateHash !== input.admission.engineStateHash) fail("human paper admission is stale because engine state changed");

    const currentAccounts = state.snapshot.paperAccounts.filter((account) => account.accountId === input.admission.accountSnapshot.accountId);
    if (currentAccounts.length !== 1) fail("human paper submission requires exactly one current account");
    if (hashCanonicalPayload(currentAccounts[0]) !== hashCanonicalPayload(input.admission.accountSnapshot)) {
      fail("human paper admission account snapshot is stale");
    }
    const currentSeasons = state.snapshot.seasons.filter((season) => season.seasonId === input.admission.seasonSnapshot.seasonId);
    if (currentSeasons.length !== 1) fail("human paper submission requires exactly one current season");
    if (hashCanonicalPayload(currentSeasons[0]) !== hashCanonicalPayload(input.admission.seasonSnapshot)) {
      fail("human paper admission season snapshot is stale");
    }
    if (state.snapshot.paperOrders.some((order) => order.accountId === input.admission.accountSnapshot.accountId)) {
      fail("human paper submission refuses an account with an existing paper order until participant-neutral order state is active");
    }
    if (state.snapshot.paperFills.some((fill) => fill.accountId === input.admission.accountSnapshot.accountId)) {
      fail("human paper submission refuses an account with an existing paper fill until participant-neutral order state is active");
    }

    const checkedAt = input.checkedAt ?? Date.now();
    assertTimestamp(checkedAt, "human paper submission checkedAt");
    if (checkedAt < input.admission.admittedAt) fail("human paper submission check predates admission");
    if (input.admission.seasonSnapshot.endsAt !== undefined && checkedAt > input.admission.seasonSnapshot.endsAt) {
      fail("human paper submission check is outside season window");
    }

    const gateId = hashCanonicalPayload({
      schemaVersion: 1,
      streamId: this.streamId,
      admissionId: input.admission.admissionId,
      admissionHash: input.admission.admissionHash,
      expectedRevision: input.admission.revision,
      expectedStateHash: input.admission.engineStateHash,
      checkedAt,
    });
    const payload: Omit<HumanPaperOrderSubmissionGateRecord, "gateHash"> = {
      schemaVersion: 1,
      streamId: this.streamId,
      admissionId: input.admission.admissionId,
      admissionHash: input.admission.admissionHash,
      expectedRevision: input.admission.revision,
      expectedStateHash: input.admission.engineStateHash,
      checkedAt,
      gateId,
    };
    const record: HumanPaperOrderSubmissionGateRecord = { ...payload, gateHash: hashCanonicalPayload(payload) };
    assertHumanPaperOrderSubmissionGateRecord(record);
    return record;
  }
}
