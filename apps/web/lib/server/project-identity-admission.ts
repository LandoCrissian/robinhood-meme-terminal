import { createPublicClient, erc20Abi, getAddress, http, isAddress, zeroAddress, type Address } from "viem";
import { robinhoodChain } from "@rmt/shared/chains";

const COINGECKO_PROJECT_REGISTRY_URL = "https://api.coingecko.com/api/v3/coins/list?include_platform=true&status=active";
const ROBINHOOD_PLATFORM_ID = "robinhood";
const REGISTRY_TIMEOUT_MS = 4_000;
const MAXIMUM_REGISTRY_RESPONSE_BYTES = 5_000_000;
const MAXIMUM_REGISTRY_ENTRIES = 25_000;
const REGISTRY_CACHE_TTL_MS = 5 * 60_000;
const REGISTRY_FAILURE_BACKOFF_MS = 15_000;
const IDENTITY_CACHE_TTL_MS = 5 * 60_000;
const MAXIMUM_BATCH_IDENTITIES = 256;
const IDENTITIES_PER_MULTICALL = 100;
const MAXIMUM_POSITIVE_QUARANTINE_CACHE_ENTRIES = 1_024;
const ROBINHOOD_MULTICALL3 = getAddress("0xcA11bde05977b3631167028862bE2a173976CA11");

export type ProjectTokenIdentity = {
  address: string;
  name: string;
  symbol: string;
};

export type AuthoritativeProjectIdentity = {
  projectId: string;
  name: string;
  symbol: string;
  contractAddress: string;
  authority: "coingecko-robinhood-contract-registry";
};

export type ProjectIdentityAuthoritySnapshot =
  | { status: "ready"; entries: AuthoritativeProjectIdentity[]; freshness?: "current" | "last-known" }
  | { status: "unavailable"; entries: [] };

export type ProjectIdentityAdmissionTiming = {
  authorityMs: number;
  candidateIdentityMs: number;
  establishedIdentityMs: number;
  admissionTotalMs: number;
  candidateIdentityCount: number;
  establishedIdentityCount: number;
  identityNetworkBatches: number;
};

export type ProjectIdentityAdmission =
  | {
      status: "admitted";
      authorityState: "authoritative-binding" | "no-conflict" | "unknown";
    }
  | {
      status: "conflicting-project-identity";
      authorityState: "positive-conflict";
      establishedProject: AuthoritativeProjectIdentity;
    };

export type ProjectIdentityAdmissionCandidate = {
  address: string;
  verifiedIdentity?: ProjectTokenIdentity | null;
};

export type ProjectIdentityAdmissionDependencies = {
  readAuthority?: () => Promise<ProjectIdentityAuthoritySnapshot>;
  readIdentity?: (address: Address) => Promise<ProjectTokenIdentity | null>;
  readIdentities?: (addresses: readonly Address[]) => Promise<ReadonlyMap<string, ProjectTokenIdentity>>;
  onTiming?: (timing: ProjectIdentityAdmissionTiming) => void;
};

export type ProjectIdentityAuthorityReaderDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

type CoinGeckoRegistryItem = {
  id?: unknown;
  name?: unknown;
  symbol?: unknown;
  platforms?: unknown;
};

type CachedAuthority = {
  expiresAt: number;
  observedAt: number;
  snapshot: Extract<ProjectIdentityAuthoritySnapshot, { status: "ready" }>;
};

type CachedIdentity = {
  expiresAt: number;
  identity: ProjectTokenIdentity;
};

const identityCache = new Map<string, CachedIdentity>();
const positiveQuarantineCache = new Map<string, Extract<ProjectIdentityAdmission, { status: "conflicting-project-identity" }>>();

const identityClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(
    process.env.RMT_MAINNET_RPC_URL
      ?? process.env.ROBINHOOD_MAINNET_RPC_URL
      ?? robinhoodChain.rpcUrls.default.http[0],
    { retryCount: 0, timeout: 2_000 }
  )
});

