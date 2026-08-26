import {
  readVNextCanonicalMarketDirectoryPage,
  type VNextCanonicalMarketDirectoryPage
} from "./vnext-canonical-market-directory";
import {
  readVNextLegacyMarketDirectoryPage,
  type VNextLegacyMarketDirectoryPage
} from "./vnext-legacy-market-directory";
import {
  applyProjectIdentityDirectoryAdmission,
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
};

export type VNextMarketDirectoryRouteResult = {
  status: 200 | 400 | 503;
  body: VNextCanonicalMarketDirectoryPage["body"] | VNextLegacyMarketDirectoryPage["body"];
  headers: Readonly<Record<string, string>>;
};

const defaultDependencies: VNextMarketDirectoryRouteDependencies = {
  readCanonical: readVNextCanonicalMarketDirectoryPage,
  readLegacy: readVNextLegacyMarketDirectoryPage,
  admitProjectIdentities: async <T extends ProjectIdentityAdmissionCandidate>(candidates: readonly T[]) => (
    await applyProjectIdentityDirectoryAdmission(candidates)
  ).admitted
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
const directoryCache = new Map<string, CachedDirectoryResult>();
const directoryInFlight = new Map<string, Promise<VNextMarketDirectoryRouteResult>>();

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

function cachedResult(result: VNextMarketDirectoryRouteResult, state: "HIT" | "STALE") {
  return {
    ...result,
    headers: {
      ...result.headers,
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
  const result = dependencies === defaultDependencies
    ? await readVNextCanonicalMarketDirectoryPage(requestUrl, undefined, (value) => { indexerTiming = value; })
    : await dependencies.readCanonical(requestUrl);
  let body = result.body;
  if (result.status === 200) {
    if (dependencies === defaultDependencies) {
      const admission = await applyProjectIdentityDirectoryAdmission(result.body.markets ?? [], {
        onTiming: (value) => { admissionTiming = value; }
      });
      admissionAuthorityStatus = admission.authorityStatus;
      body = { ...result.body, markets: admission.admitted };
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
  const publiclyCacheable = result.status === 200 && admissionAuthorityStatus === "ready";
  const headers: Record<string, string> = publiclyCacheable
    ? {
        "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=120, stale-if-error=600",
        ...timingHeaders(timing, "MISS" as const)
      }
    : { "Cache-Control": "private, no-store, max-age=0", ...timingHeaders(timing, "MISS" as const) };
  headers["X-RMT-Project-Authority"] = admissionAuthorityStatus;
  console.info(JSON.stringify({
    event: "vnext_market_directory_timing",
    status: result.status,
    ...Object.fromEntries(Object.entries(timing).map(([key, value]) => [key, rounded(value)])),
    candidateIdentityCount: admissionTiming.candidateIdentityCount,
    establishedIdentityCount: admissionTiming.establishedIdentityCount,
    identityNetworkBatches: admissionTiming.identityNetworkBatches
  }));
  return { ...result, body, headers } as VNextMarketDirectoryRouteResult;
}

export function vNextCanonicalBrowseEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  return env.RMT_CANONICAL_BROWSE_ENABLED === "true";
}

export async function readVNextMarketDirectoryRequest(
  requestUrl: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  dependencies: VNextMarketDirectoryRouteDependencies = defaultDependencies
): Promise<VNextMarketDirectoryRouteResult> {
  if (!vNextCanonicalBrowseEnabled(env)) return dependencies.readLegacy();
  const presentationCacheEnabled = dependencies === defaultDependencies || dependencies.presentationCache === true;
  if (!presentationCacheEnabled) {
    return readUncachedVNextMarketDirectoryRequest(requestUrl, dependencies);
  }
  const cacheKey = new URL(requestUrl).search;
  const now = Date.now();
  const cached = directoryCache.get(cacheKey);
  if (cached && cached.freshUntil > now) return cachedResult(cached.result, "HIT");
  const existing = directoryInFlight.get(cacheKey);
  if (cached && cached.staleUntil > now) {
    if (!existing) {
      const refresh = readUncachedVNextMarketDirectoryRequest(requestUrl, dependencies)
        .then((result) => {
          if (result.status === 200 && result.headers["X-RMT-Project-Authority"] === "ready") directoryCache.set(cacheKey, {
            freshUntil: Date.now() + DIRECTORY_FRESH_TTL_MS,
            staleUntil: Date.now() + DIRECTORY_STALE_TTL_MS,
            result: { ...result, headers: { ...result.headers, "X-RMT-Directory-Cache": "REFRESH" } }
          });
          return result;
        })
        .catch(() => cached.result)
        .finally(() => directoryInFlight.delete(cacheKey));
      directoryInFlight.set(cacheKey, refresh);
    }
    return cachedResult(cached.result, "STALE");
  }
  const request = existing ?? readUncachedVNextMarketDirectoryRequest(requestUrl, dependencies)
    .then((result) => {
      if (result.status === 200 && result.headers["X-RMT-Project-Authority"] === "ready") directoryCache.set(cacheKey, {
        freshUntil: Date.now() + DIRECTORY_FRESH_TTL_MS,
        staleUntil: Date.now() + DIRECTORY_STALE_TTL_MS,
        result
      });
      return result;
    })
    .finally(() => directoryInFlight.delete(cacheKey));
  if (!existing) directoryInFlight.set(cacheKey, request);
  return request;
}
