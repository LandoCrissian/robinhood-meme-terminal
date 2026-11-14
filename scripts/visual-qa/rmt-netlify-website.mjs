import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices } from "playwright";

const site = new URL(process.env.RMT_WEBSITE_PREVIEW_URL ?? "http://127.0.0.1:3205/");
const loopback = site.protocol === "http:" && site.hostname === "127.0.0.1" && site.port;
const netlifyPreview = site.protocol === "https:" && !site.port
  && /^(?:deploy-preview-\d+|[0-9a-f]{24})--[a-z0-9][a-z0-9-]*\.netlify\.app$/.test(site.hostname);
assert.ok(loopback || netlifyPreview, "Use loopback or an exact, operator-verified Netlify preview URL.");
assert.equal(site.href, `${site.origin}/`);
const output = process.env.RMT_WEBSITE_PREVIEW_ARTIFACTS ?? join(tmpdir(), "rmt-website-preview-qa");
await mkdir(output, { recursive: true });

async function request(path, options) {
  return fetch(new URL(path, site), { redirect: "error", signal: AbortSignal.timeout(20_000), ...options });
}

const pages = [
  ["/", "Launches"],
  ["/launches/example-alder", "Alder Example"],
  ["/launches/example-harbor", "Harbor Example"],
  ["/create-token", "Create Token"],
  ["/my-launches", "My Launches"],
  ["/wallet", "Wallet"],
];
for (const [path, text] of pages) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/, path);
  assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/i, path);
  assert.ok((await response.text()).includes(text), `${path} did not server-render its content`);
}
assert.equal((await request("/rmt")).status, 200);
assert.equal((await request("/create-token", { method: "HEAD" })).status, 200);

const flight = await request("/launches/example-alder", { headers: { RSC: "1" } });
assert.equal(flight.status, 200);
assert.match(flight.headers.get("content-type") ?? "", /^text\/x-component\b/);
assert.ok((await flight.text()).includes("Alder Example"));

const configResponse = await request("/api/launchpad/config");
assert.equal(configResponse.status, 200);
assert.match(configResponse.headers.get("cache-control") ?? "", /no-store/);
const config = await configResponse.json();
assert.equal(config.status, "disabled");
for (const field of ["deployment", "rpcUrl", "curve", "factory", "chainId"]) {
  assert.equal(config[field], undefined, `Preview config must not disclose ${field}`);
}

const unsupportedRoutes = [
  "/launches/0x0000000000000000000000000000000000000001", "/launches/not-a-sample",
  "/admin", "/admin/creator-applications", "/deploy-mainnet", "/deploy-testnet",
  "/activate-consent-testnet", "/mainnet-smoke", "/vnext", "/status",
  "/api/launchpad/curve", "/api/launchpad/launches", "/api/launchpad/public/list_launches?chainId=31337",
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

for (const path of ["/", "/create-token", "/launches/example-alder", "/wallet", "/api/launchpad/config"]) {
  // The application exposes no actions, even when submitted as an App Router request.
  const response = await request(path, { method: "POST", headers: { "Next-Action": "invalid", "Content-Type": "application/json" }, body: "{}" });
  assert.equal(response.status, 404, `POST ${path}`);
  await response.text();
  denied.push(`POST ${path}`);
}

const inliningMarker = process.env.RMT_WEBSITE_PREVIEW_SECRET_MARKER;
const browser = await chromium.launch();
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
      await main.getByText(/read-only preview/i).first().waitFor();
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
      const alder = main.locator('a[href="/launches/example-alder"]');
      const harbor = main.locator('a[href="/launches/example-harbor"]');
      await alder.getByText("Bonding curve", { exact: true }).waitFor();
      await harbor.getByText("Uniswap v4", { exact: true }).waitFor();
      const search = main.getByRole("textbox", { name: "Search launches" });
      await search.fill("HBR");
      await alder.waitFor({ state: "detached" });
      await harbor.waitFor();
      await search.fill("");
      await alder.waitFor();
      await screenshot("discovery");

      await alder.click();
      await verifyReadOnly("Alder Example");
      await main.getByText("Sample launch details", { exact: true }).waitFor();
      await main.getByText(/no token contract, pool or transaction history/i).waitFor();
      await screenshot("curve");
      assert.equal((await page.reload()).status(), 200);
      await verifyReadOnly("Alder Example");

      assert.equal((await page.goto(new URL("/launches/example-harbor", site).href)).status(), 200);
      await verifyReadOnly("Harbor Example");
      await main.getByRole("heading", { name: "Trade on Uniswap v4" }).waitFor();
      await main.getByText(/no token contract, pool or transaction history/i).waitFor();
      await screenshot("graduated");

      await nav.getByRole("link", { name: "Create Token", exact: true }).click();
      await verifyReadOnly("Create Token");
      for (const disclosure of [/0\.0004 ETH/i, /\b2 ETH\b/i, /60%/, /40%/, /1%/, /90%/, /5% RMT operations/i, /5% RMT future reserve/i]) {
        await main.getByText(disclosure).first().waitFor();
      }
      await screenshot("creation");
      assert.equal((await page.reload()).status(), 200);
      await verifyReadOnly("Create Token");

      for (const destination of ["My Launches", "Wallet"]) {
        await nav.getByRole("link", { name: destination, exact: true }).click();
        await verifyReadOnly(destination);
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
  url: site.href, environment: netlifyPreview ? "netlify-preview" : "loopback", checked,
  denied, ssr: pages.map(([path]) => path), rsc: "passed", config: config.status,
  privateMarkerCheck: Boolean(inliningMarker),
}, null, 2));
console.log(`Read-only website verified on desktop and iPhone emulation at ${site.origin}. Evidence: ${output}`);
