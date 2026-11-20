import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createServer as createHttpsServer, get as httpsGet } from "node:https";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { curveProductionConfig } from "../../apps/indexer/src/curve-production-config.js";
import { curveProductionSchemaSql, initializeProductionCurveStore, commitProductionCurveRange,
  productionCurveScope, readProductionCurveLaunches, rollbackProductionCurve } from "../../apps/indexer/src/curve-production-store.js";
import { hasHistoricalReadAccess } from "../../apps/indexer/src/historical-launches.js";
import { curveProductionDeployment, curveProductionPins, curveProductionProfile } from "../../apps/launch-website/lib/server/curve-production";

const root = resolve(__dirname, "../..");
const { Client, Pool } = createRequire(join(root, "apps/indexer/package.json"))("pg");
const { chromium, webkit } = createRequire(join(root, "package.json"))("playwright");
const output = process.env.RMT_DISCOVERY_REPORT_DIR || mkdtempSync(join(tmpdir(), "rmt088-discovery-"));
mkdirSync(output, { recursive: true });
const credential = "synthetic-discovery-continuity-088";
const hash = (digit: string) => "0x" + digit.repeat(64);
const address = (digit: string) => "0x" + digit.repeat(40);
type Mode = "fresh" | "stale" | "unauthorized" | "outage" | "malformed";
let mode: Mode = "fresh";
const report: any = { schemaVersion: 1, suite: "Task088 isolated discovery continuity",
  startedAt: new Date().toISOString(), source: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  node: process.version, worktreeDiffSha256: createHash("sha256").update(execFileSync("git", ["diff", "--", "apps/launch-website", "apps/indexer"], { cwd: root })).digest("hex"),
  syntheticOnly: true, liveChainAccess: false, authProbes: [], http: [], browsers: [], recovery: [], externalRequests: [], walletRequests: [],
  limitations: ["Synthetic HTTPS backend uses the actual PostgreSQL store and bearer verifier; no live indexer/RPC or production credentials.",
    "Database recovery closes and reopens the writer connection; it does not restart a production database or test PostgreSQL crash durability.",
    "The loopback proxy supplies the exact admitted deployment host/proto; this is local acceptance, not a Netlify deployment."] };
const servers: Server[] = [];
const children: ChildProcess[] = [];
let writer: any;
let reader: any;
let readPool: any;
let admin: any;
let createdDatabase = false;
let databaseName = "";

