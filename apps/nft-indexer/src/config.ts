export type NftIndexerConfig = Readonly<{
  databaseUrl: string;
  databaseSsl: boolean;
  rpcUrl: string;
  finalityDepth: number;
  batchSize: number;
  maxBatchesPerCycle: number;
  pollIntervalMs: number;
  databasePoolSize: number;
  port: number;
  readToken: string;
}>;

function required(name: string, env: NodeJS.ProcessEnv) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readToken(env: NodeJS.ProcessEnv) {
  const value = required('NFT_INDEXER_READ_TOKEN', env);
  if (!/^[A-Za-z0-9._~-]{32,512}$/.test(value)) throw new Error('NFT_INDEXER_READ_TOKEN must contain 32 to 512 URL-safe characters');
  return value;
}

function integer(name: string, fallback: number, minimum: number, maximum: number, env: NodeJS.ProcessEnv) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function requiredInteger(name: string, minimum: number, maximum: number, env: NodeJS.ProcessEnv) {
  const raw = required(name, env);
  if (!/^[0-9]+$/.test(raw)) throw new Error(`${name} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function postgresUrl(name: string, value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL URL`);
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname === '/' || !parsed.pathname) {
    throw new Error(`${name} must include a PostgreSQL host and database`);
  }
  const sslMode = parsed.searchParams.get('sslmode');
  if (sslMode !== null && !['verify-full', 'disable'].includes(sslMode)) {
    throw new Error(`${name} may only use sslmode=verify-full or sslmode=disable`);
  }
  return parsed;
}

function databaseUrl(env: NodeJS.ProcessEnv) {
  const value = required('NFT_INDEXER_DATABASE_URL', env);
  const parsed = postgresUrl('NFT_INDEXER_DATABASE_URL', value);
  const databaseIdentity = (url: URL) => `${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`;
  for (const name of ['DATABASE_URL', 'MARKET_INDEXER_DATABASE_URL', 'EXTERNAL_ORIGIN_DATABASE_URL']) {
    const other = env[name]?.trim();
    if (other && databaseIdentity(parsed) === databaseIdentity(postgresUrl(name, other))) {
      throw new Error(`NFT_INDEXER_DATABASE_URL must not equal ${name}`);
    }
  }
  return { value, ssl: parsed.searchParams.get('sslmode') !== 'disable' };
}

function rpcUrl(env: NodeJS.ProcessEnv) {
  const value = required('NFT_INDEXER_RPC_URL', env);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('NFT_INDEXER_RPC_URL must be a valid URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('NFT_INDEXER_RPC_URL must use HTTPS without embedded credentials');
  }
  return parsed.href;
}

export function loadNftIndexerConfig(env: NodeJS.ProcessEnv = process.env): NftIndexerConfig {
  const database = databaseUrl(env);
  return Object.freeze({
    databaseUrl: database.value,
    databaseSsl: database.ssl,
    rpcUrl: rpcUrl(env),
    finalityDepth: requiredInteger('NFT_INDEXER_FINALITY_DEPTH', 0, 100_000, env),
    batchSize: integer('NFT_INDEXER_BATCH_SIZE', 2_000, 1, 100_000, env),
    maxBatchesPerCycle: integer('NFT_INDEXER_MAX_BATCHES_PER_CYCLE', 16, 1, 512, env),
    pollIntervalMs: integer('NFT_INDEXER_POLL_INTERVAL_MS', 5_000, 250, 3_600_000, env),
    databasePoolSize: integer('NFT_INDEXER_DATABASE_POOL_SIZE', 8, 1, 64, env),
    port: integer('NFT_INDEXER_PORT', 3_009, 1, 65_535, env),
    readToken: readToken(env)
  });
}
