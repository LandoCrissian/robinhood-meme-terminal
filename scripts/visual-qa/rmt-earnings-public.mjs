import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, devices, webkit } from "playwright";

// This runner never starts a server, activates a flag or submits a wallet call.
// Supply a separately started, unconfigured read-only build. Do not point it at
// the private execution fixture or the production domain.
const site = new URL(process.env.RMT_WEBSITE_PREVIEW_URL ?? "http://127.0.0.1:3205/");
const loopback = site.protocol === "http:" && site.hostname === "127.0.0.1" && site.port;
const netlifyPreview = site.protocol === "https:" && !site.port
  && /^(?:deploy-preview-\d+|[0-9a-f]{24})--[a-z0-9][a-z0-9-]*\.netlify\.app$/.test(site.hostname);
const railwayPreview = site.href === "https://rmt-launch-website-preview.up.railway.app/";
assert.ok(loopback || netlifyPreview || railwayPreview, "Use loopback or an explicitly admitted isolated preview.");
assert.equal(site.href, `${site.origin}/`);
assert.equal(site.username, ""); assert.equal(site.password, "");
const engine = process.env.RMT_WEBSITE_BROWSER ?? "chromium";
assert.ok(["chromium", "webkit"].includes(engine));
const output = process.env.RMT_WEBSITE_PREVIEW_ARTIFACTS ?? join(tmpdir(), "rmt-earnings-public-qa");
const marker = process.env.RMT_WEBSITE_PREVIEW_SECRET_MARKER;
await mkdir(output, { recursive: true });
const beneficiary = "0x1000000000000000000000000000000000000740";
const earningsPath = "/my-launches/earnings", api = "/api/launchpad/earnings";

async function request(path, init = {}) {
  const response = await fetch(new URL(path, site), { redirect: "error", signal: AbortSignal.timeout(20_000), ...init });
  assert.equal(response.headers.get("set-cookie"), null, `${init.method ?? "GET"} ${path} set a cookie`);
  return response;
}
async function json(response) {
  const text = await response.text();
  if (marker) assert.ok(!text.includes(marker), "A private marker appeared in an earnings response");
  return JSON.parse(text);
}

const config = await json(await request("/api/launchpad/config"));
assert.equal(config.status, "disabled");
const session = await json(await request("/api/account/session"));
assert.equal(session.authenticated, false); assert.equal(session.availability, "disabled");
const pageResponse = await request(earningsPath);
assert.equal(pageResponse.status, 200);
assert.match(pageResponse.headers.get("content-type") ?? "", /^text\/html\b/);
assert.match(pageResponse.headers.get("x-robots-tag") ?? "", /noindex/i);
const html = await pageResponse.text();
assert.match(html, /Earnings/); assert.match(html, /Beneficiary wallet/);
if (marker) assert.ok(!html.includes(marker));

const realReads = [];
for (const path of [`${api}?recipient=${beneficiary}`, `${api}/factory?recipient=${beneficiary}`,
  `${api}/history?recipient=${beneficiary}`, `${api}/${beneficiary}?recipient=${beneficiary}`]) {
  const response = await request(path);
  assert.equal(response.status, 503, `${path}: this test requires an unconfigured read-only backend`);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = await json(response);
  assert.equal(body.status, "unavailable"); assert.equal(body.execution, "disabled");
  assert.equal(body.claimableNativeWei, undefined); assert.equal(body.claimableTokenWei, undefined);
  assert.equal(body.launches, undefined, "Unavailable discovery must not fabricate an empty verified page");
  realReads.push({ path, status: response.status, evidence: "actual unconfigured server response" });
}
const invalid = [api, `${api}?recipient=invalid`, `${api}?recipient=${beneficiary}&recipient=${beneficiary}`,
  `${api}?recipient=${beneficiary}&chainId=31337`, `${api}?recipient=${beneficiary}&after=!!!`,
  `${api}?recipient=${beneficiary}&after=${"a".repeat(769)}`,
  `${api}/factory?recipient=${beneficiary}&after=cursor`];
for (const path of invalid) assert.equal((await request(path)).status, 400, path);

const denied = [];
for (const operation of ["curve-claim", "lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token", "creation-fees"]) {
  const response = await request("/api/launchpad/test-earnings", { method: "POST",
    headers: { Origin: site.origin, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "prepare", operation, account: beneficiary, beneficiary, token: beneficiary }) });
  assert.equal(response.status, 404, `Public build admitted ${operation}`);
  denied.push({ path: "/api/launchpad/test-earnings", method: "POST", operation, status: response.status });
}
for (const [path, method] of [["/api/launchpad/production-earnings", "POST"], ["/api/launchpad/test-claim-profiles", "POST"],
  ["/api/launchpad/production-creation", "POST"], ["/api/account/nonce", "POST"],
  ["/api/account/verify", "POST"], ["/api/account/profile", "PATCH"], [earningsPath, "POST"]]) {
  const response = await request(path, { method, headers: { Origin: site.origin, "Content-Type": "application/json",
    ...(path === earningsPath ? { "Next-Action": "invalid" } : {}) }, body: "{}" });
  assert.equal(response.status, 404, `${method} ${path}`);
  denied.push({ path, method, status: response.status });
}

