import { NextResponse } from "next/server";

const BLOCKSCOUT_API = "https://robinhoodchain.blockscout.com/api/v2/smart-contracts";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const EXPECTED_COMPILER = "v0.8.26+commit.8a97fa7a";
const LEGACY_FACTORY = "0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd";
const BLOCKSCOUT_CONCURRENCY = 4;
const SUCCESS_CACHE_MS = 30_000;
const FAILURE_CACHE_MS = 5_000;
const MAX_CACHE_ENTRIES = 16;
const SOURCE_RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_UNIQUE_SOURCE_REQUESTS_PER_WINDOW = 5;
const MAX_SOURCE_RATE_LIMIT_CLIENTS = 256;

const EXPECTED_CONTRACTS = {
  governance: "RMTV6Governance",
  bootstrapController: "RMTV6BootstrapController",
  foundationVerifier: "RMTV6BootstrapFoundationVerifier",
  smokeVerifier: "RMTV6BootstrapSmokeVerifier",
  versionRegistry: "VersionedFactoryRegistry",
  legacyFactory: "LowCostMemeLaunchFactoryV5",
  hook: "V5GraduationHook",
  adapter: "V4GraduationAdapter",
  launchGate: "RMTLaunchGate",
  policyRegistry: "RMTLaunchPolicyRegistry",
  marketImplementation: "CloneBondingCurveMarketV6",
  tokenImplementation: "CloneFixedSupplyMemeToken",
  feeSplitterImplementation: "DirectLaunchFeeSplitter",
  officialMigration: "OfficialRMTIdentityMigration",
  factory: "RMTLaunchFactoryV6"
} as const;

type ContractKey = keyof typeof EXPECTED_CONTRACTS;
type ContractResult = {
  key: ContractKey;
  address: string;
  expectedName: string;
  verified: boolean;
  failures: string[];
};
type SourceStatus = {
  verified: boolean;
  checkedAt: string;
  contracts: ContractResult[];
};

type BlockscoutContract = {
  is_verified?: unknown;
  is_fully_verified?: unknown;
  is_partially_verified?: unknown;
  is_changed_bytecode?: unknown;
  name?: unknown;
  language?: unknown;
  compiler_version?: unknown;
  compiler_settings?: unknown;
  optimization_enabled?: unknown;
  optimization_runs?: unknown;
  optimizations_runs?: unknown;
  creation_status?: unknown;
};

const resultCache = new Map<string, { expiresAt: number; value: SourceStatus }>();
const inFlightChecks = new Map<string, Promise<SourceStatus>>();
const blockscoutWaiters: Array<() => void> = [];
const sourceRateLimits = new Map<string, {
  windowStartedAt: number;
  lastSeenAt: number;
  requestKeys: Set<string>;
}>();
let activeBlockscoutRequests = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseAddresses(value: unknown) {
  if (!isRecord(value) || !isRecord(value.contracts)) return undefined;
  const contracts = {} as Record<ContractKey, string>;

  for (const key of Object.keys(EXPECTED_CONTRACTS) as ContractKey[]) {
    const address = value.contracts[key];
    if (typeof address !== "string" || !ADDRESS_PATTERN.test(address)) return undefined;
    contracts[key] = address;
  }

  if (Object.keys(value.contracts).length !== Object.keys(EXPECTED_CONTRACTS).length) return undefined;
  const normalized = Object.values(contracts).map((address) => address.toLowerCase());
  if (new Set(normalized).size !== normalized.length
    || contracts.legacyFactory.toLowerCase() !== LEGACY_FACTORY) return undefined;
  return contracts;
}

function cacheKey(contracts: Record<ContractKey, string>) {
  return (Object.keys(EXPECTED_CONTRACTS) as ContractKey[])
    .map((key) => `${key}:${contracts[key].toLowerCase()}`)
    .join("|");
}

function sourceRateLimitClient(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const candidate = request.headers.get("cf-connecting-ip")?.trim()
    || forwardedFor
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
  return candidate.slice(0, 128).toLowerCase();
}

