import { z } from "zod";

const MARKET_INDEXER_CHAIN_ID = 4_663 as const;
const DEFAULT_MARKET_INDEXER_TIMEOUT_MS = 5_000;
const MINIMUM_MARKET_INDEXER_TIMEOUT_MS = 250;
const MAXIMUM_MARKET_INDEXER_TIMEOUT_MS = 10_000;
const DEFAULT_MARKET_INVENTORY_LIMIT = 100;
const MAXIMUM_MARKET_INVENTORY_LIMIT = 500;
const MAXIMUM_RESPONSE_BYTES = 2_000_000;

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const ADDRESS_INPUT_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/;
const POOL_KEY_INPUT_PATTERN = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const SOURCE_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const CANONICAL_INTEGER_PATTERN = /^(?:0|[1-9][0-9]*)$/;
const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAXIMUM_CURSOR_LENGTH = 1_024;
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

const CANONICAL_MARKET_SOURCES = {
  "sushiswap-v2": { protocol: "sushiswap", version: 2 },
  "sushiswap-v3": { protocol: "sushiswap", version: 3 },
  "uniswap-v2": { protocol: "uniswap", version: 2 },
  "uniswap-v3": { protocol: "uniswap", version: 3 },
  "uniswap-v4": { protocol: "uniswap", version: 4 },
  "up-v2": { protocol: "up", version: 2 },
  "up-cl": { protocol: "up", version: 3 }
} as const;
type CanonicalMarketSourceId = keyof typeof CANONICAL_MARKET_SOURCES;
const CANONICAL_MARKET_SOURCE_IDS = Object.keys(
  CANONICAL_MARKET_SOURCES
) as [CanonicalMarketSourceId, ...CanonicalMarketSourceId[]];
const CANONICAL_MARKET_SOURCE_SET = new Set<string>(
  CANONICAL_MARKET_SOURCE_IDS
);

const canonicalAddressSchema = z.string().regex(ADDRESS_PATTERN);
const nonzeroAddressSchema = canonicalAddressSchema.refine(
  (value) => value !== ZERO_ADDRESS
);
const bytes32Schema = z.string().regex(BYTES32_PATTERN);
const nonzeroBytes32Schema = bytes32Schema.refine(
  (value) => value !== ZERO_BYTES32
);
const canonicalIntegerSchema = z
  .string()
  .max(78)
  .regex(CANONICAL_INTEGER_PATTERN);
const sourceIdSchema = z.string().min(1).max(64).regex(SOURCE_ID_PATTERN);
const canonicalMarketSourceIdSchema = z.enum(CANONICAL_MARKET_SOURCE_IDS);
const opaqueCursorSchema = z
  .string()
  .min(1)
  .max(MAXIMUM_CURSOR_LENGTH)
  .regex(OPAQUE_CURSOR_PATTERN);
const stateErrorSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((value) => value === value.trim());

