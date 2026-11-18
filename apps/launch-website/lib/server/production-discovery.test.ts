import assert from "node:assert/strict";
import test from "node:test";
import { configuredProductionDiscovery, parseProductionDiscovery, productionDirectory, readProductionDiscovery } from "./production-discovery";
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
