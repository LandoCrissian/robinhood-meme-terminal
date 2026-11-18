import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { chromium, devices, webkit } from "playwright";

// Actual public build responses only. No wallet, fixture activation, financial
// success mocking, upstream RPC or production/hosted URL is admitted.
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => {
  if (i % 2 === 0) pairs.push([arg, all[i + 1]]); return pairs;
}, []));
assert.deepEqual(Object.keys(args).sort(), ["--browser", "--output", "--url"]);
const site = new URL(args["--url"]), engine = args["--browser"], output = args["--output"];
assert.equal(site.protocol, "http:"); assert.equal(site.hostname, "127.0.0.1"); assert.ok(site.port);
assert.equal(site.href, `${site.origin}/`); assert.equal(site.username, ""); assert.equal(site.password, "");
assert.ok(["chromium", "webkit"].includes(engine)); assert.ok(isAbsolute(output));
await mkdir(output, { recursive: false });
const pagePath = "/my-launches/treasury", api = "/api/launchpad/project-treasury";
const denied = [];
for (const path of ["/api/launchpad/test-project-treasury", "/api/launchpad/treasury-purchase-v2", "/api/launchpad/test-treasury-purchase-v2"]) {
  const response = await fetch(new URL(path, site), { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { Origin: site.origin, "Content-Type": "application/json" }, body: JSON.stringify({ action: "executePurchase", amountWei: "1" }) });
  assert.equal(response.status, 404, path); assert.equal(response.headers.get("set-cookie"), null);
  denied.push({ method: "POST", path, status: response.status });
}
const read = await fetch(new URL(`${api}?address=0x1000000000000000000000000000000000000770`, site),
  { redirect: "error", signal: AbortSignal.timeout(15_000) });
assert.equal(read.status, 200); assert.match(read.headers.get("cache-control") ?? "", /no-store/);
const unavailable = await read.json();
assert.equal(unavailable.status, "unavailable"); assert.equal(unavailable.executionEnabled, false);
for (const key of ["assets", "purchases", "events", "proof", "earnings"]) assert.equal(unavailable[key], undefined);

const browser = await (engine === "webkit" ? webkit : chromium).launch(), layouts = [];
try {
  for (const [name, options] of [["desktop", { viewport: { width: 1440, height: 900 } }],
    ["portrait", devices["iPhone 13"]], ["landscape", devices["iPhone 13 landscape"]]]) {
    const context = await browser.newContext({ ...options, serviceWorkers: "block" }), walletCalls = [], external = [], unexpected = [], errors = [];
    await context.exposeBinding("recordUnexpectedTreasuryWallet", (_source, value) => walletCalls.push(value));
    await context.addInitScript(() => {
      Object.defineProperty(window, "ethereum", { configurable: true, get() {
        void window.recordUnexpectedTreasuryWallet("injected wallet read");
        return { request: async ({ method }) => { void window.recordUnexpectedTreasuryWallet(method); throw Error("Public wallet use forbidden"); } };
      } });
      window.addEventListener("eip6963:requestProvider", () => void window.recordUnexpectedTreasuryWallet("wallet discovery"));
    });
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== site.origin) { external.push(url.origin); return route.abort(); }
      if (request.method() !== "GET" || /^\/(?:preview-rpc|mcp)(?:\/|$)/.test(url.pathname)
        || url.pathname.startsWith("/api/") && !["/api/account/session", "/api/launchpad/config"].includes(url.pathname)) {
        unexpected.push(`${request.method()} ${url.pathname}`); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    try {
      const response = await page.goto(new URL(pagePath, site).href); assert.equal(response.status(), 200);
      const main = page.getByRole("main"); await main.getByRole("heading", { name: "Project Treasury", exact: true }).waitFor();
      await page.locator('[data-treasury-ready="true"]').waitFor(); await page.waitForLoadState("networkidle");
      const capability = main.getByRole("group", { name: "Treasury purchase capability", exact: true }), summary = capability.locator(":scope > summary");
      assert.match(await summary.innerText(), /^Buy execution unavailable$/);
      await summary.focus(); assert.equal(await summary.evaluate(el => document.activeElement === el), true);
      await page.keyboard.press("Enter"); assert.equal(await capability.getAttribute("open"), "");
      const text = await capability.innerText();
      assert.match(text, /NOT EXECUTABLE/); assert.match(text, /No independent project-token price reference is admitted/);
      assert.match(text, /not deployed and has no treasury spending authority/); assert.match(text, /Token-denominated earnings do not supply ETH/);
      assert.equal(await main.getByRole("button", { name: /purchase|intent|synthetic|wallet/i }).count(), 0);
      const box = await summary.boundingBox(); assert.ok(box && box.height >= 44 && box.width >= 44);
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); assert.equal(noOverflow, true);
      await capability.scrollIntoViewIfNeeded();
      const media = () => page.evaluate(() => ({ touch: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches }));
      const beforeCapture = await media();
      const screenshot = `${engine}-${name}-purchase-unavailable.png`;
      await page.screenshot({ path: join(output, screenshot) });
      assert.deepEqual(await media(), beforeCapture, "Screenshot must preserve phone touch/pointer emulation");
      assert.deepEqual(walletCalls, []); assert.deepEqual(external, []); assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      layouts.push({ name, viewport: options.viewport, screenshot, noOverflow, summaryHeight: box.height,
        keyboardAccessible: true, capturePreservesEmulation: true, media: beforeCapture,
        walletRequests: walletCalls.length, externalRequests: external.length, operationalRequests: unexpected.length, errors });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
const report = { schemaVersion: 1, scope: "actual-loopback-read-only-build", engine, status: "PASS", physicalIPhoneAcceptance: false,
  capability: { status: "NOT_EXECUTABLE", reason: "INDEPENDENT_REFERENCE_NOT_ADMITTED", deployed: false, spendingAuthority: false },
  missingEvidenceIsUnavailable: true, denied, layouts };
await writeFile(join(output, "browser-capability.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify(report) + "\n");
