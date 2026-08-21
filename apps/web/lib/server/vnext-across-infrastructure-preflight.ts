import { createHash, timingSafeEqual } from "node:crypto";
import { getAddress, keccak256, type Address, type Hex } from "viem";
import {
  ACROSS_SPOKE_POOLS,
  acrossFundingConfiguration,
  readAcrossSpokePoolDeployment,
  verifyAcrossSpokePoolDeployment,
  type AcrossObservedSpokePoolDeployment,
  type AcrossSpokePoolDeploymentPin
} from "./vnext-across-funding";
import { getRmtAdminFirestore, hasRmtAdminConfiguration } from "./firebase-admin";
import { acrossDedicatedRpcConfigured } from "./vnext-across-rpc";
import { verifyAcrossReleaseDiscovery } from "./vnext-across-release-discovery";
import {
  ARBITRUM_MAINNET_CHAIN_ID,
  BASE_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  ROBINHOOD_MAINNET_CHAIN_ID
} from "../vnext/trusted-asset-registry";

export const ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA = "RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_V1" as const;
const ACROSS_API_URL = "https://app.across.to/api";
const REQUEST_TIMEOUT_MS = 8_000;
const ROUTE_TIMEOUT_MS = 50_000;

const chains = [{
  chainId: ETHEREUM_MAINNET_CHAIN_ID,
  chainName: "Ethereum",
  failure: "ETHEREUM_RPC"
}, {
  chainId: ARBITRUM_MAINNET_CHAIN_ID,
  chainName: "Arbitrum",
  failure: "ARBITRUM_RPC"
}, {
  chainId: BASE_MAINNET_CHAIN_ID,
  chainName: "Base",
  failure: "BASE_RPC"
}, {
  chainId: ROBINHOOD_MAINNET_CHAIN_ID,
  chainName: "Robinhood Chain",
  failure: "ROBINHOOD_RPC"
}] as const;

type AcrossInfrastructureChain = typeof chains[number];
type AcrossInfrastructureChainId = AcrossInfrastructureChain["chainId"];

export type AcrossInfrastructurePreflightFailureClassification =
  | "CONFIGURATION"
  | "ACROSS_API_AUTH"
  | "ACROSS_RELEASE_DISCOVERY"
  | "ETHEREUM_RPC"
  | "ARBITRUM_RPC"
  | "BASE_RPC"
  | "ROBINHOOD_RPC"
  | "PROXY_RUNTIME_MISMATCH"
  | "IMPLEMENTATION_MISMATCH"
  | "PINNED_BLOCK_REPLACEMENT"
  | "FIREBASE_ADMIN_READ"
  | "NETWORK_TIMEOUT"
  | "UNKNOWN";

const sanitizedMessages: Record<AcrossInfrastructurePreflightFailureClassification, string> = {
  CONFIGURATION: "Required production infrastructure configuration is unavailable or unadmitted.",
  ACROSS_API_AUTH: "Across API authentication could not be verified.",
  ACROSS_RELEASE_DISCOVERY: "Across release identities could not be verified.",
  ETHEREUM_RPC: "Ethereum RPC infrastructure could not be verified.",
  ARBITRUM_RPC: "Arbitrum RPC infrastructure could not be verified.",
  BASE_RPC: "Base RPC infrastructure could not be verified.",
  ROBINHOOD_RPC: "Robinhood Chain RPC infrastructure could not be verified.",
  PROXY_RUNTIME_MISMATCH: "An Across SpokePool proxy runtime did not match reviewed evidence.",
  IMPLEMENTATION_MISMATCH: "An Across SpokePool implementation did not match reviewed evidence.",
  PINNED_BLOCK_REPLACEMENT: "A pinned Across evidence block changed during verification.",
  FIREBASE_ADMIN_READ: "Firebase Admin read-only connectivity could not be verified.",
  NETWORK_TIMEOUT: "An infrastructure verification request exceeded its bounded timeout.",
  UNKNOWN: "Across infrastructure verification failed without exposing internal details."
};

export class AcrossInfrastructurePreflightError extends Error {
  readonly classification: AcrossInfrastructurePreflightFailureClassification;

  constructor(classification: AcrossInfrastructurePreflightFailureClassification) {
    super(sanitizedMessages[classification]);
    this.name = "AcrossInfrastructurePreflightError";
    this.classification = classification;
  }
}

