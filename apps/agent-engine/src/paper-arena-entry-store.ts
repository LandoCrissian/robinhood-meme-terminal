import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperArenaEntryRecord,
  type PaperArenaEntryRecord,
} from "./paper-arena-entry.ts";
import type { SqlPoolLike } from "./persistence/postgres-store.ts";

export interface PaperArenaEntryStore {
  put(entry: PaperArenaEntryRecord): Promise<PaperArenaEntryRecord>;
  getByAccount(streamId: string, accountId: string): Promise<PaperArenaEntryRecord | null>;
  listSeason(streamId: string, seasonId: string): Promise<PaperArenaEntryRecord[]>;
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

function identityKey(entry: PaperArenaEntryRecord): string {
  return `${entry.streamId}\u0000${entry.season.seasonId}\u0000${entry.participantType}\u0000${entry.participantId}`;
}

function accountKey(entry: PaperArenaEntryRecord): string {
  return `${entry.streamId}\u0000${entry.account.accountId}`;
}

function entryRecordHash(entry: PaperArenaEntryRecord): string {
  assertPaperArenaEntryRecord(entry);
  return hashCanonicalPayload(entry);
}

function sortEntries(entries: PaperArenaEntryRecord[]): PaperArenaEntryRecord[] {
  return entries.sort((left, right) => (
    left.participantType.localeCompare(right.participantType)
    || left.participantId.localeCompare(right.participantId)
    || left.account.accountId.localeCompare(right.account.accountId)
  ));
}

export class InMemoryPaperArenaEntryStore implements PaperArenaEntryStore {
  private readonly byIdentity = new Map<string, PaperArenaEntryRecord>();
  private readonly accountToIdentity = new Map<string, string>();

  async put(entry: PaperArenaEntryRecord): Promise<PaperArenaEntryRecord> {
    assertPaperArenaEntryRecord(entry);
    const identity = identityKey(entry);
    const account = accountKey(entry);
    const existingIdentity = this.byIdentity.get(identity);
    if (existingIdentity) {
      if (entryRecordHash(existingIdentity) !== entryRecordHash(entry)) fail("Arena participant is already registered with different entry evidence");
      return clone(existingIdentity);
    }
    const existingAccountIdentity = this.accountToIdentity.get(account);
    if (existingAccountIdentity && existingAccountIdentity !== identity) fail("Arena account is already registered to a different participant identity");
    this.byIdentity.set(identity, clone(entry));
    this.accountToIdentity.set(account, identity);
    return clone(entry);
  }

  async getByAccount(streamId: string, accountId: string): Promise<PaperArenaEntryRecord | null> {
    assertNonEmpty(streamId, "Arena entry store streamId");
    assertNonEmpty(accountId, "Arena entry store accountId");
    const identity = this.accountToIdentity.get(`${streamId}\u0000${accountId}`);
    if (!identity) return null;
    const entry = this.byIdentity.get(identity);
    if (!entry) fail("Arena entry store account index is inconsistent");
    assertPaperArenaEntryRecord(entry);
    return clone(entry);
  }

  async listSeason(streamId: string, seasonId: string): Promise<PaperArenaEntryRecord[]> {
    assertNonEmpty(streamId, "Arena entry store streamId");
    assertNonEmpty(seasonId, "Arena entry store seasonId");
    return sortEntries([...this.byIdentity.values()]
      .filter((entry) => entry.streamId === streamId && entry.season.seasonId === seasonId)
      .map(clone));
  }
}

interface StoredEntryRow {
  entry_json: PaperArenaEntryRecord;
  entry_hash: string;
}

export const paperArenaEntryStoreSchemaSql = `
CREATE TABLE IF NOT EXISTS paper_arena_entries (
  stream_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  participant_type TEXT NOT NULL CHECK (participant_type IN ('AGENT','HUMAN')),
  participant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  quote_asset_id TEXT NOT NULL,
  starting_nav_quote_atomic NUMERIC(78,0) NOT NULL CHECK (starting_nav_quote_atomic > 0),
  entered_at_ms BIGINT NOT NULL CHECK (entered_at_ms >= 0),
  entry_hash TEXT NOT NULL CHECK (entry_hash ~ '^0x[0-9a-f]{64}$'),
  entry_json JSONB NOT NULL,
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (stream_id, season_id, participant_type, participant_id),
  UNIQUE (stream_id, account_id)
);
CREATE INDEX IF NOT EXISTS paper_arena_entries_season_idx
  ON paper_arena_entries (stream_id, season_id, participant_type, participant_id);
`;

export class PostgresPaperArenaEntryStore implements PaperArenaEntryStore {
  private readonly pool: SqlPoolLike;

