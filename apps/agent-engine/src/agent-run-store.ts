import {
  assertAgentRunRecord,
  hashCanonicalPayload,
  type AgentRunRecord,
} from "../../../packages/agent-core/src/index.ts";
import type { CompilationSqlPoolLike } from "./strategy-compilation-store.ts";

export interface AgentRunStore {
  getByEvaluationKey(streamId: string, evaluationKey: string): Promise<AgentRunRecord | null>;
  putIfAbsent(streamId: string, record: AgentRunRecord): Promise<AgentRunRecord>;
}

interface AgentRunRow {
  record_json: AgentRunRecord;
  record_hash: string;
}

export const agentRunSchemaSql = `
CREATE TABLE IF NOT EXISTS agent_runs (
  stream_id TEXT NOT NULL,
  evaluation_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  strategy_version INTEGER NOT NULL CHECK (strategy_version > 0),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^0x[0-9a-f]{64}$'),
  record_json JSONB NOT NULL,
  record_hash TEXT NOT NULL CHECK (record_hash ~ '^0x[0-9a-f]{64}$'),
  evaluated_at_ms BIGINT NOT NULL CHECK (evaluated_at_ms >= 0),
  PRIMARY KEY (stream_id, evaluation_key),
  UNIQUE (stream_id, run_id),
  FOREIGN KEY (stream_id, agent_id) REFERENCES agents (stream_id, agent_id),
  FOREIGN KEY (stream_id, agent_id, strategy_version) REFERENCES strategy_versions (stream_id, agent_id, version)
);
CREATE INDEX IF NOT EXISTS agent_runs_agent_time_idx
  ON agent_runs (stream_id, agent_id, evaluated_at_ms DESC);
`;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be non-empty`);
}

function key(streamId: string, evaluationKey: string): string {
  return `${streamId}\u0000${evaluationKey}`;
}

function verifyStoredRun(row: AgentRunRow): AgentRunRecord {
  const record = clone(row.record_json);
  assertAgentRunRecord(record);
  if (row.record_hash !== hashCanonicalPayload(record)) throw new Error("stored agent run record hash mismatch");
  return record;
}

export class InMemoryAgentRunStore implements AgentRunStore {
  private readonly records = new Map<string, AgentRunRecord>();

  async getByEvaluationKey(streamId: string, evaluationKey: string): Promise<AgentRunRecord | null> {
    assertNonEmpty(streamId, "streamId");
    assertNonEmpty(evaluationKey, "evaluationKey");
    const record = this.records.get(key(streamId, evaluationKey));
    return record ? clone(record) : null;
  }

  async putIfAbsent(streamId: string, record: AgentRunRecord): Promise<AgentRunRecord> {
    assertNonEmpty(streamId, "streamId");
    assertAgentRunRecord(record);
    const recordKey = key(streamId, record.evaluationKey);
    const existing = this.records.get(recordKey);
    if (existing) return clone(existing);
    this.records.set(recordKey, clone(record));
    return clone(record);
  }
}

export class PostgresAgentRunStore implements AgentRunStore {
  private readonly pool: CompilationSqlPoolLike;

  constructor(pool: CompilationSqlPoolLike) {
    this.pool = pool;
  }

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(agentRunSchemaSql);
    } finally {
      client.release();
    }
  }

  async getByEvaluationKey(streamId: string, evaluationKey: string): Promise<AgentRunRecord | null> {
    assertNonEmpty(streamId, "streamId");
    assertNonEmpty(evaluationKey, "evaluationKey");
    const client = await this.pool.connect();
    try {
      const result = await client.query<AgentRunRow>(
        `SELECT record_json, record_hash
         FROM agent_runs
         WHERE stream_id = $1 AND evaluation_key = $2`,
        [streamId, evaluationKey],
      );
      const row = result.rows[0];
      return row ? verifyStoredRun(row) : null;
    } finally {
      client.release();
    }
  }

  async putIfAbsent(streamId: string, record: AgentRunRecord): Promise<AgentRunRecord> {
    assertNonEmpty(streamId, "streamId");
    assertAgentRunRecord(record);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('rmt-agent-run'), hashtext($1 || ':' || $2))",
        [streamId, record.evaluationKey],
      );
      const existing = await client.query<AgentRunRow>(
        `SELECT record_json, record_hash
         FROM agent_runs
         WHERE stream_id = $1 AND evaluation_key = $2
         FOR UPDATE`,
        [streamId, record.evaluationKey],
      );
      const existingRow = existing.rows[0];
      if (existingRow) {
        const verified = verifyStoredRun(existingRow);
        await client.query("COMMIT");
        return verified;
      }
      const recordHash = hashCanonicalPayload(record);
      await client.query(
        `INSERT INTO agent_runs (
           stream_id, evaluation_key, run_id, agent_id, strategy_version, request_hash,
           record_json, record_hash, evaluated_at_ms
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`,
        [
          streamId, record.evaluationKey, record.runId, record.agentId, record.strategyVersion,
          record.requestHash, JSON.stringify(record), recordHash, record.evaluatedAt,
        ],
      );
      await client.query("COMMIT");
      return clone(record);
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* Preserve original error. */ }
      throw error;
    } finally {
      client.release();
    }
  }
}

