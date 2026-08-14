import {
  assertStrategyCompilationRecord,
  hashCanonicalPayload,
  type StrategyCompilationRecord,
} from "../../../packages/agent-core/src/index.ts";

export interface StrategyCompilationStore {
  getByRequestHash(streamId: string, requestHash: string): Promise<StrategyCompilationRecord | null>;
  putIfAbsent(streamId: string, record: StrategyCompilationRecord): Promise<StrategyCompilationRecord>;
}

export interface CompilationSqlQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface CompilationSqlClientLike {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<CompilationSqlQueryResult<Row>>;
  release(): void;
}

export interface CompilationSqlPoolLike {
  connect(): Promise<CompilationSqlClientLike>;
}

interface CompilationRow {
  record_json: StrategyCompilationRecord;
  record_hash: string;
}

export const strategyCompilationSchemaSql = `
CREATE TABLE IF NOT EXISTS strategy_compilations (
  stream_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^0x[0-9a-f]{64}$'),
  compilation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ADMITTED','REJECTED')),
  record_json JSONB NOT NULL,
  record_hash TEXT NOT NULL CHECK (record_hash ~ '^0x[0-9a-f]{64}$'),
  compiled_at_ms BIGINT NOT NULL CHECK (compiled_at_ms >= 0),
  PRIMARY KEY (stream_id, request_hash),
  UNIQUE (stream_id, compilation_id),
  FOREIGN KEY (stream_id, agent_id) REFERENCES agents (stream_id, agent_id)
);
CREATE INDEX IF NOT EXISTS strategy_compilations_agent_time_idx
  ON strategy_compilations (stream_id, agent_id, compiled_at_ms DESC);
`;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be non-empty`);
}

function key(streamId: string, requestHash: string): string {
  return `${streamId}\u0000${requestHash}`;
}

function verifyStoredCompilation(row: CompilationRow): StrategyCompilationRecord {
  const record = clone(row.record_json);
  assertStrategyCompilationRecord(record);
  if (row.record_hash !== hashCanonicalPayload(record)) throw new Error("stored strategy compilation record hash mismatch");
  return record;
}

export class InMemoryStrategyCompilationStore implements StrategyCompilationStore {
  private readonly records = new Map<string, StrategyCompilationRecord>();

  async getByRequestHash(streamId: string, requestHash: string): Promise<StrategyCompilationRecord | null> {
    assertNonEmpty(streamId, "streamId");
    assertNonEmpty(requestHash, "requestHash");
    const record = this.records.get(key(streamId, requestHash));
    return record ? clone(record) : null;
  }

  async putIfAbsent(streamId: string, record: StrategyCompilationRecord): Promise<StrategyCompilationRecord> {
    assertNonEmpty(streamId, "streamId");
    assertStrategyCompilationRecord(record);
    const recordKey = key(streamId, record.requestHash);
    const existing = this.records.get(recordKey);
    if (existing) return clone(existing);
    this.records.set(recordKey, clone(record));
    return clone(record);
  }
}

export class PostgresStrategyCompilationStore implements StrategyCompilationStore {
  private readonly pool: CompilationSqlPoolLike;

  constructor(pool: CompilationSqlPoolLike) {
    this.pool = pool;
  }

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(strategyCompilationSchemaSql);
    } finally {
      client.release();
    }
  }

  async getByRequestHash(streamId: string, requestHash: string): Promise<StrategyCompilationRecord | null> {
    assertNonEmpty(streamId, "streamId");
    assertNonEmpty(requestHash, "requestHash");
    const client = await this.pool.connect();
    try {
      const result = await client.query<CompilationRow>(
        `SELECT record_json, record_hash
         FROM strategy_compilations
         WHERE stream_id = $1 AND request_hash = $2`,
        [streamId, requestHash],
      );
      const row = result.rows[0];
      return row ? verifyStoredCompilation(row) : null;
    } finally {
      client.release();
    }
  }

  async putIfAbsent(streamId: string, record: StrategyCompilationRecord): Promise<StrategyCompilationRecord> {
    assertNonEmpty(streamId, "streamId");
    assertStrategyCompilationRecord(record);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('rmt-agent-compiler'), hashtext($1 || ':' || $2))",
        [streamId, record.requestHash],
      );
      const existing = await client.query<CompilationRow>(
        `SELECT record_json, record_hash
         FROM strategy_compilations
         WHERE stream_id = $1 AND request_hash = $2
         FOR UPDATE`,
        [streamId, record.requestHash],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        const verified = verifyStoredCompilation(existingRow);
        await client.query("COMMIT");
        return verified;
      }

      const recordHash = hashCanonicalPayload(record);
      await client.query(
        `INSERT INTO strategy_compilations (
           stream_id, request_hash, compilation_id, agent_id, status, record_json, record_hash, compiled_at_ms
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [
          streamId,
          record.requestHash,
          record.compilationId,
          record.agentId,
          record.status,
          JSON.stringify(record),
          recordHash,
          record.compiledAt,
        ],
      );
      await client.query("COMMIT");
      return clone(record);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original compiler-persistence error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
