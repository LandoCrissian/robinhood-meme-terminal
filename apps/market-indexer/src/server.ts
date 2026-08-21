import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import type { Pool } from "pg";
import type { MarketIndexerConfig } from "./config.js";
import {
  MARKET_INDEXER_ACTIVATION_LOCKED,
  MARKET_INDEXER_CHAIN_ID,
  MARKET_SOURCE_MANIFEST_HASH,
  marketSources
} from "./sources.js";
import type { MarketIndexerWorker } from "./worker.js";
import type { PositionGuardHeartbeat } from "./position-guard-heartbeat.js";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const POOL_KEY_PATTERN = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_POOL_ID = `0x${"0".repeat(64)}`;

function exactToken(value: string | null) {
  if (value === null) return null;
  if (!EVM_ADDRESS_PATTERN.test(value) || value.toLowerCase() === ZERO_ADDRESS) {
    return undefined;
  }
  return value.toLowerCase();
}

function exactPoolKey(value: string | null) {
  if (value === null) return null;
  const normalized = value.toLowerCase();
  if (
    !POOL_KEY_PATTERN.test(value) ||
    normalized === ZERO_ADDRESS ||
    normalized === ZERO_POOL_ID
  ) {
    return undefined;
  }
  return normalized;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(JSON.stringify(body));
}