  constructor(pool: SqlPoolLike) {
    this.pool = pool;
  }

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(paperArenaEntryStoreSchemaSql);
    } finally {
      client.release();
    }
  }

  async put(entry: PaperArenaEntryRecord): Promise<PaperArenaEntryRecord> {
    assertPaperArenaEntryRecord(entry);
    const hash = entryRecordHash(entry);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('rmt-paper-arena-entry'), hashtext($1))",
        [`${entry.streamId}:${entry.season.seasonId}`],
      );
      await client.query(
        `INSERT INTO paper_arena_entries (
           stream_id, season_id, participant_type, participant_id, account_id,
           quote_asset_id, starting_nav_quote_atomic, entered_at_ms, entry_hash, entry_json, created_at_ms
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
         ON CONFLICT (stream_id, season_id, participant_type, participant_id) DO NOTHING`,
        [
          entry.streamId,
          entry.season.seasonId,
          entry.participantType,
          entry.participantId,
          entry.account.accountId,
          entry.quoteAssetId,
          entry.startingNavQuoteAtomic,
          entry.enteredAt,
          hash,
          JSON.stringify(entry),
          Date.now(),
        ],
      );
      const selected = await client.query<StoredEntryRow>(
        `SELECT entry_json, entry_hash
         FROM paper_arena_entries
         WHERE stream_id = $1 AND season_id = $2 AND participant_type = $3 AND participant_id = $4`,
        [entry.streamId, entry.season.seasonId, entry.participantType, entry.participantId],
      );
      const row = selected.rows[0];
      if (!row) fail("Arena entry insert could not be read back");
      assertPaperArenaEntryRecord(row.entry_json);
      const storedHash = entryRecordHash(row.entry_json);
      if (row.entry_hash !== storedHash) fail("stored Arena entry hash mismatch");
      if (storedHash !== hash) fail("Arena participant is already registered with different entry evidence");
      if (row.entry_json.account.accountId !== entry.account.accountId) fail("Arena participant is already registered with a different account");
      await client.query("COMMIT");
      return clone(row.entry_json);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async getByAccount(streamId: string, accountId: string): Promise<PaperArenaEntryRecord | null> {
    assertNonEmpty(streamId, "Arena entry store streamId");
    assertNonEmpty(accountId, "Arena entry store accountId");
    const client = await this.pool.connect();
    try {
      const result = await client.query<StoredEntryRow>(
        `SELECT entry_json, entry_hash FROM paper_arena_entries WHERE stream_id = $1 AND account_id = $2`,
        [streamId, accountId],
      );
      const row = result.rows[0];
      if (!row) return null;
      assertPaperArenaEntryRecord(row.entry_json);
      if (row.entry_hash !== entryRecordHash(row.entry_json)) fail("stored Arena entry hash mismatch");
      return clone(row.entry_json);
    } finally {
      client.release();
    }
  }

  async listSeason(streamId: string, seasonId: string): Promise<PaperArenaEntryRecord[]> {
    assertNonEmpty(streamId, "Arena entry store streamId");
    assertNonEmpty(seasonId, "Arena entry store seasonId");
    const client = await this.pool.connect();
    try {
      const result = await client.query<StoredEntryRow>(
        `SELECT entry_json, entry_hash
         FROM paper_arena_entries
         WHERE stream_id = $1 AND season_id = $2
         ORDER BY participant_type ASC, participant_id ASC`,
        [streamId, seasonId],
      );
      return sortEntries(result.rows.map((row) => {
        assertPaperArenaEntryRecord(row.entry_json);
        if (row.entry_hash !== entryRecordHash(row.entry_json)) fail("stored Arena entry hash mismatch");
        return clone(row.entry_json);
      }));
    } finally {
      client.release();
    }
  }
}
