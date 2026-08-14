import {
  assertBps,
  assertNonEmptyString,
  assertPaperAccountParticipantIdentity,
  assertPositiveAtomicAmount,
  hashCanonicalPayload,
  type HumanPaperOrderIntent,
  type PaperAccountRecord,
  type SeasonRecord,
} from "../../../packages/agent-core/src/index.ts";
import type { AgentEngineSnapshot } from "./snapshot.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface HumanPaperOrderAdmissionPolicy {
  policyVersion: string;
  maximumSlippageBps: number;
  maximumInputBalanceBps: number;
}

export interface HumanPaperOrderAdmissionRecord {
  schemaVersion: 1;
  streamId: string;
  revision: number;
  engineSnapshot: AgentEngineSnapshot;
  engineStateHash: string;
  accountSnapshot: PaperAccountRecord;
  seasonSnapshot: SeasonRecord;
  policy: HumanPaperOrderAdmissionPolicy;
  intent: HumanPaperOrderIntent;
  admittedAt: number;
  admissionId: string;
  admissionHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertPositiveRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail("human paper admission revision must be a positive safe integer");
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function accountFrom(snapshot: AgentEngineSnapshot, accountId: string): PaperAccountRecord {
  const matches = snapshot.paperAccounts.filter((account) => account.accountId === accountId);
  if (matches.length !== 1) fail("human paper admission requires exactly one account in engine snapshot");
  return matches[0]!;
}

function seasonFrom(snapshot: AgentEngineSnapshot, seasonId: string): SeasonRecord {
  const matches = snapshot.seasons.filter((season) => season.seasonId === seasonId);
  if (matches.length !== 1) fail("human paper admission requires exactly one season in engine snapshot");
  return matches[0]!;
}

function assertPolicy(policy: HumanPaperOrderAdmissionPolicy): void {
  assertNonEmptyString(policy.policyVersion, "human paper manual policyVersion");
  assertBps(policy.maximumSlippageBps, "human paper maximumSlippageBps");
  assertBps(policy.maximumInputBalanceBps, "human paper maximumInputBalanceBps");
  if (policy.maximumInputBalanceBps <= 0) fail("human paper maximumInputBalanceBps must be positive");
}

function maximumInputAmount(balanceAtomic: string, bps: number): string {
  return (BigInt(balanceAtomic) * BigInt(bps) / 10_000n).toString();
}

export function assertHumanPaperOrderAdmissionRecord(record: HumanPaperOrderAdmissionRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported human paper admission schema version");
  assertNonEmptyString(record.streamId, "human paper admission streamId");
  assertPositiveRevision(record.revision);
  if (record.engineSnapshot.schemaVersion !== 1) fail("human paper admission snapshot version is unsupported");
  assertHash(record.engineStateHash, "human paper admission engineStateHash");
  if (record.engineStateHash !== hashCanonicalPayload(record.engineSnapshot)) fail("human paper admission engine state hash mismatch");
  assertPolicy(record.policy);
  assertPaperAccountParticipantIdentity(record.accountSnapshot);
  if (record.accountSnapshot.participantType !== "HUMAN") fail("human paper admission requires a HUMAN account");
  const canonicalAccount = accountFrom(record.engineSnapshot, record.accountSnapshot.accountId);
  if (hashCanonicalPayload(canonicalAccount) !== hashCanonicalPayload(record.accountSnapshot)) fail("human paper admission account differs from engine snapshot");
  const canonicalSeason = seasonFrom(record.engineSnapshot, record.accountSnapshot.seasonId);
  if (hashCanonicalPayload(canonicalSeason) !== hashCanonicalPayload(record.seasonSnapshot)) fail("human paper admission season differs from engine snapshot");

  assertTimestamp(record.admittedAt, "human paper admittedAt");
  if (record.admittedAt < record.accountSnapshot.openedAt || record.admittedAt < record.seasonSnapshot.startsAt) fail("human paper admission predates account or season");
  if (record.seasonSnapshot.endsAt !== undefined && record.admittedAt > record.seasonSnapshot.endsAt) fail("human paper admission is outside season window");

  const intent = record.intent;
  if (intent.participantType !== "HUMAN") fail("human paper intent participantType mismatch");
  if (intent.participantId !== record.accountSnapshot.participantId) fail("human paper intent participantId mismatch");
  if (intent.manualPolicyVersion !== record.policy.policyVersion) fail("human paper intent policy version mismatch");
  if (intent.accountId !== record.accountSnapshot.accountId) fail("human paper intent account mismatch");
  assertNonEmptyString(intent.inputAssetId, "human paper inputAssetId");
  assertNonEmptyString(intent.outputAssetId, "human paper outputAssetId");
  if (intent.inputAssetId.toLowerCase() === intent.outputAssetId.toLowerCase()) fail("human paper order assets must differ");
  assertPositiveAtomicAmount(intent.inputAmountAtomic, "human paper inputAmountAtomic");
  assertBps(intent.maximumSlippageBps, "human paper maximumSlippageBps");
  if (intent.maximumSlippageBps > record.policy.maximumSlippageBps) fail("human paper slippage exceeds manual policy");
  if (intent.createdAt !== record.admittedAt) fail("human paper intent timestamp must equal admission time");

  const balance = record.accountSnapshot.balances[intent.inputAssetId] ?? "0";
  assertPositiveAtomicAmount(balance, "human paper current input balance");
  const maximum = maximumInputAmount(balance, record.policy.maximumInputBalanceBps);
  if (BigInt(maximum) <= 0n) fail("human paper policy rounds maximum input amount to zero");
  if (BigInt(intent.inputAmountAtomic) > BigInt(maximum)) fail("human paper input amount exceeds manual balance policy");

  const expectedAdmissionId = hashCanonicalPayload({
    schemaVersion: 1,
    streamId: record.streamId,
    revision: record.revision,
    engineStateHash: record.engineStateHash,
    accountId: record.accountSnapshot.accountId,
    participantId: record.accountSnapshot.participantId,
    policy: record.policy,
    intent: record.intent,
  });
  assertHash(record.admissionId, "human paper admissionId");
  if (record.admissionId !== expectedAdmissionId) fail("human paper admissionId mismatch");
  assertHash(record.admissionHash, "human paper admissionHash");
  const { admissionHash, ...payload } = record;
  if (record.admissionHash !== hashCanonicalPayload(payload)) fail("human paper admission hash mismatch");
}

export class HumanPaperOrderAdmissionService {
  private readonly store: AgentStateStore;
  private readonly streamId: string;
  private readonly policy: HumanPaperOrderAdmissionPolicy;

