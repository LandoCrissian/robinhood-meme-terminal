export const EXTERNAL_ORIGIN_CHAIN_ID = 4663 as const;
export const EXTERNAL_ORIGIN_SCHEMA_VERSION = 1 as const;

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim();
  if (!value) throw new Error(name + " is required");
  return value;
}

function positiveInteger(name: string, fallback: number, env: NodeJS.ProcessEnv) {
  const raw = env[name]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(name + " must be a positive integer");
  }
  return parsed;
}

export type ExternalOriginConfig = {
  databaseUrl: string;
  readToken: string;
  port: number;
  databasePoolSize: number;
};

export function loadExternalOriginConfig(
  env: NodeJS.ProcessEnv = process.env
): ExternalOriginConfig {
  const readToken = required("EXTERNAL_ORIGIN_READ_TOKEN", env);
  if (readToken.length < 32) {
    throw new Error(
      "EXTERNAL_ORIGIN_READ_TOKEN must contain at least 32 characters"
    );
  }

  const port = positiveInteger("PORT", 3_002, env);
  if (port > 65_535) throw new Error("PORT must be at most 65535");

  return {
    databaseUrl: required("EXTERNAL_ORIGIN_DATABASE_URL", env),
    readToken,
    port,
    databasePoolSize: positiveInteger(
      "EXTERNAL_ORIGIN_DB_POOL_SIZE",
      5,
      env
    )
  };
}