const marketPoolSchema = z
  .object({
    sourceId: canonicalMarketSourceIdSchema,
    protocol: z.enum(["sushiswap", "uniswap", "up"]),
    version: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    poolKey: z.string(),
    poolAddress: canonicalAddressSchema.nullable(),
    token0: nonzeroAddressSchema,
    token1: nonzeroAddressSchema,
    stable: z.boolean().nullable(),
    fee: z.number().int().min(0).max(16_777_215).nullable(),
    tickSpacing: z.number().int().min(1).max(32_767).nullable(),
    hooks: canonicalAddressSchema.nullable(),
    transactionHash: bytes32Schema,
    blockNumber: canonicalIntegerSchema,
    blockHash: bytes32Schema,
    stateStatus: z.enum(["ready", "error"]).nullable(),
    liveFee: z.number().int().min(0).max(1_000_000).nullable(),
    feeDenominator: z.union([z.literal(10_000), z.literal(1_000_000)]).nullable(),
    gaugeAddress: nonzeroAddressSchema.nullable(),
    gaugeAlive: z.boolean().nullable(),
    gaugeWeight: canonicalIntegerSchema.nullable(),
    gaugeClaimable: canonicalIntegerSchema.nullable(),
    feesAddress: nonzeroAddressSchema.nullable(),
    bribeAddress: nonzeroAddressSchema.nullable(),
    stateError: stateErrorSchema.nullable(),
    stateObservedBlock: canonicalIntegerSchema.nullable(),
    stateObservedBlockHash: bytes32Schema.nullable()
  })
  .strict()
  .superRefine((pool, context) => {
    const expectedSource = CANONICAL_MARKET_SOURCES[pool.sourceId];
    if (
      pool.protocol !== expectedSource.protocol ||
      pool.version !== expectedSource.version
    ) {
      context.addIssue({
        code: "custom",
        message: "pool source identity does not match protocol and version"
      });
    }

    if (pool.token0 === pool.token1) {
      context.addIssue({ code: "custom", message: "token identities must differ" });
    }

    if (pool.version === 2 || pool.version === 3) {
      if (
        !ADDRESS_PATTERN.test(pool.poolKey) ||
        pool.poolKey === ZERO_ADDRESS ||
        pool.poolAddress !== pool.poolKey
      ) {
        context.addIssue({ code: "custom", message: "invalid V2/V3 pool identity" });
      }
    } else if (
      pool.protocol !== "uniswap" ||
      !BYTES32_PATTERN.test(pool.poolKey) ||
      pool.poolKey === ZERO_BYTES32 ||
      pool.poolAddress !== null
    ) {
      context.addIssue({ code: "custom", message: "invalid V4 pool identity" });
    }

    if (pool.version === 2) {
      const validV2 =
        pool.fee === null &&
        pool.tickSpacing === null &&
        pool.hooks === null &&
        (pool.protocol === "up"
          ? pool.sourceId === "up-v2" && typeof pool.stable === "boolean"
          : pool.stable === null);
      if (!validV2) {
        context.addIssue({ code: "custom", message: "invalid V2 fields" });
      }
    }

    if (pool.version === 3) {
      const validV3 =
        pool.stable === null &&
        pool.hooks === null &&
        (pool.protocol === "up"
          ? pool.sourceId === "up-cl" &&
            pool.fee === null &&
            pool.tickSpacing !== null &&
            pool.tickSpacing <= 16_384
          : pool.fee !== null &&
            pool.fee >= 1 &&
            pool.fee <= 1_000_000 &&
            pool.tickSpacing !== null &&
            pool.tickSpacing <= 16_384);
      if (!validV3) {
        context.addIssue({ code: "custom", message: "invalid V3 fields" });
      }
    }

    if (
      pool.version === 4 &&
      (pool.stable !== null ||
        pool.fee === null ||
        pool.tickSpacing === null ||
        pool.hooks === null)
    ) {
      context.addIssue({ code: "custom", message: "invalid V4 fields" });
    }

    const hasState = pool.stateStatus !== null;
    if (
      hasState &&
      (pool.protocol !== "up" || !["up-v2", "up-cl"].includes(pool.sourceId))
    ) {
      context.addIssue({ code: "custom", message: "invalid state source" });
    }
    if (
      hasState !==
      (pool.stateObservedBlock !== null && pool.stateObservedBlockHash !== null)
    ) {
      context.addIssue({ code: "custom", message: "incomplete state provenance" });
    }
    if (pool.stateStatus === "ready" && pool.stateError !== null) {
      context.addIssue({ code: "custom", message: "ready state cannot contain an error" });
    }
    if (pool.stateStatus === "error" && pool.stateError === null) {
      context.addIssue({ code: "custom", message: "error state requires an error" });
    }

    const optionalStateValues = [
      pool.liveFee,
      pool.feeDenominator,
      pool.gaugeAddress,
      pool.gaugeAlive,
      pool.gaugeWeight,
      pool.gaugeClaimable,
      pool.feesAddress,
      pool.bribeAddress,
      pool.stateError,
      pool.stateObservedBlock,
      pool.stateObservedBlockHash
    ];
    if (
      pool.stateStatus === null &&
      optionalStateValues.some((value) => value !== null)
    ) {
      context.addIssue({ code: "custom", message: "orphaned state evidence" });
    }
    if (
      pool.stateStatus === "error" &&
      [
        pool.liveFee,
        pool.feeDenominator,
        pool.gaugeAddress,
        pool.gaugeAlive,
        pool.gaugeWeight,
        pool.gaugeClaimable,
        pool.feesAddress,
        pool.bribeAddress
      ].some((value) => value !== null)
    ) {
      context.addIssue({ code: "custom", message: "error state contains live evidence" });
    }
    if (pool.stateStatus === "ready") {
      const validFeeEvidence =
        pool.protocol === "up" &&
        pool.liveFee !== null &&
        ((pool.sourceId === "up-v2" &&
          pool.feeDenominator === 10_000 &&
          pool.liveFee <= 300) ||
          (pool.sourceId === "up-cl" &&
            pool.feeDenominator === 1_000_000 &&
            pool.liveFee <= 1_000_000));
      const gaugeValues = [
        pool.gaugeAddress,
        pool.gaugeAlive,
        pool.gaugeWeight,
        pool.gaugeClaimable,
        pool.feesAddress,
        pool.bribeAddress
      ];
      const validGaugeEvidence =
        gaugeValues.every((value) => value === null) ||
        gaugeValues.every((value) => value !== null);
      if (!validFeeEvidence || !validGaugeEvidence) {
        context.addIssue({ code: "custom", message: "invalid ready state evidence" });
      }
    }
  });

