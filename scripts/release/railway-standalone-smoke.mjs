import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const base = new URL(process.env.RMT_RAILWAY_SMOKE_URL ?? "http://127.0.0.1:3340/");
assert.equal(base.protocol, "http:"); assert.equal(base.hostname, "127.0.0.1"); assert.ok(base.port); assert.equal(base.pathname, "/");
const host = "rmt-launch-website-preview.up.railway.app";
const environment = process.env.RMT_RAILWAY_SMOKE_MODE ?? "local-container";
assert.ok(["local-container", "local-next-runtime"].includes(environment));
const read = (path, init = {}) => fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(10_000),
  ...init, headers: { Host: host, "X-Forwarded-Proto": "https", ...init.headers } });
for (let i = 0; ; i++) {
  try { if ((await read("/healthz")).status === 200) break; } catch { /* Wait for this local container only. */ }
  assert.ok(i < 59, "Standalone liveness did not become available"); await new Promise(resolve => setTimeout(resolve, 1000));
}
const checked = [];
for (const path of ["/", "/create-token", "/my-launches", "/wallet", "/account/profile", "/u/review_creator", "/creator/0x0000000000000000000000000000000000000001"]) {
  const response = await read(path); assert.equal(response.status, 200, path);
  const html = await response.text(); assert.match(html, /RMT/); assert.doesNotMatch(html, /synthetic-test-only-credential/);
  if (path === "/") assert.doesNotMatch(html, /Historical registrations|Historical V4\/V6 registrations/);
  checked.push(path);
}
const sessionResponse = await read("/api/account/session"); const session = await sessionResponse.json();
assert.equal(session.authenticated, false); assert.equal(session.availability, "disabled"); assert.equal(sessionResponse.headers.get("set-cookie"), null);
assert.equal((await (await read("/api/launchpad/config")).json()).status, "disabled");
const history = await (await read("/api/launchpad/launches")).json();
assert.equal(history.chainId, 4663); assert.equal(history.status, "stale"); assert.equal(history.coverage, "verified-snapshot");
assert.equal(history.launches.length, 4); assert.equal(history.finality, "l1-unverified");
assert.equal((await read("/readyz")).status, 503, "Missing private test backend must be degraded, not live");
assert.equal((await read("/", { headers: { Host: "other.up.railway.app" } })).status, 421);
const blocked = ["/admin", "/.env", "/preview-rpc/fixture", "/wallet/mobile-review", "/api/launchpad/new-engine", "/api/launchpad/test-mobile-review"];
for (const path of blocked) assert.equal((await read(path)).status, 404, path);
const mutations = [["/api/account/nonce", "POST"], ["/api/account/verify", "POST"], ["/api/account/logout", "POST"],
  ["/api/account/profile", "PATCH"], ["/api/account/profile", "DELETE"], ["/api/account/avatar", "POST"], ["/api/account/avatar", "DELETE"],
  ["/api/launchpad/production-creation", "POST"]];
for (const [path, method] of mutations) assert.equal((await read(path, { method, headers: { Origin: "https://" + host, "Content-Type": "application/json" }, body: "{}" })).status, 404, path);
for (let i = mutations.length; i < 12; i++) assert.equal((await read("/api/account/nonce", { method: "POST" })).status, 404);
const limited = await read("/api/account/nonce", { method: "POST", headers: { "X-Real-IP": "198.51.100.42" } });
assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get("retry-after")) > 0);
const report = { status: "passed", environment, source: process.env.RMT_RAILWAY_SOURCE_SHA ?? "local", checked,
  history: { status: history.status, coverage: history.coverage, registrations: history.launches.length }, readiness: "degraded without private fixture",
  authentication: "disabled", transactions: "disabled", blocked, mutations: mutations.length,
  aggregateRateLimit: "12 mutations per minute per single container; spoofed client-IP header does not bypass", physicalDevice: "not performed" };
if (process.env.RMT_RAILWAY_SMOKE_REPORT) await writeFile(process.env.RMT_RAILWAY_SMOKE_REPORT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
