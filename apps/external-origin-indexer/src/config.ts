export const EXTERNAL_ORIGIN_CHAIN_ID = 4663 as const;
export const EXTERNAL_ORIGIN_SCHEMA_VERSION = 1 as const;

export type ExternalOriginConfig = Readonly<{
  databaseUrl: string;
  readToken: string;
  port: number;
  databasePoolSize: number;
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

function databaseUrl(env: NodeJS.ProcessEnv) {
  const value = required("EXTERNAL_ORIGIN_DATABASE_URL", env);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "EXTERNAL_ORIGIN_DATABASE_URL must be a valid PostgreSQL URL"
    );
  }
  if (
    (parsed.protocol !== "postgres:" &&
      parsed.protocol !== "postgresql:") ||
    !parsed.hostname ||
    parsed.pathname === "" ||
    parsed.pathname === "/"
  ) {
    throw new Error(
      "EXTERNAL_ORIGIN_DATABASE_URL must include a PostgreSQL host and database"
    );
  }
  return value;
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
    )
  });
}
