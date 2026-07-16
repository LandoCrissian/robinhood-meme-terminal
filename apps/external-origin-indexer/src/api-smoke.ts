import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { externalOriginAdapters } from "./adapter-registry.js";
import type {
  ExternalOriginStoreLike,
  StoredExternalOriginClaim
} from "./origin-store.js";
import { createExternalOriginServer } from "./server.js";

const readToken = "shadow-api-smoke-token-0000000000000001";
const address = "0xdBa33be56C89CC9fc014c4459028d7e5c7878671";

let pingCalls = 0;
let claimCalls = 0;
const store: ExternalOriginStoreLike = {
  async ping() {
    pingCalls += 1;
  },
  async adapterStates(adapterIds) {
    assert.deepEqual(adapterIds, []);
    return [];
  },
  async originClaims(tokens, adapterIds): Promise<StoredExternalOriginClaim[]> {
    claimCalls += 1;
    assert.deepEqual(tokens, [address.toLowerCase()]);
    assert.deepEqual(adapterIds, []);
    return [];
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
  assert.equal(claimCalls, 1);
  console.info("External-origin API smoke test passed.");
} finally {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}