const browser = await (engine === "webkit" ? webkit : chromium).launch();
const checked = [];
try {
  for (const { name, options } of [
    { name: "desktop", options: { viewport: { width: 1440, height: 900 } } },
    { name: "portrait", options: devices["iPhone 13"] },
    { name: "landscape", options: devices["iPhone 13 landscape"] },
  ]) {
    const context = await browser.newContext({ ...options, serviceWorkers: "block" });
    const walletCalls = [], externalRequests = [], operationalRequests = [], errors = [], earningsRequests = [];
    await context.exposeBinding("recordEarningsWalletAccess", (_source, value) => walletCalls.push(value));
    await context.addInitScript(() => {
      const record = value => void window.recordEarningsWalletAccess(value);
      const provider = { request: async ({ method }) => { record(method); throw new Error("Unexpected public wallet request"); },
        on: () => record("provider subscription") };
      Object.defineProperty(window, "ethereum", { configurable: true, get() { record("injected wallet access"); return provider; } });
      window.addEventListener("eip6963:requestProvider", () => record("wallet discovery"));
    });
    let latencyUsed = false;
    await context.route("**/*", async route => {
      const sent = route.request(), url = new URL(sent.url());
      if (url.origin !== site.origin) { externalRequests.push(url.origin); return route.abort(); }
      if (sent.method() === "GET" && url.pathname === api) {
        earningsRequests.push(url.pathname + url.search);
        // Explicit latency injection only; the real server still returns 503.
        // No balances, registration or financial success are mocked.
        if (!latencyUsed) { latencyUsed = true; await new Promise(resolve => setTimeout(resolve, 700)); }
        return route.continue();
      }
      if (sent.method() === "GET" && ["/api/account/session", "/api/launchpad/config"].includes(url.pathname)) return route.continue();
      if (sent.method() !== "GET" || /^\/(?:api|preview-rpc|mcp|\.netlify)(?:\/|$)/.test(url.pathname)) {
        operationalRequests.push(`${sent.method()} ${url.pathname}`); return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const main = page.getByRole("main");
    async function settled(heading) {
      await main.getByRole("heading", { name: heading, exact: true }).waitFor();
      await page.waitForLoadState("networkidle");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${engine}/${name}: horizontal overflow`);
    }
    try {
      assert.equal((await page.goto(new URL("/my-launches", site).href)).status(), 200);
      await settled("My Launches");
      const entry = main.locator(`a[href="${earningsPath}"]`).first();
      await entry.waitFor(); assert.match(await entry.innerText(), /earnings/i);
      await entry.click(); await settled("Earnings");
      const input = main.getByLabel("Beneficiary wallet", { exact: true });
      const submit = main.getByRole("button", { name: "View earnings", exact: true });
      await input.fill("invalid"); await submit.click();
      await main.getByRole("status").filter({ hasText: "Enter a complete beneficiary wallet address." }).waitFor();
      assert.equal(earningsRequests.length, 0, "Invalid address triggered a backend read");

      // Reach the input with real keyboard navigation and retain visible focus.
      await input.fill(""); await submit.focus(); await page.keyboard.press("Shift+Tab");
      assert.equal(await input.evaluate(node => document.activeElement === node), true);
      const focus = await input.evaluate(node => {
        const style = getComputedStyle(node);
        return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, boxShadow: style.boxShadow, fontSize: style.fontSize };
      });
      assert.ok(focus.outlineStyle !== "none" && parseFloat(focus.outlineWidth) > 0 || focus.boxShadow !== "none", `${engine}/${name}: missing keyboard focus`);
      const inputBox = await input.boundingBox(), submitBox = await submit.boundingBox();
      assert.ok(inputBox && inputBox.height >= 44, "Beneficiary input is too small to touch");
      assert.ok(submitBox && submitBox.height >= 44 && submitBox.width >= 44, "Lookup button is too small to touch");
      if (name !== "desktop") assert.ok(parseFloat(focus.fontSize) >= 16, `iPhone input text is ${focus.fontSize}; expected at least 16px to avoid automatic zoom`);
      await page.screenshot({ path: join(output, `earnings-${engine}-${name}-focus.png`), fullPage: true });

      await input.fill(beneficiary);
      const response = page.waitForResponse(r => new URL(r.url()).pathname === api && r.request().method() === "GET");
      await submit.click();
      const loading = main.getByRole("button", { name: "Checking evidence…", exact: true });
      await loading.waitFor(); assert.equal(await loading.isDisabled(), true);
      await main.getByRole("status").filter({ hasText: "Loading recipient-aware registrations…" }).waitFor();
      assert.equal((await response).status(), 503);
      await main.getByRole("status").filter({ hasText: /Earnings unavailable.*failed read does not mean zero/ }).waitFor();
      await page.waitForLoadState("networkidle");
      assert.equal(earningsRequests.length, 1, "The lookup duplicated its read");
      assert.equal(await submit.isEnabled(), true, "Unavailable data stranded the lookup");
      assert.equal(await main.getByText("No matching new-engine registrations at this checkpoint", { exact: true }).count(), 0);
      assert.equal(await main.locator(".lpEarningsSummary, .lpEarningsProject").count(), 0, "Failed read fabricated checked balances");
      assert.equal(await main.getByRole("button", { name: /^(?:Claim|Collect|Release|Confirm|Review claim)/i }).count(), 0);
      await main.getByText("Robinhood Chain 4663 · read-only. Claims and wallet signing are not activated.", { exact: true }).waitFor();
      await settled("Earnings");
      await page.screenshot({ path: join(output, `earnings-${engine}-${name}-unavailable.png`), fullPage: true });

      assert.equal((await page.reload()).status(), 200); await settled("Earnings");
      const trigger = page.getByRole("button", { name: "Connect wallet and profile", exact: true });
      await trigger.focus(); await page.keyboard.press("ArrowDown");
      const menu = page.getByRole("navigation", { name: "Wallet and profile" });
      await menu.waitFor();
      const menuEntry = menu.locator(`a[href="${earningsPath}"]`);
      assert.equal(await menuEntry.count(), 1, "Wallet menu lacks its unique Earnings entry");
      assert.match(await menuEntry.innerText(), /earnings/i);
      await page.keyboard.press("Escape");
      assert.equal(await trigger.getAttribute("aria-expanded"), "false");
      assert.equal(await trigger.evaluate(node => document.activeElement === node), true);
      await trigger.click(); await menuEntry.click(); await settled("Earnings");
      assert.equal(new URL(page.url()).pathname, earningsPath);
      const nav = page.getByRole("navigation", { name: "Launchpad navigation" });
      for (const label of ["Launches", "Create", "My Launches"]) assert.equal(await nav.getByRole("link", { name: label, exact: true }).count(), 1);
      assert.deepEqual(walletCalls, [], "Read-only earnings accessed a wallet");
      assert.deepEqual(externalRequests, [], "Read-only earnings connected outside its origin");
      assert.deepEqual(operationalRequests, [], "Read-only earnings attempted execution or a private API");
      assert.deepEqual(errors, [], "Read-only earnings raised browser errors");
      checked.push({ name, viewport: page.viewportSize(), walletCalls: 0, externalRequests: 0, operationalRequests: 0,
        browserErrors: 0, noHorizontalOverflow: true, inputHeight: inputBox.height, submitHeight: submitBox.height,
        focus, earningsRequests: earningsRequests.length, lookupStatus: "actual server 503", mockedLatencyOnly: latencyUsed });
    } catch (error) {
      await page.screenshot({ path: join(output, `earnings-${engine}-${name}-failure.png`), fullPage: true }).catch(() => undefined);
      const inputState = await page.locator("#earnings-wallet").evaluateAll(nodes => nodes.map(node => ({
        fontSize: getComputedStyle(node).fontSize, height: node.getBoundingClientRect().height,
        focused: node === document.activeElement,
      }))).catch(() => []);
      await writeFile(join(output, `earnings-${engine}-${name}-failure.json`), JSON.stringify({
        status: "failed", engine, layout: name, url: page.url(), viewport: page.viewportSize(),
        reason: String(error.message).slice(0, 1000), inputState,
        walletCalls: walletCalls.length, externalRequests: externalRequests.length,
        operationalRequests: operationalRequests.length, earningsRequests: earningsRequests.length,
        physicalDevice: "not performed",
      }, null, 2) + "\n");
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
const result = { status: "passed", observedAt: new Date().toISOString(), url: site.href, engine,
  environment: loopback ? "unconfigured-loopback-public-build" : "isolated-HTTPS-public-build", realReads,
  invalidQueries: invalid.length, denied, checked, financialSuccessMocked: false, syntheticExecutionPerformed: false,
  physicalDevice: "not performed", privateMarkerCheck: Boolean(marker) };
await writeFile(join(output, `earnings-${engine}-public.json`), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ status: result.status, engine, layouts: checked.length, evidence: output }));
