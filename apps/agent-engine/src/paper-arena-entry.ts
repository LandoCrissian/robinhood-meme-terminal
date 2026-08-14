import {
  assertAtomicAmount,
  assertNonEmptyString,
  assertPaperAccountParticipantIdentity,
  assertPositiveAtomicAmount,
  hashCanonicalPayload,
  type PaperAccountRecord,
  type ParticipantType,
  type SeasonRecord,
} from "../../../packages/agent-core/src/index.ts";
import type { AgentEngineSnapshot } from "./snapshot.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface PaperArenaEntryRecord {
  schemaVersion: 1;
  streamId: string;
  revision: number;
  engineSnapshot: AgentEngineSnapshot;
  engineStateHash: string;
  season: SeasonRecord;
  account: PaperAccountRecord;
  participantType: ParticipantType;
  participantId: string;
  quoteAssetId: string;
  startingNavQuoteAtomic: string;
  enteredAt: number;
  entryHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail("paper arena entry revision must be a positive safe integer");
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function snapshotAccount(snapshot: AgentEngineSnapshot, accountId: string): PaperAccountRecord {
  const matches = snapshot.paperAccounts.filter((account) => account.accountId === accountId);
  if (matches.length !== 1) fail("paper arena entry requires exactly one account in engine snapshot");
  return matches[0]!;
}

function snapshotSeason(snapshot: AgentEngineSnapshot, seasonId: string): SeasonRecord {
  const matches = snapshot.seasons.filter((season) => season.seasonId === seasonId);
  if (matches.length !== 1) fail("paper arena entry requires exactly one season in engine snapshot");
  return matches[0]!;
}

function assertQuoteOnlyStart(account: PaperAccountRecord, quoteAssetId: string): string {
  const quoteBalance = account.balances[quoteAssetId] ?? "0";
  assertPositiveAtomicAmount(quoteBalance, "paper arena starting quote balance");
  for (const [assetId, amount] of Object.entries(account.balances)) {
    assertNonEmptyString(assetId, "paper arena starting assetId");
    assertAtomicAmount(amount, "paper arena starting balance");
    if (assetId !== quoteAssetId && BigInt(amount) !== 0n) {
      fail("paper arena v1 requires quote-only positive starting capital");
    }
  }
  return quoteBalance;
}

export function assertPaperArenaEntryRecord(record: PaperArenaEntryRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported paper arena entry schema version");
  assertNonEmptyString(record.streamId, "paper arena streamId");
  assertRevision(record.revision);
  if (record.engineSnapshot.schemaVersion !== 1) fail("paper arena entry engine snapshot version is unsupported");
  assertHash(record.engineStateHash, "paper arena engineStateHash");
  if (record.engineStateHash !== hashCanonicalPayload(record.engineSnapshot)) fail("paper arena entry engine state hash mismatch");
  const account = snapshotAccount(record.engineSnapshot, record.account.accountId);
  assertPaperAccountParticipantIdentity(account);
  if (hashCanonicalPayload(account) !== hashCanonicalPayload(record.account)) fail("paper arena entry account differs from engine snapshot");
  const season = snapshotSeason(record.engineSnapshot, account.seasonId);
  if (hashCanonicalPayload(season) !== hashCanonicalPayload(record.season)) fail("paper arena entry season differs from engine snapshot");
  if (record.participantType !== account.participantType || record.participantId !== account.participantId) fail("paper arena participant identity mismatch");
  assertNonEmptyString(record.quoteAssetId, "paper arena quoteAssetId");
  const startingNav = assertQuoteOnlyStart(account, record.quoteAssetId);
  if (record.startingNavQuoteAtomic !== startingNav) fail("paper arena starting NAV differs from canonical account balance");
  assertTimestamp(record.enteredAt, "paper arena enteredAt");
  if (record.enteredAt !== account.openedAt) fail("paper arena entry timestamp must equal canonical account opening time");
  if (record.enteredAt < season.startsAt || (season.endsAt !== undefined && record.enteredAt > season.endsAt)) fail("paper arena entry is outside season window");
  if (record.engineSnapshot.paperOrders.some((order) => order.accountId === account.accountId)) fail("paper arena entry snapshot already contains an order for account");
  if (record.engineSnapshot.paperFills.some((fill) => fill.accountId === account.accountId)) fail("paper arena entry snapshot already contains a fill for account");
  assertHash(record.entryHash, "paper arena entryHash");
  const { entryHash, ...payload } = record;
  if (entryHash !== hashCanonicalPayload(payload)) fail("paper arena entry hash mismatch");
}

export class PaperArenaEntryService {
  private readonly store: AgentStateStore;
  private readonly streamId: string;

  constructor(input: { store: AgentStateStore; streamId: string }) {
    this.store = input.store;
    assertNonEmptyString(input.streamId, "paper arena streamId");
    this.streamId = input.streamId;
  }

  async enter(input: { accountId: string; quoteAssetId: string }): Promise<PaperArenaEntryRecord> {
    assertNonEmptyString(input.accountId, "paper arena accountId");
    assertNonEmptyString(input.quoteAssetId, "paper arena quoteAssetId");
    const state = await this.store.load(this.streamId);
    if (!state) fail("paper arena entry requires persisted engine state");
    assertRevision(state.revision);
    const snapshot = structuredClone(state.snapshot);
    const account = structuredClone(snapshotAccount(snapshot, input.accountId));
    assertPaperAccountParticipantIdentity(account);
    const season = structuredClone(snapshotSeason(snapshot, account.seasonId));
    const startingNavQuoteAtomic = assertQuoteOnlyStart(account, input.quoteAssetId);
    if (snapshot.paperOrders.some((order) => order.accountId === account.accountId)) fail("paper arena account has already submitted an order");
    if (snapshot.paperFills.some((fill) => fill.accountId === account.accountId)) fail("paper arena account has already traded");
    const payload: Omit<PaperArenaEntryRecord, "entryHash"> = {
      schemaVersion: 1,
      streamId: this.streamId,
      revision: state.revision,
      engineSnapshot: snapshot,
      engineStateHash: hashCanonicalPayload(snapshot),
      season,
      account,
      participantType: account.participantType,
      participantId: account.participantId,
      quoteAssetId: input.quoteAssetId,
      startingNavQuoteAtomic,
      enteredAt: account.openedAt,
    };
    const record: PaperArenaEntryRecord = { ...payload, entryHash: hashCanonicalPayload(payload) };
    assertPaperArenaEntryRecord(record);
    return record;
  }
}
