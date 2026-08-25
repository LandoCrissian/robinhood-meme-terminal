import { getAddress, isAddress, zeroAddress, type Address } from "viem";
import { readRobinhoodTokenIdentity } from "./universal-market-resolver";

const COINGECKO_PROJECT_REGISTRY_URL = "https://api.coingecko.com/api/v3/coins/list?include_platform=true&status=active";
const ROBINHOOD_PLATFORM_ID = "robinhood";
const REGISTRY_TIMEOUT_MS = 4_000;
const MAXIMUM_REGISTRY_RESPONSE_BYTES = 5_000_000;
const MAXIMUM_REGISTRY_ENTRIES = 25_000;
const REGISTRY_CACHE_TTL_MS = 5 * 60_000;
const IDENTITY_CACHE_TTL_MS = 5 * 60_000;
const IDENTITY_READ_CONCURRENCY = 8;

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
  | { status: "ready"; entries: AuthoritativeProjectIdentity[] }
  | { status: "unavailable"; entries: [] };

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
};

type CoinGeckoRegistryItem = {
  id?: unknown;
  name?: unknown;
  symbol?: unknown;
  platforms?: unknown;
};

type CachedAuthority = {
  expiresAt: number;
  snapshot: ProjectIdentityAuthoritySnapshot;
};

type CachedIdentity = {
  expiresAt: number;
  identity: Promise<ProjectTokenIdentity | null>;
};

let cachedAuthority: CachedAuthority | undefined;
const identityCache = new Map<string, CachedIdentity>();

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
  return projectInitialism(candidate.name) === candidateSymbol
    && projectInitialism(established.name) === establishedSymbol;
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
  return { status: "ready", entries: [...entries.values()] };
}

async function fetchAuthoritySnapshot(): Promise<ProjectIdentityAuthoritySnapshot> {
  const now = Date.now();
  if (cachedAuthority && cachedAuthority.expiresAt > now) return cachedAuthority.snapshot;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  try {
    const response = await fetch(COINGECKO_PROJECT_REGISTRY_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller.signal
    });
    const contentLength = Number(response.headers.get("content-length"));
    if (!response.ok || (Number.isFinite(contentLength) && contentLength > MAXIMUM_REGISTRY_RESPONSE_BYTES)) {
      return { status: "unavailable", entries: [] };
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAXIMUM_REGISTRY_RESPONSE_BYTES) {
      return { status: "unavailable", entries: [] };
    }
    const snapshot = parseProjectIdentityAuthoritySnapshot(JSON.parse(text) as unknown);
    if (snapshot.status === "ready") {
      cachedAuthority = { expiresAt: now + REGISTRY_CACHE_TTL_MS, snapshot };
    }
    return snapshot;
  } catch {
    return { status: "unavailable", entries: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function cachedIdentity(address: Address) {
  const key = address.toLowerCase();
  const now = Date.now();
  const cached = identityCache.get(key);
  if (cached && cached.expiresAt > now) return cached.identity;
  const identity = readRobinhoodTokenIdentity(address).then((result) => result ? {
    address: result.address,
    name: result.name,
    symbol: result.symbol
  } : null);
  identityCache.set(key, { expiresAt: now + IDENTITY_CACHE_TTL_MS, identity });
  void identity.then((result) => {
    if (!result && identityCache.get(key)?.identity === identity) identityCache.delete(key);
  });
  return identity;
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

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function applyProjectIdentityDirectoryAdmission<T extends ProjectIdentityAdmissionCandidate>(
  candidates: readonly T[],
  dependencies: ProjectIdentityAdmissionDependencies = {}
) {
  const readAuthority = dependencies.readAuthority ?? fetchAuthoritySnapshot;
  const readIdentity = dependencies.readIdentity ?? cachedIdentity;
  const snapshot = await readAuthority().catch((): ProjectIdentityAuthoritySnapshot => ({ status: "unavailable", entries: [] }));
  if (snapshot.status !== "ready") {
    return {
      admitted: [...candidates],
      quarantined: [] as Array<{ candidate: T; admission: Extract<ProjectIdentityAdmission, { status: "conflicting-project-identity" }> }>,
      authorityStatus: "unavailable" as const
    };
  }
  const decisions = await mapWithConcurrency(candidates, IDENTITY_READ_CONCURRENCY, async (candidate) => ({
    candidate,
    admission: await evaluateProjectIdentityAdmission(candidate, snapshot, readIdentity)
  }));
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
    { status: 451, headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}
