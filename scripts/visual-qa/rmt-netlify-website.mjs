import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices, webkit } from "playwright";

const site = new URL(process.env.RMT_WEBSITE_PREVIEW_URL ?? "http://127.0.0.1:3205/");
const loopback = site.protocol === "http:" && site.hostname === "127.0.0.1" && site.port;
const netlifyPreview = site.protocol === "https:" && !site.port
  && /^(?:deploy-preview-\d+|[0-9a-f]{24})--[a-z0-9][a-z0-9-]*\.netlify\.app$/.test(site.hostname);
assert.ok(loopback || netlifyPreview, "Use loopback or an exact, operator-verified Netlify preview URL.");
assert.equal(site.href, `${site.origin}/`);
const output = process.env.RMT_WEBSITE_PREVIEW_ARTIFACTS ?? join(tmpdir(), "rmt-website-preview-qa");
const inliningMarker = process.env.RMT_WEBSITE_PREVIEW_SECRET_MARKER;
await mkdir(output, { recursive: true });

async function request(path, options) {
  return fetch(new URL(path, site), { redirect: "error", signal: AbortSignal.timeout(20_000), ...options });
}

async function readPublicJson(response) {
  const body = await response.text();
  if (inliningMarker) assert.ok(!body.includes(inliningMarker), "A private marker appeared in an API response");
  return JSON.parse(body);
}

const listResponse = await request("/api/launchpad/launches");
assert.equal(listResponse.status, 200);
const directory = await readPublicJson(listResponse);
assert.equal(directory.chainId, 4663);
assert.equal(directory.future, "prelaunch");
assert.equal(directory.finality, "l1-unverified");
assert.ok(["ready", "stale"].includes(directory.status));
assert.ok(["verified-snapshot", "v6-indexed"].includes(directory.coverage));
assert.ok(directory.launches.length >= 2 && directory.launches.length <= 25);
assert.equal(new Set(directory.launches.map(({ token }) => token.toLowerCase())).size, directory.launches.length);

for (const launch of directory.launches) {
  assert.equal(launch.kind, "historical-rmt");
  assert.ok(["historical", "retired", "deployment-test"].includes(launch.classification));
  for (const address of [launch.token, launch.factory, launch.market]) assert.match(address, /^0x[0-9a-f]{40}$/i);
  assert.match(launch.receipt.transactionHash, /^0x[0-9a-f]{64}$/i);
  assert.match(launch.receipt.blockHash, /^0x[0-9a-f]{64}$/i);
  assert.ok(Number.isFinite(Date.parse(launch.receipt.timestamp)));
  for (const field of ["balances", "volume", "marketCap", "price", "liquidity"]) {
    assert.equal(launch[field], undefined, `Unverified ${field} was exposed`);
  }
}

const v4 = directory.launches.find(({ version, launchId }) => version === 4 && launchId === "1");
const v6 = directory.launches.find(({ version, launchId }) => version === 6 && launchId === "0");
assert.ok(v4 && v6, "Both original RMT registrations must remain searchable");
assert.notEqual(v4.token.toLowerCase(), v6.token.toLowerCase());
for (const launch of [v4, v6]) {
  const response = await request(`/api/launchpad/launches/${launch.token}`);
  assert.equal(response.status, 200);
  const detail = await readPublicJson(response);
  assert.equal(detail.chainId, 4663);
  assert.deepEqual(detail.launches.map(({ token }) => token), [launch.token]);
  assert.deepEqual(detail.launches[0].receipt, launch.receipt);
}
const detailPath = (launch) => `/launches/${launch.token}`;

const pages = [
  ["/", "Launches"],
  [detailPath(v4), v4.name],
  [detailPath(v6), v6.name],
  ["/rmt", "Legacy RMT"],
  ["/create-token", "Create Token"],
  ["/my-launches", "My Launches"],
  ["/wallet", "Wallet"],
];
for (const [path, text] of pages) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/, path);
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/i, path);
  const html = await response.text();
  assert.ok(html.includes(text), `${path} did not server-render its content`);
  assert.doesNotMatch(html, /Alder Example|Harbor Example/);
}
const identityResponse = await request("/rmt");
const identityHtml = await identityResponse.text();
assert.ok(identityHtml.includes(v4.receipt.transactionHash) && identityHtml.includes(v6.receipt.transactionHash));
assert.equal((await request("/create-token", { method: "HEAD" })).status, 200);

