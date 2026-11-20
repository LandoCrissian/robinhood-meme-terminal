import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewEngineLaunches } from "../../app/_components/new-engine-launches";
import { configuredProductionDiscovery, createProductionDiscoveryHandler, parseProductionDiscovery, productionDirectory, readProductionDiscovery } from "./production-discovery";
import { curveProductionDeployment, curveProductionPins, curveProductionProfile } from "./curve-production";
import { railwayEnvironment, railwayIndexerOrigin, railwayIndexerService, railwayProject, railwayReadOnlyProfile, railwayWebsiteService } from "./indexer-origin";

const hash = (digit: string) => "0x" + digit.repeat(64);
const address = (digit: string) => "0x" + digit.repeat(40);
const now = Date.parse("2026-11-17T22:00:00.000Z");
const point = { blockNumber: "116840000", blockHash: hash("a"), timestamp: "2026-11-17T21:59:50.000Z",
  confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" };
function feed() {
  return { chainId: 4663, profile: "rmt-curve-fixed-supply-security-v2", status: "ready", observedAt: "2026-11-17T22:00:00.000Z",
    deployment: { factory: curveProductionPins.factory[0], registry: curveProductionPins.registry[0],
      blockNumber: String(curveProductionDeployment.blockNumber), blockHash: curveProductionDeployment.blockHash }, checkpoint: { ...point }, nextCursor: null,
    launches: [{ kind: "curve-launch-1b-v2", status: "created", chainId: 4663, engineVersion: 1,
      factory: curveProductionPins.factory[0], projectRegistry: curveProductionPins.registry[0], token: address("2"), initialCurve: address("3"),
      creator: address("4"), revenueLedger: address("5"), name: "New project", symbol: "NEW", projectURI: "https://example.invalid/project",
      totalSupplyWei: "1000000000000000000000000000", tokenDecimals: 18, treasury: null, treasuryShareBps: 0,
      creation: { blockNumber: "116839000", blockHash: hash("b"), timestamp: "2026-11-17T21:59:00.000Z", transactionHash: hash("c"), logIndex: 4 },
      creationFee: { amountWei: "400000000000000", refundWei: "0", recipient: curveProductionDeployment.operating, logIndex: 5 },
      // Stored ingestion checkpoints legitimately differ from today's index cursor.
      checkpoint: { ...point, blockNumber: "116839500", blockHash: hash("d"), timestamp: "2026-11-17T21:59:20.000Z" },
    }] };
}

test("production discovery binds the actual new engine and current index cursor without historical feed blending", () => {
  const evidence = parseProductionDiscovery(feed(), undefined, now);
  assert.equal(evidence.status, "ready");
  assert.equal(evidence.launches.length, 1);
  assert.equal(evidence.launches[0].checkpoint.blockNumber, point.blockNumber);
  assert.equal(productionDirectory(evidence).status, "ready");
  const directory = productionDirectory(evidence);
  if (directory.status === "ready") assert.equal(directory.freshUntil, Date.parse(point.timestamp) + 120_000);
  assert.equal(parseProductionDiscovery(feed(), address("9"), now).status, "unavailable");
  for (const change of [{ chainId: 31337 }, { profile: "v6" }, { deployment: { ...feed().deployment, factory: address("9") } },
    { deployment: { ...feed().deployment, blockHash: hash("f") } }, { launches: [{ ...feed().launches[0], kind: "historical-rmt" }] },
    { launches: [{ ...feed().launches[0], totalSupplyWei: "2000000000000000000000000000" }] },
    { launches: [...feed().launches, ...feed().launches] }, { checkpoint: { ...point, l1Finality: "verified" } },
    { checkpoint: { ...point, timestamp: "2030-01-01T00:00:00.000Z" } }]) {
    assert.equal(parseProductionDiscovery({ ...feed(), ...change }, undefined, now).status, "unavailable");
  }
});

test("stale observations remain stale and untrusted extra fields never leave public responses", () => {
  const input = feed();
  Object.assign(input.launches[0], { privateCreatorDraft: "private", credentials: "private", lifecycle: "trading-live", volume: "invented" });
  Object.assign(input.checkpoint, { bearerToken: "private" });
  Object.assign(input.launches[0].creation, { privateSession: "private" });
  const evidence = parseProductionDiscovery(input, undefined, now + 180_000);
  assert.equal(evidence.status, "stale");
  assert.doesNotMatch(JSON.stringify(evidence), /private|invented|trading-live/);
  assert.equal(parseProductionDiscovery(null, undefined, now).status, "unavailable");
});

test("authenticated Railway reads use exact-address paths and never expose credentials or follow redirects", async () => {
  let calls = 0;
  const env = { RMT_LAUNCH_HISTORY_INDEXER_URL: "https://worker.up.railway.app/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "private-bearer" };
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(String(url), "https://worker.up.railway.app/curve-launches/" + address("2"));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-bearer");
    assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
    return Response.json(feed());
  };
  const data = await readProductionDiscovery(address("2"), { env, fetch: fetcher, now });
  assert.equal(data.status, "ready"); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(data), /private-bearer|worker\.up\.railway/);
  assert.equal((await readProductionDiscovery(address("2"), { env: { ...env, RMT_LAUNCH_HISTORY_INDEXER_URL: "http://127.0.0.1:8545/" }, fetch: fetcher })).status, "unavailable");
  assert.equal(calls, 1);
});