const marketInventoryCoverageSchema = z
  .object({
    complete: z.boolean(),
    finalizedHead: canonicalIntegerSchema.nullable(),
    sources: z.array(
      z.object({
        sourceId: canonicalMarketSourceIdSchema,
        status: z.enum(["backfilling", "shadow-ready", "error", "missing"]),
        indexedThrough: canonicalIntegerSchema.nullable()
      }).strict()
    ).max(64)
  })
  .strict()
  .superRefine((coverage, context) => {
    const sourceIds = new Set(coverage.sources.map((source) => source.sourceId));
    if (sourceIds.size !== coverage.sources.length) {
      context.addIssue({ code: "custom", message: "duplicate coverage source" });
    }
    if (
      coverage.sources.length !== CANONICAL_MARKET_SOURCE_IDS.length ||
      sourceIds.size !== CANONICAL_MARKET_SOURCE_IDS.length ||
      CANONICAL_MARKET_SOURCE_IDS.some((sourceId) => !sourceIds.has(sourceId)) ||
      [...sourceIds].some((sourceId) => !CANONICAL_MARKET_SOURCE_SET.has(sourceId))
    ) {
      context.addIssue({ code: "custom", message: "coverage source set mismatch" });
    }
    if (
      coverage.complete &&
      (coverage.finalizedHead === null ||
        coverage.sources.length === 0 ||
        coverage.sources.some((source) =>
          source.status !== "shadow-ready" ||
          source.indexedThrough === null ||
          BigInt(source.indexedThrough) < BigInt(coverage.finalizedHead!)
        ))
    ) {
      context.addIssue({ code: "custom", message: "invalid complete coverage" });
    }
  });

const marketInventoryResponseSchema = z
  .object({
    chainId: z.literal(MARKET_INDEXER_CHAIN_ID),
    mode: z.literal("shadow"),
    authoritative: z.literal(false),
    sourceManifestHash: nonzeroBytes32Schema,
    coverage: marketInventoryCoverageSchema,
    nextCursor: opaqueCursorSchema.nullable(),
    pools: z.array(marketPoolSchema).max(MAXIMUM_MARKET_INVENTORY_LIMIT)
  })
  .strict();

export type VNextCanonicalMarketInventoryPool = z.infer<typeof marketPoolSchema>;
export type VNextCanonicalMarketInventoryCoverage = z.infer<typeof marketInventoryCoverageSchema>;

export type VNextCanonicalMarketInventoryResult =
  | {
      status: "verified_shadow";
      chainId: typeof MARKET_INDEXER_CHAIN_ID;
      mode: "shadow";
      authoritative: false;
      sourceManifestHash: string;
      coverage: VNextCanonicalMarketInventoryCoverage;
      nextCursor: string | null;
      pools: VNextCanonicalMarketInventoryPool[];
    }
  | {
      status: "not_configured";
      reason: "market_indexer_not_configured";
    }
  | {
      status: "misconfigured";
      reason: "market_indexer_misconfigured";
    }
  | {
      status: "invalid_query";
      reason:
        | "invalid_token"
        | "invalid_pool_key"
        | "invalid_source"
        | "invalid_limit"
        | "invalid_cursor";
    }
  | {
      status: "upstream_unavailable";
      reason: "timeout" | "request_failed" | "http_failure";
    }
  | {
      status: "invalid_upstream_response";
      reason:
        | "malformed_json"
        | "schema_mismatch"
        | "response_too_large"
        | "query_mismatch"
        | "sensitive_echo";
    };

export type VNextCanonicalMarketInventoryQuery = {
  token?: string;
  poolKey?: string;
  source?: string;
  limit?: number;
  cursor?: string;
};

type MarketIndexerFetch = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

type MarketIndexerEnvironment = Record<string, string | undefined>;