function listen(server: Server, port = 0): Promise<number> {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const item = server.address();
      if (!item || typeof item === "string") reject(new Error("Invalid local listener"));
      else resolvePort(item.port);
    });
  });
}
async function close(server: Server) {
  server.closeAllConnections?.();
  await new Promise<void>(done => server.close(() => done()));
}
async function waitFor(url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(url); if (response.status < 500) return; } catch {}
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error("Local Next production server did not become ready");
}
async function main() {
  const dbUrl = new URL(process.env.DATABASE_URL || "");
  assert.ok(["127.0.0.1", "localhost"].includes(dbUrl.hostname), "loopback PostgreSQL only");
  assert.match(dbUrl.pathname, /^\/rmt_curve_production_smoke_[a-z0-9_]+$/, "dedicated synthetic database name required");
  assert.equal(dbUrl.search, "", "connection query overrides are forbidden");
  assert.equal(dbUrl.hash, "", "connection fragment is forbidden");
  databaseName = dbUrl.pathname.slice(1);
  const adminUrl = new URL(dbUrl); adminUrl.pathname = "/postgres";
  admin = new Client({ connectionString: String(adminUrl) });
  assert.ok(["127.0.0.1", "localhost"].includes(admin.connectionParameters.host), "effective admin connection must be loopback");
  await admin.connect();
  assert.equal((await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [databaseName])).rows.length, 0, "fresh database only");
  await admin.query('CREATE DATABASE "' + databaseName + '"'); createdDatabase = true;
  writer = new Client({ connectionString: String(dbUrl) });
  assert.ok(["127.0.0.1", "localhost"].includes(writer.connectionParameters.host), "effective writer connection must be loopback");
  await writer.connect();
  reader = new Client({ connectionString: String(dbUrl) }); await reader.connect();
  readPool = new Pool({ connectionString: String(dbUrl), max: 4, options: "-c default_transaction_read_only=on -c statement_timeout=5000" });
  report.postgresVersion = (await writer.query("SELECT version() AS version")).rows[0].version;
  const config = curveProductionConfig({ RMT_CURVE_PRODUCTION_BINDING: JSON.stringify({
    schemaVersion: 1, evidence: "CANONICAL_DEPLOYMENT_AND_SOURCE_VERIFIED", chainId: 4663,
    profile: "rmt-curve-fixed-supply-security-v2", deploymentBlock: String(curveProductionDeployment.blockNumber),
    deploymentBlockHash: curveProductionDeployment.blockHash, deploymentTransactionHash: curveProductionDeployment.transactionHash,
    factory: curveProductionPins.factory[0], factoryRuntimeHash: curveProductionPins.factory[1],
    projectRegistry: curveProductionPins.registry[0], registryRuntimeHash: curveProductionPins.registry[1],
    operatingRecipient: curveProductionDeployment.operating, reserveRecipient: curveProductionDeployment.reserve,
    sourceVerificationEvidenceSha256: "5".repeat(64), creationFeeWei: String(curveProductionDeployment.creationFeeWei)
  }) })!;
  const scope = productionCurveScope(config);
  const start = curveProductionDeployment.blockNumber;
  const createdAt = new Date(Date.now() - 600_000).toISOString();
  const ingestion = { blockNumber: String(start + 1n), blockHash: hash("b"), timestamp: createdAt,
    confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified" } as const;
  let point = { blockNumber: String(start + 10n), blockHash: hash("a"), timestamp: new Date(Date.now() - 2_000).toISOString() };
  let registration: any = { kind: "curve-launch-1b-v2", status: "created", chainId: 4663, engineVersion: 1,
    factory: curveProductionPins.factory[0], projectRegistry: curveProductionPins.registry[0],
    token: address("2"), initialCurve: address("3"), creator: address("4"), revenueLedger: address("5"),
    name: "Synthetic continuity project", symbol: "SYNTH", projectURI: "https://example.invalid/synthetic-only",
    totalSupplyWei: String(10n ** 27n), tokenDecimals: 18, treasury: null, treasuryShareBps: 0, intentId: hash("d"),
    creation: { blockNumber: ingestion.blockNumber, blockHash: ingestion.blockHash, timestamp: createdAt,
      transactionHash: hash("c"), logIndex: 4 }, projectRegistrationLogIndex: 3,
    creationFee: { amountWei: String(curveProductionDeployment.creationFeeWei), refundWei: "0",
      recipient: curveProductionDeployment.operating, logIndex: 5 }, checkpoint: ingestion };
  await writer.query(curveProductionSchemaSql);
  await initializeProductionCurveStore(writer, config);
  await commitProductionCurveRange(writer, config, start, ingestion, [registration]);
  await commitProductionCurveRange(writer, config, start + 2n, point, []);
  report.recovery.push({ phase: "advanced-checkpoint", creationBlock: registration.creation.blockNumber, checkpointBlock: point.blockNumber,
    unchangedCreation: (await readProductionCurveLaunches(reader, scope, point, { limit: 25 }))[0].creation.transactionHash === registration.creation.transactionHash });

  const cert = join(output, "loopback-cert.pem"), key = join(output, "loopback-key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
    "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-keyout", key, "-out", cert], { stdio: "ignore" });
  let authorizedReads = 0, rejectedReads = 0;
  const fixture = createHttpsServer({ cert: readFileSync(cert), key: readFileSync(key) }, async (request, response) => {
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    if (!hasHistoricalReadAccess(credential, request.headers.authorization)) {
      rejectedReads++; json(401, { error: "Unauthorized" }); return;
    }
    authorizedReads++;
    if (mode === "unauthorized") { json(401, { error: "Unauthorized" }); return; }
    if (mode === "outage") { json(503, { status: "unavailable" }); return; }
    if (mode === "malformed") { json(200, { chainId: 1, launches: [] }); return; }
    const url = new URL(request.url || "/", "https://127.0.0.1");
    const token = /^\/curve-launches\/(0x[0-9a-f]{40})$/.exec(url.pathname)?.[1];
    if (url.pathname !== "/curve-launches" && !token) { json(404, { status: "unavailable" }); return; }
    let db: any;
    try {
      db = await readPool.connect();
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const launches = await readProductionCurveLaunches(db, scope, point, { token, limit: 25 });
      await db.query("COMMIT");
      const checkpoint = { ...point, confirmations: 20, finality: "l2-confirmed", l1Finality: "unverified",
        ...(mode === "stale" ? { timestamp: new Date(Date.now() - 180_000).toISOString() } : {}) };
      json(200, { chainId: 4663, profile: "rmt-curve-fixed-supply-security-v2", status: mode === "stale" ? "stale" : "ready",
        observedAt: new Date().toISOString(), deployment: { factory: config.binding.factory, registry: config.binding.projectRegistry,
          blockNumber: String(start), blockHash: config.binding.deploymentBlockHash }, checkpoint, launches, nextCursor: null });
    } catch {
      await db?.query("ROLLBACK").catch(() => undefined); json(503, { status: "unavailable" });
    } finally { db?.release(); }
  });
  servers.push(fixture);
  const fixturePort = await listen(fixture);
  const probe = (authorization?: string) => new Promise<number>((resolveStatus, reject) => {
    httpsGet({ hostname: "127.0.0.1", port: fixturePort, path: "/curve-launches?limit=25", ca: readFileSync(cert),
      headers: authorization ? { Authorization: authorization } : {} }, response => {
      response.resume(); resolveStatus(response.statusCode!);
    }).on("error", reject);
  });
  assert.equal(await probe(), 401);
  assert.equal(await probe("Bearer incorrect-synthetic-only"), 401);
  report.authProbes.push({ credential: "missing", status: 401 }, { credential: "incorrect synthetic", status: 401 });

  const nextPort = Number(process.env.RMT_DISCOVERY_NEXT_PORT || 3398);
  assert.ok(Number.isInteger(nextPort) && nextPort > 1024 && nextPort < 65536);
  const nextLog = createWriteStream(join(output, "next-server.log"));
  const app = join(root, "apps/launch-website");
  const child = spawn(process.execPath, [join(app, "node_modules/next/dist/bin/next"), "start", "-p", String(nextPort), "-H", "127.0.0.1"], {
    cwd: app, env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
      NODE_EXTRA_CA_CERTS: cert, RMT_CURVE_PRODUCTION_DISCOVERY: curveProductionProfile,
      RMT_LAUNCH_HISTORY_INDEXER_URL: "https://127.0.0.1:" + fixturePort + "/",
      RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN: credential },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child); child.stdout!.pipe(nextLog); child.stderr!.pipe(nextLog);
  await waitFor("http://127.0.0.1:" + nextPort + "/api/launchpad/config");
  const proxy = createServer((request, response) => {
    const upstream = httpRequest({ hostname: "127.0.0.1", port: nextPort, path: request.url, method: request.method,
      headers: { ...request.headers, host: "www.rmtlaunch.fun", "x-forwarded-host": "www.rmtlaunch.fun", "x-forwarded-proto": "https" } }, result => {
      response.writeHead(result.statusCode!, result.headers); result.pipe(response);
    });
    upstream.on("error", () => { response.writeHead(502); response.end(); });
    request.pipe(upstream);
  });
  servers.push(proxy);
  const origin = "http://127.0.0.1:" + await listen(proxy);
  console.info("Isolated discovery proxy ready: " + origin);
  async function api(path: string, expected: number, expectedStatus?: string) {
    const response = await fetch(origin + path);
    const body = await response.json() as any;
    assert.equal(response.status, expected, path + " HTTP status");
    if (expectedStatus) assert.equal(body.status, expectedStatus, path + " body status");
    assert.doesNotMatch(JSON.stringify(body), /synthetic-discovery-continuity-088|127\.0\.0\.1|Bearer/);
    if (expected >= 500) assert.equal(response.headers.get("netlify-cdn-cache-control"), "no-store");
    report.http.push({ mode, path, status: response.status, feedStatus: body.status,
      launches: body.launches?.length, cacheControl: response.headers.get("cache-control"),
      cdnCacheControl: response.headers.get("netlify-cdn-cache-control") });
    return body;
  }
  await api("/api/launchpad/new-engine", 200, "ready");
  await api("/api/launchpad/new-engine/" + registration.token, 200, "ready");
  await api("/api/launchpad/new-engine/" + address("9"), 404, "ready");
  for (const [selected, expected] of [["stale", "stale"], ["unauthorized", "unavailable"], ["outage", "unavailable"], ["malformed", "unavailable"]] as const) {
    mode = selected; await api("/api/launchpad/new-engine", 503, expected);
    await api("/api/launchpad/new-engine/" + address("9"), 503, expected);
  }
  mode = "fresh";
  const gates = await (await fetch(origin + "/api/launchpad/config")).json() as any;
  assert.equal(gates.status, "disabled");
  for (const path of ["/api/launchpad/test-creation", "/api/launchpad/test-lifecycle", "/api/launchpad/test-mobile-review"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 404, path);
    report.http.push({ path, status: response.status });
  }

  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]] as const) {
    const browser = await engine.launch({ headless: true });
    try {
      for (const [viewportName, viewport] of [["desktop", { width: 1440, height: 1000 }], ["portrait", { width: 390, height: 844 }]] as const) {
        const context = await browser.newContext({ viewport });
        // A string keeps the browser initializer independent of tsx/esbuild's Node-only name helper.
        await context.addInitScript("window.__walletRequests = []; window.ethereum = { request: async function(request) { window.__walletRequests.push(request); throw new Error('Synthetic wallet disabled'); } };");
        await context.route("**/*", async (route: any) => {
          const requested = route.request().url();
          if (new URL(requested).origin === origin) return route.continue();
          report.externalRequests.push({ browser: name, viewport: viewportName, url: requested });
          return route.abort();
        });
        const page = await context.newPage();
        const pageErrors: string[] = []; page.on("pageerror", (error: Error) => pageErrors.push(error.message));
        for (const [selected, text, cards] of [["fresh", "Synthetic continuity project", 1], ["stale", "Launch feed stale", 0],
          ["unauthorized", "Launch feed unavailable", 0], ["outage", "Launch feed unavailable", 0],
          ["malformed", "Launch feed unavailable", 0]] as const) {
          mode = selected;
          await page.goto(origin + "/", { waitUntil: "networkidle" });
          assert.ok(await page.getByText(text, { exact: selected !== "fresh" }).first().isVisible(), selected + " UI status");
          assert.equal(await page.locator(".lpLaunchCard").count(), cards);
          if (selected === "stale") assert.equal(await page.getByText("Last-known creation history (stale)", { exact: true }).count(), 1);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "no horizontal overflow");
          assert.doesNotMatch(await page.content(), /synthetic-discovery-continuity-088|Bearer/);
          if (selected !== "malformed" && selected !== "outage") await page.screenshot({ path: join(output, name + "-" + viewportName + "-" + selected + ".png"), fullPage: true });
          report.walletRequests.push(...await page.evaluate(() => (window as any).__walletRequests));
          report.browsers.push({ browser: name, viewport: viewportName, mode: selected, statusText: text, cards, passed: true });
          if (selected === "fresh") {
            await page.evaluate("window.__continuityOriginalNow = Date.now; Date.now = function() { return window.__continuityOriginalNow() + 121000; }; document.dispatchEvent(new Event('visibilitychange'));");
            await page.getByText("Launch feed stale", { exact: true }).waitFor();
            assert.equal(await page.locator(".lpLaunchCard").count(), 0);
            const history = page.locator("details").filter({ has: page.getByText("Last-known creation history (stale)", { exact: true }) });
            assert.equal(await history.getAttribute("open"), null, "expired history stays collapsed");
            await page.evaluate("Date.now = window.__continuityOriginalNow; document.dispatchEvent(new Event('visibilitychange')); new Promise(function(done) { requestAnimationFrame(function() { requestAnimationFrame(done); }); });");
            assert.ok(await page.getByText("Launch feed stale", { exact: true }).isVisible(), "clock rollback cannot revive expired data");
            assert.equal(await page.locator(".lpLaunchCard").count(), 0);
            await page.screenshot({ path: join(output, name + "-" + viewportName + "-expired.png"), fullPage: true });
            report.browsers.push({ browser: name, viewport: viewportName, mode: "client-expiration-and-clock-rollback", cards: 0, historyCollapsed: true, stayedStaleAfterClockRestore: true, passed: true });
          }
        }
        assert.deepEqual(pageErrors, []);
        await context.close();
      }
    } finally { await browser.close(); }
  }
  mode = "fresh";
  await writer.end();
  writer = new Client({ connectionString: String(dbUrl) });
  assert.ok(["127.0.0.1", "localhost"].includes(writer.connectionParameters.host), "effective writer connection must be loopback");
  await writer.connect();
  await initializeProductionCurveStore(writer, config);
  const reopened = await readProductionCurveLaunches(reader, scope, point, { limit: 25 });
  assert.equal(reopened.length, 1); assert.equal(reopened[0].creation.transactionHash, registration.creation.transactionHash);
  report.recovery.push({ phase: "writer-restart", recoveredRows: reopened.length, originalReceiptPreserved: true });
  await api("/api/launchpad/new-engine", 200, "ready");
  const oldPoint = point;
  await rollbackProductionCurve(writer, scope, start);
  await api("/api/launchpad/new-engine", 503, "unavailable");
  point = { ...point, blockHash: hash("e"), timestamp: new Date(Date.now() - 1_000).toISOString() };
  registration = { ...registration, checkpoint: { ...ingestion, blockHash: hash("f") },
    creation: { ...registration.creation, blockHash: hash("f"), transactionHash: hash("7") } };
  await commitProductionCurveRange(writer, config, start + 1n, point, [registration]);
  await assert.rejects(readProductionCurveLaunches(reader, scope, oldPoint, { limit: 25 }), /checkpoint changed/);
  const canonical = await api("/api/launchpad/new-engine", 200, "ready");
  assert.equal(canonical.launches[0].creation.transactionHash, hash("7"));
  report.recovery.push({ phase: "reorg-replay", oldCheckpointRejected: true, canonicalTransactionHash: hash("7") });
  await rollbackProductionCurve(writer, scope, start);
  point = { ...point, blockHash: hash("8") };
  await commitProductionCurveRange(writer, config, start + 1n, point, []);
  const empty = await api("/api/launchpad/new-engine", 200, "ready"); assert.deepEqual(empty.launches, []);
  await api("/api/launchpad/new-engine/" + registration.token, 404, "ready");
  for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]] as const) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      await page.route("**/*", async (route: any) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(origin, { waitUntil: "networkidle" });
      assert.ok(await page.getByText("No launches yet", { exact: true }).isVisible());
      assert.equal(await page.locator(".lpLaunchCard").count(), 0);
      await page.screenshot({ path: join(output, name + "-portrait-empty.png"), fullPage: true });
      report.browsers.push({ browser: name, viewport: "portrait", mode: "reorg-empty", cards: 0, passed: true });
    } finally { await browser.close(); }
  }
  assert.equal(report.externalRequests.length, 0, "no external browser requests");
  assert.equal(report.walletRequests.length, 0, "no wallet requests");
  assert.ok(authorizedReads > 0 && rejectedReads === 2);
  report.authentication = { authorizedReads, rejectedMissingOrWrongCredentials: rejectedReads, syntheticCredentialNotExposed: true };
  report.result = "PASS";
}
main().catch(error => { report.result = "FAIL"; report.error = { name: error.name, message: error.message, stack: error.stack }; process.exitCode = 1; }).finally(async () => {
  for (const child of children) { child.kill("SIGTERM"); await Promise.race([once(child, "exit"), new Promise(done => setTimeout(done, 3_000))]).catch(() => undefined); if (child.exitCode === null) child.kill("SIGKILL"); }
  for (const server of servers.reverse()) await close(server);
  await readPool?.end().catch(() => undefined);
  await reader?.end().catch(() => undefined); await writer?.end().catch(() => undefined);
  if (createdDatabase) {
    assert.ok(["127.0.0.1", "localhost"].includes(admin.connectionParameters.host), "effective cleanup connection must be loopback");
    await admin.query('DROP DATABASE "' + databaseName + '"').catch(() => undefined);
  }
  await admin?.end().catch(() => undefined);
  report.completedAt = new Date().toISOString();
  writeFileSync(join(output, "continuity.json"), JSON.stringify(report, null, 2) + "\n");
  console.info(JSON.stringify({ result: report.result, httpChecks: report.http.length, browserCases: report.browsers.length,
    recovery: report.recovery, report: join(output, "continuity.json"), ...(report.error ? { error: report.error.message } : {}) }));
});