function checkSourceRateLimit(request: Request, requestKey: string, now: number) {
  for (const [client, entry] of sourceRateLimits) {
    if (entry.windowStartedAt + SOURCE_RATE_LIMIT_WINDOW_MS <= now) sourceRateLimits.delete(client);
  }

  const client = sourceRateLimitClient(request);
  let entry = sourceRateLimits.get(client);
  if (!entry) {
    while (sourceRateLimits.size >= MAX_SOURCE_RATE_LIMIT_CLIENTS) {
      let oldestClient: string | undefined;
      let oldestSeenAt = Number.POSITIVE_INFINITY;
      for (const [candidate, candidateEntry] of sourceRateLimits) {
        if (candidateEntry.lastSeenAt < oldestSeenAt) {
          oldestClient = candidate;
          oldestSeenAt = candidateEntry.lastSeenAt;
        }
      }
      if (!oldestClient) break;
      sourceRateLimits.delete(oldestClient);
    }
    entry = { windowStartedAt: now, lastSeenAt: now, requestKeys: new Set<string>() };
    sourceRateLimits.set(client, entry);
  }

  entry.lastSeenAt = now;
  if (entry.requestKeys.has(requestKey)) return { allowed: true as const };
  if (entry.requestKeys.size >= MAX_UNIQUE_SOURCE_REQUESTS_PER_WINDOW) {
    return {
      allowed: false as const,
      retryAfterSeconds: Math.max(1, Math.ceil(
        (entry.windowStartedAt + SOURCE_RATE_LIMIT_WINDOW_MS - now) / 1_000
      ))
    };
  }
  entry.requestKeys.add(requestKey);
  return { allowed: true as const };
}

function pruneCache(now: number) {
  for (const [key, entry] of resultCache) {
    if (entry.expiresAt <= now) resultCache.delete(key);
  }
  while (resultCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = resultCache.keys().next().value as string | undefined;
    if (!oldest) break;
    resultCache.delete(oldest);
  }
}

async function acquireBlockscoutSlot() {
  if (activeBlockscoutRequests < BLOCKSCOUT_CONCURRENCY) {
    activeBlockscoutRequests += 1;
    return;
  }
  await new Promise<void>((resolve) => blockscoutWaiters.push(resolve));
}

function releaseBlockscoutSlot() {
  const next = blockscoutWaiters.shift();
  if (next) next();
  else activeBlockscoutRequests -= 1;
}

