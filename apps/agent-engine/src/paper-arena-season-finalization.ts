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
import type { SqlPoolLike } from "./persistence/postgres-store.ts";

export interface PaperArenaSeasonFinalizationPolicy {
  policyVersion: string;
  maximumFinalPerformanceLagMs: number;
}

export interface PaperArenaSeasonFinalizationRecord {
  schemaVersion: 1;
  streamId: string;
  seasonId: string;
  policy: PaperArenaSeasonFinalizationPolicy;
  seasonEndsAt: number;
  finalizedAt: number;
  roster: PaperArenaRosterRecord;
  finalPerformances: PaperArenaNetPerformanceRecord[];
  cutoffPerformanceDigest: string;
  matchup: PaperArenaMatchupRecord;
  winner: "AGENT" | "HUMAN" | "TIE";
  finalizationHash: string;
}

export interface PaperArenaSeasonFinalizationStore {
  get(streamId: string, seasonId: string): Promise<PaperArenaSeasonFinalizationRecord | null>;
  put(record: PaperArenaSeasonFinalizationRecord): Promise<PaperArenaSeasonFinalizationRecord>;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${field} must be a non-negative safe integer`);
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${field} must be a positive safe integer`);
}

function assertHash(value: string, field: string): void {
  if (!/^0x[0-9a-f]{64}$/.test(value)) fail(`${field} must be a sha256 hex hash`);
}

function identity(performance: PaperArenaNetPerformanceRecord): string {
  const entry = performance.basePerformance.entry;
  return `${entry.participantType}:${entry.participantId}`;
}

function sortPerformances(values: PaperArenaNetPerformanceRecord[]): PaperArenaNetPerformanceRecord[] {
  return values.sort((left, right) => identity(left).localeCompare(identity(right)));
}

function performanceDigest(values: PaperArenaNetPerformanceRecord[]): string {
  return hashCanonicalPayload(values.map((performance) => ({
    participant: identity(performance),
    capturedAt: performance.capturedAt,
    netPerformanceHash: performance.netPerformanceHash,
    fullRecordHash: hashCanonicalPayload(performance),
  })));
}

function assertPolicy(policy: PaperArenaSeasonFinalizationPolicy): void {
  assertNonEmpty(policy.policyVersion, "Arena finalization policyVersion");
  assertPositiveSafeInteger(policy.maximumFinalPerformanceLagMs, "Arena finalization maximumFinalPerformanceLagMs");
}

function derive(input: {
  streamId: string;
  seasonId: string;
  policy: PaperArenaSeasonFinalizationPolicy;
  finalizedAt: number;
  roster: PaperArenaRosterRecord;
  finalPerformances: PaperArenaNetPerformanceRecord[];
}): Omit<PaperArenaSeasonFinalizationRecord, "finalizationHash"> {
  assertNonEmpty(input.streamId, "Arena finalization streamId");
  assertNonEmpty(input.seasonId, "Arena finalization seasonId");
  assertPolicy(input.policy);
  assertTimestamp(input.finalizedAt, "Arena finalization finalizedAt");
  assertPaperArenaRosterRecord(input.roster);
  if (input.roster.streamId !== input.streamId || input.roster.seasonId !== input.seasonId) fail("Arena finalization roster identity mismatch");
  const season = input.roster.entries[0]?.season;
  if (!season || season.endsAt === undefined) fail("Arena finalization requires a season with endsAt");
  if (input.finalizedAt < season.endsAt) fail("Arena finalization cannot occur before season end");
  const finalPerformances = sortPerformances(input.finalPerformances.map((performance) => structuredClone(performance)));
  finalPerformances.forEach(assertPaperArenaNetPerformanceRecord);
  const matchup = buildPaperArenaMatchup({ roster: input.roster, netPerformances: finalPerformances });
  if (matchup.status !== "FINALIZABLE" || matchup.winner === null) fail("Arena finalization requires complete eligible Human and Agent results");
  for (const performance of finalPerformances) {
    if (performance.capturedAt > season.endsAt) fail("Arena finalization performance is after season end");
    if (season.endsAt - performance.capturedAt > input.policy.maximumFinalPerformanceLagMs) {
      fail("Arena finalization performance is too far before season end");
    }
  }
  return {
    schemaVersion: 1,
    streamId: input.streamId,
    seasonId: input.seasonId,
    policy: structuredClone(input.policy),
    seasonEndsAt: season.endsAt,
    finalizedAt: input.finalizedAt,
    roster: structuredClone(input.roster),
    finalPerformances,
    cutoffPerformanceDigest: performanceDigest(finalPerformances),
    matchup,
    winner: matchup.winner,
  };
}

