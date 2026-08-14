import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  PaperArenaEntryService,
  assertPaperArenaEntryRecord,
  type PaperArenaEntryRecord,
} from "./paper-arena-entry.ts";
import type { PaperArenaEntryStore } from "./paper-arena-entry-store.ts";
import type { AgentStateStore } from "./persistence/store.ts";

export interface PaperArenaRosterRecord {
  schemaVersion: 1;
  streamId: string;
  seasonId: string;
  quoteAssetId: string;
  startingNavQuoteAtomic: string;
  entries: PaperArenaEntryRecord[];
  agentCount: number;
  humanCount: number;
  rosterHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
}

function assertAtomic(value: string, field: string): void {
  if (!/^(0|[1-9]\d*)$/.test(value)) fail(`${field} must be a canonical atomic amount`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function sortEntries(entries: PaperArenaEntryRecord[]): PaperArenaEntryRecord[] {
  return entries.sort((left, right) => (
    left.participantType.localeCompare(right.participantType)
    || left.participantId.localeCompare(right.participantId)
  ));
}

function deriveRoster(entriesInput: PaperArenaEntryRecord[]): Omit<PaperArenaRosterRecord, "rosterHash"> {
  if (!Array.isArray(entriesInput) || entriesInput.length === 0) fail("Arena roster requires at least one registered participant");
  const entries = sortEntries(entriesInput.map((entry) => structuredClone(entry)));
  entries.forEach(assertPaperArenaEntryRecord);
  const first = entries[0]!;
  const identities = new Set<string>();
  const accountIds = new Set<string>();
  for (const entry of entries) {
    if (entry.streamId !== first.streamId) fail("Arena roster contains mixed streams");
    if (entry.season.seasonId !== first.season.seasonId) fail("Arena roster contains mixed seasons");
    if (entry.quoteAssetId !== first.quoteAssetId) fail("Arena roster contains mixed quote assets");
    if (entry.startingNavQuoteAtomic !== first.startingNavQuoteAtomic) fail("Arena roster contains mixed starting capital");
    const identity = `${entry.participantType}:${entry.participantId}`;
    if (identities.has(identity)) fail("Arena roster contains duplicate participant identity");
    identities.add(identity);
    if (accountIds.has(entry.account.accountId)) fail("Arena roster contains duplicate paper account");
    accountIds.add(entry.account.accountId);
  }
  return {
    schemaVersion: 1,
    streamId: first.streamId,
    seasonId: first.season.seasonId,
    quoteAssetId: first.quoteAssetId,
    startingNavQuoteAtomic: first.startingNavQuoteAtomic,
    entries,
    agentCount: entries.filter((entry) => entry.participantType === "AGENT").length,
    humanCount: entries.filter((entry) => entry.participantType === "HUMAN").length,
  };
}

export function assertPaperArenaRosterRecord(record: PaperArenaRosterRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported Arena roster schema version");
  assertNonEmpty(record.streamId, "Arena roster streamId");
  assertNonEmpty(record.seasonId, "Arena roster seasonId");
  assertNonEmpty(record.quoteAssetId, "Arena roster quoteAssetId");
  assertAtomic(record.startingNavQuoteAtomic, "Arena roster starting capital");
  if (BigInt(record.startingNavQuoteAtomic) <= 0n) fail("Arena roster starting capital must be positive");
  const rebuilt = deriveRoster(record.entries);
  const { rosterHash, ...payload } = record;
  if (hashCanonicalPayload(rebuilt) !== hashCanonicalPayload(payload)) fail("Arena roster payload is not correctly derived from entries");
  assertHash(rosterHash, "Arena rosterHash");
  if (rosterHash !== hashCanonicalPayload(payload)) fail("Arena roster hash mismatch");
}

export class PaperArenaRegistrationService {
  private readonly entryService: PaperArenaEntryService;
  private readonly entryStore: PaperArenaEntryStore;

  constructor(input: { stateStore: AgentStateStore; entryStore: PaperArenaEntryStore; streamId: string }) {
    assertNonEmpty(input.streamId, "Arena registration streamId");
    this.entryService = new PaperArenaEntryService({ store: input.stateStore, streamId: input.streamId });
    this.entryStore = input.entryStore;
  }

  async register(input: { accountId: string; quoteAssetId: string }): Promise<PaperArenaEntryRecord> {
    assertNonEmpty(input.accountId, "Arena registration accountId");
    assertNonEmpty(input.quoteAssetId, "Arena registration quoteAssetId");
    const existing = await this.entryStore.getByAccount((this.entryService as unknown as { streamId?: string }).streamId ?? "", input.accountId);
    if (existing) {
      if (existing.quoteAssetId !== input.quoteAssetId) fail("Arena account is already registered under a different quote asset");
      return structuredClone(existing);
    }
    const entry = await this.entryService.enter(input);
    return this.entryStore.put(entry);
  }
}

export class PaperArenaRosterService {
  private readonly entryStore: PaperArenaEntryStore;
  private readonly streamId: string;

  constructor(input: { entryStore: PaperArenaEntryStore; streamId: string }) {
    assertNonEmpty(input.streamId, "Arena roster streamId");
    this.entryStore = input.entryStore;
    this.streamId = input.streamId;
  }

  async snapshot(seasonId: string): Promise<PaperArenaRosterRecord> {
    assertNonEmpty(seasonId, "Arena roster seasonId");
    const entries = await this.entryStore.listSeason(this.streamId, seasonId);
    const payload = deriveRoster(entries);
    const record: PaperArenaRosterRecord = { ...payload, rosterHash: hashCanonicalPayload(payload) };
    assertPaperArenaRosterRecord(record);
    return record;
  }
}
