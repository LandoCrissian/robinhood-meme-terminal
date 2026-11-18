import assert from "node:assert/strict";
import test from "node:test";
import { indexerOrigin, railwayEnvironment, railwayIndexerOrigin, railwayProject, railwayReadOnlyProfile, railwayWebsiteOrigin } from "./indexer-origin";
import { createRailwayRequestBudget, railwayHosting } from "./railway-read-only";

const env = { RMT_WEB_HOSTING: railwayReadOnlyProfile, RAILWAY_PROJECT_ID: railwayProject,
  RAILWAY_ENVIRONMENT_ID: railwayEnvironment, RAILWAY_PUBLIC_DOMAIN: "stale-provider-metadata.up.railway.app", RMT_WEB_ORIGIN: railwayWebsiteOrigin,
  RAILWAY_SERVICE_ID: "8e9c1c15-74b5-4262-8851-72603a3dfc98", RMT_INDEXER_SERVICE_ID: "27b1aa2c-77e5-4ed4-91a1-1951d68c488e" };
test("private read origin requires the exact existing backend, port, project and environment", () => {
  assert.equal(indexerOrigin(railwayIndexerOrigin + "/", env)?.origin, railwayIndexerOrigin);
  for (const url of ["http://127.0.0.1:8080/", "http://169.254.169.254/", "http://other.railway.internal:8080/",
    "http://robinhood-meme-terminal.railway.internal:3000/", "http://robinhood-meme-terminal.railway.internal:3001/",
    railwayIndexerOrigin + "/admin", railwayIndexerOrigin + "/?token=x",
    "http://user:password@robinhood-meme-terminal.railway.internal:8080/", railwayIndexerOrigin + "/#x"]) assert.equal(indexerOrigin(url, env), null);
  for (const key of ["RMT_WEB_HOSTING", "RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID", "RMT_INDEXER_SERVICE_ID"]) assert.equal(indexerOrigin(railwayIndexerOrigin + "/", { ...env, [key]: "incorrect" }), null);
  assert.equal(indexerOrigin(railwayIndexerOrigin + "/", {}), null);
  assert.equal(indexerOrigin("https://history.example/")?.origin, "https://history.example");
});
test("Railway request authority admits only the assigned preview origin", () => {
  assert.deepEqual(railwayHosting(env), { origin: railwayWebsiteOrigin });
  for (const field of ["RMT_WEB_HOSTING", "RAILWAY_PROJECT_ID", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_SERVICE_ID", "RMT_WEB_ORIGIN"]) assert.equal(railwayHosting({ ...env, [field]: "incorrect" }), null);
  assert.equal(railwayHosting({ ...env, RMT_WEB_ORIGIN: "https://www.rmtlaunch.fun" }), null);
  assert.equal(railwayHosting({ ...env, RMT_WEB_ORIGIN: undefined }), null);
  assert.equal(railwayHosting({ ...env, RMT_WEB_ORIGIN: "https://other.up.railway.app" }), null);
  assert.deepEqual(railwayHosting({ ...env, RAILWAY_PUBLIC_DOMAIN: "other.up.railway.app" }), { origin: railwayWebsiteOrigin });
});
test("single-process request budgets cannot be bypassed by changing IP headers, bound memory and expire", () => {
  let now = 120_000; const admit = createRailwayRequestBudget(() => now);
  for (let i = 0; i < 12; i++) assert.equal(admit("/api/account/nonce", "POST").allowed, true);
  assert.deepEqual(admit("/api/account/profile", "PATCH"), { allowed: false, retryAfter: 60 });
  for (let i = 0; i < 120; i++) assert.equal(admit("/api/launchpad/creation-review", "POST").allowed, true);
  assert.equal(admit("/api/launchpad/creation-review", "POST").allowed, false);
  for (let i = 0; i < 600; i++) assert.equal(admit("/api/launchpad/launches", "GET").allowed, true);
  assert.equal(admit("/", "HEAD").allowed, false);
  assert.equal(admit("/healthz", "GET").allowed, true);
  assert.equal(admit("/_next/static/app.js", "GET").allowed, true);
  now += 60_000; assert.equal(admit("/api/account/avatar", "DELETE").allowed, true); assert.equal(admit("/", "GET").allowed, true);
});