test("authentication failure, unavailable worker, oversized data and malformed responses never become 'not registered'", async () => {
  const env = { RMT_LAUNCH_HISTORY_INDEXER_URL: "https://worker.up.railway.app/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "private-bearer" };
  const responses = [new Response("unauthorized", { status: 401 }), new Response("unavailable", { status: 503 }),
    new Response("x".repeat(65_537), { headers: { "content-type": "application/json" } }), Response.json({ launches: [] })];
  for (const response of responses) assert.equal((await readProductionDiscovery(undefined, { env, fetch: async () => response, now })).status, "unavailable");
  assert.equal((await readProductionDiscovery(undefined, { env, fetch: async () => { throw new Error("Provider outage"); } })).status, "unavailable");
});

test("private new-engine reads use only the pinned existing indexer and do not activate the public route", async () => {
  const env = { RMT_WEB_HOSTING: railwayReadOnlyProfile, RAILWAY_PROJECT_ID: railwayProject, RAILWAY_ENVIRONMENT_ID: railwayEnvironment,
    RAILWAY_SERVICE_ID: railwayWebsiteService, RMT_INDEXER_SERVICE_ID: railwayIndexerService,
    RMT_LAUNCH_HISTORY_INDEXER_URL: railwayIndexerOrigin + "/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "private-read-fixture" };
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++; assert.equal(String(url), railwayIndexerOrigin + "/curve-launches?limit=25");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-read-fixture");
    return Response.json(feed());
  };
  assert.equal((await readProductionDiscovery(undefined, { env, fetch: fetcher, now })).status, "ready");
  assert.equal(configuredProductionDiscovery(new Headers({ host: "rmt-preview.up.railway.app", "x-forwarded-proto": "https" }), env), false);
  assert.equal((await readProductionDiscovery(undefined, { env: { ...env, RAILWAY_PROJECT_ID: "wrong" }, fetch: fetcher, now })).status, "unavailable");
  assert.equal(calls, 1);
});

test("discovery requires its own exact 4663 server profile and HTTPS host; fixture activation remains separate", () => {
  const h = new Headers({ host: "www.rmtlaunch.fun", "x-forwarded-proto": "https" });
  assert.equal(configuredProductionDiscovery(h, { RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile }), true);
  assert.equal(configuredProductionDiscovery(h, {}), false);
  assert.equal(configuredProductionDiscovery(h, { RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile, RMT_CURVE_FIXTURE: "local" }), false);
  h.set("host", "deploy-preview.netlify.app");
  assert.equal(configuredProductionDiscovery(h, { RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile }), false);
});

test("stale directories retain last-known history without current inventory or an absence claim", () => {
  for (const count of [0, 1]) {
    const input = feed();
    input.launches = input.launches.slice(0, count);
    const directory = productionDirectory(parseProductionDiscovery(input, undefined, now + 180_000));
    assert.equal(directory.status, "stale");
    assert.equal("launches" in directory, false);
    const html = renderToStaticMarkup(createElement(NewEngineLaunches, { directory }));
    assert.match(html, /Launch feed stale/);
    assert.doesNotMatch(html, /lpLaunchCard|No launches yet|Creation confirmed|Active bonding curve/);
    assert.equal(html.includes("Last-known creation history (stale)"), count === 1);
    if (directory.status === "stale") assert.ok(directory.history.every((row) => row.state === "unknown"));
  }
});

test("freshness expires at the inclusive two-minute boundary", () => {
  const expires = Date.parse(point.timestamp) + 120_000;
  assert.equal(parseProductionDiscovery(feed(), undefined, expires - 1).status, "ready");
  assert.equal(parseProductionDiscovery(feed(), undefined, expires).status, "stale");
  assert.equal(parseProductionDiscovery(feed(), undefined, expires + 1).status, "stale");
  const upstreamStale = { ...feed(), status: "stale" };
  assert.equal(parseProductionDiscovery(upstreamStale, undefined, now).status, "stale");
});

test("fixed diagnostic categories separate denied credentials, rate limits, transport and invalid evidence", async () => {
  const env = { RMT_LAUNCH_HISTORY_INDEXER_URL: "https://worker.up.railway.app/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "synthetic-secret" };
  const diagnostics: unknown[] = [];
  const onDiagnostic = (diagnostic: unknown) => diagnostics.push(diagnostic);
  const cases: [number, string][] = [[401, "unauthorized"], [403, "forbidden"], [429, "rate_limited"], [503, "upstream_http"]];
  for (const [status, reason] of cases) {
    const data = await readProductionDiscovery(undefined, { env, now, onDiagnostic,
      fetch: async () => new Response("sensitive upstream body", { status }) });
    assert.equal(data.status, "unavailable");
    assert.deepEqual(diagnostics.pop(), { reason, status });
  }
  for (const [fetcher, reason] of [
    [async () => { throw new Error("synthetic-secret in private exception"); }, "network"],
    [async () => new Response("not json"), "response_body"],
    [async () => Response.json({ ...feed(), chainId: 31337, secret: "private metadata" }), "response_schema"],
    [async () => Response.json(feed()), "stale_checkpoint"],
    [async () => Response.json({ ...feed(), status: "stale" }), "stale_upstream"],
  ] as const) {
    await readProductionDiscovery(undefined, { env, now: now + 180_000, onDiagnostic, fetch: fetcher });
    assert.deepEqual(diagnostics.pop(), { reason });
  }
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret|sensitive|private|worker/);
});

test("configuration diagnostics reject missing credentials and unapproved origins without fetching", async () => {
  let calls = 0;
  const diagnostics: unknown[] = [];
  const options = { fetch: async () => { calls++; return Response.json(feed()); },
    onDiagnostic: (diagnostic: unknown) => diagnostics.push(diagnostic) };
  for (const [env, reason] of [
    [{}, "config_missing"],
    [{ RMT_LAUNCH_HISTORY_INDEXER_URL: "https://worker.up.railway.app/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "bad token" }, "credential_invalid"],
    [{ RMT_LAUNCH_HISTORY_INDEXER_URL: "http://127.0.0.1:8080/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "fixture" }, "origin_rejected"],
  ] as const) {
    assert.equal((await readProductionDiscovery(undefined, { ...options, env })).status, "unavailable");
    assert.deepEqual(diagnostics.pop(), { reason });
  }
  assert.equal(calls, 0);
});

test("new-engine HTTP status and caches fail closed for stale history and unavailable reads", async () => {
  const env = { RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile };
  const headers = { host: "www.rmtlaunch.fun", "x-forwarded-proto": "https" };
  const request = () => new Request("https://www.rmtlaunch.fun/api/launchpad/new-engine", { headers });
  for (const count of [0, 1]) {
    const input = feed();
    input.launches = input.launches.slice(0, count);
    const stale = parseProductionDiscovery(input, undefined, now + 180_000);
    const respond = createProductionDiscoveryHandler({ env, now: () => now + 180_000, read: async () => stale });
    for (const token of [undefined, address("2")]) {
      const response = await respond(request(), token);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
      assert.equal((await response.json()).status, "stale");
    }
    const head = await respond(new Request(request(), { method: "HEAD" }));
    assert.equal(head.status, 503);
    assert.equal(await head.text(), "");
  }
  const unavailable = await createProductionDiscoveryHandler({ env, read: async () => ({ status: "unavailable", launches: [] }) })(request());
  assert.equal(unavailable.status, 503);
  const current = parseProductionDiscovery(feed(), undefined, now);
  const fresh = await createProductionDiscoveryHandler({ env, now: () => now, read: async () => current })(request());
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers.get("cache-control"), "private, no-store");
  assert.match(fresh.headers.get("netlify-cdn-cache-control")!, /s-maxage=15,/);
  const empty = parseProductionDiscovery({ ...feed(), launches: [] }, undefined, now);
  const absent = await createProductionDiscoveryHandler({ env, now: () => now, read: async () => empty })(request(), address("2"));
  assert.equal(absent.status, 404);
  assert.equal(absent.headers.get("netlify-cdn-cache-control"), "no-store");
});

test("unapproved host, forwarded authority and financial writes never invoke new-engine reads", async () => {
  let reads = 0;
  const env = { RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile };
  const respond = createProductionDiscoveryHandler({ env, read: async () => { reads++; return parseProductionDiscovery(feed(), undefined, now); } });
  for (const headers of [
    { host: "preview.netlify.app", "x-forwarded-proto": "https" },
    { host: "www.rmtlaunch.fun", "x-forwarded-proto": "http" },
    { host: "www.rmtlaunch.fun", "x-forwarded-proto": "https", forwarded: "host=www.rmtlaunch.fun" },
    { host: "www.rmtlaunch.fun", "x-forwarded-proto": "https", "x-forwarded-host": "untrusted.invalid" },
  ] as Record<string, string>[]) {
    assert.equal((await respond(new Request("https://www.rmtlaunch.fun/api/launchpad/new-engine", { headers }))).status, 404);
  }
  const headers = { host: "www.rmtlaunch.fun", "x-forwarded-proto": "https" };
  for (const method of ["POST", "PUT", "DELETE"]) {
    assert.equal((await respond(new Request("https://www.rmtlaunch.fun/api/launchpad/new-engine", { headers, method }))).status, 404);
  }
  assert.equal(reads, 0);
});

test("malformed JSON, invalid UTF-8 and streamed byte overflow remain unavailable", async () => {
  const env = { RMT_LAUNCH_HISTORY_INDEXER_URL: "https://worker.up.railway.app/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "fixture" };
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(65_537)); },
    cancel() { cancelled = true; },
  });
  for (const response of [
    new Response("{", { headers: { "content-type": "application/json" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    new Response(oversized, { headers: { "content-type": "application/json" } }),
  ]) {
    const diagnostics: unknown[] = [];
    assert.equal((await readProductionDiscovery(undefined, { env, now, fetch: async () => response,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) })).status, "unavailable");
    assert.deepEqual(diagnostics, [{ reason: "response_body" }]);
  }
  assert.equal(cancelled, true);
});

test("a response that ages during the authenticated read is stale before publication", async () => {
  let at = now;
  const headers = { host: "www.rmtlaunch.fun", "x-forwarded-proto": "https" };
  const env = { RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile };
  const respond = createProductionDiscoveryHandler({ env, now: () => at, read: async () => {
    const data = parseProductionDiscovery(feed(), undefined, at);
    at = Date.parse(point.timestamp) + 120_000;
    return data;
  } });
  const response = await respond(new Request("https://www.rmtlaunch.fun/api/launchpad/new-engine", { headers }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "stale");
  assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
});

test("default operational logging is rate bounded and cannot contain an upstream secret", async () => {
  const actualNow = Date.now;
  const actualWarn = console.warn;
  let at = actualNow() + 120_000;
  const messages: unknown[] = [];
  Date.now = () => at;
  console.warn = (message: unknown) => { messages.push(message); };
  const env = { RMT_LAUNCH_HISTORY_INDEXER_URL: "https://worker.up.railway.app/", RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: "synthetic-secret" };
  try {
    const options = { env, fetch: async () => new Response("private secret diagnostic body", { status: 401 }) };
    for (let attempt = 0; attempt < 3; attempt++) await readProductionDiscovery(undefined, options);
    assert.equal(messages.length, 1);
    at += 60_000;
    await readProductionDiscovery(undefined, options);
    assert.equal(messages.length, 2);
    assert.deepEqual(messages.map((message) => JSON.parse(String(message))), [
      { event: "production_discovery_degraded", reason: "unauthorized", status: 401 },
      { event: "production_discovery_degraded", reason: "unauthorized", status: 401 },
    ]);
    assert.doesNotMatch(JSON.stringify(messages), /synthetic-secret|private secret|worker/);
  } finally {
    Date.now = actualNow;
    console.warn = actualWarn;
  }
});
