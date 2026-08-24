import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import {
  deriveExternalOriginManifestHash,
  externalOriginAdapters,
  validateExternalOriginAdapters,
  type ExternalOriginAdapterManifest,
  type ExternalOriginAdapterManifestInput
} from "./adapter-registry.js";
import {
  EXTERNAL_ORIGIN_SCHEMA_VERSION,
  loadExternalOriginConfig
} from "./config.js";
import {
  deriveExternalOriginEvidenceHash,
  type ExternalOriginEvidence
} from "./evidence.js";
import type { ExternalOriginStoreLike } from "./origin-store.js";
import { createExternalOriginServer } from "./server.js";

const readToken = "shadow-api-smoke-token-0000000000000001";
const address = "0x2222222222222222222222222222222222222222";

const manifestInput: ExternalOriginAdapterManifestInput = {
  adapterId: "smoke-v1",
  sourceId: "smoke",
  sourceName: "Smoke Launchpad",
  sourceUrl: "https://example.com/source",
  evidenceUrl: "https://example.com/evidence",
  chainId: 4663,
  evidenceContract: `0x${"1".repeat(40)}`,
  evidenceRole: "creation-factory",
  startBlock: 100n,
  runtimeCodeHash: `0x${"2".repeat(64)}`,
  evidenceEventTopic0: `0x${"3".repeat(64)}`,
  schemaVersion: EXTERNAL_ORIGIN_SCHEMA_VERSION,
  claimKinds: ["token-created"]
};
const manifest: ExternalOriginAdapterManifest = {
  ...manifestInput,
  manifestHash: deriveExternalOriginManifestHash(manifestInput)
};
assert.equal(
  deriveExternalOriginManifestHash(manifestInput),
  manifest.manifestHash
);
assert.equal(validateExternalOriginAdapters([manifest]).length, 1);

const manifestTampering: ExternalOriginAdapterManifest[] = [
  { ...manifest, sourceName: "Changed Launchpad" },
  { ...manifest, sourceUrl: "https://example.com/changed-source" },
  { ...manifest, evidenceUrl: "https://example.com/changed-evidence" },
  { ...manifest, evidenceContract: `0x${"4".repeat(40)}` },
  {
    ...manifest,
    evidenceRole: "listing-registry",
    claimKinds: ["source-listed"]
  },
  { ...manifest, startBlock: 101n },
  { ...manifest, runtimeCodeHash: `0x${"5".repeat(64)}` },
  { ...manifest, evidenceEventTopic0: `0x${"6".repeat(64)}` },
  { ...manifest, claimKinds: ["token-created", "source-listed"] }
];
for (const tampered of manifestTampering) {
  assert.throws(
    () => validateExternalOriginAdapters([tampered]),
    /manifestHash/
  );
}

const evidence: ExternalOriginEvidence = {
  chainId: 4663,
  adapterId: manifest.adapterId,
  manifestHash: manifest.manifestHash,
  claimKind: "token-created",
  token: address.toLowerCase() as `0x${string}`,
  evidenceContract: manifest.evidenceContract,
  evidenceRole: manifest.evidenceRole,
  transactionHash: `0x${"7".repeat(64)}`,
  logIndex: 1,
  transactionIndex: 2,
  blockNumber: 101n,
  blockHash: `0x${"8".repeat(64)}`,
  creator: null,
  market: null
};
assert.equal(
  deriveExternalOriginEvidenceHash(evidence),
  deriveExternalOriginEvidenceHash(evidence)
);
assert.notEqual(
  deriveExternalOriginEvidenceHash(evidence),
  deriveExternalOriginEvidenceHash({
    ...evidence,
    transactionHash: `0x${"9".repeat(64)}`
  })
);
assert.notEqual(
  deriveExternalOriginEvidenceHash(evidence),
  deriveExternalOriginEvidenceHash({
    ...evidence,
    claimKind: "source-listed",
    evidenceRole: "listing-registry"
  })
);

const baseConfig = {
  EXTERNAL_ORIGIN_DATABASE_URL:
    "postgresql://external:secret@db.example.com/external_origin",
  EXTERNAL_ORIGIN_READ_TOKEN: readToken
};
assert.equal(loadExternalOriginConfig(baseConfig).databaseSsl, true);
assert.equal(
  loadExternalOriginConfig({
    ...baseConfig,
    PGSSLMODE: "disable"
  }).databaseSsl,
  false
);
assert.throws(
  () => loadExternalOriginConfig({
    ...baseConfig,
    DATABASE_URL: baseConfig.EXTERNAL_ORIGIN_DATABASE_URL
  }),
  /must not equal DATABASE_URL/
);

let pingCalls = 0;
const store: ExternalOriginStoreLike = {
  async ping() {
    pingCalls += 1;
  },
  async adapterStates() {
    throw new Error("Activation-locked API must not read adapter state");
  },
  async originClaims() {
    throw new Error("Activation-locked API must not read origin claims");
  }
};

