export type NftMarketplaceConfig = {
  databaseUrl: string;
  databaseSsl: boolean;
  apiKey: string;
  baseUrl: string;
  rpcUrl: string;
  requestTimeoutMs: number;
  pollIntervalMs: number;
  databasePoolSize: number;
  maxPagesPerCycle: number;
  pageSize: number;
  port: number;
};
function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
function integer(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`${name} must be between ${min} and ${max}.`);
  return value;
}
function url(raw: string, name: string, protocols: readonly string[]) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (!protocols.includes(parsed.protocol))
    throw new Error(`${name} must use ${protocols.join(" or ")}.`);
  if (parsed.username || parsed.password)
    throw new Error(`${name} must not contain embedded credentials.`);
  return parsed;
}
function databaseIdentity(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      "NFT_MARKETPLACE_DATABASE_URL must be a valid PostgreSQL URL.",
    );
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol))
    throw new Error(
      "NFT_MARKETPLACE_DATABASE_URL must be a valid PostgreSQL URL.",
    );
  if (!parsed.hostname || !parsed.pathname.slice(1))
    throw new Error("NFT_MARKETPLACE_DATABASE_URL must identify a database.");
  return `${parsed.hostname.toLowerCase()}:${parsed.port || "5432"}${parsed.pathname}`.toLowerCase();
}
export function loadNftMarketplaceConfig(
  env: NodeJS.ProcessEnv = process.env,
): NftMarketplaceConfig {
  const databaseUrl = required(env, "NFT_MARKETPLACE_DATABASE_URL");
  const identity = databaseIdentity(databaseUrl);
  for (const name of [
    "NFT_INDEXER_DATABASE_URL",
    "MARKET_INDEXER_DATABASE_URL",
    "DATABASE_URL",
    "EXTERNAL_ORIGIN_DATABASE_URL",
  ]) {
    const other = env[name]?.trim();
    if (other && databaseIdentity(other) === identity)
      throw new Error(`NFT_MARKETPLACE_DATABASE_URL must not equal ${name}.`);
  }
  const base = url(
    env.NFT_MARKETPLACE_OPENSEA_BASE_URL?.trim() || "https://api.opensea.io",
    "NFT_MARKETPLACE_OPENSEA_BASE_URL",
    ["https:"],
  );
  const rpc = url(
    required(env, "NFT_MARKETPLACE_RPC_URL"),
    "NFT_MARKETPLACE_RPC_URL",
    ["https:"],
  );
  return {
    databaseUrl,
    databaseSsl: !new URL(databaseUrl).searchParams
      .get("sslmode")
      ?.match(/^(disable|allow|prefer)$/),
    apiKey: required(env, "NFT_MARKETPLACE_OPENSEA_API_KEY"),
    baseUrl: base.origin,
    rpcUrl: rpc.toString(),
    requestTimeoutMs: integer(
      env,
      "NFT_MARKETPLACE_REQUEST_TIMEOUT_MS",
      10000,
      1000,
      60000,
    ),
    pollIntervalMs: integer(
      env,
      "NFT_MARKETPLACE_POLL_INTERVAL_MS",
      60000,
      1000,
      3600000,
    ),
    databasePoolSize: integer(
      env,
      "NFT_MARKETPLACE_DATABASE_POOL_SIZE",
      8,
      1,
      64,
    ),
    maxPagesPerCycle: integer(
      env,
      "NFT_MARKETPLACE_MAX_PAGES_PER_CYCLE",
      8,
      1,
      64,
    ),
    pageSize: integer(env, "NFT_MARKETPLACE_PAGE_SIZE", 50, 1, 200),
    port: integer(env, "NFT_MARKETPLACE_PORT", 3012, 1, 65535),
  };
}
