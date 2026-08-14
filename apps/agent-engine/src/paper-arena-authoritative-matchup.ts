import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import type { PaperArenaEntryStore } from "./paper-arena-entry-store.ts";
import {
  buildPaperArenaMatchup,
  assertPaperArenaMatchupRecord,
  type PaperArenaMatchupRecord,
} from "./paper-arena-matchup.ts";
import type { PaperArenaNetPerformanceStore } from "./paper-arena-net-performance-store.ts";
import {
  assertPaperArenaNetPerformanceRecord,
  type PaperArenaNetPerformanceRecord,
} from "./paper-arena-net-performance.ts";
import {
  PaperArenaRosterService,
  assertPaperArenaRosterRecord,
  type PaperArenaRosterRecord,
} from "./paper-arena-roster.ts";

export interface PaperArenaAuthoritativeMatchupRecord {
  schemaVersion: 1;
  streamId: string;
  seasonId: string;
  roster: PaperArenaRosterRecord;
  latestNetPerformances: PaperArenaNetPerformanceRecord[];
  latestPerformanceDigest: string;
  matchup: PaperArenaMatchupRecord;
  snapshotHash: string;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function identity(performance: PaperArenaNetPerformanceRecord): string {
  const entry = performance.basePerformance.entry;
  return `${entry.participantType}:${entry.participantId}`;
}

function digest(performances: PaperArenaNetPerformanceRecord[]): string {
  const source = performances.map((performance) => ({
    participant: identity(performance),
    capturedAt: performance.capturedAt,
    netPerformanceHash: performance.netPerformanceHash,
    fullRecordHash: hashCanonicalPayload(performance),
  }));
  return hashCanonicalPayload(source);
}

function sortPerformances(performances: PaperArenaNetPerformanceRecord[]): PaperArenaNetPerformanceRecord[] {
  return performances.sort((left, right) => identity(left).localeCompare(identity(right)));
}

function assertSources(input: {
  streamId: string;
  seasonId: string;
  roster: PaperArenaRosterRecord;
  latestNetPerformances: PaperArenaNetPerformanceRecord[];
}): void {
  assertPaperArenaRosterRecord(input.roster);
  if (input.roster.streamId !== input.streamId || input.roster.seasonId !== input.seasonId) {
    fail("authoritative Arena matchup roster identity mismatch");
  }
  const registered = new Set(input.roster.entries.map((entry) => `${entry.participantType}:${entry.participantId}`));
  const seen = new Set<string>();
  for (const performance of input.latestNetPerformances) {
    assertPaperArenaNetPerformanceRecord(performance);
    const entry = performance.basePerformance.entry;
    if (entry.streamId !== input.streamId || entry.season.seasonId !== input.seasonId) {
      fail("authoritative Arena matchup performance belongs to another competition");
    }
    const key = identity(performance);
    if (!registered.has(key)) fail("authoritative Arena matchup performance belongs to unregistered participant");
    if (seen.has(key)) fail("authoritative Arena matchup contains duplicate latest performance");
    seen.add(key);
  }
}

export function assertPaperArenaAuthoritativeMatchupRecord(record: PaperArenaAuthoritativeMatchupRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported authoritative Arena matchup schema version");
  assertNonEmpty(record.streamId, "authoritative Arena matchup streamId");
  assertNonEmpty(record.seasonId, "authoritative Arena matchup seasonId");
  assertSources({
    streamId: record.streamId,
    seasonId: record.seasonId,
    roster: record.roster,
    latestNetPerformances: record.latestNetPerformances,
  });
  const sorted = sortPerformances(record.latestNetPerformances.map((performance) => structuredClone(performance)));
  if (hashCanonicalPayload(sorted) !== hashCanonicalPayload(record.latestNetPerformances)) {
    fail("authoritative Arena matchup latest performances are not canonically ordered");
  }
  assertHash(record.latestPerformanceDigest, "authoritative Arena matchup performance digest");
  if (record.latestPerformanceDigest !== digest(record.latestNetPerformances)) {
    fail("authoritative Arena matchup performance digest mismatch");
  }
  assertPaperArenaMatchupRecord(record.matchup);
  const rebuiltMatchup = buildPaperArenaMatchup({
    roster: record.roster,
    netPerformances: record.latestNetPerformances,
  });
  if (hashCanonicalPayload(rebuiltMatchup) !== hashCanonicalPayload(record.matchup)) {
    fail("authoritative Arena matchup is not correctly derived from authoritative sources");
  }
  assertHash(record.snapshotHash, "authoritative Arena matchup snapshotHash");
  const { snapshotHash, ...payload } = record;
  if (snapshotHash !== hashCanonicalPayload(payload)) fail("authoritative Arena matchup snapshot hash mismatch");
}

export class PaperArenaAuthoritativeMatchupService {
  private readonly entryStore: PaperArenaEntryStore;
  private readonly performanceStore: PaperArenaNetPerformanceStore;
  private readonly streamId: string;

  constructor(input: {
    entryStore: PaperArenaEntryStore;
    performanceStore: PaperArenaNetPerformanceStore;
    streamId: string;
  }) {
    assertNonEmpty(input.streamId, "authoritative Arena matchup streamId");
    this.entryStore = input.entryStore;
    this.performanceStore = input.performanceStore;
    this.streamId = input.streamId;
  }

  async snapshot(seasonId: string): Promise<PaperArenaAuthoritativeMatchupRecord> {
    assertNonEmpty(seasonId, "authoritative Arena matchup seasonId");
    const roster = await new PaperArenaRosterService({ entryStore: this.entryStore, streamId: this.streamId }).snapshot(seasonId);
    const storedLatest = await this.performanceStore.listLatestSeason(this.streamId, seasonId);
    const latestNetPerformances = sortPerformances(storedLatest.map((performance) => structuredClone(performance)));
    assertSources({ streamId: this.streamId, seasonId, roster, latestNetPerformances });
    const matchup = buildPaperArenaMatchup({ roster, netPerformances: latestNetPerformances });
    const payload: Omit<PaperArenaAuthoritativeMatchupRecord, "snapshotHash"> = {
      schemaVersion: 1,
      streamId: this.streamId,
      seasonId,
      roster,
      latestNetPerformances,
      latestPerformanceDigest: digest(latestNetPerformances),
      matchup,
    };
    const record: PaperArenaAuthoritativeMatchupRecord = { ...payload, snapshotHash: hashCanonicalPayload(payload) };
    assertPaperArenaAuthoritativeMatchupRecord(record);
    return record;
  }
}
