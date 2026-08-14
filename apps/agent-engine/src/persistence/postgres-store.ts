import { hashCanonicalPayload } from "../../../../packages/agent-core/src/index.ts";
import type { AgentEngineSnapshot } from "../snapshot.ts";
import { agentEngineSchemaSql } from "./schema.ts";
import type {
  AgentStateCommitInput,
  AgentStateCommitResult,
  AgentStateStore,
  StoredAgentEngineState,
  StoredMutationReplay,
} from "./store.ts";

export interface SqlQueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface SqlClientLike {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<SqlQueryResult<Row>>;
  release(): void;
}

export interface SqlPoolLike {
  connect(): Promise<SqlClientLike>;
}

interface StateRow {
  revision: string | number;
  state_json: AgentEngineSnapshot;
  state_hash: string;
}

interface MutationRow {
  operation: string;
  request_hash: string;
  result_json: unknown;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseRevision(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("stored agent engine revision is invalid or exceeds JS safe integer range");
  return parsed;
}

function verifyStateRow(row: StateRow): StoredAgentEngineState {
  const snapshot = clone(row.state_json);
  const expectedHash = hashCanonicalPayload(snapshot);
  if (row.state_hash !== expectedHash) throw new Error("stored agent engine state hash mismatch");
  return { revision: parseRevision(row.revision), snapshot };
}

async function upsertProjection(client: SqlClientLike, streamId: string, snapshot: AgentEngineSnapshot): Promise<void> {
  for (const season of snapshot.seasons) {
    await client.query(
      `INSERT INTO agent_seasons (stream_id, season_id, name, starts_at_ms, ends_at_ms, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (stream_id, season_id) DO UPDATE SET
         name = EXCLUDED.name,
         starts_at_ms = EXCLUDED.starts_at_ms,
         ends_at_ms = EXCLUDED.ends_at_ms,
         created_at_ms = EXCLUDED.created_at_ms`,
      [streamId, season.seasonId, season.name, season.startsAt, season.endsAt ?? null, season.createdAt],
    );
  }

  for (const agent of snapshot.agents) {
    await client.query(
      `INSERT INTO agents (stream_id, agent_id, owner_address, name, thesis, performance_state, execution_mode, created_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (stream_id, agent_id) DO UPDATE SET
         owner_address = EXCLUDED.owner_address,
         name = EXCLUDED.name,
         thesis = EXCLUDED.thesis,
         performance_state = EXCLUDED.performance_state,
         execution_mode = EXCLUDED.execution_mode,
         created_at_ms = EXCLUDED.created_at_ms`,
      [streamId, agent.id, agent.ownerAddress, agent.name, agent.thesis, agent.performanceState, agent.executionMode, agent.createdAt],
    );
  }

  for (const strategy of snapshot.strategyVersions) {
    await client.query(
      `INSERT INTO strategy_versions (stream_id, strategy_id, agent_id, version, spec_json, strategy_hash, created_at_ms)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)
       ON CONFLICT (stream_id, strategy_id) DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         version = EXCLUDED.version,
         spec_json = EXCLUDED.spec_json,
         strategy_hash = EXCLUDED.strategy_hash,
         created_at_ms = EXCLUDED.created_at_ms`,
      [streamId, strategy.id, strategy.agentId, strategy.version, JSON.stringify(strategy.spec), strategy.strategyHash, strategy.createdAt],
    );
  }

  for (const account of snapshot.paperAccounts) {
    await client.query(
      `INSERT INTO paper_accounts (stream_id, account_id, season_id, participant_type, participant_id, balances_json, opened_at_ms)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
       ON CONFLICT (stream_id, account_id) DO UPDATE SET
         season_id = EXCLUDED.season_id,
         participant_type = EXCLUDED.participant_type,
         participant_id = EXCLUDED.participant_id,
         balances_json = EXCLUDED.balances_json,
         opened_at_ms = EXCLUDED.opened_at_ms`,
      [streamId, account.accountId, account.seasonId, account.participantType, account.participantId, JSON.stringify(account.balances), account.openedAt],
    );
  }

  for (const decision of snapshot.decisions) {
    await client.query(
      `INSERT INTO agent_decisions (
         stream_id, decision_id, agent_id, strategy_version, market_snapshot_id, created_at_ms,
         action, confidence, reasoning_summary, model_identity, compiler_version, policy_version, decision_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (stream_id, decision_id) DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         strategy_version = EXCLUDED.strategy_version,
         market_snapshot_id = EXCLUDED.market_snapshot_id,
         created_at_ms = EXCLUDED.created_at_ms,
         action = EXCLUDED.action,
         confidence = EXCLUDED.confidence,
         reasoning_summary = EXCLUDED.reasoning_summary,
         model_identity = EXCLUDED.model_identity,
         compiler_version = EXCLUDED.compiler_version,
         policy_version = EXCLUDED.policy_version,
         decision_hash = EXCLUDED.decision_hash`,
      [
        streamId, decision.decisionId, decision.agentId, decision.strategyVersion, decision.marketSnapshotId,
        decision.createdAt, decision.action, decision.confidence, decision.reasoningSummary, decision.modelIdentity,
        decision.compilerVersion, decision.policyVersion, decision.decisionHash,
      ],
    );
  }

  for (const prediction of snapshot.predictions) {
    await client.query(
      `INSERT INTO predictions (
         stream_id, prediction_id, agent_id, strategy_version, asset_id, condition,
         forecast_probability, created_at_ms, resolves_at_ms, resolved_outcome, resolved_at_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (stream_id, prediction_id) DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         strategy_version = EXCLUDED.strategy_version,
         asset_id = EXCLUDED.asset_id,
         condition = EXCLUDED.condition,
         forecast_probability = EXCLUDED.forecast_probability,
         created_at_ms = EXCLUDED.created_at_ms,
         resolves_at_ms = EXCLUDED.resolves_at_ms,
         resolved_outcome = EXCLUDED.resolved_outcome,
         resolved_at_ms = EXCLUDED.resolved_at_ms`,
      [
        streamId, prediction.predictionId, prediction.agentId, prediction.strategyVersion, prediction.assetId,
        prediction.condition, prediction.forecastProbability, prediction.createdAt, prediction.resolvesAt,
        prediction.resolvedOutcome ?? null, prediction.resolvedAt ?? null,
      ],
    );
  }

  for (const order of snapshot.paperOrders) {
    await client.query(
      `INSERT INTO paper_orders (
         stream_id, order_id, agent_id, strategy_version, account_id, input_asset_id, output_asset_id,
         input_amount_atomic, maximum_slippage_bps, created_at_ms, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (stream_id, order_id) DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         strategy_version = EXCLUDED.strategy_version,
         account_id = EXCLUDED.account_id,
         input_asset_id = EXCLUDED.input_asset_id,
         output_asset_id = EXCLUDED.output_asset_id,
         input_amount_atomic = EXCLUDED.input_amount_atomic,
         maximum_slippage_bps = EXCLUDED.maximum_slippage_bps,
         created_at_ms = EXCLUDED.created_at_ms,
         status = EXCLUDED.status`,
      [
        streamId, order.orderId, order.agentId, order.strategyVersion, order.accountId, order.inputAssetId,
        order.outputAssetId, order.inputAmountAtomic, order.maximumSlippageBps, order.createdAt, order.status,
      ],
    );
  }

  for (const fill of snapshot.paperFills) {
    await client.query(
      `INSERT INTO paper_fills (
         stream_id, fill_id, order_id, quote_id, agent_id, account_id, input_asset_id, output_asset_id,
         input_amount_atomic, output_amount_atomic, provider_id, fee_asset_id, fee_amount_atomic,
         gas_asset_id, gas_cost_atomic, filled_at_ms, evidence_hash, quote_evidence_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
       ON CONFLICT (stream_id, fill_id) DO UPDATE SET
         order_id = EXCLUDED.order_id,
         quote_id = EXCLUDED.quote_id,
         agent_id = EXCLUDED.agent_id,
         account_id = EXCLUDED.account_id,
         input_asset_id = EXCLUDED.input_asset_id,
         output_asset_id = EXCLUDED.output_asset_id,
         input_amount_atomic = EXCLUDED.input_amount_atomic,
         output_amount_atomic = EXCLUDED.output_amount_atomic,
         provider_id = EXCLUDED.provider_id,
         fee_asset_id = EXCLUDED.fee_asset_id,
         fee_amount_atomic = EXCLUDED.fee_amount_atomic,
         gas_asset_id = EXCLUDED.gas_asset_id,
         gas_cost_atomic = EXCLUDED.gas_cost_atomic,
         filled_at_ms = EXCLUDED.filled_at_ms,
         evidence_hash = EXCLUDED.evidence_hash,
         quote_evidence_json = EXCLUDED.quote_evidence_json`,
      [
        streamId, fill.fillId, fill.orderId, fill.quoteId, fill.agentId, fill.accountId, fill.inputAssetId,
        fill.outputAssetId, fill.inputAmountAtomic, fill.outputAmountAtomic, fill.providerId, fill.feeAssetId ?? null,
        fill.feeAmountAtomic, fill.gasAssetId ?? null, fill.gasCostAtomic, fill.filledAt, fill.evidenceHash,
        JSON.stringify(fill.quoteEvidence),
      ],
    );
  }

  for (const portfolio of snapshot.portfolioSnapshots) {
    await client.query(
      `INSERT INTO portfolio_snapshots (
         stream_id, account_id, captured_at_ms, quote_asset_id, mark_nav_atomic, liquidation_nav_atomic
       ) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (stream_id, account_id, captured_at_ms) DO UPDATE SET
         quote_asset_id = EXCLUDED.quote_asset_id,
         mark_nav_atomic = EXCLUDED.mark_nav_atomic,
         liquidation_nav_atomic = EXCLUDED.liquidation_nav_atomic`,
      [streamId, portfolio.accountId, portfolio.capturedAt, portfolio.quoteAssetId, portfolio.markNavAtomic, portfolio.liquidationNavAtomic],
    );
  }

  for (const risk of snapshot.riskEvents) {
    await client.query(
      `INSERT INTO risk_events (
         stream_id, risk_event_id, agent_id, account_id, event_type, severity, detail, policy_version, occurred_at_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (stream_id, risk_event_id) DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         account_id = EXCLUDED.account_id,
         event_type = EXCLUDED.event_type,
         severity = EXCLUDED.severity,
         detail = EXCLUDED.detail,
         policy_version = EXCLUDED.policy_version,
         occurred_at_ms = EXCLUDED.occurred_at_ms`,
      [streamId, risk.riskEventId, risk.agentId, risk.accountId ?? null, risk.type, risk.severity, risk.detail, risk.policyVersion, risk.occurredAt],
    );
  }

  for (const score of snapshot.scoreSnapshots) {
    await client.query(
      `INSERT INTO score_snapshots (
         stream_id, score_snapshot_id, agent_id, season_id, brier_score, prediction_count,
         resolved_prediction_count, paper_fill_count, captured_at_ms
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (stream_id, score_snapshot_id) DO UPDATE SET
         agent_id = EXCLUDED.agent_id,
         season_id = EXCLUDED.season_id,
         brier_score = EXCLUDED.brier_score,
         prediction_count = EXCLUDED.prediction_count,
         resolved_prediction_count = EXCLUDED.resolved_prediction_count,
         paper_fill_count = EXCLUDED.paper_fill_count,
         captured_at_ms = EXCLUDED.captured_at_ms`,
      [
        streamId, score.scoreSnapshotId, score.agentId, score.seasonId, score.brierScore, score.predictionCount,
        score.resolvedPredictionCount, score.paperFillCount, score.capturedAt,
      ],
    );
  }
}

export class PostgresAgentStateStore implements AgentStateStore {
  private readonly pool: SqlPoolLike;

