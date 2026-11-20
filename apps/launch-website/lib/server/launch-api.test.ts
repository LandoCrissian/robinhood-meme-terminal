import assert from "node:assert/strict";
import test from "node:test";
import { createLaunchHistoryHandler } from "./launch-api";
import { indexedFreshnessMs } from "./launch-data";
import type { LaunchDirectoryData } from "../launch-data";
import { creationReviewPath } from "../launch-draft";
import { config as edge } from "../../netlify/edge-functions/launch-discovery-limit";

const now = Date.UTC(2026, 10, 14, 5, 0);
const token = "0x" + "b".repeat(40);
const url = new URL("https://rmt.example/api/launchpad/launches");
const evidence: LaunchDirectoryData = {
  chainId: 4663, status: "ready", coverage: "v6-indexed", future: "prelaunch", finality: "l1-unverified",
  observedAt: new Date(now).toISOString(),
  checkpoint: { blockNumber: "42", blockHash: "0x" + "a".repeat(64), timestamp: new Date(now - 20_000).toISOString() },
  launches: [], truncated: false,
};

test("CDN caching is short, public, query-sensitive and separate from client caching", async () => {
  const respond = createLaunchHistoryHandler(async () => evidence, () => now);
  const response = await respond(new Request(url));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "public, durable, s-maxage=15, must-revalidate");
  assert.equal(response.headers.get("netlify-vary"), "query");
  assert.deepEqual(await response.json(), evidence);
  const head = await respond(new Request(url, { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("netlify-cdn-cache-control"), "no-store");
  assert.equal(await head.text(), "");
});

test("cache expires before uncertain freshness and serves the checked snapshot with stale label", async () => {
  const older = { ...evidence.checkpoint!, timestamp: new Date(now - indexedFreshnessMs + 10_000).toISOString() };
  const freshBorder = await createLaunchHistoryHandler(async () => ({ ...evidence, checkpoint: older }), () => now)(new Request(url));
  assert.match(freshBorder.headers.get("netlify-cdn-cache-control")!, /s-maxage=5(?:,|$)/);
  const stale = await createLaunchHistoryHandler(async () => ({ ...evidence, status: "stale" }), () => now)(new Request(url));
  assert.equal(stale.headers.get("netlify-cdn-cache-control"), "no-store");
  const snapshot = await createLaunchHistoryHandler(async () => ({ ...evidence, coverage: "verified-snapshot", status: "stale" }), () => now)(new Request(url));
  assert.equal(snapshot.headers.get("netlify-cdn-cache-control"), "no-store");
  assert.equal((await snapshot.json()).status, "stale");
});

test("invalid, missing, unavailable and write requests are never shared", async () => {
  let reads = 0;
  const read = async () => { reads++; return evidence; };
  const respond = createLaunchHistoryHandler(read, () => now);
  const invalid = await respond(new Request(url.href + "?token=" + token));
  assert.equal(invalid.status, 400);
  const post = await respond(new Request(url, { method: "POST" }));
  assert.equal(post.status, 405);
  assert.equal(reads, 0);
  const unknown = await respond(new Request(url), token);
  assert.equal(unknown.status, 404);
  const unavailable = await createLaunchHistoryHandler(async () => ({ ...evidence, status: "unavailable" }))(new Request(url));
  assert.equal(unavailable.status, 503);
  for (const response of [invalid, post, unknown, unavailable]) {
    assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
  }
});

test("one native per-IP read rule covers history, draft review and public profiles", () => {
  // Netlify URLPattern named segments also limit invalid address requests;
  // middleware and handlers remain responsible for rejecting those identities.
  const limited = (pathname: string) => edge.path.some((pattern) => new RegExp("^" + pattern.replace(/:[a-z]+/g, "[^/]+") + "/?$").test(pathname));
  for (const pathname of [url.pathname, url.pathname + "/" + token, "/launches/" + token, "/", creationReviewPath,
    "/u/creator_one", "/creator/" + token, "/api/account/public/creator_one", "/api/account/creator/" + token,
    "/api/account/avatar/" + token, "/api/account/session", "/api/launchpad/launches/random"]) assert.equal(limited(pathname), true);
  for (const rejected of ["/rmt", "/wallet", "/api/launchpad/config", "/launches/" + token + "/admin",
    creationReviewPath + "/extra", "/api/launchpad/curve"]) {
    assert.equal(limited(rejected), false);
  }
  assert.deepEqual(edge.rateLimit, { windowSize: 60, windowLimit: 120, aggregateBy: ["ip", "domain"] });
});

test("stale historical absence remains unavailable instead of a definitive missing token", async () => {
  const response = await createLaunchHistoryHandler(async () => ({ ...evidence, status: "stale" }), () => now)(new Request(url), token);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
});
