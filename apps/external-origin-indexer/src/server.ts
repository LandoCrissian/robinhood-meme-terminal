import { createHash, timingSafeEqual } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from "node:http";
import {
  externalOriginAdapters,
  validateExternalOriginAdapters,
  type ExternalOriginAdapterManifest
} from "./adapter-registry.js";
import {
  EXTERNAL_ORIGIN_CHAIN_ID,
  EXTERNAL_ORIGIN_SCHEMA_VERSION
} from "./config.js";
import type {
  ExternalAdapterState,
  ExternalOriginStoreLike
} from "./origin-store.js";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const MAX_TOKENS = 100;

type ServiceReadiness = {
  ok: boolean;
  attributionReady: boolean;
  coverage: "complete" | "unavailable";
  configuredAdapters: number;
  enabledAdapters: number;
  readyAdapters: number;
  readyManifests: readonly ExternalOriginAdapterManifest[];
  readyStates: readonly ExternalAdapterState[];
  error: string | null;
};

export type CreateExternalOriginServerOptions = {
  store: ExternalOriginStoreLike;
  readToken: string;
  adapters?: readonly ExternalOriginAdapterManifest[];
};

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {}
) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body).toString(),
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders
  });
  response.end(body);
}

function hasValidBearer(request: IncomingMessage, expectedToken: string) {
  const header = request.headers.authorization;
  if (!header || header.length > 1_024) return false;

  const match = /^Bearer ([A-Za-z0-9._~+/=-]+)$/i.exec(header);
  if (!match?.[1]) return false;

  const received = createHash("sha256")
    .update(match[1], "utf8")
    .digest();
  const expected = createHash("sha256")
    .update(expectedToken, "utf8")
    .digest();
  return timingSafeEqual(received, expected);
}

function parseTokens(url: URL) {
  if ([...url.searchParams.keys()].some((name) => name !== "tokens")) {
    throw new Error("tokens is the only supported query parameter");
  }

  const values = url.searchParams.getAll("tokens");
  if (values.length !== 1 || values[0] === undefined) {
    throw new Error("tokens must be supplied exactly once");
  }

  const tokens = values[0].split(",");
  if (tokens.length < 1 || tokens.length > MAX_TOKENS) {
    throw new Error("tokens must contain between 1 and 100 addresses");
  }
  if (tokens.some((token) => !ADDRESS_PATTERN.test(token))) {
    throw new Error("tokens must contain exact EVM addresses");
  }

  return [...new Set(tokens.map((token) => token.toLowerCase()))];
}

function stateMatchesManifest(
  state: ExternalAdapterState | undefined,
  manifest: ExternalOriginAdapterManifest
) {
  return Boolean(
    state &&
      state.status === "ready" &&
      state.nextBlock !== manifest.startBlock.toString() &&
      state.lastSyncAt !== null &&
      state.lastError === null &&
      state.sourceId === manifest.sourceId &&
      state.sourceName === manifest.sourceName &&
      state.factory === manifest.factory.toLowerCase() &&
      state.startBlock === manifest.startBlock.toString() &&
      state.manifestHash === manifest.manifestHash.toLowerCase() &&
      state.schemaVersion === manifest.schemaVersion
  );
}

async function serviceReadiness(
  store: ExternalOriginStoreLike,
  adapters: readonly ExternalOriginAdapterManifest[]
): Promise<ServiceReadiness> {
  const configuredAdapters = adapters.length;
  const enabledAdapters = adapters.length;

  try {
    await store.ping();
    const states = await store.adapterStates(
      adapters.map((adapter) => adapter.adapterId)
    );
    const statesById = new Map(
      states.map((state) => [state.adapterId, state])
    );
    const readyManifests = adapters.filter((manifest) =>
      stateMatchesManifest(statesById.get(manifest.adapterId), manifest)
    );
    const readyStates = readyManifests.flatMap((manifest) => {
      const state = statesById.get(manifest.adapterId);
      return state ? [state] : [];
    });
    const attributionReady =
      enabledAdapters > 0 && readyManifests.length === enabledAdapters;

    return {
      ok: true,
      attributionReady,
      coverage: attributionReady ? "complete" : "unavailable",
      configuredAdapters,
      enabledAdapters,
      readyAdapters: readyManifests.length,
      readyManifests,
      readyStates,
      error:
        enabledAdapters > 0 && !attributionReady
          ? "attribution_not_ready"
          : null
    };
  } catch {
    return {
      ok: false,
      attributionReady: false,
      coverage: "unavailable",
      configuredAdapters,
      enabledAdapters,
      readyAdapters: 0,
      readyManifests: [],
      readyStates: [],
      error: "database_unavailable"
    };
  }
}