export function assertPaperArenaSeasonFinalizationRecord(record: PaperArenaSeasonFinalizationRecord): void {
  if (record.schemaVersion !== 1) fail("unsupported Arena finalization schema version");
  const rebuilt = derive({
    streamId: record.streamId,
    seasonId: record.seasonId,
    policy: record.policy,
    finalizedAt: record.finalizedAt,
    roster: record.roster,
    finalPerformances: record.finalPerformances,
  });
  if (record.seasonEndsAt !== rebuilt.seasonEndsAt) fail("Arena finalization seasonEndsAt mismatch");
  if (record.cutoffPerformanceDigest !== rebuilt.cutoffPerformanceDigest) fail("Arena finalization cutoff digest mismatch");
  if (record.winner !== rebuilt.winner) fail("Arena finalization winner mismatch");
  if (hashCanonicalPayload(record.matchup) !== hashCanonicalPayload(rebuilt.matchup)) fail("Arena finalization matchup mismatch");
  assertPaperArenaMatchupRecord(record.matchup);
  assertHash(record.finalizationHash, "Arena finalizationHash");
  const { finalizationHash, ...payload } = record;
  if (finalizationHash !== hashCanonicalPayload(payload)) fail("Arena finalization hash mismatch");
}

export class InMemoryPaperArenaSeasonFinalizationStore implements PaperArenaSeasonFinalizationStore {
  private readonly records = new Map<string, PaperArenaSeasonFinalizationRecord>();

  async get(streamId: string, seasonId: string): Promise<PaperArenaSeasonFinalizationRecord | null> {
    assertNonEmpty(streamId, "Arena finalization store streamId");
    assertNonEmpty(seasonId, "Arena finalization store seasonId");
    const record = this.records.get(`${streamId}\u0000${seasonId}`);
    return record ? structuredClone(record) : null;
  }