export class ConflictingProjectIdentityError extends Error {
  readonly code = "CONFLICTING_PROJECT_IDENTITY";

  constructor() {
    super("Not admitted to the RMT directory.");
    this.name = "ConflictingProjectIdentityError";
  }
}

function boundedText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum);
  return normalized || null;
}

function projectText(value: string) {
  return value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function projectInitialism(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
}

function isBoundedInitialismExtension(value: string, base: string) {
  return value.startsWith(base)
    && value.length > base.length
    && value.length <= base.length + 2;
}

function materiallyConfusableProjectIdentity(
  candidate: ProjectTokenIdentity,
  established: AuthoritativeProjectIdentity
) {
  const candidateSymbol = projectText(candidate.symbol);
  const establishedSymbol = projectText(established.symbol);
  if (!candidateSymbol || candidateSymbol !== establishedSymbol) return false;
  const candidateName = projectText(candidate.name);
  const establishedName = projectText(established.name);
  if (candidateName && candidateName === establishedName) return true;
  if (candidateSymbol.length < 2 || candidateSymbol.length > 10) return false;
  const candidateInitialism = projectInitialism(candidate.name);
  const establishedInitialism = projectInitialism(established.name);
  if (candidateInitialism === candidateSymbol && establishedInitialism === establishedSymbol) return true;
  return (
    establishedInitialism === establishedSymbol
    && isBoundedInitialismExtension(candidateInitialism, candidateSymbol)
  ) || (
    candidateInitialism === candidateSymbol
    && isBoundedInitialismExtension(establishedInitialism, establishedSymbol)
  );
}

function canonicalAddress(value: unknown) {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) return null;
  const address = getAddress(value);
  return address === zeroAddress ? null : address;
}

export function parseProjectIdentityAuthoritySnapshot(value: unknown): ProjectIdentityAuthoritySnapshot {
  if (!Array.isArray(value) || value.length > MAXIMUM_REGISTRY_ENTRIES) {
    return { status: "unavailable", entries: [] };
  }
  const entries = new Map<string, AuthoritativeProjectIdentity>();
  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
    const item = rawItem as CoinGeckoRegistryItem;
    const projectId = boundedText(item.id, 160);
    const name = boundedText(item.name, 80);
    const symbol = boundedText(item.symbol, 20);
    const platforms = item.platforms && typeof item.platforms === "object" && !Array.isArray(item.platforms)
      ? item.platforms as Record<string, unknown>
      : null;
    const contractAddress = canonicalAddress(platforms?.[ROBINHOOD_PLATFORM_ID]);
    if (!projectId || !name || !symbol || !contractAddress) continue;
    entries.set(`${projectId}:${contractAddress.toLowerCase()}`, {
      projectId,
      name,
      symbol,
      contractAddress,
      authority: "coingecko-robinhood-contract-registry"
    });
  }
  return entries.size > 0
    ? { status: "ready", entries: [...entries.values()] }
    : { status: "unavailable", entries: [] };
}

