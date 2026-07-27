import type { Pool } from "pg";
import { MARKET_INDEXER_CHAIN_ID, marketSources } from "./sources.js";

export type DatabasePressure =
  | "unbounded"
  | "healthy"
  | "warning"
  | "critical"
  | "limit-reached";

export type DatabaseTelemetry = {
  scope: "logical-database-only";
  logicalBytes: number;
  configuredLimitBytes: number | null;
  remainingLogicalBytes: number | null;
  usageBps: number | null;
  pressure: DatabasePressure;
  providerVolumeIncluded: false;
};

export type SourceTelemetry = {
  sourceId: string;
  status: "backfilling" | "shadow-ready" | "error";
  startBlock: string;
  nextBlock: string;
  indexedThrough: string;
  finalizedHead: string | null;
  lagBlocks: string | null;
  poolCount: number;
  lastSyncAt: string | null;
  updatedAt: string;
  error: string | null;
};

export type MarketIndexerTelemetry = {
  capturedAt: string;
  finalizedHead: string | null;
  totalPools: number;
  database: DatabaseTelemetry;
  sources: SourceTelemetry[];
};

type SourceTelemetryRow = {
  source_id: string;
  status: SourceTelemetry["status"];
  start_block: string;
  next_block: string;
  pool_count: string;
  last_sync_at: Date | string | null;
  updated_at: Date | string;
  last_error: string | null;
};

function safeInteger(value: string | number, label: string) {
  if (typeof value === "string" && !/^[0-9]+$/.test(value)) {
    throw new Error(`PostgreSQL returned an invalid ${label}`);
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`PostgreSQL returned an invalid ${label}`);
  }
  return parsed;
}

function timestamp(value: Date | string | null) {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("PostgreSQL returned an invalid telemetry timestamp");
  }
  return parsed.toISOString();
}

export function databaseTelemetry(
  logicalBytes: number,
  configuredLimitBytes: number | null
): DatabaseTelemetry {
  if (!Number.isSafeInteger(logicalBytes) || logicalBytes < 0) {
    throw new Error("PostgreSQL returned an invalid database size");
  }
  if (configuredLimitBytes === null) {
    return {
      scope: "logical-database-only",
      logicalBytes,
      configuredLimitBytes: null,
      remainingLogicalBytes: null,
      usageBps: null,
      pressure: "unbounded",
      providerVolumeIncluded: false
    };
  }
  if (!Number.isSafeInteger(configuredLimitBytes) || configuredLimitBytes <= 0) {
    throw new Error("configured database size limit is invalid");
  }
  const usageBps = Math.floor((logicalBytes / configuredLimitBytes) * 10_000);
  const pressure: DatabasePressure =
    logicalBytes >= configuredLimitBytes
      ? "limit-reached"
      : usageBps >= 9_000
        ? "critical"
        : usageBps >= 8_000
          ? "warning"
          : "healthy";
  return {
    scope: "logical-database-only",
    logicalBytes,
    configuredLimitBytes,
    remainingLogicalBytes: Math.max(configuredLimitBytes - logicalBytes, 0),
    usageBps,
    pressure,
    providerVolumeIncluded: false
  };
}

export async function readMarketIndexerTelemetry(
  pool: Pool,
  finalizedHead: bigint | null,
  configuredLimitBytes: number | null
): Promise<MarketIndexerTelemetry> {
  const [databaseResult, sourceResult] = await Promise.all([
    pool.query<{ bytes: string }>(
      "SELECT pg_database_size(current_database()) AS bytes"
    ),
    pool.query<SourceTelemetryRow>(
      `SELECT state.source_id, state.status, state.start_block,
              state.next_block, state.last_sync_at, state.updated_at,
              state.last_error, COUNT(pools.pool_key)::text AS pool_count
       FROM market_indexer_source_state AS state
       LEFT JOIN market_pools AS pools
         ON pools.chain_id = state.chain_id
        AND pools.source_id = state.source_id
       WHERE state.chain_id = $1
       GROUP BY state.chain_id, state.source_id, state.status, state.start_block,
                state.next_block, state.last_sync_at, state.updated_at,
                state.last_error
       ORDER BY state.source_id`,
      [MARKET_INDEXER_CHAIN_ID]
    )
  ]);
  const logicalBytes = safeInteger(
    databaseResult.rows[0]?.bytes ?? "",
    "database size"
  );
  const expected = new Set(marketSources.map((source) => source.id));
  const observed = new Set(sourceResult.rows.map((row) => row.source_id));
  if (
    observed.size !== expected.size ||
    [...observed].some((sourceId) => !expected.has(sourceId))
  ) {
    throw new Error("market indexer telemetry source set does not match manifest");
  }
  const sources = sourceResult.rows.map((row): SourceTelemetry => {
    const startBlock = BigInt(row.start_block);
    const nextBlock = BigInt(row.next_block);
    const indexedThrough = nextBlock - 1n;
    const lagBlocks =
      finalizedHead === null
        ? null
        : (finalizedHead > indexedThrough
            ? finalizedHead - indexedThrough
            : 0n
          ).toString();
    return {
      sourceId: row.source_id,
      status: row.status,
      startBlock: startBlock.toString(),
      nextBlock: nextBlock.toString(),
      indexedThrough: indexedThrough.toString(),
      finalizedHead: finalizedHead?.toString() ?? null,
      lagBlocks,
      poolCount: safeInteger(row.pool_count, "pool count"),
      lastSyncAt: timestamp(row.last_sync_at),
      updatedAt: timestamp(row.updated_at)!,
      error: row.last_error
    };
  });
  return {
    capturedAt: new Date().toISOString(),
    finalizedHead: finalizedHead?.toString() ?? null,
    totalPools: sources.reduce((total, source) => total + source.poolCount, 0),
    database: databaseTelemetry(logicalBytes, configuredLimitBytes),
    sources
  };
}
