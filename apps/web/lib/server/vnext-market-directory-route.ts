import {
  readVNextCanonicalMarketDirectoryPage,
  type VNextCanonicalMarketDirectoryPage
} from "./vnext-canonical-market-directory";
import {
  readVNextLegacyMarketDirectoryPage,
  type VNextLegacyMarketDirectoryPage
} from "./vnext-legacy-market-directory";
import {
  excludeKnownPositiveProjectIdentityQuarantines,
  type ProjectIdentityAdmissionCandidate,
  type ProjectIdentityAdmissionTiming
} from "./project-identity-admission";
import type { VNextMarketIndexerTiming } from "./vnext-market-indexer";

type CanonicalReader = (requestUrl: string) => Promise<VNextCanonicalMarketDirectoryPage>;
type LegacyReader = () => Promise<VNextLegacyMarketDirectoryPage>;
type ProjectAdmissionFilter = <T extends ProjectIdentityAdmissionCandidate>(candidates: readonly T[]) => Promise<T[]>;

type VNextMarketDirectoryRouteDependencies = {
  readCanonical: CanonicalReader;
  readLegacy: LegacyReader;
  admitProjectIdentities?: ProjectAdmissionFilter;
  presentationCache?: boolean;
  now?: () => number;
};

export type VNextMarketDirectoryRouteResult = {
  status: 200 | 400 | 503;
  body: VNextCanonicalMarketDirectoryPage["body"] | VNextLegacyMarketDirectoryPage["body"];
  headers: Readonly<Record<string, string>>;
};

const defaultDependencies: VNextMarketDirectoryRouteDependencies = {
  readCanonical: readVNextCanonicalMarketDirectoryPage,
  readLegacy: readVNextLegacyMarketDirectoryPage,
  admitProjectIdentities: async <T extends ProjectIdentityAdmissionCandidate>(candidates: readonly T[]) => [...candidates]
};

type MarketDirectoryTiming = VNextMarketIndexerTiming & ProjectIdentityAdmissionTiming & {
  totalMs: number;
};

type CachedDirectoryResult = {
  freshUntil: number;
  staleUntil: number;
  result: VNextMarketDirectoryRouteResult;
};

const DIRECTORY_FRESH_TTL_MS = 15_000;
const DIRECTORY_STALE_TTL_MS = 2 * 60_000;
export const VNEXT_DIRECTORY_PRESENTATION_CACHE_MAX_ENTRIES = 128;
const DIRECTORY_IN_FLIGHT_MAX_ENTRIES = 32;
const directoryCache = new Map<string, CachedDirectoryResult>();
const directoryInFlight = new Map<string, Promise<VNextMarketDirectoryRouteResult>>();
const dependencyCacheNamespaces = new WeakMap<VNextMarketDirectoryRouteDependencies, number>();
let nextDependencyCacheNamespace = 1;

function rounded(value: number) {
  return Math.max(0, Math.round(value * 10) / 10);
}

function timingHeaders(timing: MarketDirectoryTiming, cacheState: "MISS" | "REFRESH") {
  return {
    "Server-Timing": [
      `total;dur=${rounded(timing.totalMs)}`,
      `indexer;dur=${rounded(timing.indexerReadMs)}`,
      `inventory_json;dur=${rounded(timing.inventoryJsonMs)}`,
      `inventory_schema;dur=${rounded(timing.inventorySchemaMs)}`,
      `project_authority;dur=${rounded(timing.authorityMs)}`,
      `candidate_identity;dur=${rounded(timing.candidateIdentityMs)}`,
      `established_identity;dur=${rounded(timing.establishedIdentityMs)}`,
      `identity_admission;dur=${rounded(timing.admissionTotalMs)}`
    ].join(", "),
    "X-RMT-Directory-Cache": cacheState
  };
}

function cacheNamespace(dependencies: VNextMarketDirectoryRouteDependencies) {
  if (dependencies === defaultDependencies) return "default";
  const existing = dependencyCacheNamespaces.get(dependencies);
  if (existing !== undefined) return `dependency-${existing}`;
  const namespace = nextDependencyCacheNamespace;
  nextDependencyCacheNamespace += 1;
  dependencyCacheNamespaces.set(dependencies, namespace);
  return `dependency-${namespace}`;
}

function normalizedDirectoryCacheKey(requestUrl: string, dependencies: VNextMarketDirectoryRouteDependencies) {
  const cursor = new URL(requestUrl).searchParams.get("cursor");
  if (cursor !== null) return null;
  return `${cacheNamespace(dependencies)}:root`;
}

function setBoundedDirectoryCache(cacheKey: string, value: CachedDirectoryResult) {
  directoryCache.delete(cacheKey);
  while (directoryCache.size >= VNEXT_DIRECTORY_PRESENTATION_CACHE_MAX_ENTRIES) {
    const oldest = directoryCache.keys().next().value;
    if (!oldest) break;
    directoryCache.delete(oldest);
  }
  directoryCache.set(cacheKey, value);
}

function setBoundedDirectoryInFlight(cacheKey: string, value: Promise<VNextMarketDirectoryRouteResult>) {
  while (directoryInFlight.size >= DIRECTORY_IN_FLIGHT_MAX_ENTRIES) {
    const oldest = directoryInFlight.keys().next().value;
    if (!oldest) break;
    directoryInFlight.delete(oldest);
  }
  directoryInFlight.set(cacheKey, value);
}

function filterKnownPositiveQuarantines(result: VNextMarketDirectoryRouteResult) {
  if (result.status !== 200 || !("markets" in result.body) || !Array.isArray(result.body.markets)) return result;
  return {
    ...result,
    body: {
      ...result.body,
      markets: excludeKnownPositiveProjectIdentityQuarantines(result.body.markets)
    }
  } as VNextMarketDirectoryRouteResult;
}

