import { NextResponse } from "next/server";
import { createHash } from "node:crypto";

const BLOCKSCOUT_API = "https://robinhoodchain.blockscout.com/api/v2/smart-contracts";
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const EXPECTED_COMPILER = "v0.8.26+commit.8a97fa7a";
const LEGACY_FACTORY = "0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd";
const BLOCKSCOUT_CONCURRENCY = 4;
const FAILURE_CACHE_MS = 5_000;
const MAX_CACHE_ENTRIES = 16;
const MAX_BLOCKSCOUT_WAITERS = 64;
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

const EXPECTED_SOURCE_PATHS = {
  governance: "src/RMTV6Governance.sol",
  bootstrapController: "src/RMTV6BootstrapController.sol",
  foundationVerifier: "src/RMTV6BootstrapFoundationVerifier.sol",
  smokeVerifier: "src/RMTV6BootstrapSmokeVerifier.sol",
  versionRegistry: "src/VersionedFactoryRegistry.sol",
  legacyFactory: "src/LowCostMemeLaunchFactoryV5.sol",
  hook: "src/V5GraduationHook.sol",
  adapter: "src/V4GraduationAdapter.sol",
  launchGate: "src/RMTLaunchGate.sol",
  policyRegistry: "src/RMTLaunchPolicyRegistry.sol",
  marketImplementation: "src/clone/CloneBondingCurveMarketV6.sol",
  tokenImplementation: "src/clone/CloneFixedSupplyMemeToken.sol",
  feeSplitterImplementation: "src/DirectLaunchFeeSplitter.sol",
  officialMigration: "src/OfficialRMTIdentityMigration.sol",
  factory: "src/RMTLaunchFactoryV6.sol"
} as const;

const EXPECTED_SOURCE_SHA256 = {
  governance: "74662b5e6b147a281ec07f3f9a817acf95f616a85224ab0f1119706ff2bb8188",
  bootstrapController: "2396bf0087a43a1f82bdf694a5b9d278111ca6c1ddef7a80546dfbc5d9a4bb30",
  foundationVerifier: "a0082fccaef30c0521d14fe029ac6a5f12c050c57be05d1801327769a89cd7dc",
  smokeVerifier: "6444c4304fb529601634a9b440b7e00927dafebc28a9da0051838403d4f09ec0",
  versionRegistry: "980e4b647655f3783474682a7a9a31952b0dca4832d12eca54e7ff3757489f07",
  legacyFactory: "6c3e3727b603482e14738334ae6fc85a75a5930482d231aca10e5bd5f36cfc51",
  hook: "4787666914ebc080d701278d906ae75aea3a5202e7e790614b191601d78caa40",
  adapter: "026fd6ddd7787a11dabb601d4f4bca9232d514af8d7912962c4df521b0279d08",
  launchGate: "3d5689dfdf4598c4798963e1cab17f4a300405f226be0a9cf60007da76db313c",
  policyRegistry: "c8bc8114297be645218a01a0eddf20538f1f1deadf0d2cefa0be3cef2a87efda",
  marketImplementation: "f4b40c5abc0089cb8cdad31cbf40c8ee90d28f7ebd1dcea62f6dbbe400378cc7",
  tokenImplementation: "d97e5701f116fa0ed0dd519e7b15fdcb4a3f95b734c8f7c8bb48100e82b13300",
  feeSplitterImplementation: "2b266488200ac6c4257e6f10021f62d2bdff0565202ca83f6759902baeb7cc28",
  officialMigration: "db5084a448c5d7547b4baba825060ae4db9f1b69d3618d9a34c422fd2f547290",
  factory: "190f6bdea0d5222b2782b091f1356db11a2ad57dfd9a159c2ebdc6905b322fba"
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
  evm_version?: unknown;
  file_path?: unknown;
  source_code?: unknown;
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
  if (blockscoutWaiters.length >= MAX_BLOCKSCOUT_WAITERS) {
    throw new Error("Blockscout verification queue is full.");
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

function verificationFailures(
  contract: BlockscoutContract,
  expectedName: string,
  expectedPath: string,
  expectedSourceHash: string
) {
  const failures: string[] = [];
  if (contract.is_verified !== true) {
    failures.push("source not published or verification still pending");
    if (contract.is_changed_bytecode === true) failures.push("changed bytecode reported");
    return failures;
  }
  if (contract.is_fully_verified !== true) failures.push("not fully verified");
  if (contract.is_partially_verified !== false) failures.push("full-match status is not explicitly confirmed");
  if (contract.is_changed_bytecode === true) failures.push("changed bytecode reported");
  else if (contract.is_changed_bytecode !== false) failures.push("unchanged bytecode is not confirmed");
  if (contract.name !== expectedName) failures.push(`expected source ${expectedName}`);
  if (contract.language !== "solidity") failures.push("language is not Solidity");
  if (contract.compiler_version !== EXPECTED_COMPILER) failures.push(`compiler is not ${EXPECTED_COMPILER}`);
  if (contract.evm_version !== "cancun") failures.push("top-level EVM version is not Cancun");
  if (contract.file_path !== expectedPath) failures.push(`source path is not exactly ${expectedPath}`);
  if (typeof contract.source_code !== "string"
    || createHash("sha256").update(contract.source_code).digest("hex") !== expectedSourceHash) {
    failures.push("published primary source does not match the reviewed release source");
  }
  // Blockscout v2 omits compiler_settings.compilationTarget on exact/full records.
  // The exact name, file path, source hash, and unchanged-bytecode flags bind the
  // published record to the reviewed primary compilation source instead.
  const optimizationRuns = contract.optimizations_runs ?? contract.optimization_runs;
  if (contract.optimization_enabled !== true || optimizationRuns !== 200) {
    failures.push("optimizer settings do not match 200 runs");
  }
  if (!isRecord(contract.compiler_settings)) {
    failures.push("via-IR compiler setting is not reported");
    failures.push("compiler-settings optimizer does not match 200 runs");
    failures.push("compiler-settings EVM version is not Cancun");
  } else {
    if (contract.compiler_settings.viaIR !== true) {
      failures.push("via-IR compiler setting is not reported");
    }
    const optimizer = contract.compiler_settings.optimizer;
    if (!isRecord(optimizer) || optimizer.enabled !== true || optimizer.runs !== 200) {
      failures.push("compiler-settings optimizer does not match 200 runs");
    }
    if (contract.compiler_settings.evmVersion !== "cancun") {
      failures.push("compiler-settings EVM version is not Cancun");
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

      const failures = verificationFailures(
        payload as BlockscoutContract,
        EXPECTED_CONTRACTS[key],
        EXPECTED_SOURCE_PATHS[key],
        EXPECTED_SOURCE_SHA256[key]
      );
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
    if (value.verified) resultCache.delete(key);
    else resultCache.set(key, { expiresAt: completedAt + FAILURE_CACHE_MS, value });
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
