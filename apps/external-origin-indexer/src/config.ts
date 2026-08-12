export const EXTERNAL_ORIGIN_CHAIN_ID = 4663 as const;
export const EXTERNAL_ORIGIN_SCHEMA_VERSION = 2 as const;

// Source-only safety lock. The first verified adapter must add finalized-head,
// freshness, reorg, and atomic-read logic in a separate reviewed change before
// this can be removed.
export const EXTERNAL_ORIGIN_ATTRIBUTION_ACTIVATION_LOCKED = true as const;

export type ExternalOriginConfig = Readonly<{
  databaseUrl: string;
  readToken: string;
  port: number;
  databasePoolSize: number;
  databaseSsl: boolean;
}>;

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

function integer(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  env: NodeJS.ProcessEnv
) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(name + " must be an integer");
  }

  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    throw new Error(
      name + " must be between " + minimum + " and " + maximum
    );
  }
  return parsed;
}

function parsePostgresUrl(name: string, value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(name + " must be a valid PostgreSQL URL");
  }
  if (
    (parsed.protocol !== "postgres:" &&
      parsed.protocol !== "postgresql:") ||
    !parsed.hostname ||
    parsed.pathname === "" ||
    parsed.pathname === "/"
  ) {
    throw new Error(
      name + " must include a PostgreSQL host and database"
    );
  }
  const sslMode = parsed.searchParams.get("sslmode");
  if (
    sslMode !== null &&
    sslMode !== "verify-full" &&
    sslMode !== "disable"
  ) {
    throw new Error(
      name + " may only use sslmode=verify-full or sslmode=disable"
    );
  }
  return parsed;
}

function databaseUrl(env: NodeJS.ProcessEnv) {
  const value = required("EXTERNAL_ORIGIN_DATABASE_URL", env);
  const parsed = parsePostgresUrl(
    "EXTERNAL_ORIGIN_DATABASE_URL",
    value
  );

  const canonicalValue = env.DATABASE_URL?.trim();
  if (canonicalValue) {
    const canonical = parsePostgresUrl("DATABASE_URL", canonicalValue);
    if (parsed.href === canonical.href) {
      throw new Error(
        "EXTERNAL_ORIGIN_DATABASE_URL must not equal DATABASE_URL"
      );
    }
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

function readToken(env: NodeJS.ProcessEnv) {
  const value = required("EXTERNAL_ORIGIN_READ_TOKEN", env);
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes < 32 || bytes > 512) {
    throw new Error(
      "EXTERNAL_ORIGIN_READ_TOKEN must contain 32 to 512 bytes"
    );
  }
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(value)) {
    throw new Error(
      "EXTERNAL_ORIGIN_READ_TOKEN must use bearer-token characters"
    );
  }
  return value;
}

export function loadExternalOriginConfig(
  env: NodeJS.ProcessEnv = process.env
): ExternalOriginConfig {
  return Object.freeze({
    databaseUrl: databaseUrl(env),
    readToken: readToken(env),
    port: integer("PORT", 3_002, 1, 65_535, env),
    databasePoolSize: integer(
      "EXTERNAL_ORIGIN_DB_POOL_SIZE",
      5,
      1,
      50,
      env
    ),
    databaseSsl: databaseSsl(env)
  });
}
