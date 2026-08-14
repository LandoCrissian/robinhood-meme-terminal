import {
  assertPaperArenaSeasonFinalizationRecord,
  type PaperArenaSeasonFinalizationRecord,
} from "./paper-arena-season-finalization.ts";
import type { SqlPoolLike } from "./persistence/postgres-store.ts";

export interface PaperArenaFinalizationArchiveStore {
  put(record: PaperArenaSeasonFinalizationRecord): Promise<PaperArenaSeasonFinalizationRecord>;
  get(streamId: string, seasonId: string): Promise<PaperArenaSeasonFinalizationRecord | null>;
  list(streamId: string): Promise<PaperArenaSeasonFinalizationRecord[]>;
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

function sortFinalizations(values: PaperArenaSeasonFinalizationRecord[]): PaperArenaSeasonFinalizationRecord[] {
  return values.sort((left, right) => (
    left.seasonEndsAt - right.seasonEndsAt
    || left.seasonId.localeCompare(right.seasonId)
  ));
}

export class InMemoryPaperArenaFinalizationArchiveStore implements PaperArenaFinalizationArchiveStore {
  private readonly records = new Map<string, PaperArenaSeasonFinalizationRecord>();

  async put(record: PaperArenaSeasonFinalizationRecord): Promise<PaperArenaSeasonFinalizationRecord> {
    assertPaperArenaSeasonFinalizationRecord(record);
    const key = `${record.streamId}\u0000${record.seasonId}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.finalizationHash !== record.finalizationHash) fail("Arena archive already contains different finalization evidence for season");
      return clone(existing);
    }
    this.records.set(key, clone(record));
    return clone(record);
  }

  async get(streamId: string, seasonId: string): Promise<PaperArenaSeasonFinalizationRecord | null> {
    assertNonEmpty(streamId, "Arena finalization archive streamId");
    assertNonEmpty(seasonId, "Arena finalization archive seasonId");
    const record = this.records.get(`${streamId}\u0000${seasonId}`);
    if (!record) return null;
    assertPaperArenaSeasonFinalizationRecord(record);
    return clone(record);
  }

  async list(streamId: string): Promise<PaperArenaSeasonFinalizationRecord[]> {
    assertNonEmpty(streamId, "Arena finalization archive streamId");
    return sortFinalizations([...this.records.values()]
      .filter((record) => record.streamId === streamId)
      .map(clone));
  }
}

interface StoredArchiveRow {
  finalization_json: PaperArenaSeasonFinalizationRecord;
  finalization_hash: string;
}

export const paperArenaFinalizationArchiveSchemaSql = `
CREATE TABLE IF NOT EXISTS paper_arena_finalization_archive (
  stream_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  season_ends_at_ms BIGINT NOT NULL CHECK (season_ends_at_ms >= 0),
  finalized_at_ms BIGINT NOT NULL CHECK (finalized_at_ms >= season_ends_at_ms),
  winner TEXT NOT NULL CHECK (winner IN ('AGENT','HUMAN','TIE')),
  finalization_hash TEXT NOT NULL CHECK (finalization_hash ~ '^0x[0-9a-f]{64}$'),
  finalization_json JSONB NOT NULL,
  archived_at_ms BIGINT NOT NULL CHECK (archived_at_ms >= 0),
  PRIMARY KEY (stream_id, season_id)
);
CREATE INDEX IF NOT EXISTS paper_arena_finalization_archive_time_idx
  ON paper_arena_finalization_archive (stream_id, season_ends_at_ms ASC, season_id ASC);
`;

export class PostgresPaperArenaFinalizationArchiveStore implements PaperArenaFinalizationArchiveStore {
  private readonly pool: SqlPoolLike;

  constructor(pool: SqlPoolLike) {
    this.pool = pool;
  }

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(paperArenaFinalizationArchiveSchemaSql);
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
        "SELECT pg_advisory_xact_lock(hashtext('rmt-arena-finalization-archive'), hashtext($1))",
        [`${record.streamId}:${record.seasonId}`],
      );
      await client.query(
        `INSERT INTO paper_arena_finalization_archive (
           stream_id, season_id, season_ends_at_ms, finalized_at_ms, winner,
           finalization_hash, finalization_json, archived_at_ms
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
         ON CONFLICT (stream_id, season_id) DO NOTHING`,
        [
          record.streamId,
          record.seasonId,
          record.seasonEndsAt,
          record.finalizedAt,
          record.winner,
          record.finalizationHash,
          JSON.stringify(record),
          Date.now(),
        ],
      );
      const selected = await client.query<StoredArchiveRow>(
        `SELECT finalization_json, finalization_hash
         FROM paper_arena_finalization_archive
         WHERE stream_id=$1 AND season_id=$2`,
        [record.streamId, record.seasonId],
      );
      const row = selected.rows[0];
      if (!row) fail("Arena finalization archive insert could not be read back");
      assertPaperArenaSeasonFinalizationRecord(row.finalization_json);
      if (row.finalization_hash !== row.finalization_json.finalizationHash) fail("stored Arena archive hash mismatch");
      if (row.finalization_hash !== record.finalizationHash) fail("Arena archive already contains different finalization evidence for season");
      await client.query("COMMIT");
      return clone(row.finalization_json);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async get(streamId: string, seasonId: string): Promise<PaperArenaSeasonFinalizationRecord | null> {
    assertNonEmpty(streamId, "Arena finalization archive streamId");
    assertNonEmpty(seasonId, "Arena finalization archive seasonId");
    const client = await this.pool.connect();
    try {
      const result = await client.query<StoredArchiveRow>(
        `SELECT finalization_json, finalization_hash
         FROM paper_arena_finalization_archive
         WHERE stream_id=$1 AND season_id=$2`,
        [streamId, seasonId],
      );
      const row = result.rows[0];
      if (!row) return null;
      assertPaperArenaSeasonFinalizationRecord(row.finalization_json);
      if (row.finalization_hash !== row.finalization_json.finalizationHash) fail("stored Arena archive hash mismatch");
      return clone(row.finalization_json);
    } finally {
      client.release();
    }
  }

  async list(streamId: string): Promise<PaperArenaSeasonFinalizationRecord[]> {
    assertNonEmpty(streamId, "Arena finalization archive streamId");
    const client = await this.pool.connect();
    try {
      const result = await client.query<StoredArchiveRow>(
        `SELECT finalization_json, finalization_hash
         FROM paper_arena_finalization_archive
         WHERE stream_id=$1
         ORDER BY season_ends_at_ms ASC, season_id ASC`,
        [streamId],
      );
      return result.rows.map((row) => {
        assertPaperArenaSeasonFinalizationRecord(row.finalization_json);
        if (row.finalization_hash !== row.finalization_json.finalizationHash) fail("stored Arena archive hash mismatch");
        return clone(row.finalization_json);
      });
    } finally {
      client.release();
    }
  }
}