  constructor(input: { store: AgentStateStore; streamId: string; policy: HumanPaperOrderAdmissionPolicy }) {
    this.store = input.store;
    assertNonEmptyString(input.streamId, "human paper admission streamId");
    this.streamId = input.streamId;
    this.policy = structuredClone(input.policy);
    assertPolicy(this.policy);
  }

  async admit(input: {
    accountId: string;
    inputAssetId: string;
    outputAssetId: string;
    inputAmountAtomic: string;
    maximumSlippageBps: number;
    admittedAt?: number;
  }): Promise<HumanPaperOrderAdmissionRecord> {
    assertNonEmptyString(input.accountId, "human paper admission accountId");
    assertNonEmptyString(input.inputAssetId, "human paper admission inputAssetId");
    assertNonEmptyString(input.outputAssetId, "human paper admission outputAssetId");
    if (input.inputAssetId.toLowerCase() === input.outputAssetId.toLowerCase()) fail("human paper order assets must differ");
    assertPositiveAtomicAmount(input.inputAmountAtomic, "human paper admission inputAmountAtomic");
    assertBps(input.maximumSlippageBps, "human paper admission maximumSlippageBps");
    if (input.maximumSlippageBps > this.policy.maximumSlippageBps) fail("human paper slippage exceeds manual policy");

    const state = await this.store.load(this.streamId);
    if (!state) fail("human paper admission requires persisted engine state");
    assertPositiveRevision(state.revision);
    const snapshot = structuredClone(state.snapshot);
    const account = structuredClone(accountFrom(snapshot, input.accountId));
    assertPaperAccountParticipantIdentity(account);
    if (account.participantType !== "HUMAN") fail("human paper admission requires a HUMAN account");
    const season = structuredClone(seasonFrom(snapshot, account.seasonId));
    const admittedAt = input.admittedAt ?? Date.now();
    assertTimestamp(admittedAt, "human paper admittedAt");
    if (admittedAt < account.openedAt || admittedAt < season.startsAt) fail("human paper admission predates account or season");
    if (season.endsAt !== undefined && admittedAt > season.endsAt) fail("human paper admission is outside season window");

    const balance = account.balances[input.inputAssetId] ?? "0";
    assertPositiveAtomicAmount(balance, "human paper current input balance");
    const maximum = maximumInputAmount(balance, this.policy.maximumInputBalanceBps);
    if (BigInt(maximum) <= 0n) fail("human paper policy rounds maximum input amount to zero");
    if (BigInt(input.inputAmountAtomic) > BigInt(maximum)) fail("human paper input amount exceeds manual balance policy");

    const intent: HumanPaperOrderIntent = {
      participantType: "HUMAN",
      participantId: account.participantId,
      manualPolicyVersion: this.policy.policyVersion,
      accountId: account.accountId,
      inputAssetId: input.inputAssetId,
      outputAssetId: input.outputAssetId,
      inputAmountAtomic: input.inputAmountAtomic,
      maximumSlippageBps: input.maximumSlippageBps,
      createdAt: admittedAt,
    };
    const engineStateHash = hashCanonicalPayload(snapshot);
    const admissionId = hashCanonicalPayload({
      schemaVersion: 1,
      streamId: this.streamId,
      revision: state.revision,
      engineStateHash,
      accountId: account.accountId,
      participantId: account.participantId,
      policy: this.policy,
      intent,
    });
    const payload: Omit<HumanPaperOrderAdmissionRecord, "admissionHash"> = {
      schemaVersion: 1,
      streamId: this.streamId,
      revision: state.revision,
      engineSnapshot: snapshot,
      engineStateHash,
      accountSnapshot: account,
      seasonSnapshot: season,
      policy: structuredClone(this.policy),
      intent,
      admittedAt,
      admissionId,
    };
    const record: HumanPaperOrderAdmissionRecord = { ...payload, admissionHash: hashCanonicalPayload(payload) };
    assertHumanPaperOrderAdmissionRecord(record);
    return record;
  }
}