type MarketIndexerDependencies = {
  env?: MarketIndexerEnvironment;
  fetch?: MarketIndexerFetch;
  timeoutMs?: number;
};

type NormalizedQuery = {
  token: string | null;
  poolKey: string | null;
  source: string | null;
  limit: number;
  cursor: string | null;
};

type MarketIndexerConfiguration = {
  endpoint: URL;
  baseUrl: string;
  readCredential: string;
  timeoutMs: number;
};

class MarketIndexerTimeoutError extends Error {}

function invalidQuery(
  reason: Extract<VNextCanonicalMarketInventoryResult, { status: "invalid_query" }>["reason"]
): VNextCanonicalMarketInventoryResult {
  return { status: "invalid_query", reason };
}

function normalizeAddressInput(value: string | undefined) {
  if (value === undefined) return null;
  if (!ADDRESS_INPUT_PATTERN.test(value)) return undefined;
  const normalized = value.toLowerCase();
  return normalized === ZERO_ADDRESS ? undefined : normalized;
}

function normalizePoolKeyInput(value: string | undefined) {
  if (value === undefined) return null;
  if (!POOL_KEY_INPUT_PATTERN.test(value)) return undefined;
  const normalized = value.toLowerCase();
  return normalized === ZERO_ADDRESS || normalized === ZERO_BYTES32
    ? undefined
    : normalized;
}

function normalizeQuery(
  query: VNextCanonicalMarketInventoryQuery
): NormalizedQuery | VNextCanonicalMarketInventoryResult {
  const token = normalizeAddressInput(query.token);
  if (token === undefined) return invalidQuery("invalid_token");

  const poolKey = normalizePoolKeyInput(query.poolKey);
  if (poolKey === undefined) return invalidQuery("invalid_pool_key");

  const source = query.source ?? null;
  if (source !== null && !sourceIdSchema.safeParse(source).success) {
    return invalidQuery("invalid_source");
  }

  const limit = query.limit ?? DEFAULT_MARKET_INVENTORY_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAXIMUM_MARKET_INVENTORY_LIMIT
  ) {
    return invalidQuery("invalid_limit");
  }

  const cursor = query.cursor ?? null;
  if (cursor !== null && !opaqueCursorSchema.safeParse(cursor).success) {
    return invalidQuery("invalid_cursor");
  }

  return { token, poolKey, source, limit, cursor };
}

function configuredValue(env: MarketIndexerEnvironment, name: string) {
  return env[name]?.trim() ?? "";
}

