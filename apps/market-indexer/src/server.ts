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
import {
  readCanonicalTokenIdentityIndexStats,
  searchCanonicalTokenIdentityIndex
} from "./token-identity-index.js";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const POOL_KEY_PATTERN = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const CANONICAL_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const CURSOR_VERSION = 2 as const;
const MAX_CURSOR_LENGTH = 1_024;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_POOL_ID = `0x${"0".repeat(64)}`;

type PoolCursor = {
  v: typeof CURSOR_VERSION;
  chainId: typeof MARKET_INDEXER_CHAIN_ID;
  source: string | null;
  token: string | null;
  poolKey: string | null;
  blockNumber: string;
  logIndex: number;
};

type PoolRow = Record<string, unknown> & {
  blockNumber: string;
  logIndex: number;
};

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

function canonicalCoordinate(value: unknown) {
  return typeof value === "string" && CANONICAL_INTEGER_PATTERN.test(value)
    ? value
    : null;
}

function coordinateAtOrAfter(value: unknown, minimum: string) {
  const coordinate = canonicalCoordinate(value);
  return coordinate !== null && BigInt(coordinate) >= BigInt(minimum);
}

function nonnegativeIndex(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function cursorKeys(value: Record<string, unknown>) {
  return Object.keys(value).sort().join(",");
}

const EXPECTED_CURSOR_KEYS = [
  "blockNumber",
  "chainId",
  "logIndex",
  "poolKey",
  "source",
  "token",
  "v"
].sort().join(",");

function decodeCursor(value: string | null): PoolCursor | null | undefined {
  if (value === null) return null;
  if (
    value.length === 0 ||
    value.length > MAX_CURSOR_LENGTH ||
    !CURSOR_PATTERN.test(value)
  ) return undefined;

  let parsed: unknown;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return undefined;
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const candidate = parsed as Record<string, unknown>;
  if (
    cursorKeys(candidate) !== EXPECTED_CURSOR_KEYS ||
    candidate.v !== CURSOR_VERSION ||
    candidate.chainId !== MARKET_INDEXER_CHAIN_ID ||
    (candidate.source !== null &&
      (typeof candidate.source !== "string" ||
        !marketSources.some((source) => source.id === candidate.source))) ||
    (candidate.token !== null &&
      (typeof candidate.token !== "string" || exactToken(candidate.token) !== candidate.token)) ||
    (candidate.poolKey !== null &&
      (typeof candidate.poolKey !== "string" || exactPoolKey(candidate.poolKey) !== candidate.poolKey)) ||
    canonicalCoordinate(candidate.blockNumber) === null ||
    nonnegativeIndex(candidate.logIndex) === null
  ) return undefined;

  return candidate as PoolCursor;
}

function encodeCursor(
  source: string | null,
  token: string | null,
  poolKey: string | null,
  row: PoolRow
) {
  const blockNumber = canonicalCoordinate(row.blockNumber);
  const logIndex = nonnegativeIndex(row.logIndex);
  if (blockNumber === null || logIndex === null) {
    throw new Error("PostgreSQL returned invalid pagination coordinates");
  }
  const cursor: PoolCursor = {
    v: CURSOR_VERSION,
    chainId: MARKET_INDEXER_CHAIN_ID,
    source,
    token,
    poolKey,
    blockNumber,
    logIndex
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function publicPool(row: PoolRow) {
  const { logIndex: _logIndex, ...pool } = row;
  return pool;
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

function inventoryCoverage(
  worker: MarketIndexerWorker,
  config: MarketIndexerConfig
) {
  const workerHeartbeat = heartbeat(worker, config);
  const telemetry = worker.status.telemetry;
  const finalizedHead = canonicalCoordinate(telemetry?.finalizedHead) ?? null;
  const telemetryBySource = new Map(
    telemetry?.sources.map((source) => [source.sourceId, source]) ?? []
  );
  const sources = marketSources.map((configuredSource) => {
    const source = telemetryBySource.get(configuredSource.id);
    return source
      ? {
          sourceId: configuredSource.id,
          status: source.status,
          indexedThrough: canonicalCoordinate(source.indexedThrough)
        }
      : {
          sourceId: configuredSource.id,
          status: "missing" as const,
          indexedThrough: null
        };
  });
  const expectedSources = new Set(marketSources.map((source) => source.id));
  const observedSources = new Set(telemetry?.sources.map((source) => source.sourceId) ?? []);
  const exactSourceSet = Boolean(
    telemetry &&
    telemetry.sources.length === expectedSources.size &&
    observedSources.size === expectedSources.size &&
    [...observedSources].every((sourceId) => expectedSources.has(sourceId))
  );
  const exactVerifiedSet =
    worker.status.verifiedSources.length === expectedSources.size &&
    new Set(worker.status.verifiedSources).size === expectedSources.size &&
    worker.status.verifiedSources.every((sourceId) => expectedSources.has(sourceId));
  const complete = Boolean(
    telemetry &&
    finalizedHead !== null &&
    worker.status.lastFinalizedHead === finalizedHead &&
    worker.status.lastError === null &&
    worker.status.cycleSequence > 0 &&
    workerHeartbeat.ageMs !== null &&
    Number.isFinite(workerHeartbeat.ageMs) &&
    !workerHeartbeat.stale &&
    exactSourceSet &&
    exactVerifiedSet &&
    telemetry.sources.every((source) =>
      source.status === "shadow-ready" &&
      source.error === null &&
      source.lastSyncAt !== null &&
      source.finalizedHead === finalizedHead &&
      source.lagBlocks === "0" &&
      coordinateAtOrAfter(source.indexedThrough, finalizedHead)
    )
  );
  return { complete, finalizedHead, sources };
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
        const cursor = decodeCursor(url.searchParams.get("cursor"));
        if (cursor === undefined) {
          json(response, 400, { error: "cursor is malformed" });
          return;
        }
        if (
          cursor !== null &&
          (cursor.source !== source || cursor.token !== token || cursor.poolKey !== poolKey)
        ) {
          json(response, 400, { error: "cursor does not match query" });
          return;
        }
        const result = await pool.query(
          `SELECT manifest.source_id AS "sourceId", manifest.protocol,
                  manifest.protocol_version AS "version",
                  '0x' || encode(pools.pool_key, 'hex') AS "poolKey",
                  CASE WHEN pools.source_code = 5 THEN NULL
                       ELSE '0x' || encode(pools.pool_key, 'hex') END AS "poolAddress",
                  '0x' || encode(pools.token0, 'hex') AS token0,
                  '0x' || encode(pools.token1, 'hex') AS token1,
                  CASE WHEN pools.source_code = 6
                       THEN get_byte(pools.attributes, 0) = 1 ELSE NULL END AS stable,
                  CASE WHEN pools.source_code IN (2, 4, 5)
                       THEN get_byte(pools.attributes, 0) * 65536
                          + get_byte(pools.attributes, 1) * 256
                          + get_byte(pools.attributes, 2)
                       ELSE NULL END AS fee,
                  CASE
                    WHEN pools.source_code IN (2, 4, 5) THEN
                      get_byte(pools.attributes, 3) * 256 + get_byte(pools.attributes, 4)
                      - CASE WHEN get_byte(pools.attributes, 3) >= 128 THEN 65536 ELSE 0 END
                    WHEN pools.source_code = 7 THEN
                      get_byte(pools.attributes, 0) * 256 + get_byte(pools.attributes, 1)
                      - CASE WHEN get_byte(pools.attributes, 0) >= 128 THEN 65536 ELSE 0 END
                    ELSE NULL
                  END AS "tickSpacing",
                  CASE WHEN pools.source_code = 5
                       THEN '0x' || encode(substring(pools.attributes FROM 6 FOR 20), 'hex')
                       ELSE NULL END AS hooks,
                  '0x' || encode(substring(pools.provenance FROM 1 FOR 32), 'hex') AS "transactionHash",
                  pools.block_number::text AS "blockNumber",
                  '0x' || encode(substring(pools.provenance FROM 33 FOR 32), 'hex') AS "blockHash",
                  pools.log_index AS "logIndex",
                  state.status AS "stateStatus",
                  state.live_fee AS "liveFee",
                  state.fee_denominator AS "feeDenominator",
                  CASE WHEN state.gauge_address IS NULL THEN NULL
                       ELSE '0x' || encode(state.gauge_address, 'hex') END AS "gaugeAddress",
                  state.gauge_alive AS "gaugeAlive",
                  state.gauge_weight AS "gaugeWeight",
                  state.gauge_claimable AS "gaugeClaimable",
                  CASE WHEN state.fees_address IS NULL THEN NULL
                       ELSE '0x' || encode(state.fees_address, 'hex') END AS "feesAddress",
                  CASE WHEN state.bribe_address IS NULL THEN NULL
                       ELSE '0x' || encode(state.bribe_address, 'hex') END AS "bribeAddress",
                  state.last_error AS "stateError",
                  state.observed_block::text AS "stateObservedBlock",
                  CASE WHEN state.observed_block_hash IS NULL THEN NULL
                       ELSE '0x' || encode(state.observed_block_hash, 'hex') END AS "stateObservedBlockHash"
           FROM market_pools AS pools
           JOIN market_indexer_source_state AS manifest
             ON manifest.source_code = pools.source_code
           LEFT JOIN market_pool_state AS state
             ON state.source_code = pools.source_code
            AND state.pool_key = pools.pool_key
           WHERE ($1::text IS NULL OR manifest.source_id = $1)
             AND ($2::text IS NULL OR
               pools.token0 = decode(substring($2 FROM 3), 'hex') OR
               pools.token1 = decode(substring($2 FROM 3), 'hex'))
             AND ($3::text IS NULL OR pools.pool_key = decode(substring($3 FROM 3), 'hex'))
             AND ($4::integer IS NULL OR
               (pools.block_number, pools.log_index) < ($4::integer, $5::integer))
           ORDER BY pools.block_number DESC, pools.log_index DESC
           LIMIT $6`,
          [
            source,
            token,
            poolKey,
            cursor?.blockNumber ?? null,
            cursor?.logIndex ?? null,
            limit + 1
          ]
        );
        const rows = result.rows as PoolRow[];
        const hasNextPage = rows.length > limit;
        const page = rows.slice(0, limit);
        const lastRow = page.at(-1);
        json(response, 200, {
          chainId: MARKET_INDEXER_CHAIN_ID,
          mode: "shadow",
          authoritative: false,
          sourceManifestHash: MARKET_SOURCE_MANIFEST_HASH,
          coverage: inventoryCoverage(worker, config),
          nextCursor: hasNextPage && lastRow
            ? encodeCursor(source, token, poolKey, lastRow)
            : null,
          pools: page.map(publicPool)
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/v1/token-identities/search") {
        if (!bearer(request, config.readToken)) {
          json(response, 401, { error: "unauthorized" });
          return;
        }
        const query = url.searchParams.get("q")?.trim() ?? "";
        const rawLimit = url.searchParams.get("limit") ?? "256";
        if (query.length < 1 || query.length > 160 || !/^[1-9][0-9]*$/.test(rawLimit)) {
          json(response, 400, { error: "invalid token identity search query" });
          return;
        }
        const limit = Number(rawLimit);
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 512) {
          json(response, 400, { error: "limit must be between 1 and 512" });
          return;
        }
        const [identities, capacity] = await Promise.all([
          searchCanonicalTokenIdentityIndex(pool, query, limit),
          readCanonicalTokenIdentityIndexStats(pool)
        ]);
        const tokenBuffers = identities.map((entry) => Buffer.from(entry.address.slice(2), "hex"));
        const marketRows = tokenBuffers.length === 0 ? [] : (await pool.query(
          `WITH candidate_pools AS (
             SELECT pools.token0 AS matched_token, pools.*,
                    ROW_NUMBER() OVER (PARTITION BY pools.token0 ORDER BY pools.block_number DESC,pools.log_index DESC) AS token_rank
             FROM market_pools AS pools WHERE pools.token0=ANY($1::bytea[])
             UNION ALL
             SELECT pools.token1 AS matched_token, pools.*,
                    ROW_NUMBER() OVER (PARTITION BY pools.token1 ORDER BY pools.block_number DESC,pools.log_index DESC) AS token_rank
             FROM market_pools AS pools WHERE pools.token1=ANY($1::bytea[])
           ),
           matched_pools AS (
             SELECT * FROM candidate_pools WHERE token_rank <= 16
           )
           SELECT manifest.source_id AS "sourceId", manifest.protocol,
                  manifest.protocol_version AS "version",
                  '0x' || encode(pools.matched_token, 'hex') AS "matchedToken",
                  '0x' || encode(pools.pool_key, 'hex') AS "poolKey",
                  CASE WHEN pools.source_code = 5 THEN NULL ELSE '0x' || encode(pools.pool_key, 'hex') END AS "poolAddress",
                  '0x' || encode(pools.token0, 'hex') AS token0,
                  '0x' || encode(pools.token1, 'hex') AS token1,
                  CASE WHEN pools.source_code = 6 THEN get_byte(pools.attributes, 0) = 1 ELSE NULL END AS stable,
                  CASE WHEN pools.source_code IN (2,4,5) THEN get_byte(pools.attributes,0)*65536+get_byte(pools.attributes,1)*256+get_byte(pools.attributes,2) ELSE NULL END AS fee,
                  CASE WHEN pools.source_code IN (2,4,5) THEN get_byte(pools.attributes,3)*256+get_byte(pools.attributes,4)-CASE WHEN get_byte(pools.attributes,3)>=128 THEN 65536 ELSE 0 END
                       WHEN pools.source_code=7 THEN get_byte(pools.attributes,0)*256+get_byte(pools.attributes,1)-CASE WHEN get_byte(pools.attributes,0)>=128 THEN 65536 ELSE 0 END ELSE NULL END AS "tickSpacing",
                  CASE WHEN pools.source_code=5 THEN '0x'||encode(substring(pools.attributes FROM 6 FOR 20),'hex') ELSE NULL END AS hooks,
                  '0x'||encode(substring(pools.provenance FROM 1 FOR 32),'hex') AS "transactionHash",
                  pools.block_number::text AS "blockNumber",
                  '0x'||encode(substring(pools.provenance FROM 33 FOR 32),'hex') AS "blockHash",
                  pools.log_index AS "logIndex",
                  state.status AS "stateStatus", state.live_fee AS "liveFee", state.fee_denominator AS "feeDenominator",
                  CASE WHEN state.gauge_address IS NULL THEN NULL ELSE '0x'||encode(state.gauge_address,'hex') END AS "gaugeAddress",
                  state.gauge_alive AS "gaugeAlive", state.gauge_weight AS "gaugeWeight", state.gauge_claimable AS "gaugeClaimable",
                  CASE WHEN state.fees_address IS NULL THEN NULL ELSE '0x'||encode(state.fees_address,'hex') END AS "feesAddress",
                  CASE WHEN state.bribe_address IS NULL THEN NULL ELSE '0x'||encode(state.bribe_address,'hex') END AS "bribeAddress",
                  state.last_error AS "stateError", state.observed_block::text AS "stateObservedBlock",
                  CASE WHEN state.observed_block_hash IS NULL THEN NULL ELSE '0x'||encode(state.observed_block_hash,'hex') END AS "stateObservedBlockHash"
           FROM matched_pools AS pools
           JOIN market_indexer_source_state AS manifest ON manifest.source_code=pools.source_code
           LEFT JOIN market_pool_state AS state ON state.source_code=pools.source_code AND state.pool_key=pools.pool_key
           ORDER BY pools.block_number DESC, pools.log_index DESC`,
          [tokenBuffers]
        )).rows as Array<PoolRow & { matchedToken: string }>;
        const entries = identities.map((identity) => ({
          ...identity,
          markets: marketRows
            .filter((market) => market.matchedToken === identity.address.toLowerCase())
            .map(({ matchedToken: _matchedToken, ...market }) => publicPool(market))
        })).filter((identity) => identity.markets.length > 0);
        json(response, 200, {
          chainId: MARKET_INDEXER_CHAIN_ID,
          sourceManifestHash: MARKET_SOURCE_MANIFEST_HASH,
          coverage: inventoryCoverage(worker, config),
          capacity,
          entries
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