function publicHealth(readiness: ServiceReadiness) {
  return {
    ok: readiness.ok,
    mode: "shadow",
    chainId: EXTERNAL_ORIGIN_CHAIN_ID,
    servingProductionTraffic: false,
    attributionReady: readiness.attributionReady,
    coverage: readiness.coverage,
    configuredAdapters: readiness.configuredAdapters,
    enabledAdapters: readiness.enabledAdapters,
    readyAdapters: readiness.readyAdapters,
    error: readiness.error
  };
}

function adapterSummaries(
  manifests: readonly ExternalOriginAdapterManifest[]
) {
  return manifests.map((manifest) => ({
    adapterId: manifest.adapterId,
    sourceId: manifest.sourceId,
    sourceName: manifest.sourceName,
    sourceUrl: manifest.sourceUrl,
    evidenceUrl: manifest.evidenceUrl,
    factory: manifest.factory.toLowerCase(),
    manifestHash: manifest.manifestHash.toLowerCase(),
    schemaVersion: manifest.schemaVersion
  }));
}

function indexedThrough(states: readonly ExternalAdapterState[]) {
  if (states.length === 0) return null;

  let minimum: bigint | null = null;
  for (const state of states) {
    const value = BigInt(state.nextBlock) - 1n;
    if (minimum === null || value < minimum) minimum = value;
  }
  return minimum?.toString() ?? null;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<CreateExternalOriginServerOptions>
) {
  const url = new URL(request.url ?? "/", "http://external-origin.local");
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "method_not_allowed" }, {
      Allow: "GET"
    });
    return;
  }

  if (url.pathname === "/health") {
    const readiness = await serviceReadiness(
      options.store,
      options.adapters
    );
    sendJson(response, readiness.ok ? 200 : 503, publicHealth(readiness));
    return;
  }

  if (url.pathname === "/ready") {
    const readiness = await serviceReadiness(
      options.store,
      options.adapters
    );
    const ready = readiness.ok && readiness.attributionReady;
    sendJson(response, ready ? 200 : 503, {
      ...publicHealth(readiness),
      ready,
      reason: ready
        ? null
        : readiness.error ?? "no_verified_adapters"
    });
    return;
  }

  if (url.pathname !== "/v1/origins") {
    sendJson(response, 404, { error: "not_found" });
    return;
  }

  if (!hasValidBearer(request, options.readToken)) {
    sendJson(
      response,
      401,
      { error: "unauthorized" },
      { "WWW-Authenticate": 'Bearer realm="external-origin-indexer"' }
    );
    return;
  }

  let tokens: string[];
  try {
    tokens = parseTokens(url);
  } catch (error) {
    sendJson(response, 400, {
      error: "invalid_tokens",
      message: error instanceof Error ? error.message : "Invalid tokens"
    });
    return;
  }

  const readiness = await serviceReadiness(
    options.store,
    options.adapters
  );
  if (!readiness.ok) {
    sendJson(response, 503, {
      chainId: EXTERNAL_ORIGIN_CHAIN_ID,
      mode: "shadow",
      authoritative: false,
      coverage: "unavailable",
      enabledAdapters: [],
      claims: [],
      indexedThrough: null,
      error: readiness.error
    });
    return;
  }

  const activeManifests = readiness.attributionReady
    ? readiness.readyManifests
    : [];
  const activeAdapterIds = activeManifests.map(
    (manifest) => manifest.adapterId
  );
  const claims = await options.store.originClaims(tokens, activeAdapterIds);

  sendJson(response, 200, {
    chainId: EXTERNAL_ORIGIN_CHAIN_ID,
    mode: "shadow",
    authoritative: readiness.attributionReady,
    coverage: readiness.coverage,
    enabledAdapters: adapterSummaries(activeManifests),
    claims: readiness.attributionReady ? claims : [],
    indexedThrough: readiness.attributionReady
      ? indexedThrough(readiness.readyStates)
      : null
  });
}

export function createExternalOriginServer(
  options: CreateExternalOriginServerOptions
): Server {
  const tokenBytes = Buffer.byteLength(options.readToken, "utf8");
  if (tokenBytes < 32 || tokenBytes > 512) {
    throw new Error("readToken must contain 32 to 512 bytes");
  }

  const adapters = validateExternalOriginAdapters(
    options.adapters ?? (
      externalOriginAdapters as readonly ExternalOriginAdapterManifest[]
    )
  );
  const completeOptions: Required<CreateExternalOriginServerOptions> = {
    ...options,
    adapters
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response, completeOptions).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "internal_error" });
      } else {
        response.destroy();
      }
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}