export function createProjectIdentityAuthorityReader(
  dependencies: ProjectIdentityAuthorityReaderDependencies = {}
) {
  let cachedAuthority: CachedAuthority | undefined;
  let failureBackoffUntil = 0;
  let inFlight: Promise<ProjectIdentityAuthoritySnapshot> | undefined;
  const fetchImplementation = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const timeoutMs = dependencies.timeoutMs ?? REGISTRY_TIMEOUT_MS;

  const readFresh = async (): Promise<ProjectIdentityAuthoritySnapshot> => {
    const requestedAt = now();
    if (cachedAuthority && cachedAuthority.expiresAt > requestedAt) return cachedAuthority.snapshot;
    if (failureBackoffUntil > requestedAt) return cachedAuthority
      ? { ...cachedAuthority.snapshot, freshness: "last-known" }
      : { status: "unavailable", entries: [] };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImplementation(COINGECKO_PROJECT_REGISTRY_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
      const contentLength = Number(response.headers.get("content-length"));
      if (!response.ok || (Number.isFinite(contentLength) && contentLength > MAXIMUM_REGISTRY_RESPONSE_BYTES)) {
        failureBackoffUntil = requestedAt + REGISTRY_FAILURE_BACKOFF_MS;
        return cachedAuthority
          ? { ...cachedAuthority.snapshot, freshness: "last-known" }
          : { status: "unavailable", entries: [] };
      }
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > MAXIMUM_REGISTRY_RESPONSE_BYTES) {
        failureBackoffUntil = requestedAt + REGISTRY_FAILURE_BACKOFF_MS;
        return cachedAuthority
          ? { ...cachedAuthority.snapshot, freshness: "last-known" }
          : { status: "unavailable", entries: [] };
      }
      const snapshot = parseProjectIdentityAuthoritySnapshot(JSON.parse(text) as unknown);
      if (snapshot.status !== "ready") {
        failureBackoffUntil = requestedAt + REGISTRY_FAILURE_BACKOFF_MS;
        return cachedAuthority
          ? { ...cachedAuthority.snapshot, freshness: "last-known" }
          : snapshot;
      }
      cachedAuthority = {
        expiresAt: requestedAt + REGISTRY_CACHE_TTL_MS,
        observedAt: requestedAt,
        snapshot: { ...snapshot, freshness: "current" }
      };
      failureBackoffUntil = 0;
      return cachedAuthority.snapshot;
    } catch {
      failureBackoffUntil = requestedAt + REGISTRY_FAILURE_BACKOFF_MS;
      return cachedAuthority
        ? { ...cachedAuthority.snapshot, freshness: "last-known" }
        : { status: "unavailable", entries: [] };
    } finally {
      clearTimeout(timeout);
    }
  };
  return async () => {
    if (inFlight) return inFlight;
    inFlight = readFresh().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
}

const fetchAuthoritySnapshot = createProjectIdentityAuthorityReader();

function boundedIdentityText(value: unknown, maximum: number) {
  return typeof value === "string" ? boundedText(value, maximum) : null;
}

async function readBatchedIdentities(addresses: readonly Address[]) {
  const now = Date.now();
  const unique = [...new Map(addresses.slice(0, MAXIMUM_BATCH_IDENTITIES).map((address) => {
    const normalized = getAddress(address);
    return [normalized.toLowerCase(), normalized] as const;
  })).values()];
  const identities = new Map<string, ProjectTokenIdentity>();
  const missing: Address[] = [];
  for (const address of unique) {
    const cached = identityCache.get(address.toLowerCase());
    if (cached && cached.expiresAt > now) identities.set(address.toLowerCase(), cached.identity);
    else missing.push(address);
  }
  if (missing.length > 0) {
    const batches = Array.from(
      { length: Math.ceil(missing.length / IDENTITIES_PER_MULTICALL) },
      (_, index) => missing.slice(index * IDENTITIES_PER_MULTICALL, (index + 1) * IDENTITIES_PER_MULTICALL)
    );
    const batchResults = await Promise.all(batches.map(async (batch) => ({
      batch,
      results: await identityClient.multicall({
        allowFailure: true,
        multicallAddress: ROBINHOOD_MULTICALL3,
        contracts: batch.flatMap((address) => [
          { address, abi: erc20Abi, functionName: "name" as const },
          { address, abi: erc20Abi, functionName: "symbol" as const }
        ])
      }).catch(() => [])
    })));
    for (const { batch, results } of batchResults) {
      batch.forEach((address, index) => {
        const nameResult = results[index * 2];
        const symbolResult = results[index * 2 + 1];
        const name = boundedIdentityText(nameResult?.status === "success" ? nameResult.result : null, 80);
        const symbol = boundedIdentityText(symbolResult?.status === "success" ? symbolResult.result : null, 20);
        if (!name || !symbol) return;
        const identity = { address, name, symbol };
        identities.set(address.toLowerCase(), identity);
        identityCache.set(address.toLowerCase(), { expiresAt: now + IDENTITY_CACHE_TTL_MS, identity });
      });
    }
  }
  return identities;
}