  async put(record: PaperArenaSeasonFinalizationRecord): Promise<PaperArenaSeasonFinalizationRecord> {
    assertPaperArenaSeasonFinalizationRecord(record);
    const key = `${record.streamId}\u0000${record.seasonId}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.finalizationHash !== record.finalizationHash) fail("Arena season is already finalized with different evidence");
      return structuredClone(existing);
    }
    this.records.set(key, structuredClone(record));
    return structuredClone(record);
  }
}

interface StoredFinalizationRow {
  finalization_json: PaperArenaSeasonFinalizationRecord;
  finalization_hash: string;
}

export const paperArenaSeasonFinalizationSchemaSql = `
CREATE TABLE IF NOT EXISTS paper_arena_season_finalizations (
  stream_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  season_ends_at_ms BIGINT NOT NULL CHECK (season_ends_at_ms >= 0),
  finalized_at_ms BIGINT NOT NULL CHECK (finalized_at_ms >= season_ends_at_ms),
  winner TEXT NOT NULL CHECK (winner IN ('AGENT','HUMAN','TIE')),
  roster_hash TEXT NOT NULL CHECK (roster_hash ~ '^0x[0-9a-f]{64}$'),
  cutoff_performance_digest TEXT NOT NULL CHECK (cutoff_performance_digest ~ '^0x[0-9a-f]{64}$'),
  finalization_hash TEXT NOT NULL CHECK (finalization_hash ~ '^0x[0-9a-f]{64}$'),
  finalization_json JSONB NOT NULL,
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (stream_id, season_id)
);
`;

export class PostgresPaperArenaSeasonFinalizationStore implements PaperArenaSeasonFinalizationStore {
  private readonly pool: SqlPoolLike;

  constructor(pool: SqlPoolLike) {
    this.pool = pool;
  }

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(paperArenaSeasonFinalizationSchemaSql);
    } finally {
      client.release();
    }
  }

  async get(streamId: string, seasonId: string): Promise<PaperArenaSeasonFinalizationRecord | null> {
    assertNonEmpty(streamId, "Arena finalization store streamId");
    assertNonEmpty(seasonId, "Arena finalization store seasonId");
    const client = await this.pool.connect();
    try {
      const result = await client.query<StoredFinalizationRow>(
        `SELECT finalization_json, finalization_hash
         FROM paper_arena_season_finalizations
         WHERE stream_id=$1 AND season_id=$2`,
        [streamId, seasonId],
      );
      const row = result.rows[0];
      if (!row) return null;
      assertPaperArenaSeasonFinalizationRecord(row.finalization_json);
      if (row.finalization_hash !== row.finalization_json.finalizationHash) fail("stored Arena finalization hash mismatch");
      return structuredClone(row.finalization_json);
    } finally {
      client.release();
    }
  }

  async put(record: PaperArenaSeasonFinalizationRecord): Promise<PaperArenaSeasonFinalizationRecord> {
    assertPaperArenaSeasonFinalizationRecord(record);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('rmt-arena-finalization'), hashtext($1))",
        [`${record.streamId}:${record.seasonId}`],
      );
      await client.query(
        `INSERT INTO paper_arena_season_finalizations (
           stream_id, season_id, season_ends_at_ms, finalized_at_ms, winner,
           roster_hash, cutoff_performance_digest, finalization_hash, finalization_json, created_at_ms
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
         ON CONFLICT (stream_id, season_id) DO NOTHING`,
        [
          record.streamId,
          record.seasonId,
          record.seasonEndsAt,
          record.finalizedAt,
          record.winner,
          record.roster.rosterHash,
          record.cutoffPerformanceDigest,
          record.finalizationHash,
          JSON.stringify(record),
          Date.now(),
        ],
      );
      const selected = await client.query<StoredFinalizationRow>(
        `SELECT finalization_json, finalization_hash
         FROM paper_arena_season_finalizations
         WHERE stream_id=$1 AND season_id=$2`,
        [record.streamId, record.seasonId],
      );
      const row = selected.rows[0];
      if (!row) fail("Arena finalization insert could not be read back");
      assertPaperArenaSeasonFinalizationRecord(row.finalization_json);
      if (row.finalization_hash !== row.finalization_json.finalizationHash) fail("stored Arena finalization hash mismatch");
      if (row.finalization_hash !== record.finalizationHash) fail("Arena season is already finalized with different evidence");
      await client.query("COMMIT");
      return structuredClone(row.finalization_json);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }
}

export class PaperArenaSeasonFinalizationService {
  private readonly entryStore: PaperArenaEntryStore;
  private readonly performanceStore: PaperArenaNetPerformanceStore;
  private readonly finalizationStore: PaperArenaSeasonFinalizationStore;
  private readonly streamId: string;
  private readonly policy: PaperArenaSeasonFinalizationPolicy;

  constructor(input: {
    entryStore: PaperArenaEntryStore;
    performanceStore: PaperArenaNetPerformanceStore;
    finalizationStore: PaperArenaSeasonFinalizationStore;
    streamId: string;
    policy: PaperArenaSeasonFinalizationPolicy;
  }) {
    assertNonEmpty(input.streamId, "Arena finalization streamId");
    assertPolicy(input.policy);
    this.entryStore = input.entryStore;
    this.performanceStore = input.performanceStore;
    this.finalizationStore = input.finalizationStore;
    this.streamId = input.streamId;
    this.policy = structuredClone(input.policy);
  }

  async finalize(seasonId: string, finalizedAt = Date.now()): Promise<PaperArenaSeasonFinalizationRecord> {
    assertNonEmpty(seasonId, "Arena finalization seasonId");
    assertTimestamp(finalizedAt, "Arena finalization finalizedAt");
    const existing = await this.finalizationStore.get(this.streamId, seasonId);
    if (existing) return existing;
    const roster = await new PaperArenaRosterService({ entryStore: this.entryStore, streamId: this.streamId }).snapshot(seasonId);
    const season = roster.entries[0]?.season;
    if (!season || season.endsAt === undefined) fail("Arena finalization requires a season with endsAt");
    if (finalizedAt < season.endsAt) fail("Arena finalization cannot occur before season end");
    const finalPerformances = await this.performanceStore.listLatestSeasonAtOrBefore(this.streamId, seasonId, season.endsAt);
    const payload = derive({
      streamId: this.streamId,
      seasonId,
      policy: this.policy,
      finalizedAt,
      roster,
      finalPerformances,
    });
    const record: PaperArenaSeasonFinalizationRecord = { ...payload, finalizationHash: hashCanonicalPayload(payload) };
    assertPaperArenaSeasonFinalizationRecord(record);
    return this.finalizationStore.put(record);
  }
}