export type AcrossInfrastructureRpcObservation = {
  chainId: AcrossInfrastructureChainId;
  chainName: string;
  rpcIdentityVerified: true;
  spokePool: Address;
  proxyRuntimeHash: Hex;
  implementationAddress: Address;
  implementationRuntimeHash: Hex;
  observedBlockNumber: string;
  observedBlockHash: Hex;
  pinnedBlockHashRereadVerified: true;
};

export type AcrossInfrastructurePreflightSuccess = {
  schemaVersion: typeof ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA;
  status: "across_infrastructure_preflight_passed";
  runtime: {
    environment: "production";
    sourceCommit: string;
    deploymentId: string | null;
  };
  authenticatedApiVerified: true;
  robinhoodChainSupported: true;
  releaseDiscovery: ReturnType<typeof verifyAcrossReleaseDiscovery>;
  persistence: {
    configured: true;
    firebaseAdminReadVerified: true;
  };
  rpcObservations: AcrossInfrastructureRpcObservation[];
  walletUsed: false;
  quoteRequested: false;
  approvalRequested: false;
  transactionAttempted: false;
  serverSubmissionEnabled: false;
  observedAtMs: number;
};

export type AcrossInfrastructurePreflightFailure = {
  schemaVersion: typeof ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA;
  status: "across_infrastructure_preflight_failed";
  classification: AcrossInfrastructurePreflightFailureClassification;
  sanitizedMessage: string;
  walletUsed: false;
  quoteRequested: false;
  transactionAttempted: false;
};

type PublicDeploymentEvidence = Omit<AcrossInfrastructureRpcObservation, "chainId" | "chainName" | "rpcIdentityVerified" | "spokePool">;

export type AcrossInfrastructurePreflightDependencies = {
  observeDeployment?: (input: {
    chain: AcrossInfrastructureChain;
    expected: AcrossSpokePoolDeploymentPin;
    env: NodeJS.ProcessEnv;
  }) => Promise<PublicDeploymentEvidence>;
  firebaseAdminRead?: (env: NodeJS.ProcessEnv) => Promise<void>;
};

function timeoutFailure(cause: unknown) {
  return cause instanceof DOMException && (cause.name === "AbortError" || cause.name === "TimeoutError")
    || cause instanceof Error && /timed?\s*out|timeout/i.test(cause.message);
}

function preflightError(cause: unknown, fallback: AcrossInfrastructurePreflightFailureClassification) {
  if (cause instanceof AcrossInfrastructurePreflightError) return cause;
  if (timeoutFailure(cause)) return new AcrossInfrastructurePreflightError("NETWORK_TIMEOUT");
  return new AcrossInfrastructurePreflightError(fallback);
}

function configuredSecretValues(env: NodeJS.ProcessEnv) {
  return Object.entries(env)
    .filter(([key, value]) => Boolean(value) && /(?:API_KEY|AUTH_TOKEN|PRIVATE_KEY|PREFLIGHT_TOKEN)$/i.test(key))
    .map(([, value]) => value as string);
}