function resolveConfiguration(
  env: MarketIndexerEnvironment,
  timeoutOverride?: number
):
  | MarketIndexerConfiguration
  | Extract<
      VNextCanonicalMarketInventoryResult,
      { status: "not_configured" | "misconfigured" }
    > {
  const rawUrl = configuredValue(env, "RMT_MARKET_INDEXER_URL");
  const readCredential = configuredValue(env, "RMT_MARKET_INDEXER_READ_TOKEN");
  const rawTimeout = configuredValue(env, "RMT_MARKET_INDEXER_TIMEOUT_MS");

  if (!rawUrl && !readCredential && !rawTimeout) {
    return { status: "not_configured", reason: "market_indexer_not_configured" };
  }
  if (!rawUrl || !readCredential) {
    return { status: "misconfigured", reason: "market_indexer_misconfigured" };
  }

  const credentialLength = Buffer.byteLength(readCredential, "utf8");
  if (
    credentialLength < 32 ||
    credentialLength > 512 ||
    !/^[A-Za-z0-9._~+/=-]+$/.test(readCredential)
  ) {
    return { status: "misconfigured", reason: "market_indexer_misconfigured" };
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(rawUrl);
  } catch {
    return { status: "misconfigured", reason: "market_indexer_misconfigured" };
  }
  const loopbackHttp =
    baseUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
  if (
    (baseUrl.protocol !== "https:" && !loopbackHttp) ||
    !baseUrl.hostname ||
    baseUrl.username !== "" ||
    baseUrl.password !== "" ||
    baseUrl.search !== "" ||
    baseUrl.hash !== ""
  ) {
    return { status: "misconfigured", reason: "market_indexer_misconfigured" };
  }

  let timeoutMs = DEFAULT_MARKET_INDEXER_TIMEOUT_MS;
  if (rawTimeout) {
    if (!/^[1-9][0-9]*$/.test(rawTimeout)) {
      return { status: "misconfigured", reason: "market_indexer_misconfigured" };
    }
    timeoutMs = Number(rawTimeout);
  }
  if (timeoutOverride !== undefined) timeoutMs = timeoutOverride;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MINIMUM_MARKET_INDEXER_TIMEOUT_MS ||
    timeoutMs > MAXIMUM_MARKET_INDEXER_TIMEOUT_MS
  ) {
    return { status: "misconfigured", reason: "market_indexer_misconfigured" };
  }

  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/v1/pools`;
  return {
    endpoint: baseUrl,
    baseUrl: rawUrl,
    readCredential,
    timeoutMs
  };
}

async function fetchWithTimeout(
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImplementation: MarketIndexerFetch
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new MarketIndexerTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetchImplementation(url, { ...init, signal: controller.signal }),
      timeoutPromise
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function responseMatchesQuery(
  pools: VNextCanonicalMarketInventoryPool[],
  query: NormalizedQuery
) {
  if (pools.length > query.limit) return false;
  return pools.every(
    (pool) =>
      (query.token === null ||
        pool.token0 === query.token ||
        pool.token1 === query.token) &&
      (query.poolKey === null || pool.poolKey === query.poolKey) &&
      (query.source === null || pool.sourceId === query.source)
  );
}

function containsConfiguredSecret(
  result: VNextCanonicalMarketInventoryResult,
  configuration: MarketIndexerConfiguration
) {
  const serialized = JSON.stringify(result);
  const parsedBaseUrl = new URL(configuration.baseUrl);
  return [
    configuration.readCredential,
    configuration.baseUrl,
    parsedBaseUrl.href,
    parsedBaseUrl.origin
  ].some((value) => value !== "" && serialized.includes(value));
}

export async function readVNextCanonicalMarketInventory(
  query: VNextCanonicalMarketInventoryQuery = {},
  dependencies: MarketIndexerDependencies = {}
): Promise<VNextCanonicalMarketInventoryResult> {
  const normalizedQuery = normalizeQuery(query);
  if ("status" in normalizedQuery) return normalizedQuery;

  const configuration = resolveConfiguration(
    dependencies.env ?? process.env,
    dependencies.timeoutMs
  );
  if ("status" in configuration) return configuration;

  const search = new URLSearchParams();
  if (normalizedQuery.token !== null) search.set("token", normalizedQuery.token);
  if (normalizedQuery.poolKey !== null) {
    search.set("poolKey", normalizedQuery.poolKey);
  }
  if (normalizedQuery.source !== null) search.set("source", normalizedQuery.source);
  search.set("limit", String(normalizedQuery.limit));
  if (normalizedQuery.cursor !== null) search.set("cursor", normalizedQuery.cursor);

  const requestUrl = new URL(configuration.endpoint);
  requestUrl.search = search.toString();

  let response: Response;
  try {
    response = await fetchWithTimeout(
      requestUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${configuration.readCredential}`
        },
        cache: "no-store"
      },
      configuration.timeoutMs,
      dependencies.fetch ?? fetch
    );
  } catch (cause) {
    return cause instanceof MarketIndexerTimeoutError
      ? { status: "upstream_unavailable", reason: "timeout" }
      : { status: "upstream_unavailable", reason: "request_failed" };
  }

  if (!response.ok) {
    return { status: "upstream_unavailable", reason: "http_failure" };
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAXIMUM_RESPONSE_BYTES) {
    return { status: "invalid_upstream_response", reason: "response_too_large" };
  }

  let body: unknown;
  try {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAXIMUM_RESPONSE_BYTES) {
      return { status: "invalid_upstream_response", reason: "response_too_large" };
    }
    body = JSON.parse(text);
  } catch {
    return { status: "invalid_upstream_response", reason: "malformed_json" };
  }

  const parsed = marketInventoryResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { status: "invalid_upstream_response", reason: "schema_mismatch" };
  }
  if (!responseMatchesQuery(parsed.data.pools, normalizedQuery)) {
    return { status: "invalid_upstream_response", reason: "query_mismatch" };
  }

  const result: VNextCanonicalMarketInventoryResult = {
    status: "verified_shadow",
    chainId: parsed.data.chainId,
    mode: parsed.data.mode,
    authoritative: parsed.data.authoritative,
    sourceManifestHash: parsed.data.sourceManifestHash,
    coverage: parsed.data.coverage,
    nextCursor: parsed.data.nextCursor,
    pools: parsed.data.pools
  };
  if (containsConfiguredSecret(result, configuration)) {
    return { status: "invalid_upstream_response", reason: "sensitive_echo" };
  }
  return result;
}