function cachedResult(result: VNextMarketDirectoryRouteResult, state: "HIT" | "STALE") {
  const filtered = filterKnownPositiveQuarantines(result);
  return {
    ...filtered,
    headers: {
      ...filtered.headers,
      "Cache-Control": "private, no-store, max-age=0",
      "X-RMT-Directory-Cache": state,
      "X-RMT-Directory-Freshness": state === "HIT" ? "current" : "last-known"
    }
  };
}

async function readUncachedVNextMarketDirectoryRequest(
  requestUrl: string,
  dependencies: VNextMarketDirectoryRouteDependencies
) {
  const startedAt = performance.now();
  let indexerTiming: VNextMarketIndexerTiming = { indexerReadMs: 0, inventoryJsonMs: 0, inventorySchemaMs: 0 };
  let admissionTiming: ProjectIdentityAdmissionTiming = {
    authorityMs: 0,
    candidateIdentityMs: 0,
    establishedIdentityMs: 0,
    admissionTotalMs: 0,
    candidateIdentityCount: 0,
    establishedIdentityCount: 0,
    identityNetworkBatches: 0
  };
  let admissionAuthorityStatus: "ready" | "unavailable" = "unavailable";
  const result = await dependencies.readCanonical(requestUrl);
  let body = result.body;
  if (result.status === 200) {
    if (dependencies === defaultDependencies) {
      admissionAuthorityStatus = "ready";
      body = result.body;
    } else {
      admissionAuthorityStatus = "ready";
      body = {
        ...result.body,
        markets: await (dependencies.admitProjectIdentities ?? defaultDependencies.admitProjectIdentities!)(result.body.markets ?? [])
      };
    }
  }
  const timing: MarketDirectoryTiming = {
    ...indexerTiming,
    ...admissionTiming,
    totalMs: performance.now() - startedAt
  };
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store, max-age=0",
    ...timingHeaders(timing, "MISS" as const)
  };
  headers["X-RMT-Project-Authority"] = admissionAuthorityStatus;
  console.info(JSON.stringify({
    event: "vnext_market_directory_timing",
    status: result.status,
    ...Object.fromEntries(Object.entries(timing).map(([key, value]) => [key, rounded(value)])),
    candidateIdentityCount: admissionTiming.candidateIdentityCount,
    establishedIdentityCount: admissionTiming.establishedIdentityCount,
    identityNetworkBatches: admissionTiming.identityNetworkBatches
  }));
  return filterKnownPositiveQuarantines({ ...result, body, headers } as VNextMarketDirectoryRouteResult);
}

export function vNextCanonicalBrowseEnabled(
  _env: Readonly<Record<string, string | undefined>> = process.env
) {
  return true;
}

export async function readVNextMarketDirectoryRequest(
  requestUrl: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: VNextMarketDirectoryRouteDependencies = defaultDependencies
): Promise<VNextMarketDirectoryRouteResult> {
  void env;
  const presentationCacheEnabled = dependencies === defaultDependencies || dependencies.presentationCache === true;
  if (!presentationCacheEnabled) {
    return readUncachedVNextMarketDirectoryRequest(requestUrl, dependencies);
  }
  const cacheKey = normalizedDirectoryCacheKey(requestUrl, dependencies);
  if (cacheKey === null) return readUncachedVNextMarketDirectoryRequest(requestUrl, dependencies);
  const readNow = dependencies.now ?? Date.now;
  const now = readNow();
  const cached = directoryCache.get(cacheKey);
  if (cached && cached.freshUntil > now) {
    directoryCache.delete(cacheKey);
    directoryCache.set(cacheKey, cached);
    return cachedResult(cached.result, "HIT");
  }
  const existing = directoryInFlight.get(cacheKey);
  if (cached && cached.staleUntil > now) {
    if (!existing) {
      let refresh: Promise<VNextMarketDirectoryRouteResult>;
      refresh = readUncachedVNextMarketDirectoryRequest(requestUrl, dependencies)
        .then((result) => {
          if (result.status === 200 && result.headers["X-RMT-Project-Authority"] === "ready") setBoundedDirectoryCache(cacheKey, {
            freshUntil: readNow() + DIRECTORY_FRESH_TTL_MS,
            staleUntil: readNow() + DIRECTORY_STALE_TTL_MS,
            result: { ...result, headers: { ...result.headers, "X-RMT-Directory-Cache": "REFRESH" } }
          });
          return result;
        })
        .catch(() => cached.result)
        .finally(() => {
          if (directoryInFlight.get(cacheKey) === refresh) directoryInFlight.delete(cacheKey);
        });
      setBoundedDirectoryInFlight(cacheKey, refresh);
    }
    return cachedResult(cached.result, "STALE");
  }
  let request = existing;
  if (!request) {
    request = readUncachedVNextMarketDirectoryRequest(requestUrl, dependencies)
      .then((result) => {
        if (result.status === 200 && result.headers["X-RMT-Project-Authority"] === "ready") setBoundedDirectoryCache(cacheKey, {
          freshUntil: readNow() + DIRECTORY_FRESH_TTL_MS,
          staleUntil: readNow() + DIRECTORY_STALE_TTL_MS,
          result
        });
        return result;
      })
      .finally(() => {
        if (directoryInFlight.get(cacheKey) === request) directoryInFlight.delete(cacheKey);
      });
    setBoundedDirectoryInFlight(cacheKey, request);
  }
  return request;
}
