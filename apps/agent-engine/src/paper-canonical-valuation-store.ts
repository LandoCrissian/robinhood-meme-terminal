import { hashCanonicalPayload } from "../../../packages/agent-core/src/index.ts";
import {
  assertPaperCanonicalValuationRecord,
  type PaperCanonicalValuationRecord,
} from "./paper-canonical-valuation.ts";
import type { SqlPoolLike } from "./persistence/postgres-store.ts";

export interface PaperCanonicalValuationHistoryStore {
  put(record: PaperCanonicalValuationRecord): Promise<PaperCanonicalValuationRecord>;
  list(streamId: string, accountId: string): Promise<PaperCanonicalValuationRecord[]>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || !value.trim()) fail(`${field} must be non-empty`);
}

function key(record: PaperCanonicalValuationRecord): string {
  return `${record.streamId}\u0000${record.valuation.accountId}\u0000${record.valuation.valuedAt}`;
}

function recordHash(record: PaperCanonicalValuationRecord): string {
  assertPaperCanonicalValuationRecord(record);
  return hashCanonicalPayload(record);
}

function sort(records: PaperCanonicalValuationRecord[]): PaperCanonicalValuationRecord[] {
  return records.sort((left, right) => (
    left.valuation.valuedAt - right.valuation.valuedAt
    || left.revision - right.revision
    || recordHash(left).localeCompare(recordHash(right))
  ));
}

export class InMemoryPaperCanonicalValuationHistoryStore implements PaperCanonicalValuationHistoryStore {
  private readonly records = new Map<string, PaperCanonicalValuationRecord>();

  async put(record: PaperCanonicalValuationRecord): Promise<PaperCanonicalValuationRecord> {
    assertPaperCanonicalValuationRecord(record);
    const recordKey = key(record);
    const existing = this.records.get(recordKey);
    if (existing) {
      if (recordHash(existing) !== recordHash(record)) fail("canonical valuation timestamp already contains different evidence");
      return clone(existing);
    }
    this.records.set(recordKey, clone(record));
    return clone(record);
  }

  async list(streamId: string, accountId: string): Promise<PaperCanonicalValuationRecord[]> {
    assertNonEmpty(streamId, "canonical valuation history streamId");
    assertNonEmpty(accountId, "canonical valuation history accountId");
    return sort([...this.records.values()]
      .filter((record) => record.streamId === streamId && record.valuation.accountId === accountId)
      .map(clone));
  }
}

interface StoredRow {
  record_json: PaperCanonicalValuationRecord;
  record_hash: string;
}

export const paperCanonicalValuationHistorySchemaSql = `
CREATE TABLE IF NOT EXISTS paper_canonical_valuation_history (
  stream_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  valued_at_ms BIGINT NOT NULL CHECK (valued_at_ms >= 0),
  revision BIGINT NOT NULL CHECK (revision > 0),
  engine_state_hash TEXT NOT NULL CHECK (engine_state_hash ~ '^0x[0-9a-f]{64}$'),
  record_hash TEXT NOT NULL CHECK (record_hash ~ '^0x[0-9a-f]{64}$'),
  record_json JSONB NOT NULL,
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0),
  PRIMARY KEY (stream_id, account_id, valued_at_ms)
);
CREATE INDEX IF NOT EXISTS paper_canonical_valuation_history_revision_idx
  ON paper_canonical_valuation_history (stream_id, account_id, revision, valued_at_ms);
`;

export class PostgresPaperCanonicalValuationHistoryStore implements PaperCanonicalValuationHistoryStore {
  constructor(private readonly pool: SqlPoolLike) {}

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(paperCanonicalValuationHistorySchemaSql);
    } finally {
      client.release();
    }
  }

  async put(record: PaperCanonicalValuationRecord): Promise<PaperCanonicalValuationRecord> {
    assertPaperCanonicalValuationRecord(record);
    const hash = recordHash(record);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('rmt-canonical-valuation'), hashtext($1))",
        [`${record.streamId}:${record.valuation.accountId}`],
      );
      await client.query(
        `INSERT INTO paper_canonical_valuation_history (
           stream_id, account_id, valued_at_ms, revision, engine_state_hash, record_hash, record_json, created_at_ms
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
         ON CONFLICT (stream_id, account_id, valued_at_ms) DO NOTHING`,
        [
          record.streamId,
          record.valuation.accountId,
          record.valuation.valuedAt,
          record.revision,
          record.engineStateHash,
          hash,
          JSON.stringify(record),
          Date.now(),
        ],
      );
      const selected = await client.query<StoredRow>(
        `SELECT record_json, record_hash
         FROM paper_canonical_valuation_history
         WHERE stream_id = $1 AND account_id = $2 AND valued_at_ms = $3`,
        [record.streamId, record.valuation.accountId, record.valuation.valuedAt],
      );
      const row = selected.rows[0];
      if (!row) fail("canonical valuation history insert could not be read back");
      assertPaperCanonicalValuationRecord(row.record_json);
      const storedHash = recordHash(row.record_json);
      if (row.record_hash !== storedHash) fail("stored canonical valuation history hash mismatch");
      if (storedHash !== hash) fail("canonical valuation timestamp already contains different evidence");
      await client.query("COMMIT");
      return clone(row.record_json);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally {
      client.release();
    }
  }

  async list(streamId: string, accountId: string): Promise<PaperCanonicalValuationRecord[]> {
    assertNonEmpty(streamId, "canonical valuation history streamId");
    assertNonEmpty(accountId, "canonical valuation history accountId");
    const client = await this.pool.connect();
    try {
      const result = await client.query<StoredRow>(
        `SELECT record_json, record_hash
         FROM paper_canonical_valuation_history
         WHERE stream_id = $1 AND account_id = $2
         ORDER BY valued_at_ms ASC, revision ASC`,
        [streamId, accountId],
      );
      const records = result.rows.map((row) => {
        assertPaperCanonicalValuationRecord(row.record_json);
        const hash = recordHash(row.record_json);
        if (row.record_hash !== hash) fail("stored canonical valuation history hash mismatch");
        return clone(row.record_json);
      });
      return sort(records);
    } finally {
      client.release();
    }
  }
}
