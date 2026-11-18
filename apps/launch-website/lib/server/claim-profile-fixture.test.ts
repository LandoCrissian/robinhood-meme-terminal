import assert from "node:assert/strict";
import test from "node:test";
import { configuredClaimProfileFixture, handleTestClaimProfile, readClaimProfileBody } from "./claim-profile-fixture";
import { handleProductionEarningsClaim } from "./earnings-claims";

test("profile fixture stays unavailable without its complete local manifest and hosted environments cannot activate it", async () => {
  const old = process.env.RMT_CLAIM_PROFILES_FIXTURE, cloud = process.env.NETLIFY;
  try {
    for (const flag of [undefined, "", "true", "local-reviewed-claims-31337-v1"]) {
      if (flag === undefined) delete process.env.RMT_CLAIM_PROFILES_FIXTURE; else process.env.RMT_CLAIM_PROFILES_FIXTURE = flag;
      for (const url of ["https://www.rmtlaunch.fun/api/launchpad/test-claim-profiles", "http://127.0.0.1:3555/api/launchpad/test-claim-profiles"]) {
        const req = new Request(url, { method: "POST", headers: { Host: new URL(url).host, Origin: new URL(url).origin }, body: JSON.stringify({ action: "prepare" }) });
        const response = await handleTestClaimProfile(req); assert.equal(response.status, 404);
        assert.equal((await response.json()).executionEnabled, false);
      }
    }
    process.env.NETLIFY = "true";
    assert.equal(configuredClaimProfileFixture(new Headers({ Host: "127.0.0.1:3555", Origin: "http://127.0.0.1:3555" })), null);
    const production = await handleProductionEarningsClaim(new Request("https://www.rmtlaunch.fun/api/launchpad/production-earnings", { method: "POST" }));
    assert.equal(production.status, 404); assert.equal((await production.json()).executionEnabled, false);
  } finally {
    if (old === undefined) delete process.env.RMT_CLAIM_PROFILES_FIXTURE; else process.env.RMT_CLAIM_PROFILES_FIXTURE = old;
    if (cloud === undefined) delete process.env.NETLIFY; else process.env.NETLIFY = cloud;
  }
});
test("profile body reader bounds bytes, JSON type and UTF-8 without accepting supplied execution authority", async () => {
  const stream = (bytes: Uint8Array) => new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const encoder = new TextEncoder();
  assert.deepEqual(await readClaimProfileBody(stream(encoder.encode('{"action":"verify"}'))), { action: "verify" });
  for (const raw of ["[]", "null", "true", "", "{" , JSON.stringify({ review: "x".repeat(32768) })]) {
    await assert.rejects(readClaimProfileBody(stream(encoder.encode(raw))));
  }
  await assert.rejects(readClaimProfileBody(stream(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]))));
});