async function cachedIdentity(address: Address) {
  return (await readBatchedIdentities([address])).get(address.toLowerCase()) ?? null;
}

function registryBindingForAddress(snapshot: ProjectIdentityAuthoritySnapshot, address: string) {
  if (snapshot.status !== "ready") return undefined;
  return snapshot.entries.find((entry) => entry.contractAddress.toLowerCase() === address.toLowerCase());
}

async function verifyEstablishedProject(
  entry: AuthoritativeProjectIdentity,
  readIdentity: (address: Address) => Promise<ProjectTokenIdentity | null>
) {
  const identity = await readIdentity(getAddress(entry.contractAddress)).catch(() => null);
  return Boolean(
    identity
    && identity.address.toLowerCase() === entry.contractAddress.toLowerCase()
    && projectText(identity.name) === projectText(entry.name)
    && projectText(identity.symbol) === projectText(entry.symbol)
  );
}

export async function evaluateProjectIdentityAdmission(
  candidate: ProjectIdentityAdmissionCandidate,
  snapshot: ProjectIdentityAuthoritySnapshot,
  readIdentity: (address: Address) => Promise<ProjectTokenIdentity | null> = cachedIdentity
): Promise<ProjectIdentityAdmission> {
  const address = canonicalAddress(candidate.address);
  if (!address || snapshot.status !== "ready") {
    return { status: "admitted", authorityState: "unknown" };
  }
  if (registryBindingForAddress(snapshot, address)) {
    return { status: "admitted", authorityState: "authoritative-binding" };
  }
  const identity = candidate.verifiedIdentity
    ?? await readIdentity(address).catch(() => null);
  if (!identity || identity.address.toLowerCase() !== address.toLowerCase()) {
    return { status: "admitted", authorityState: "unknown" };
  }
  const conflicts = snapshot.entries.filter((entry) => (
    entry.contractAddress.toLowerCase() !== address.toLowerCase()
    && materiallyConfusableProjectIdentity(identity, entry)
  ));
  for (const establishedProject of conflicts) {
    if (await verifyEstablishedProject(establishedProject, readIdentity)) {
      return {
        status: "conflicting-project-identity",
        authorityState: "positive-conflict",
        establishedProject
      };
    }
  }
  return { status: "admitted", authorityState: "no-conflict" };
}

