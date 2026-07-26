import { MARKET_INDEXER_CHAIN_ID } from "./sources.js";

export type MarketIndexerConfig = Readonly<{
  databaseUrl: string;
  rpcUrl: string;
  readToken: string;
  confirmations: number;
  batchSize: number;
  pollIntervalMs: number;
  databasePoolSize: number;
  databaseSsl: boolean;
  port: number;
}>;

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  env: NodeJS.ProcessEnv
) {
  const value = env[name]?.trim();
  if (!value) return fallback;
  if (!/^[0-9]+$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function postgresUrl(name: string, value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL`);
  }
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname === "" ||
    parsed.pathname === "/"
  ) {
    throw new Error(`${name} must include a PostgreSQL host and database`);
  }
  const sslMode = parsed.searchParams.get("sslmode");
  if (sslMode !== null && !["verify-full", "disable"].includes(sslMode)) {
    throw new Error(`${name} may only use sslmode=verify-full or sslmode=disable`);
  }
  return parsed;
}

function isolatedDatabaseUrl(env: NodeJS.ProcessEnv) {
  const value = required("MARKET_INDEXER_DATABASE_URL", env);
  const parsed = postgresUrl("MARKET_INDEXER_DATABASE_URL", value);
  for (const name of ["DATABASE_URL", "EXTERNAL_ORIGIN_DATABASE_URL"]) {
    const other = env[name]?.trim();
    if (other && parsed.href === postgresUrl(name, other).href) {
      throw new Error(`MARKET_INDEXER_DATABASE_URL must not equal ${name}`);
    }
  }
  return value;
}

function rpcUrl(env: NodeJS.ProcessEnv) {
  const value = required("MARKET_INDEXER_RPC_URL", env);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("MARKET_INDEXER_RPC_URL must be a valid URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("MARKET_INDEXER_RPC_URL must be HTTPS and must not embed credentials");
  }
  return value;
}

function readToken(env: NodeJS.ProcessEnv) {
  const value = required("MARKET_INDEXER_READ_TOKEN", env);
  const length = Buffer.byteLength(value, "utf8");
  if (length < 32 || length > 512 || !/^[A-Za-z0-9._~+/=-]+$/.test(value)) {
    throw new Error(
      "MARKET_INDEXER_READ_TOKEN must contain 32 to 512 bearer-token characters"
    );
  }
  return value;
}

function databaseSsl(env: NodeJS.ProcessEnv) {
  const mode = env.PGSSLMODE?.trim().toLowerCase();
  if (mode === "disable") return false;
  if (mode !== undefined && mode !== "" && mode !== "verify-full") {
    throw new Error("PGSSLMODE must be verify-full or disable");
  }
  return true;
}

export function loadMarketIndexerConfig(
  env: NodeJS.ProcessEnv = process.env
): MarketIndexerConfig {
  if (MARKET_INDEXER_CHAIN_ID !== 4663) {
    throw new Error("market indexer source manifest must remain bound to chain 4663");
  }
  return Object.freeze({
    databaseUrl: isolatedDatabaseUrl(env),
    rpcUrl: rpcUrl(env),
    readToken: readToken(env),
    confirmations: integer("MARKET_INDEXER_CONFIRMATIONS", 20, 12, 10_000, env),
    batchSize: integer("MARKET_INDEXER_BATCH_SIZE", 5_000, 1, 5_000, env),
    pollIntervalMs: integer(
      "MARKET_INDEXER_POLL_INTERVAL_MS",
      5_000,
      1_000,
      300_000,
      env
    ),
    databasePoolSize: integer("MARKET_INDEXER_DB_POOL_SIZE", 5, 1, 50, env),
    databaseSsl: databaseSsl(env),
    port: integer("PORT", 3_003, 1, 65_535, env)
  });
}
