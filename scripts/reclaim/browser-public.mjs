import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, devices, webkit } from "playwright";

const { values } = parseArgs({ options: { url: { type: "string" }, browser: { type: "string" }, output: { type: "string" } } });
assert.ok(values.url && values.browser && values.output);
const site = new URL(values.url), engine = values.browser, output = values.output;
assert.equal(site.protocol, "http:"); assert.equal(site.hostname, "127.0.0.1"); assert.ok(site.port); assert.equal(site.href, site.origin + "/");
assert.equal(site.username, ""); assert.equal(site.password, ""); assert.ok(["chromium", "webkit"].includes(engine)); assert.ok(isAbsolute(output));
await mkdir(output, { recursive: false });
const denied = [];
for (const body of [{ action: "prepare", operation: "redeem", account: "0x1000000000000000000000000000000000000780", fields: {} },
  { action: "revalidate", review: {} }, { action: "verify", review: {} }, { action: "prepare", operation: "fund", fields: { amountWei: "1" } }]) {
  const result = await fetch(new URL("/api/launchpad/test-reclaim", site), { method: "POST", headers: { Origin: site.origin, "Content-Type": "application/json" },
    body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(15_000) });
  assert.equal(result.status, 404); assert.equal(result.headers.get("set-cookie"), null); denied.push({ action: body.action, operation: body.operation, status: result.status });
}
const result = await fetch(new URL("/api/launchpad/reclaim?campaign=0x1000000000000000000000000000000000000780", site), { redirect: "error", signal: AbortSignal.timeout(15_000) });
assert.equal(result.status, 200); const read = await result.json(); assert.equal(read.status, "unavailable"); assert.equal(read.executionEnabled, false);
assert.match(result.headers.get("cache-control") ?? "", /no-store/);
for (const key of ["reserve", "rewardToken", "collections", "receipts", "rewardPerUnit", "balance", "price"]) assert.equal(read[key], undefined, "Unavailable must not invent " + key);

const browser = await (engine === "webkit" ? webkit : chromium).launch(), layouts = [];
try {
  for (const [name, options] of [["desktop", { viewport: { width: 1440, height: 900 } }], ["portrait", devices["iPhone 13"]], ["landscape", devices["iPhone 13 landscape"]]]) {
    const context = await browser.newContext({ ...options, serviceWorkers: "block" }); const wallet = [], external = [], financial = [], errors = [];
    await context.exposeBinding("unexpectedReclaimWallet", (_source, method) => wallet.push(method));
    await context.addInitScript(() => {
      Object.defineProperty(window, "ethereum", { configurable: true, get() { void window.unexpectedReclaimWallet("provider-read"); return { request: async ({ method }) => { void window.unexpectedReclaimWallet(method); throw Error("Read-only Reclaim cannot use a wallet"); } }; } });
      window.addEventListener("eip6963:requestProvider", () => void window.unexpectedReclaimWallet("wallet-discovery"));
    });
    await context.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== site.origin) { external.push(url.origin); return route.abort(); }
      if (request.method() !== "GET" || /^\/(?:preview-rpc|mcp)(?:\/|$)/.test(url.pathname)
        || url.pathname.startsWith("/api/") && !["/api/account/session", "/api/launchpad/config"].includes(url.pathname)) {
        financial.push(`${request.method()} ${url.pathname}`); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    try {
      const response = await page.goto(new URL("/reclaim", site).href); assert.equal(response.status(), 200);
      const main = page.getByRole("main"); await main.getByRole("heading", { name: "RMT Reclaim", exact: true }).waitFor(); await page.locator('[data-reclaim-ready="true"]').waitFor();
      await page.waitForLoadState("networkidle");
      assert.match(await main.innerText(), /No verified live campaign, new RMT token, price reference or funded reward reserve/);
      assert.match(await main.innerText(), /Escrow, not burn/); assert.match(await main.innerText(), /Only the original claimant/);
      assert.equal(await main.getByRole("button", { name: /Connect test|Confirm test|trade-in|funding|reward|claim|approve|surrender/i }).count(), 0);
      const details = main.getByRole("region", { name: "Reclaim custody and funding" }).locator("details");
      const summary = details.locator(":scope > summary"); await summary.focus(); await page.keyboard.press("Enter"); assert.equal(await details.getAttribute("open"), "");
      const copy = await details.innerText(); assert.match(copy, /nominal goals, not a live price or promise/); assert.match(copy, /local model assumes 1 synthetic RMT = \$0.01/);
      const fields = await main.locator("input:visible, select:visible, button:visible, summary:visible").evaluateAll(items => items.map(el => ({ id: el.id || el.tagName,
        height: el.getBoundingClientRect().height, font: parseFloat(getComputedStyle(el).fontSize), editable: ["INPUT", "SELECT"].includes(el.tagName) })));
      assert.ok(fields.every(field => field.height >= 44 && (!field.editable || name === "desktop" || field.font >= 16)), JSON.stringify(fields));
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth); assert.equal(noOverflow, true);
      const before = await page.evaluate(() => ({ touch: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches }));
      const screenshot = `${engine}-${name}-reclaim-read-only.png`; await page.screenshot({ path: join(output, screenshot) });
      assert.deepEqual(await page.evaluate(() => ({ touch: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches })), before);
      assert.deepEqual(wallet, []); assert.deepEqual(external, []); assert.deepEqual(financial, []); assert.deepEqual(errors, []);
      layouts.push({ name, screenshot, noOverflow, keyboardAccessible: true, capturePreservesEmulation: true, fields, media: before, walletRequests: wallet.length, externalRequests: external.length, financialRequests: financial.length, errors });
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
const report = { schemaVersion: 1, profile: "rmt-reclaim-public-acceptance-v1", status: "PASS", engine, scope: "actual-loopback-read-only-build", physicalIPhoneAcceptance: false,
  productionFinancialExecution: false, liveCampaignAssigned: false, liveTokenAssigned: false, liveUsdReferenceAssigned: false, fabricatedReserve: false, denied, layouts };
await writeFile(join(output, "reclaim-public.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report));