  constructor(pool: SqlPoolLike) {
    this.pool = pool;
  }

  async ensureSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(agentEngineSchemaSql);
    } finally {
      client.release();
    }
  }

  async load(streamId: string): Promise<StoredAgentEngineState | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query<StateRow>(
        "SELECT revision, state_json, state_hash FROM agent_engine_state WHERE stream_id = $1",
        [streamId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return verifyStateRow(row);
    } finally {
      client.release();
    }
  }

  async lookupMutation(streamId: string, idempotencyKey: string, requestHash: string): Promise<StoredMutationReplay | null> {
    const client = await this.pool.connect();
    try {
      const mutationResult = await client.query<MutationRow>(
        `SELECT operation, request_hash, result_json
         FROM agent_engine_mutations
         WHERE stream_id = $1 AND idempotency_key = $2`,
        [streamId, idempotencyKey],
      );
      const mutation = mutationResult.rows[0];
      if (!mutation) return null;
      if (mutation.request_hash !== requestHash) throw new Error("idempotency key was already used for a different request");
      const stateResult = await client.query<StateRow>(
        "SELECT revision, state_json, state_hash FROM agent_engine_state WHERE stream_id = $1",
        [streamId],
      );
      const state = stateResult.rows[0];
      if (!state) throw new Error("idempotency record exists without canonical engine state");
      const verified = verifyStateRow(state);
      return {
        operation: mutation.operation,
        requestHash: mutation.request_hash,
        result: clone(mutation.result_json),
        revision: verified.revision,
        snapshot: verified.snapshot,
      };
    } finally {
      client.release();
    }
  }

  async commit(input: AgentStateCommitInput): Promise<AgentStateCommitResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('rmt-agent-engine'), hashtext($1))", [input.streamId]);

      const stateResult = await client.query<StateRow>(
        "SELECT revision, state_json, state_hash FROM agent_engine_state WHERE stream_id = $1 FOR UPDATE",
        [input.streamId],
      );
      const currentState = stateResult.rows[0] ?? null;
      const verifiedCurrent = currentState ? verifyStateRow(currentState) : null;
      const currentRevision = verifiedCurrent?.revision ?? 0;

      const mutationResult = await client.query<MutationRow>(
        `SELECT operation, request_hash, result_json
         FROM agent_engine_mutations
         WHERE stream_id = $1 AND idempotency_key = $2`,
        [input.streamId, input.idempotencyKey],
      );
      const existingMutation = mutationResult.rows[0] ?? null;
      if (existingMutation) {
        if (existingMutation.request_hash !== input.requestHash || existingMutation.operation !== input.operation) {
          throw new Error("idempotency key was already used for a different request");
        }
        if (!currentState) throw new Error("idempotency record exists without canonical engine state");
        await client.query("COMMIT");
        return {
          status: "REPLAYED",
          revision: currentRevision,
          snapshot: clone(verifiedCurrent!.snapshot),
          result: clone(existingMutation.result_json),
        };
      }

      if (currentRevision !== input.expectedRevision) {
        if (!currentState) throw new Error("revision conflict without canonical engine state");
        await client.query("ROLLBACK");
        return { status: "CONFLICT", revision: currentRevision, snapshot: clone(verifiedCurrent!.snapshot) };
      }

      const revision = currentRevision + 1;
      if (!Number.isSafeInteger(revision)) throw new Error("agent engine revision exceeds JS safe integer range");
      const stateHash = hashCanonicalPayload(input.snapshot);
      await client.query(
        `INSERT INTO agent_engine_state (stream_id, schema_version, revision, state_json, state_hash, updated_at_ms)
         VALUES ($1,1,$2,$3::jsonb,$4,$5)
         ON CONFLICT (stream_id) DO UPDATE SET
           schema_version = EXCLUDED.schema_version,
           revision = EXCLUDED.revision,
           state_json = EXCLUDED.state_json,
           state_hash = EXCLUDED.state_hash,
           updated_at_ms = EXCLUDED.updated_at_ms`,
        [input.streamId, revision, JSON.stringify(input.snapshot), stateHash, input.createdAt],
      );
      await client.query(
        `INSERT INTO agent_engine_mutations (
           stream_id, revision, idempotency_key, operation, request_hash, result_json, state_hash, created_at_ms
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [
          input.streamId, revision, input.idempotencyKey, input.operation, input.requestHash,
          JSON.stringify(input.result), stateHash, input.createdAt,
        ],
      );

      await upsertProjection(client, input.streamId, input.snapshot);
      await client.query("COMMIT");
      return { status: "COMMITTED", revision, snapshot: clone(input.snapshot), result: clone(input.result) };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original persistence error.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}