assert.equal(externalOriginAdapters.length, 0);

const server = createExternalOriginServer({ store, readToken });
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const serverAddress = server.address();
if (!serverAddress || typeof serverAddress === "string") {
  throw new Error("External-origin API smoke server did not bind");
}
const baseUrl = `http://127.0.0.1:${(serverAddress as AddressInfo).port}`;
const authorization = { Authorization: `Bearer ${readToken}` };

async function json(response: Response) {
  return response.json() as Promise<unknown>;
}

try {
  const health = await fetch(baseUrl + "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await json(health), {
    ok: true,
    mode: "shadow",
    chainId: 4663,
    servingProductionTraffic: false,
    attributionReady: false,
    coverage: "unavailable",
    configuredAdapters: 0,
    enabledAdapters: 0,
    readyAdapters: 0,
    error: null
  });

  const ready = await fetch(baseUrl + "/ready");
  assert.equal(ready.status, 503);
  assert.equal((await json(ready) as { ready?: unknown }).ready, false);

  const missingAuth = await fetch(
    baseUrl + "/v1/origins?tokens=" + address
  );
  assert.equal(missingAuth.status, 401);

  const wrongAuth = await fetch(
    baseUrl + "/v1/origins?tokens=" + address,
    { headers: { Authorization: "Bearer " + "x".repeat(40) } }
  );
  assert.equal(wrongAuth.status, 401);

  const malformedUrls = [
    "/v1/origins",
    "/v1/origins?tokens=",
    "/v1/origins?tokens=not-an-address",
    "/v1/origins?tokens=%20" + address,
    "/v1/origins?tokens=" + address + "&tokens=" + address,
    "/v1/origins?tokens=" + address + "&limit=1",
    "/v1/origins?tokens=" +
      Array.from({ length: 101 }, () => address).join(",")
  ];
  for (const path of malformedUrls) {
    const response = await fetch(baseUrl + path, {
      headers: authorization
    });
    assert.equal(response.status, 400, path);
  }

  const valid = await fetch(
    baseUrl + "/v1/origins?tokens=" + address,
    { headers: authorization }
  );
  assert.equal(valid.status, 200);
  assert.deepEqual(await json(valid), {
    chainId: 4663,
    mode: "shadow",
    authoritative: false,
    coverage: "unavailable",
    enabledAdapters: [],
    claims: [],
    indexedThrough: null
  });

  const noLaunchesRoute = await fetch(baseUrl + "/launches");
  assert.equal(noLaunchesRoute.status, 404);

  const wrongMethod = await fetch(baseUrl + "/health", {
    method: "POST"
  });
  assert.equal(wrongMethod.status, 405);

  assert.equal(pingCalls, 3);
  console.info("External-origin API smoke test passed.");
} finally {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}


const lockedAdapterServer = createExternalOriginServer({
  store,
  readToken,
  adapters: [manifest]
});
await new Promise<void>((resolve, reject) => {
  lockedAdapterServer.once("error", reject);
  lockedAdapterServer.listen(0, "127.0.0.1", resolve);
});
const lockedAddress = lockedAdapterServer.address();
if (!lockedAddress || typeof lockedAddress === "string") {
  throw new Error("Locked-adapter API smoke server did not bind");
}
const lockedBaseUrl =
  `http://127.0.0.1:${(lockedAddress as AddressInfo).port}`;

try {
  const health = await fetch(lockedBaseUrl + "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await json(health), {
    ok: true,
    mode: "shadow",
    chainId: 4663,
    servingProductionTraffic: false,
    attributionReady: false,
    coverage: "unavailable",
    configuredAdapters: 1,
    enabledAdapters: 0,
    readyAdapters: 0,
    error: "activation_locked"
  });

  const ready = await fetch(lockedBaseUrl + "/ready");
  assert.equal(ready.status, 503);
  assert.deepEqual(await json(ready), {
    ok: true,
    mode: "shadow",
    chainId: 4663,
    servingProductionTraffic: false,
    attributionReady: false,
    coverage: "unavailable",
    configuredAdapters: 1,
    enabledAdapters: 0,
    readyAdapters: 0,
    error: "activation_locked",
    ready: false,
    reason: "activation_locked"
  });

  const origin = await fetch(
    lockedBaseUrl + "/v1/origins?tokens=" + address,
    { headers: authorization }
  );
  assert.equal(origin.status, 200);
  assert.deepEqual(await json(origin), {
    chainId: 4663,
    mode: "shadow",
    authoritative: false,
    coverage: "unavailable",
    enabledAdapters: [],
    claims: [],
    indexedThrough: null
  });

  assert.equal(pingCalls, 6);
  console.info("Activation lock synthetic-adapter test passed.");
} finally {
  await new Promise<void>((resolve) => {
    lockedAdapterServer.close(() => resolve());
    lockedAdapterServer.closeIdleConnections();
  });
}