export async function applyProjectIdentityDirectoryAdmission<T extends ProjectIdentityAdmissionCandidate>(
  candidates: readonly T[],
  dependencies: ProjectIdentityAdmissionDependencies = {}
) {
  const admissionStartedAt = performance.now();
  const timing: ProjectIdentityAdmissionTiming = {
    authorityMs: 0,
    candidateIdentityMs: 0,
    establishedIdentityMs: 0,
    admissionTotalMs: 0,
    candidateIdentityCount: 0,
    establishedIdentityCount: 0,
    identityNetworkBatches: 0
  };
  const readAuthority = dependencies.readAuthority ?? fetchAuthoritySnapshot;
  const readIdentity = dependencies.readIdentity ?? cachedIdentity;
  const readIdentities = dependencies.readIdentities ?? (dependencies.readIdentity ? undefined : readBatchedIdentities);
  const authorityStartedAt = performance.now();
  const snapshot = await readAuthority().catch((): ProjectIdentityAuthoritySnapshot => ({ status: "unavailable", entries: [] }));
  timing.authorityMs = performance.now() - authorityStartedAt;
  if (snapshot.status !== "ready") {
    const quarantined = candidates.flatMap((candidate) => {
      const admission = positiveQuarantineCache.get(candidate.address.toLowerCase());
      return admission ? [{ candidate, admission }] : [];
    });
    const quarantinedAddresses = new Set(quarantined.map(({ candidate }) => candidate.address.toLowerCase()));
    timing.admissionTotalMs = performance.now() - admissionStartedAt;
    dependencies.onTiming?.(timing);
    return {
      admitted: candidates.filter((candidate) => !quarantinedAddresses.has(candidate.address.toLowerCase())),
      quarantined,
      authorityStatus: "unavailable" as const
    };
  }
  const prefetchedIdentities = new Map<string, ProjectTokenIdentity>();
  if (readIdentities) {
    const candidateAddresses = candidates.flatMap((candidate) => {
      const address = canonicalAddress(candidate.address);
      return address && !candidate.verifiedIdentity && !registryBindingForAddress(snapshot, address) ? [address] : [];
    });
    timing.candidateIdentityCount = new Set(candidateAddresses.map((address) => address.toLowerCase())).size;
    timing.identityNetworkBatches += Math.ceil(timing.candidateIdentityCount / IDENTITIES_PER_MULTICALL);
    const candidateStartedAt = performance.now();
    const candidateIdentities = await readIdentities(candidateAddresses);
    timing.candidateIdentityMs = performance.now() - candidateStartedAt;
    for (const [address, identity] of candidateIdentities) prefetchedIdentities.set(address, identity);
    const establishedAddresses = candidates.flatMap((candidate) => {
      const address = canonicalAddress(candidate.address);
      const identity = candidate.verifiedIdentity ?? (address ? candidateIdentities.get(address.toLowerCase()) : undefined);
      if (!address || !identity) return [];
      return snapshot.entries.flatMap((entry) => (
        entry.contractAddress.toLowerCase() !== address.toLowerCase()
        && materiallyConfusableProjectIdentity(identity, entry)
      ) ? [getAddress(entry.contractAddress)] : []);
    });
    timing.establishedIdentityCount = new Set(establishedAddresses.map((address) => address.toLowerCase())).size;
    timing.identityNetworkBatches += Math.ceil(timing.establishedIdentityCount / IDENTITIES_PER_MULTICALL);
    const establishedStartedAt = performance.now();
    const establishedIdentities = await readIdentities(establishedAddresses);
    timing.establishedIdentityMs = performance.now() - establishedStartedAt;
    for (const [address, identity] of establishedIdentities) prefetchedIdentities.set(address, identity);
  }
  const decisionIdentityReader = async (address: Address) => (
    prefetchedIdentities.get(address.toLowerCase()) ?? readIdentity(address)
  );
  const decisions = await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    admission: await evaluateProjectIdentityAdmission(candidate, snapshot, decisionIdentityReader)
  })));
  for (const { candidate, admission } of decisions) {
    const key = candidate.address.toLowerCase();
    if (admission.status === "conflicting-project-identity") {
      if (!positiveQuarantineCache.has(key) && positiveQuarantineCache.size >= MAXIMUM_POSITIVE_QUARANTINE_CACHE_ENTRIES) {
        const oldest = positiveQuarantineCache.keys().next().value;
        if (oldest) positiveQuarantineCache.delete(oldest);
      }
      positiveQuarantineCache.set(key, admission);
    }
    else positiveQuarantineCache.delete(key);
  }
  timing.admissionTotalMs = performance.now() - admissionStartedAt;
  dependencies.onTiming?.(timing);
  return {
    admitted: decisions.filter(({ admission }) => admission.status === "admitted").map(({ candidate }) => candidate),
    quarantined: decisions.flatMap(({ candidate, admission }) => admission.status === "conflicting-project-identity"
      ? [{ candidate, admission }]
      : []),
    authorityStatus: "ready" as const
  };
}

export async function requireProjectIdentityDirectoryAdmitted(
  candidates: readonly ProjectIdentityAdmissionCandidate[],
  dependencies: ProjectIdentityAdmissionDependencies = {}
) {
  const result = await applyProjectIdentityDirectoryAdmission(candidates, dependencies);
  if (result.quarantined.length > 0) throw new ConflictingProjectIdentityError();
}

export function projectIdentityAdmissionErrorResponse(cause: unknown) {
  if (!(cause instanceof ConflictingProjectIdentityError)) return null;
  return Response.json(
    { error: cause.message },
    { status: 409, headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