function publicSourceCommit(env: NodeJS.ProcessEnv) {
  const value = env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "";
  return /^[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : "";
}

function publicDeploymentId(env: NodeJS.ProcessEnv) {
  const value = env.VERCEL_DEPLOYMENT_ID?.trim() ?? "";
  return /^dpl_[A-Za-z0-9]+$/.test(value) ? value : null;
}

export function assertSanitizedAcrossInfrastructurePreflightResult<
  Result extends AcrossInfrastructurePreflightSuccess | AcrossInfrastructurePreflightFailure
>(
  result: Result,
  forbiddenValues: readonly string[] = []
): Result {
  const serialized = JSON.stringify(result);
  if (/authorization\s*(?:header|:)|process\.env|privateKey|apiKey|authToken/i.test(serialized)) {
    throw new AcrossInfrastructurePreflightError("UNKNOWN");
  }
  for (const value of forbiddenValues) {
    if (value.length >= 4 && serialized.includes(value)) throw new AcrossInfrastructurePreflightError("UNKNOWN");
  }
  return result;
}

export function acrossInfrastructurePreflightFailure(
  cause: unknown,
  forbiddenValues: readonly string[] = []
): AcrossInfrastructurePreflightFailure {
  const error = preflightError(cause, "UNKNOWN");
  return assertSanitizedAcrossInfrastructurePreflightResult({
    schemaVersion: ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA,
    status: "across_infrastructure_preflight_failed",
    classification: error.classification,
    sanitizedMessage: error.message,
    walletUsed: false,
    quoteRequested: false,
    transactionAttempted: false
  }, forbiddenValues);
}

export function verifyAcrossInfrastructureDeploymentEvidence(input: {
  observed: {
    proxyRuntimeHash: Hex;
    implementationAddress: Address;
    implementationRuntimeHash: Hex;
  };
  expected: AcrossSpokePoolDeploymentPin;
}) {
  if (input.observed.proxyRuntimeHash.toLowerCase() !== input.expected.proxyRuntimeHash.toLowerCase()) {
    throw new AcrossInfrastructurePreflightError("PROXY_RUNTIME_MISMATCH");
  }
  if (getAddress(input.observed.implementationAddress) !== input.expected.implementationAddress
    || input.observed.implementationRuntimeHash.toLowerCase() !== input.expected.implementationRuntimeHash.toLowerCase()) {
    throw new AcrossInfrastructurePreflightError("IMPLEMENTATION_MISMATCH");
  }
  return true;
}

async function defaultObserveDeployment(input: {
  chain: AcrossInfrastructureChain;
  expected: AcrossSpokePoolDeploymentPin;
  env: NodeJS.ProcessEnv;
}): Promise<PublicDeploymentEvidence> {
  let observed: AcrossObservedSpokePoolDeployment;
  try {
    observed = await readAcrossSpokePoolDeployment(
      input.chain.chainId,
      ACROSS_SPOKE_POOLS[input.chain.chainId],
      input.env
    );
  } catch (cause) {
    if (cause instanceof Error && /replaced Across deployment evidence/i.test(cause.message)) {
      throw new AcrossInfrastructurePreflightError("PINNED_BLOCK_REPLACEMENT");
    }
    throw preflightError(cause, input.chain.failure);
  }
  if (!observed.observedBlockNumber || !observed.observedBlockHash) {
    throw new AcrossInfrastructurePreflightError(input.chain.failure);
  }
  const proxyRuntimeHash = observed.proxyRuntimeCode === "0x" ? null : keccak256(observed.proxyRuntimeCode);
  const implementationRuntimeHash = observed.implementationRuntimeCode === "0x"
    ? null
    : keccak256(observed.implementationRuntimeCode);
  if (!proxyRuntimeHash) throw new AcrossInfrastructurePreflightError("PROXY_RUNTIME_MISMATCH");
  if (!implementationRuntimeHash) throw new AcrossInfrastructurePreflightError("IMPLEMENTATION_MISMATCH");
  verifyAcrossInfrastructureDeploymentEvidence({
    observed: {
      proxyRuntimeHash,
      implementationAddress: observed.implementationAddress,
      implementationRuntimeHash
    },
    expected: input.expected
  });
  const verified = verifyAcrossSpokePoolDeployment(
    observed,
    input.expected,
    input.chain.chainId === ROBINHOOD_MAINNET_CHAIN_ID ? "destination" : "source"
  );
  return {
    ...verified,
    observedBlockNumber: observed.observedBlockNumber,
    observedBlockHash: observed.observedBlockHash,
    pinnedBlockHashRereadVerified: true
  };
}

async function defaultFirebaseAdminRead() {
  const database = getRmtAdminFirestore();
  if (!database) throw new AcrossInfrastructurePreflightError("CONFIGURATION");
  await database.collection("__rmt_preflight__").doc("across-infrastructure").get();
}

async function fetchReleaseRecord(
  path: "/api/swap/chains" | "/api/swap/tokens",
  configuration: NonNullable<ReturnType<typeof acrossFundingConfiguration>>,
  fetchImplementation: typeof fetch
) {
  const url = new URL(path, ACROSS_API_URL);
  url.searchParams.set("integratorId", configuration.integratorId);
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${configuration.apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch (cause) {
    throw preflightError(cause, "ACROSS_RELEASE_DISCOVERY");
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AcrossInfrastructurePreflightError(
      response.status === 401 || response.status === 403 ? "ACROSS_API_AUTH" : "ACROSS_RELEASE_DISCOVERY"
    );
  }
  return body;
}

export async function runAcrossInfrastructurePreflight(input: {
  env?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  observedAtMs?: number;
  dependencies?: AcrossInfrastructurePreflightDependencies;
} = {}): Promise<AcrossInfrastructurePreflightSuccess> {
  const env = input.env ?? process.env;
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const observedAtMs = input.observedAtMs ?? Date.now();
  const configuration = acrossFundingConfiguration(env);
  if (!configuration || !acrossDedicatedRpcConfigured(env) || !hasRmtAdminConfiguration(env)) {
    throw new AcrossInfrastructurePreflightError("CONFIGURATION");
  }

  const discoveryBodies = await Promise.all([
    fetchReleaseRecord("/api/swap/chains", configuration, fetchImplementation),
    fetchReleaseRecord("/api/swap/tokens", configuration, fetchImplementation)
  ]);
  let releaseDiscovery: ReturnType<typeof verifyAcrossReleaseDiscovery>;
  try {
    releaseDiscovery = verifyAcrossReleaseDiscovery({ chains: discoveryBodies[0], tokens: discoveryBodies[1] });
  } catch (cause) {
    throw preflightError(cause, "ACROSS_RELEASE_DISCOVERY");
  }

  const observeDeployment = input.dependencies?.observeDeployment ?? defaultObserveDeployment;
  const rpcObservations = await Promise.all(chains.map(async (chain) => {
    try {
      const observation = await observeDeployment({
        chain,
        expected: configuration.deployments[chain.chainId],
        env
      });
      verifyAcrossInfrastructureDeploymentEvidence({ observed: observation, expected: configuration.deployments[chain.chainId] });
      return {
        chainId: chain.chainId,
        chainName: chain.chainName,
        rpcIdentityVerified: true,
        spokePool: ACROSS_SPOKE_POOLS[chain.chainId],
        ...observation
      } satisfies AcrossInfrastructureRpcObservation;
    } catch (cause) {
      if (cause instanceof Error && /replaced Across deployment evidence/i.test(cause.message)) {
        throw new AcrossInfrastructurePreflightError("PINNED_BLOCK_REPLACEMENT");
      }
      throw preflightError(cause, chain.failure);
    }
  }));

  const firebaseAdminRead = input.dependencies?.firebaseAdminRead ?? defaultFirebaseAdminRead;
  try {
    await firebaseAdminRead(env);
  } catch (cause) {
    throw preflightError(cause, "FIREBASE_ADMIN_READ");
  }

  return assertSanitizedAcrossInfrastructurePreflightResult({
    schemaVersion: ACROSS_INFRASTRUCTURE_PREFLIGHT_SCHEMA,
    status: "across_infrastructure_preflight_passed",
    runtime: {
      environment: "production",
      sourceCommit: publicSourceCommit(env),
      deploymentId: publicDeploymentId(env)
    },
    authenticatedApiVerified: true,
    robinhoodChainSupported: true,
    releaseDiscovery,
    persistence: {
      configured: true,
      firebaseAdminReadVerified: true
    },
    rpcObservations,
    walletUsed: false,
    quoteRequested: false,
    approvalRequested: false,
    transactionAttempted: false,
    serverSubmissionEnabled: false,
    observedAtMs
  }, configuredSecretValues(env));
}

function validPreflightToken(value: string) {
  return value.length >= 43 && value.length <= 512
    && Buffer.byteLength(value, "utf8") >= 32
    && /^[A-Za-z0-9._~-]+$/.test(value);
}

export function authorizedAcrossInfrastructurePreflightRequest(request: Request, env: NodeJS.ProcessEnv) {
  const configured = env.RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_TOKEN?.trim() ?? "";
  const supplied = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]{43,512})$/)?.[1] ?? "";
  const left = createHash("sha256").update(configured).digest();
  const right = createHash("sha256").update(supplied).digest();
  return validPreflightToken(configured) && validPreflightToken(supplied) && timingSafeEqual(left, right);
}

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  Vary: "Authorization"
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...privateHeaders, "Content-Type": "application/json; charset=utf-8" }
  });
}

async function boundedPreflight(
  runner: () => Promise<AcrossInfrastructurePreflightSuccess>,
  timeoutMs: number
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runner(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new AcrossInfrastructurePreflightError("NETWORK_TIMEOUT")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function handleAcrossInfrastructurePreflightRequest(
  request: Request,
  input: {
    env?: NodeJS.ProcessEnv;
    runPreflight?: () => Promise<AcrossInfrastructurePreflightSuccess>;
    timeoutMs?: number;
  } = {}
) {
  const env = input.env ?? process.env;
  if (env.VERCEL_ENV !== "production" || env.RMT_ACROSS_INFRASTRUCTURE_PREFLIGHT_ENABLED !== "true") {
    return jsonResponse({ error: "Not found." }, 404);
  }
  if (!authorizedAcrossInfrastructurePreflightRequest(request, env)) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }
  try {
    const result = await boundedPreflight(
      input.runPreflight ?? (() => runAcrossInfrastructurePreflight({ env })),
      input.timeoutMs ?? ROUTE_TIMEOUT_MS
    );
    return jsonResponse(result, 200);
  } catch (cause) {
    return jsonResponse(acrossInfrastructurePreflightFailure(cause, configuredSecretValues(env)), 503);
  }
}
