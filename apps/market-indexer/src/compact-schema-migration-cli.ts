import pg from "pg";
import {
  migrationDatabaseUrl,
  preflightCompactMigration,
  REVIEWED_DATABASE_LIMIT_BYTES,
  runCompactPreserveProgressMigration,
  type CompactMigrationSafety
} from "./compact-schema-migration.js";

function exact(name: string, expected: string) {
  if (process.env[name] !== expected) throw new Error(`${name} must equal ${expected}`);
}

function configuredLimitBytes() {
  const raw = process.env.MARKET_INDEXER_COMPACT_MIGRATION_MAX_DATABASE_BYTES;
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) {
    throw new Error("MARKET_INDEXER_COMPACT_MIGRATION_MAX_DATABASE_BYTES is required");
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error("compact migration limit is invalid");
  if (value !== REVIEWED_DATABASE_LIMIT_BYTES) {
    throw new Error("compact migration requires the unchanged reviewed logical database limit");
  }
  return value;
}

exact("MARKET_INDEXER_COMPACT_MIGRATION_WRITER_STOPPED", "YES");
exact("MARKET_INDEXER_COMPACT_MIGRATION_SHADOW_MODE", "YES");
exact("MARKET_INDEXER_COMPACT_MIGRATION_AUTHORITATIVE", "NO");
exact("MARKET_INDEXER_COMPACT_MIGRATION_PRODUCTION_TRAFFIC", "NO");
exact("MARKET_INDEXER_COMPACT_MIGRATION_ACTIVATION_LOCKED", "YES");
const execute = process.env.MARKET_INDEXER_COMPACT_MIGRATION_EXECUTE === "LOW_PEAK_V3";
if (execute) {
  exact("MARKET_INDEXER_COMPACT_MIGRATION_CLEANUP", "DROP_OLD_AFTER_VALIDATION");
}

const safety: CompactMigrationSafety = Object.freeze({
  writerStopped: true,
  shadowMode: true,
  authoritative: false,
  servingProductionTraffic: false,
  activationLocked: true,
  oldRelationCleanupAuthorized:
    process.env.MARKET_INDEXER_COMPACT_MIGRATION_CLEANUP === "DROP_OLD_AFTER_VALIDATION",
  configuredLimitBytes: configuredLimitBytes()
});
const pool = new pg.Pool({
  connectionString: migrationDatabaseUrl(),
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: true },
  max: 1
});

try {
  if (execute) {
    const result = await runCompactPreserveProgressMigration(pool, safety);
    console.info(JSON.stringify({
      status: "compact_migration_complete",
      writerRestartEligible: true,
      preflight: result.preflight,
      afterPredropBytes: result.afterPredropBytes,
      stagedBytes: result.stagedBytes,
      postCleanupBytes: result.postCleanupBytes,
      actualPeakBytes: result.actualPeakBytes,
      reclaimedBytes: result.reclaimedBytes,
      poolCount: result.poolCount,
      syncPointCount: result.syncPointCount,
      stateCount: result.stateCount
    }));
  } else {
    const client = await pool.connect();
    try {
      const preflight = await preflightCompactMigration(client, safety);
      console.info(JSON.stringify({
        status: preflight.safe ? "preflight_safe" : "preflight_refused",
        writerRestartEligible: false,
        preflight
      }));
      if (!preflight.safe) process.exitCode = 2;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