function bearer(request: IncomingMessage, expected: string) {
  const value = request.headers.authorization;
  if (!value?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(value.slice(7));
  const target = Buffer.from(expected);
  return actual.length === target.length && timingSafeEqual(actual, target);
}

function heartbeat(worker: MarketIndexerWorker, config: MarketIndexerConfig) {
  const completedAt = worker.status.lastCycleCompletedAt;
  const ageMs =
    completedAt === null ? null : Math.max(Date.now() - Date.parse(completedAt), 0);
  const staleAfterMs = Math.max(
    config.pollIntervalMs * 3,
    config.heartbeatIntervalMs * 2,
    30_000
  );
  return {
    cycleSequence: worker.status.cycleSequence,
    running: worker.status.running,
    lastCycleStartedAt: worker.status.lastCycleStartedAt,
    lastCycleCompletedAt: completedAt,
    lastCycleDurationMs: worker.status.lastCycleDurationMs,
    ageMs,
    staleAfterMs,
    stale: ageMs !== null && ageMs > staleAfterMs
  };
}

export function createMarketIndexerServer(
  pool: Pool,
  config: MarketIndexerConfig,
  worker: MarketIndexerWorker,
  positionGuardHeartbeat?: PositionGuardHeartbeat
) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://market-indexer.internal");
      if (request.method === "GET" && url.pathname === "/health") {
        const workerHeartbeat = heartbeat(worker, config);
        const telemetry = worker.status.telemetry;
        json(response, 200, {
          ok:
            worker.status.lastError === null &&
            !workerHeartbeat.stale &&
            worker.status.cycleSequence > 0,
          mode: "shadow",
          storageMode: config.storageMode,
          chainId: MARKET_INDEXER_CHAIN_ID,
          authoritative: false,
          servingProductionTraffic: false,
          activationLocked: MARKET_INDEXER_ACTIVATION_LOCKED,
          sourceManifestHash: MARKET_SOURCE_MANIFEST_HASH,
          configuredSources: marketSources.map((source) => source.id),
          verifiedSources: worker.status.verifiedSources,
          verifiedDependencies: worker.status.verifiedDependencies,
          indexedThrough: worker.status.indexedThrough,
          lastSyncAt: worker.status.lastSyncAt,
          heartbeat: workerHeartbeat,
          finalizedHead: worker.status.lastFinalizedHead,
          totalPools: telemetry?.totalPools ?? null,
          stateReadyPools: telemetry?.stateReadyPools ?? null,
          stateErrorPools: telemetry?.stateErrorPools ?? null,
          database: telemetry?.database ?? {
            scope: "logical-database-only",
            logicalBytes: null,
            configuredLimitBytes: config.databaseSizeLimitBytes,
            remainingLogicalBytes: null,
            usageBps: null,
            pressure: "unknown",
            providerVolumeIncluded: false
          },
          sourceStatus:
            telemetry?.sources.map((source) => ({
              sourceId: source.sourceId,
              status: source.status,
              lagBlocks: source.lagBlocks,
              poolCount: source.poolCount,
              stateReadyCount: source.stateReadyCount,
              stateErrorCount: source.stateErrorCount
            })) ?? [],
          positionGuardEvaluator: positionGuardHeartbeat?.status ?? {
            enabled: false,
            running: false,
            cycleSequence: 0,
            lastAttemptAt: null,
            lastSuccessAt: null,
            lastError: null
          },
          error: worker.status.lastError === null ? null : "worker-error"
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/ready") {
        json(response, 503, {
          ok: false,
          mode: "shadow",
          authoritative: false,
          servingProductionTraffic: false,
          activationLocked: true,
          reason: "shadow market data cannot receive production traffic"
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/status") {
        if (!bearer(request, config.readToken)) {
          json(response, 401, { error: "unauthorized" });
          return;
        }
        json(response, 200, {
          mode: "shadow",
          storageMode: config.storageMode,
          chainId: MARKET_INDEXER_CHAIN_ID,
          authoritative: false,
          servingProductionTraffic: false,
          activationLocked: MARKET_INDEXER_ACTIVATION_LOCKED,
          sourceManifestHash: MARKET_SOURCE_MANIFEST_HASH,
          configuredSources: marketSources.map((source) => source.id),
          verifiedSources: worker.status.verifiedSources,
          verifiedDependencies: worker.status.verifiedDependencies,
          indexedThrough: worker.status.indexedThrough,
          lastSyncAt: worker.status.lastSyncAt,
          lastError: worker.status.lastError,
          heartbeat: heartbeat(worker, config),
          positionGuardEvaluator: positionGuardHeartbeat?.status ?? null,
          telemetry: worker.status.telemetry
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/pools") {
        if (!bearer(request, config.readToken)) {
          json(response, 401, { error: "unauthorized" });
          return;
        }
        const rawLimit = url.searchParams.get("limit") ?? "100";
        if (!/^[1-9][0-9]*$/.test(rawLimit)) {
          json(response, 400, { error: "limit must be an integer" });
          return;
        }
        const limit = Number(rawLimit);
        if (!Number.isSafeInteger(limit) || limit > 500) {
          json(response, 400, { error: "limit must be between 1 and 500" });
          return;
        }
        const source = url.searchParams.get("source");
        if (source && !marketSources.some((candidate) => candidate.id === source)) {
          json(response, 400, { error: "unsupported source" });
          return;
        }
        const token = exactToken(url.searchParams.get("token"));
        if (token === undefined) {
          json(response, 400, { error: "token must be a nonzero EVM address" });
          return;
        }
        const poolKey = exactPoolKey(url.searchParams.get("poolKey"));
        if (poolKey === undefined) {
          json(response, 400, {
            error: "poolKey must be a nonzero EVM address or bytes32 PoolId"
          });
          return;
        }
        const result = await pool.query(
          `SELECT pools.source_id AS "sourceId", pools.protocol,
                  pools.protocol_version AS "version", pools.pool_key AS "poolKey",
                  pools.pool_address AS "poolAddress", pools.token0, pools.token1,
                  pools.stable, pools.fee, pools.tick_spacing AS "tickSpacing",
                  pools.hooks, pools.transaction_hash AS "transactionHash",
                  pools.block_number AS "blockNumber", pools.block_hash AS "blockHash",
                  state.status AS "stateStatus",
                  state.live_fee AS "liveFee",
                  state.fee_denominator AS "feeDenominator",
                  state.gauge_address AS "gaugeAddress",
                  state.gauge_alive AS "gaugeAlive",
                  state.gauge_weight AS "gaugeWeight",
                  state.gauge_claimable AS "gaugeClaimable",
                  state.fees_address AS "feesAddress",
                  state.bribe_address AS "bribeAddress",
                  state.last_error AS "stateError",
                  state.observed_block AS "stateObservedBlock",
                  state.observed_block_hash AS "stateObservedBlockHash"
           FROM market_pools AS pools
           LEFT JOIN market_pool_state AS state
             ON state.chain_id = pools.chain_id
            AND state.source_id = pools.source_id
            AND state.pool_key = pools.pool_key
           WHERE pools.chain_id = $1
             AND ($2::text IS NULL OR pools.source_id = $2)
             AND ($3::text IS NULL OR pools.token0 = $3 OR pools.token1 = $3)
             AND ($4::text IS NULL OR pools.pool_key = $4)
           ORDER BY pools.block_number DESC, pools.transaction_index DESC, pools.log_index DESC
           LIMIT $5`,
          [MARKET_INDEXER_CHAIN_ID, source, token, poolKey, limit]
        );
        json(response, 200, {
          chainId: MARKET_INDEXER_CHAIN_ID,
          mode: "shadow",
          authoritative: false,
          sourceManifestHash: MARKET_SOURCE_MANIFEST_HASH,
          pools: result.rows
        });
        return;
      }
      json(response, 404, { error: "not found" });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "market_indexer_request_failed",
          method: request.method,
          path: request.url,
          error: error instanceof Error ? error.message.slice(0, 4_096) : "unknown"
        })
      );
      json(response, 500, { error: "internal error" });
    }
  });
}
