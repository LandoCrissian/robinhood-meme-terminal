import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaNetPerformanceRecord,
  type PaperArenaNetPerformanceRecord,
} from "./paper-arena-net-performance.ts";
import type { SqlPoolLike } from "./persistence/postgres-store.ts";

export interface PaperArenaNetPerformanceStore {
  put(record: PaperArenaNetPerformanceRecord): Promise<PaperArenaNetPerformanceRecord>;
  latestForParticipant(input: {
    streamId: string;
    seasonId: string;
    participantType: "AGENT" | "HUMAN";
    participantId: string;
  }): Promise<PaperArenaNetPerformanceRecord | null>;
  listLatestSeason(streamId: string, seasonId: string): Promise<PaperArenaNetPerformanceRecord[]>;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function entry(record: PaperArenaNetPerformanceRecord) {
  return record.basePerformance.entry;
}

function recordHash(record: PaperArenaNetPerformanceRecord): string {
  assertPaperArenaNetPerformanceRecord(record);
  return hashCanonicalPayload(record);
}

function identity(record: PaperArenaNetPerformanceRecord): string {
  const value = entry(record);
  return `${value.streamId}\u0000${value.season.seasonId}\u0000${value.participantType}\u0000${value.participantId}`;
}

function timestampKey(record: PaperArenaNetPerformanceRecord): string {
  return `${identity(record)}\u0000${record.capturedAt}`;
}

function sortLatest(records: PaperArenaNetPerformanceRecord[]): PaperArenaNetPerformanceRecord[] {
  return records.sort((left, right) => {
    const leftEntry = entry(left);
    const rightEntry = entry(right);
    return leftEntry.participantType.localeCompare(rightEntry.participantType)
      || leftEntry.participantId.localeCompare(rightEntry.participantId)
      || right.capturedAt - left.capturedAt
      || recordHash(left).localeCompare(recordHash(right));
  });
}

function latestOnly(records: PaperArenaNetPerformanceRecord[]): PaperArenaNetPerformanceRecord[] {
  const ordered = sortLatest(records);
  const seen = new Set<string>();
  const latest: PaperArenaNetPerformanceRecord[] = [];
  for (const record of ordered) {
    const key = identity(record);
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(record);
  }
  return latest.sort((left, right) => {
    const a = entry(left);
    const b = entry(right);
    return a.participantType.localeCompare(b.participantType) || a.participantId.localeCompare(b.participantId);
  });
}

export class InMemoryPaperArenaNetPerformanceStore implements PaperArenaNetPerformanceStore {
  private readonly records = new Map<string, PaperArenaNetPerformanceRecord>();

  async put(record: PaperArenaNetPerformanceRecord): Promise<PaperArenaNetPerformanceRecord> {
    assertPaperArenaNetPerformanceRecord(record);
    const key = timestampKey(record);
    const existing = this.records.get(key);
    if (existing) {
      if (recordHash(existing) !== recordHash(record)) fail("Arena net performance timestamp already contains different evidence");
      return clone(existing);
    }
    this.records.set(key, clone(record));
    return clone(record);
  }

  async latestForParticipant(input: {
    streamId: string;
    seasonId: string;
    participantType: "AGENT" | "HUMAN";
    participantId: string;
  }): Promise<PaperArenaNetPerformanceRecord | null> {
    assertNonEmpty(input.streamId, "Arena net performance streamId");
    assertNonEmpty(input.seasonId, "Arena net performance seasonId");
    assertNonEmpty(input.participantId, "Arena net performance participantId");
    const matches = [...this.records.values()].filter((record) => {
      const value = entry(record);
      return value.streamId === input.streamId
        && value.season.seasonId === input.seasonId
        && value.participantType === input.participantType
        && value.participantId === input.participantId;
    });
    if (matches.length === 0) return null;
    matches.sort((left, right) => right.capturedAt - left.capturedAt || recordHash(left).localeCompare(recordHash(right)));
    return clone(matches[0]!);
  }

  async listLatestSeason(streamId: string, seasonId: string): Promise<PaperArenaNetPerformanceRecord[]> {
    assertNonEmpty(streamId, "Arena net performance streamId");
    assertNonEmpty(seasonId, "Arena net performance seasonId");
    return latestOnly([...this.records.values()]
      .filter((record) => {
        const value = entry(record);
        return value.streamId === streamId && value.season.seasonId === seasonId;
      })
      .map(clone));
  }
}

interface StoredRow {
  performance_json: PaperArenaNetPerformanceRecord;
  performance_hash: string;
}

export const paperArenaNetPerformanceStoreSchemaSql = `
CREATE TABLE IF NOT EXISTS paper_arena_net_performance_history (
  stream_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  participant_type TEXT NOT NULL CHECK (participant_type IN ('AGENT','HUMAN')),
  participant_id TEXT NOT NULL,
  captured_at_ms BIGINT NOT NULL CHECK (captured_at_ms >= 0),
  net_performance_hash TEXT NOT NULL CHECK (net_performance_hash ~ '^0x[0-9a-f]{64}$'),
  performance_hash TEXT NOT NULL CHECK (performance_hash ~ '^0x[0-9a-f]{64}$'),
  performance_json JSONB NOT NULL,
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (stream_id, season_id, participant_type, participant_id, captured_at_ms)
);
CREATE INDEX IF NOT EXISTS paper_arena_net_performance_latest_idx
  ON paper_arena_net_performance_history (
    stream_id, season_id, participant_type, participant_id, captured_at_ms DESC
  );
`;

export class PostgresPaperArenaNetPerformanceStore implements PaperArenaNetPerformanceStore {
  private readonly pool: SqlPoolLike;