async function withBlockscoutSlot<T>(operation: () => Promise<T>) {
  await acquireBlockscoutSlot();
  try {
    return await operation();
  } finally {
    releaseBlockscoutSlot();
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function verificationFailures(contract: BlockscoutContract, expectedName: string) {
  const failures: string[] = [];
  if (contract.is_verified !== true) {
    failures.push("source not published or verification still pending");
    if (contract.is_changed_bytecode === true) failures.push("changed bytecode reported");
    return failures;
  }
  if (contract.is_fully_verified !== true) failures.push("not fully verified");
  if (contract.is_partially_verified === true) failures.push("partial verification reported");
  if (contract.is_changed_bytecode === true) failures.push("changed bytecode reported");
  else if (contract.is_changed_bytecode !== false) failures.push("unchanged bytecode is not confirmed");
  if (contract.name !== expectedName) failures.push(`expected source ${expectedName}`);
  if (contract.language !== "solidity") failures.push("language is not Solidity");
  if (contract.compiler_version !== EXPECTED_COMPILER) failures.push(`compiler is not ${EXPECTED_COMPILER}`);
  const optimizationRuns = contract.optimizations_runs ?? contract.optimization_runs;
  if (contract.optimization_enabled !== true || optimizationRuns !== 200) {
    failures.push("optimizer settings do not match 200 runs");
  }
  if (!isRecord(contract.compiler_settings) || contract.compiler_settings.viaIR !== true) {
    failures.push("via-IR compiler setting is not reported");
  } else {
    const optimizer = contract.compiler_settings.optimizer;
    if (!isRecord(optimizer) || optimizer.enabled !== true || optimizer.runs !== 200) {
      failures.push("compiler-settings optimizer does not match 200 runs");
    }
    if (contract.compiler_settings.evmVersion !== "cancun") {
      failures.push("EVM version is not Cancun");
    }
    const compilationTarget = contract.compiler_settings.compilationTarget;
    if (!isRecord(compilationTarget)
      || Object.keys(compilationTarget).length !== 1
      || Object.values(compilationTarget)[0] !== expectedName) {
      failures.push(`compilation target is not exactly ${expectedName}`);
    }
  }
  if (contract.creation_status !== "success") failures.push("successful creation is not reported");
  return failures;
}

async function checkContract(key: ContractKey, address: string): Promise<ContractResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await withBlockscoutSlot(() => fetch(`${BLOCKSCOUT_API}/${address}`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000)
      }));
      const retryable = response.status === 429 || response.status >= 500;
      if (!response.ok) {
        if (retryable && attempt === 0) {
          await wait(350);
          continue;
        }
        return {
          key,
          address,
          expectedName: EXPECTED_CONTRACTS[key],
          verified: false,
          failures: [response.status === 404
            ? "source record not published or still indexing (404)"
            : `Blockscout returned ${response.status}${retryable ? " after one retry" : ""}`]
        };
      }

      const payload: unknown = await response.json();
      if (!isRecord(payload)) {
        return {
          key,
          address,
          expectedName: EXPECTED_CONTRACTS[key],
          verified: false,
          failures: ["Blockscout returned a malformed contract record"]
        };
      }

      const failures = verificationFailures(payload as BlockscoutContract, EXPECTED_CONTRACTS[key]);
      return { key, address, expectedName: EXPECTED_CONTRACTS[key], verified: failures.length === 0, failures };
    } catch {
      if (attempt === 0) {
        await wait(350);
        continue;
      }
      return {
        key,
        address,
        expectedName: EXPECTED_CONTRACTS[key],
        verified: false,
        failures: ["Blockscout request failed after one retry"]
      };
    }
  }
  throw new Error("Unreachable Blockscout retry state.");
}

async function checkContracts(contracts: Record<ContractKey, string>) {
  const keys = Object.keys(EXPECTED_CONTRACTS) as ContractKey[];
  const results = new Array<ContractResult>(keys.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < keys.length) {
      const index = nextIndex;
      nextIndex += 1;
      const key = keys[index];
      results[index] = await checkContract(key, contracts[key]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(BLOCKSCOUT_CONCURRENCY, keys.length) }, worker));
  return results;
}

async function sourceStatus(contracts: Record<ContractKey, string>) {
  const key = cacheKey(contracts);
  const now = Date.now();
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) resultCache.delete(key);
  const existing = inFlightChecks.get(key);
  if (existing) return existing;

  const pending = (async (): Promise<SourceStatus> => {
    const results = await checkContracts(contracts);
    const value = {
      verified: results.every((result) => result.verified),
      checkedAt: new Date().toISOString(),
      contracts: results
    };
    const completedAt = Date.now();
    pruneCache(completedAt);
    resultCache.set(key, {
      expiresAt: completedAt + (value.verified ? SUCCESS_CACHE_MS : FAILURE_CACHE_MS),
      value
    });
    return value;
  })();
  inFlightChecks.set(key, pending);
  try {
    return await pending;
  } finally {
    if (inFlightChecks.get(key) === pending) inFlightChecks.delete(key);
  }
}

export async function POST(request: Request) {
  try {
    const contracts = parseAddresses(await request.json());
    if (!contracts) {
      return NextResponse.json(
        { error: "All fifteen reviewed V6 contracts and critical RMT dependencies are required." },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const rateLimit = checkSourceRateLimit(request, cacheKey(contracts), Date.now());
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many unique source-verification requests. Retry after the current window." },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(rateLimit.retryAfterSeconds)
          }
        }
      );
    }

    return NextResponse.json(await sourceStatus(contracts), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Blockscout source verification is unavailable. No activation transaction may be submitted." },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