const flight = await request(detailPath(v4), { headers: { RSC: "1" } });
assert.equal(flight.status, 200);
assert.match(flight.headers.get("content-type") ?? "", /^text\/x-component\b/);
assert.ok((await flight.text()).includes(v4.name));

const configResponse = await request("/api/launchpad/config");
assert.equal(configResponse.status, 200);
assert.match(configResponse.headers.get("cache-control") ?? "", /no-store/);
const config = await readPublicJson(configResponse);
assert.equal(config.status, "disabled");
for (const field of ["deployment", "rpcUrl", "curve", "factory", "chainId"]) {
  assert.equal(config[field], undefined, `Preview config must not disclose ${field}`);
}

const unverifiedToken = "0x0000000000000000000000000000000000000001";
const unverifiedTokenPath = `/launches/${unverifiedToken}`;
const unverifiedTokenApi = `/api/launchpad/launches/${unverifiedToken}`;
const unverifiedTokenData = await request(unverifiedTokenApi);
assert.ok([404, 503].includes(unverifiedTokenData.status));
await readPublicJson(unverifiedTokenData);
const unverifiedTokenDataHead = await request(unverifiedTokenApi, { method: "HEAD" });
assert.equal(unverifiedTokenDataHead.status, unverifiedTokenData.status);
assert.equal(await unverifiedTokenDataHead.text(), "");
const lookupUnavailable = unverifiedTokenData.status === 503;
const lookupHeading = lookupUnavailable ? "Launch data unavailable" : "No verified RMT registration for this address";
const unverifiedTokenPage = await request(unverifiedTokenPath);
assert.equal(unverifiedTokenPage.status, lookupUnavailable ? 200 : 404);
assert.ok((await unverifiedTokenPage.text()).includes(lookupHeading));
const unverifiedTokenPageHead = await request(unverifiedTokenPath, { method: "HEAD" });
assert.equal(unverifiedTokenPageHead.status, unverifiedTokenPage.status);
assert.equal(await unverifiedTokenPageHead.text(), "");

const unsupportedRoutes = [
  "/launches/example-alder", "/launches/example-harbor", "/launches/not-a-launch",
  "/admin", "/admin/creator-applications", "/deploy-mainnet", "/deploy-testnet",
  "/activate-consent-testnet", "/mainnet-smoke", "/vnext", "/status",
  "/api/launchpad/curve", "/api/launchpad/public/list_launches?chainId=31337",
  "/api/trade/rmt-v4", "/api/vnext/authorize", "/api/vnext/native-settlement-trace",
  "/api/admin/community/feedback", "/api/internal/position-guards/evaluate",
  "/mcp", "/preview-access", "/preview-rpc/fixture", "/.env", "/.git/config",
  "/.netlify/functions/___netlify-server-handler",
];
const denied = [];
for (const path of unsupportedRoutes) {
  for (const method of ["GET", "HEAD", "POST"]) {
    const schema = method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {};
    const response = await request(path, { method, ...schema });
    assert.equal(response.status, 404, `${method} ${path}`);
    const body = await response.text();
    if (method === "HEAD") assert.equal(body, "", path);
    denied.push(`${method} ${path}`);
  }
}