  constructor(pool: SqlPoolLike) {
    this.pool = pool;
  }

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(paperArenaNetPerformanceStoreSchemaSql);
    } finally {
      client.release();
    }
  }

  async put(record: PaperArenaNetPerformanceRecord): Promise<PaperArenaNetPerformanceRecord> {
    assertPaperArenaNetPerformanceRecord(record);
    const value = entry(record);
    const hash = recordHash(record);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('rmt-arena-net-performance'), hashtext($1))",
        [`${value.streamId}:${value.season.seasonId}:${value.participantType}:${value.participantId}`],
      );
      await client.query(
        `INSERT INTO paper_arena_net_performance_history (
           stream_id, season_id, participant_type, participant_id, captured_at_ms,
           net_performance_hash, performance_hash, performance_json, created_at_ms
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         ON CONFLICT (stream_id, season_id, participant_type, participant_id, captured_at_ms) DO NOTHING`,
        [
          value.streamId,
          value.season.seasonId,
          value.participantType,
          value.participantId,
          record.capturedAt,
          record.netPerformanceHash,
          hash,
          JSON.stringify(record),
          Date.now(),
        ],
      );
      const selected = await client.query<StoredRow>(
        `SELECT performance_json, performance_hash
         FROM paper_arena_net_performance_history
         WHERE stream_id=$1 AND season_id=$2 AND participant_type=$3 AND participant_id=$4 AND captured_at_ms=$5`,
        [value.streamId, value.season.seasonId, value.participantType, value.participantId, record.capturedAt],
      );
      const row = selected.rows[0];
      if (!row) fail("Arena net performance insert could not be read back");
      assertPaperArenaNetPerformanceRecord(row.performance_json);
      const storedHash = recordHash(row.performance_json);
      if (row.performance_hash !== storedHash) fail("stored Arena net performance hash mismatch");
      if (storedHash !== hash) fail("Arena net performance timestamp already contains different evidence");
      await client.query("COMMIT");
      return clone(row.performance_json);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async latestForParticipant(input: {
    streamId: string;
    seasonId: string;
    participantType: "AGENT" | "HUMAN";
    participantId: string;
  }): Promise<PaperArenaNetPerformanceRecord | null> {
    assertNonEmpty(input.streamId, "Arena net performance streamId");
    assertNonEmpty(input.seasonId, "Arena net performance seasonId");
    assertNonEmpty(input.participantId, "Arena net performance participantId");
    const client = await this.pool.connect();
    try {
      const result = await client.query<StoredRow>(
        `SELECT performance_json, performance_hash
         FROM paper_arena_net_performance_history
         WHERE stream_id=$1 AND season_id=$2 AND participant_type=$3 AND participant_id=$4
         ORDER BY captured_at_ms DESC LIMIT 1`,
        [input.streamId, input.seasonId, input.participantType, input.participantId],
      );
      const row = result.rows[0];
      if (!row) return null;
      assertPaperArenaNetPerformanceRecord(row.performance_json);
      if (row.performance_hash !== recordHash(row.performance_json)) fail("stored Arena net performance hash mismatch");
      return clone(row.performance_json);
    } finally {
      client.release();
    }
  }

  async listLatestSeason(streamId: string, seasonId: string): Promise<PaperArenaNetPerformanceRecord[]> {
    assertNonEmpty(streamId, "Arena net performance streamId");
    assertNonEmpty(seasonId, "Arena net performance seasonId");
    const client = await this.pool.connect();
    try {
      const result = await client.query<StoredRow>(
        `SELECT DISTINCT ON (participant_type, participant_id) performance_json, performance_hash
         FROM paper_arena_net_performance_history
         WHERE stream_id=$1 AND season_id=$2
         ORDER BY participant_type ASC, participant_id ASC, captured_at_ms DESC`,
        [streamId, seasonId],
      );
      return result.rows.map((row) => {
        assertPaperArenaNetPerformanceRecord(row.performance_json);
        if (row.performance_hash !== recordHash(row.performance_json)) fail("stored Arena net performance hash mismatch");
        return clone(row.performance_json);
      }).sort((left, right) => {
        const a = entry(left);
        const b = entry(right);
        return a.participantType.localeCompare(b.participantType) || a.participantId.localeCompare(b.participantId);
      });
    } finally {
      client.release();
    }
  }
}
