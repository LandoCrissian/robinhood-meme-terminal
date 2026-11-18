import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { checkWebsiteSource, checkFunctionManifest, checkEdgeManifest } from "./website-preflight.mjs";

const toml = await readFile(new URL("../../netlify.toml", import.meta.url), "utf8");
const candidate = { toml, packageManager: "pnpm@10.12.1", nextVersion: "15.5.29" };

test("read-only source acceptance never grants production publication or execution", () => {
  const result = checkWebsiteSource(candidate);
  assert.equal(result.verification, "passed");
  assert.equal(result.publication, "BLOCKED_OWNER_APPROVAL");
  assert.equal(result.execution, "BLOCKED_NO_BROADCAST");
  assert.equal(result.readApi.mode, "snapshot-only");
  assert.equal(checkWebsiteSource({ ...candidate, toml: toml.replace("process.exit(1)", "process.exit(0)") }).verification, "failed");
  assert.equal(checkWebsiteSource({ ...candidate, toml: toml.replace("process.exit(1)", "process.exit(1) || true") }).verification, "failed");
  assert.equal(checkWebsiteSource({ ...candidate, nextVersion: "15.5.30" }).verification, "failed", "A different build must be explicitly reviewed");
});

test("activation, hosted emulators and public admin secrets fail closed without disclosing values", () => {
  for (const key of ["RMT_PROFILES_MODE", "RMT_PROFILES_ACTIVATION_APPROVAL", "RMT_CURVE_PRODUCTION_EXECUTION", "RMT_CURVE_FIXTURE",
    "FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST", "NEXT_PUBLIC_FIREBASE_SERVICE_ACCOUNT_JSON"]) {
    const marker = "synthetic-sensitive-value-not-for-reporting";
    const result = checkWebsiteSource({ ...candidate, env: { [key]: marker } });
    assert.equal(result.verification, "failed", key);
    assert.ok(!JSON.stringify(result).includes(marker));
  }
});

test("Railway credential continuity is explicit; absent listing is not proof of a missing live runtime credential", () => {
  const marker = "synthetic-read-credential";
  const both = checkWebsiteSource({ ...candidate, env: { RMT_LAUNCH_HISTORY_INDEXER_URL: "https://example.invalid/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: marker } });
  assert.equal(both.verification, "passed");
  assert.match(both.readApi.publicationRequirement, /deploy-scoped/);
  assert.ok(!JSON.stringify(both).includes(marker));
  assert.equal(checkWebsiteSource({ ...candidate, env: { RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: marker } }).verification, "failed");
  assert.equal(checkWebsiteSource({ ...candidate, env: { RMT_LAUNCH_HISTORY_INDEXER_URL: "http://example.invalid/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: marker } }).verification, "failed");
});

test("Linux server acceptance rejects Windows packaging, changed adapters and missing SSR routes", () => {
  const fixture = { system: { platform: "linux" }, functions: [{ name: "___netlify-server-handler", generator: "@netlify/plugin-nextjs@5.16.8",
    runtimeVersion: "nodejs22.x", invocationMode: "stream", routes: [{ pattern: "/*", prefer_static: true }] }] };
  assert.equal(checkFunctionManifest(fixture).platform, "linux");
  assert.throws(() => checkFunctionManifest({ ...fixture, system: { platform: "win32" } }));
  assert.throws(() => checkFunctionManifest({ ...fixture, functions: [{ ...fixture.functions[0], generator: "@netlify/plugin-nextjs@5.16.9" }] }));
  assert.throws(() => checkFunctionManifest({ ...fixture, functions: [{ ...fixture.functions[0], routes: [] }] }));
});

test("both existing native edge budgets and their identity routes must survive packaging", () => {
  const rule = (budget) => ({ traffic_rules: { action: { type: "rate_limit", config: {
    rate_limit_config: { window_limit: budget, window_size: 60, algorithm: "sliding_window" }, aggregate: { keys: [{ type: "ip" }, { type: "domain" }] } } } } });
  const manifest = { function_config: { "___netlify-edge-handler-middleware": { generator: "@netlify/plugin-nextjs@5.16.8" },
    "launch-creation-limit": rule(12), "launch-discovery-limit": rule(120) }, routes: [
      { function: "launch-creation-limit", path: "/api/account/nonce" }, { function: "launch-creation-limit", path: "/api/launchpad/production-creation" },
      { function: "launch-discovery-limit", path: "/api/launchpad/new-engine" }, { function: "launch-discovery-limit", path: "/api/account/session" }] };
  assert.equal(checkEdgeManifest(manifest).nativeRules.length, 2);
  assert.throws(() => checkEdgeManifest({ ...manifest, function_config: { ...manifest.function_config, "launch-creation-limit": rule(1200) } }));
  assert.throws(() => checkEdgeManifest({ ...manifest, routes: manifest.routes.slice(1) }));
});