for (const path of ["/", "/create-token", detailPath(v4), "/wallet", "/api/launchpad/config", "/api/launchpad/launches", `/api/launchpad/launches/${v4.token}`, unverifiedTokenPath, unverifiedTokenApi]) {
  // The application exposes no actions, even when submitted as an App Router request.
  const response = await request(path, { method: "POST", headers: { "Next-Action": "invalid", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 404, `POST ${path}`);
  await response.text();
  denied.push(`POST ${path}`);
}

const engine = process.env.RMT_WEBSITE_BROWSER ?? "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const browser = await (engine === "webkit" ? webkit : chromium).launch();
const iPhone = devices["iPhone 13"];
const layouts = [
  { name: "desktop", options: { viewport: { width: 1440, height: 900 } } },
  { name: "portrait", options: iPhone },
  { name: "landscape", options: devices["iPhone 13 landscape"] },
];
const checked = [];
try {
  for (const { name, options } of layouts) {
    const context = await browser.newContext({ ...options, serviceWorkers: "block" });
    const walletCalls = [];
    await context.exposeBinding("recordPreviewWalletAccess", (_source, event) => walletCalls.push(event));
    await context.addInitScript(() => {
      const record = (event) => void window.recordPreviewWalletAccess(event);
      const provider = {
        request: async ({ method }) => { record(method); throw new Error("Unexpected preview wallet request"); },
        on: () => record("provider subscription"),
      };
      Object.defineProperty(window, "ethereum", { configurable: true, get() { record("injected wallet access"); return provider; } });
      window.addEventListener("eip6963:requestProvider", () => record("wallet discovery"));
    });
    const operationalRequests = [];
    const outsideRequests = [];
    await context.route("**/*", async (route) => {
      const sent = route.request();
      const url = new URL(sent.url());
      if (url.origin !== site.origin) {
        outsideRequests.push(url.origin);
        return route.abort();
      }
      if (sent.method() !== "GET" || /^(?:\/api\/|\/preview-|\/mcp(?:\/|$)|\/\.netlify\/)/.test(url.pathname)) {
        operationalRequests.push(`${sent.method()} ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    const scripts = new Set();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.request().resourceType() !== "script") return;
      if (!response.ok()) errors.push(`script ${response.status()} ${new URL(response.url()).pathname}`);
      else scripts.add(response.url());
    });
    const main = page.getByRole("main");
    const nav = page.getByRole("navigation", { name: "Launchpad navigation" });
    const operationalControls = /connect wallet|browser wallet|open (?:inside|in) (?:a |your )?wallet|switch to|confirm|review creation|review trade|claim fees|recover wallet request/i;
    async function verifyReadOnly(heading) {
      await main.getByRole("heading", { name: heading, exact: true }).waitFor();
      await page.getByText("Read-only", { exact: true }).first().waitFor();
      assert.equal(await page.getByRole("button", { name: operationalControls }).count(), 0);
      assert.equal(await page.getByRole("link", { name: operationalControls }).count(), 0);
      assert.equal(await page.locator("form").count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} has horizontal overflow`);
      if (inliningMarker) assert.ok(!(await page.content()).includes(inliningMarker), "A private marker appeared in HTML");
    }
    async function screenshot(view) {
      await page.screenshot({ path: join(output, `${name}-${view}.png`) });
    }
    try {
      assert.equal((await page.goto(site.href)).status(), 200);
      await verifyReadOnly("Launches");
      await main.getByText(/new RMT Launch engine is in prelaunch/i).waitFor();
      if (directory.status === "stale") {
        const source = directory.coverage === "verified-snapshot" ? "verified historical snapshot" : "last verified V6 index records";
        await main.getByText(`Chain data is stale. Showing the ${source}.`).waitFor();
      }
      const legacy = main.locator(`a[href="${detailPath(v4)}"]`);
      const official = main.locator(`a[href="${detailPath(v6)}"]`);
      const deploymentTest = directory.launches.find(({ classification }) => classification === "deployment-test");
      await legacy.waitFor();
      await official.waitFor();
      const search = main.getByRole("textbox", { name: "Search launches" });
      await search.fill("no matching RMT project");
      await main.getByRole("heading", { name: "No matching launches" }).waitFor();
      assert.equal(await main.getByRole("link", { name: "Look up this address" }).count(), 0);
      if (deploymentTest) {
        const testRow = main.locator(`a[href="${detailPath(deploymentTest)}"]`);
        assert.equal(await testRow.count(), 0);
        await search.fill(deploymentTest.token);
        await testRow.getByText(/RMT deployment test/i).waitFor();
      }
      await search.fill(v6.token.toUpperCase());
      await legacy.waitFor({ state: "detached" });
      await official.waitFor();
      await search.fill(` ${unverifiedToken.toUpperCase()} `);
      const addressLookup = main.getByRole("link", { name: "Look up this address" });
      await addressLookup.waitFor();
      assert.equal(await addressLookup.getAttribute("href"), unverifiedTokenPath);
      await screenshot("address-lookup");
      await addressLookup.click();
      await verifyReadOnly(lookupHeading);
      await main.getByText(lookupUnavailable
        ? /try again when the directory is available/i
        : /external tokens and newer or unindexed records may be absent/i).waitFor();
      await nav.getByRole("link", { name: "Launches", exact: true }).click();
      await verifyReadOnly("Launches");
      await search.fill("");
      await search.blur();
      await legacy.waitFor();
      await screenshot("discovery");

      await legacy.click();
      await verifyReadOnly(v4.name);
      await main.getByText("Launch provenance", { exact: true }).waitFor();
      await main.getByText(v4.token, { exact: true }).waitFor();
      await main.getByText(v4.receipt.transactionHash, { exact: true }).waitFor();
      await screenshot("historical-v4");
      const reloaded = await page.reload();
      assert.equal(reloaded.status(), 200);
      await verifyReadOnly(v4.name);

      assert.equal((await page.goto(new URL(detailPath(v6), site).href)).status(), 200);
      await verifyReadOnly(v6.name);
      await main.getByRole("heading", { name: "Confirmed activity" }).waitFor();
      await main.getByText(v6.receipt.transactionHash, { exact: true }).waitFor();
      await main.getByText("Ethereum L1 finality", { exact: true }).waitFor();
      await screenshot("historical-v6");

      await nav.getByRole("link", { name: "Create Token", exact: true }).click();
      await verifyReadOnly("Create Token");
      for (const disclosure of [/0\.0004 ETH/i, /\b2 ETH\b/i, /60%/, /40%/, /1%/, /90%/, /5% RMT operations/i, /5% RMT future reserve/i]) {
        await main.getByText(disclosure).first().waitFor();
      }
      await screenshot("creation");
      assert.equal((await page.reload()).status(), 200);
      await verifyReadOnly("Create Token");

      await page.getByRole("contentinfo").getByRole("link", { name: "Legacy RMT", exact: true }).click();
      await verifyReadOnly("Legacy RMT");
      assert.deepEqual((await main.getByRole("link", { name: "View launch evidence" }).evaluateAll((links) =>
        links.map((link) => link.getAttribute("href")))).sort(), [detailPath(v4), detailPath(v6)].sort());

      for (const destination of ["My Launches", "Wallet"]) {
        await nav.getByRole("link", { name: destination, exact: true }).click();
        await verifyReadOnly(destination);
      }
      const footer = page.getByRole("contentinfo");
      for (const [label, path, heading] of [
        ["Terms", "/terms", "Website Terms"],
        ["Risks", "/risks", "Risk Disclosures"],
        ["Privacy", "/privacy", "Website Privacy"],
      ]) {
        await footer.getByRole("link", { name: label, exact: true }).click();
        await main.getByRole("heading", { name: heading, exact: true }).waitFor();
        assert.equal(new URL(page.url()).pathname, path);
      }
      assert.ok(scripts.size > 0, `${name} did not verify any Next.js scripts`);
      for (const script of inliningMarker ? scripts : []) {
        const response = await request(new URL(script).pathname);
        assert.ok(!(await response.text()).includes(inliningMarker), "A private marker appeared in a browser script");
      }
      assert.deepEqual(walletCalls, [], `${name} accessed the wallet`);
      assert.deepEqual(outsideRequests, [], `${name} attempted an outside connection`);
      assert.deepEqual(operationalRequests, [], `${name} attempted an operational request`);
      assert.deepEqual(errors, [], `${name} reported browser errors`);
      checked.push({ name, ...page.viewportSize(), walletCalls: walletCalls.length,
        outsideRequests: outsideRequests.length, operationalRequests: operationalRequests.length, scripts: scripts.size });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(join(output, "website-preview-checks.json"), JSON.stringify({
  url: site.href, environment: netlifyPreview ? "netlify-preview" : "loopback", engine, checked,
  chain: { status: directory.status, coverage: directory.coverage, checkpoint: directory.checkpoint, launches: directory.launches.length },
  denied, ssr: pages.map(([path]) => path), rsc: "passed", config: config.status,
  privateMarkerCheck: Boolean(inliningMarker),
}, null, 2));
console.log(`Read-only website verified on desktop and iPhone emulation at ${site.origin}. Evidence: ${output}`);
