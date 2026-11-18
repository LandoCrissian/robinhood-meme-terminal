import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateRailwayRuntime } from "../../apps/launch-website/railway-start.mjs";
const env = { RMT_WEB_HOSTING: "railway-read-only-v1", RAILWAY_PROJECT_ID: "19587a6e-6f02-4cfa-b7db-f308934f697b",
  RAILWAY_ENVIRONMENT_ID: "539a42da-fb60-420f-b9fa-8c29af25ebbe", RAILWAY_PUBLIC_DOMAIN: "rmt-preview.up.railway.app",
  RAILWAY_SERVICE_ID: "8e9c1c15-74b5-4262-8851-72603a3dfc98", RMT_INDEXER_SERVICE_ID: "27b1aa2c-77e5-4ed4-91a1-1951d68c488e",
  RMT_LAUNCH_HISTORY_INDEXER_URL: "http://robinhood-meme-terminal.railway.internal:3001/",
  RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "synthetic-test-only-credential" };
test("standalone start requires the existing project's private reader and preview identity", () => {
  assert.deepEqual(validateRailwayRuntime(env), { origin: "https://rmt-preview.up.railway.app", port: 3000, profile: "railway-read-only-v1" });
  for (const key of Object.keys(env)) assert.throws(() => validateRailwayRuntime({ ...env, [key]: "incorrect" }));
  for (const port of ["0", "65536", "3000;bad", "-1"]) assert.throws(() => validateRailwayRuntime({ ...env, PORT: port }));
  assert.throws(() => validateRailwayRuntime({ ...env, RMT_WEB_ORIGIN: "https://www.rmtlaunch.fun" }));
});
test("activation, emulator, signing and direct database configuration are not part of this read-only process", () => {
  for (const key of ["RMT_CURVE_PRODUCTION_EXECUTION", "RMT_CURVE_PRODUCTION_DISCOVERY", "RMT_PROFILES_MODE", "RMT_MOBILE_REVIEW_FIXTURE",
    "FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "RMT_FIREBASE_WEB_API_KEY", "DATABASE_URL", "DEPLOYER_PRIVATE_KEY"]) {
    assert.throws(() => validateRailwayRuntime({ ...env, [key]: "sensitive-marker" }));
  }
});
test("Railway runs exactly one standalone web process and health probes do not depend on database migration", async () => {
  const config = JSON.parse(await readFile(new URL("../../apps/launch-website/railway-settings.json", import.meta.url)));
  assert.equal(config.numReplicas, 1); assert.equal(config.healthcheckPath, "/healthz");
  assert.equal(config.startCommand, "node apps/launch-website/railway-start.mjs");
  assert.equal(config.dockerfilePath, "apps/launch-website/Dockerfile");
  assert.equal(config.preDeployCommand, undefined);
  assert.equal(config.serviceId, env.RAILWAY_SERVICE_ID);
  const dockerfile = await readFile(new URL("../../apps/launch-website/Dockerfile", import.meta.url), "utf8");
  assert.ok(!dockerfile.includes("NETLIFY_AUTH_TOKEN") && !dockerfile.includes("DATABASE_URL"));
  assert.ok(dockerfile.includes("USER node"));
});
