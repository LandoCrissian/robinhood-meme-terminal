import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const site = new URL(process.env.RMT_LAUNCHPAD_SHOWCASE_URL ?? "http://127.0.0.1:3195");
const output = process.env.RMT_LAUNCHPAD_SHOWCASE_OUTPUT ?? ".launch-qa/showcase";
assert.equal(site.origin, `http://127.0.0.1:${site.port}`);
assert.equal(site.href, `${site.origin}/`);
await mkdir(output, { recursive: true });

const response = await fetch(new URL("/api/launchpad/config", site), { redirect: "error" });
assert.equal(response.status, 200);
const config = await response.json();
assert.equal(config.status, "disabled");
assert.equal(config.deployment, undefined);
assert.match(response.headers.get("cache-control") ?? "", /no-store/);

const curve = await fetch(new URL("/api/launchpad/curve", site), { redirect: "error" });
assert.equal(curve.status, 404);
assert.equal((await curve.json()).status, "disabled");
const operations = ["list_launches", "get_launch", "get_launch_checks", "get_pool_state", "get_launch_activity"];
const unlistedToken = "0x0000000000000000000000000000000000000001";
const publicReads = await Promise.all(operations.map(async (operation) => {
  const url = new URL(`/api/launchpad/public/${operation}?chainId=31337`, site);
  if (operation !== "list_launches") url.searchParams.set("token", unlistedToken);
  const read = await fetch(url, { redirect: "error" });
  assert.equal(read.status, 404, operation);
  assert.equal((await read.json()).status, "disabled", operation);
  return [operation, read.status];
}));
const post = (path) => fetch(new URL(path, site), {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", redirect: "error",
});
const rejectedPost = await post("/api/launchpad/launches");
assert.equal(rejectedPost.status, 403);
assert.equal((await rejectedPost.json()).status, "disabled");
const mcp = await post("/mcp");
assert.equal(mcp.status, 404);
const walletRpc = await post("/preview-rpc/sample");
assert.equal(walletRpc.status, 404);

const browser = await chromium.launch();
const browserErrors = [];
const checked = [];
const layouts = [
  { name: "desktop", width: 1440, height: 900, touch: false },
  { name: "portrait", width: 390, height: 844, touch: true },
  { name: "landscape", width: 844, height: 390, touch: true },
];
try {
  for (const { name, width, height, touch } of layouts) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, serviceWorkers: "block" });
    const attempts = [];
    await context.exposeBinding("recordShowcaseWalletAccess", (_source, operation) => {
      attempts.push(operation);
    });
    await context.addInitScript(() => {
      const record = (operation) => void window.recordShowcaseWalletAccess(operation);
      Object.defineProperty(window, "ethereum", { configurable: true, value: {
        request: async ({ method }) => { record(method); throw new Error("Unexpected wallet call from the showcase"); },
        on: () => record("subscribe"),
        removeListener: () => undefined,
      } });
      window.addEventListener("eip6963:requestProvider", () => record("wallet discovery"));
    });
    const executionRequests = [];
    const externalConnections = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== site.origin) {
        externalConnections.push(url.origin);
        return route.abort();
      }
      if (request.method() !== "GET" || url.pathname.startsWith("/api/launchpad") || url.pathname.startsWith("/preview-rpc")) {
        executionRequests.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => browserErrors.push(error.message));
    const main = page.getByRole("main");
    const nav = page.getByRole("navigation", { name: "Launchpad navigation" });
    const operational = /connect wallet|browser wallet|open (?:inside|in) (?:a |your )?wallet|switch to|confirm|review creation|review trade|claim fees|recover wallet request/i;
    async function verifyReadOnly() {
      await main.getByText(/read-only preview/i).waitFor();
      assert.equal(await page.getByRole("button", { name: operational }).count(), 0);
      assert.equal(await page.getByRole("link", { name: operational }).count(), 0);
      assert.equal(await page.locator("form").count(), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} has horizontal overflow`);
    }
    try {
      assert.equal((await page.goto(site.href)).status(), 200);
      await main.getByRole("heading", { name: "Launches", exact: true }).waitFor();
      await verifyReadOnly();
      const alder = main.locator('a[href="/launches/example-alder"]');
      const harbor = main.locator('a[href="/launches/example-harbor"]');
      await alder.getByText("Alder Example", { exact: true }).waitFor();
      await alder.getByText("Bonding curve", { exact: true }).waitFor();
      await harbor.getByText("Harbor Example", { exact: true }).waitFor();
      await harbor.getByText("Uniswap v4", { exact: true }).waitFor();
      const search = main.getByRole("textbox", { name: "Search launches" });
      await search.fill("HBR");
      await alder.waitFor({ state: "detached" });
      await harbor.waitFor();
      await search.fill("");
      await alder.waitFor();
      await page.screenshot({ path: join(output, `${name}-discovery.png`) });

      await alder.click();
      await main.getByRole("heading", { name: "Alder Example", exact: true }).waitFor();
      await main.getByRole("heading", { name: "Trade ALDR", exact: true }).waitFor();
      await main.getByRole("heading", { name: "Sample launch details", exact: true }).waitFor();
      await verifyReadOnly();
      await page.screenshot({ path: join(output, `${name}-curve.png`) });

      assert.equal((await page.goto(new URL("/launches/example-harbor", site).href)).status(), 200);
      await main.getByRole("heading", { name: "Harbor Example", exact: true }).waitFor();
      await main.getByRole("heading", { name: "Trade on Uniswap v4", exact: true }).waitFor();
      await main.getByRole("heading", { name: "Sample launch details", exact: true }).waitFor();
      await verifyReadOnly();
      await page.screenshot({ path: join(output, `${name}-graduated.png`) });

      await nav.getByRole("link", { name: "Create Token", exact: true }).click();
      await main.getByRole("heading", { name: "Create Token", exact: true }).waitFor();
      await main.getByRole("heading", { name: "Draft launch terms", exact: true }).waitFor();
      await main.getByText(/0\.0004 ETH/i).first().waitFor();
      await main.getByText(/\b2 ETH\b/i).first().waitFor();
      await verifyReadOnly();
      await page.screenshot({ path: join(output, `${name}-creation.png`) });

      for (const destination of ["My Launches", "Wallet"]) {
        await nav.getByRole("link", { name: destination, exact: true }).click();
        await main.getByRole("heading", { name: destination, exact: true }).waitFor();
        await verifyReadOnly();
      }
      const missing = await page.goto(new URL(`/launches/${unlistedToken}`, site).href);
      assert.equal(missing.status(), 404);
      assert.deepEqual(attempts, [], `${name} attempted wallet access`);
      assert.deepEqual(externalConnections, [], `${name} made an external connection`);
      assert.deepEqual(executionRequests, [], `${name} made an operational request`);
      checked.push({ name, width, height, walletCalls: attempts.length, operationalRequests: executionRequests.length });
    } finally {
      await context.close();
    }
  }
  assert.deepEqual(browserErrors, []);
  await writeFile(join(output, "showcase-checks.json"), JSON.stringify({
    checked, browserErrors, api: { config: response.status, curve: curve.status, legacySubmission: rejectedPost.status,
      mcp: mcp.status, walletRpc: walletRpc.status, publicReads: Object.fromEntries(publicReads) },
  }, null, 2));
  console.log("Read-only showcase passed on desktop, portrait and landscape.");
} finally {
  await browser.close();
}
