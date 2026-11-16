import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, devices, webkit } from "playwright";
import { mobileConnectionCheck } from "./export-mobile-connection-check.mjs";

const { values: { url: remoteUrl, html: htmlPath } } = parseArgs({
  options: { url: { type: "string" }, html: { type: "string" } },
});
const endpoint = new URL(remoteUrl ?? "https://rmt-review.example.test/");
const url = endpoint.href;
const aliasUrl = remoteUrl && endpoint.pathname === "/" ? new URL("/connection.html", endpoint).href : null;
const payer = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
const delegate = "0x63c0c19a282a1b52b07dd5a65b58948a07dae32b";
const designator = "0xef0100" + delegate.slice(2);
const blockNumber = 115939588;
const blockTag = "0x" + blockNumber.toString(16);
const blockHash = "0x" + "a".repeat(64);
const wrongBlockHash = "0x" + "b".repeat(64);
const correctChain = "0x1237";
const wrongAccount = "0x0000000000000000000000000000000000000001";
const knownRuntimeSha = "c921aae598d4413e7e93d9b69cfce4043c59687bd988c31a41d56fd45094be90";

assert.throws(() => mobileConnectionCheck("http://example.test/connection.html"));
assert.throws(() => mobileConnectionCheck("https://example.test/connection.html?copy=1"));
assert.throws(() => mobileConnectionCheck("https://example.test/?copy=1"));
assert.equal(Boolean(remoteUrl), Boolean(htmlPath), "A remote check requires --url and the generated --html file");
if (remoteUrl) assert.ok(process.env.RMT_CHECKER_DELEGATE_RUNTIME, "Supply the independently verified raw-hex fixture in RMT_CHECKER_DELEGATE_RUNTIME");
const runtime = remoteUrl
  ? readFileSync(process.env.RMT_CHECKER_DELEGATE_RUNTIME, "utf8").trim()
  : "0x600560005260206000f3";
assert.match(runtime, /^0x(?:[a-f0-9]{2})+$/i);
const runtimeBytes = Buffer.from(runtime.slice(2), "hex");
const runtimeSha256 = createHash("sha256").update(runtimeBytes).digest("hex");
if (remoteUrl) assert.equal(runtimeSha256, knownRuntimeSha, "Remote success fixture must supply the reviewed 4663 runtime");
const runtimeOptions = { runtimeSha256, runtimeByteLength: runtimeBytes.length };
const html = remoteUrl ? readFileSync(htmlPath, "utf8") : mobileConnectionCheck(url, runtimeOptions);

if (remoteUrl) {
  const read = (target, options) => fetch(target, { ...options, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  const served = await read(url);
  assert.equal(served.status, 200, "Exact HTTPS URL must serve the checker directly");
  assert.match(served.headers.get("content-type") ?? "", /^text\/html\b/i);
  assert.equal(await served.text(), html, "Hosted file differs from the reviewed generated checker");
  const directives = (served.headers.get("content-security-policy") ?? "").split(";").map((value) => value.trim());
  for (const expected of ["default-src 'none'", "frame-ancestors 'none'", "connect-src 'none'"]) {
    assert.ok(directives.includes(expected), "Missing hosted CSP directive: " + expected);
  }
  assert.equal(served.headers.get("referrer-policy"), "no-referrer");
  assert.match(served.headers.get("cache-control") ?? "", /\bno-store\b/i);
  assert.match(served.headers.get("x-robots-tag") ?? "", /\bnoindex\b/i);
  assert.equal(served.headers.has("access-control-allow-origin"), false);
  if (aliasUrl) {
    const alias = await read(aliasUrl);
    assert.equal(alias.status, 302, "The old checker path must redirect to the preview root");
    const location = alias.headers.get("location");
    assert.ok(location, "The old checker path must provide a redirect destination");
    assert.equal(new URL(location, aliasUrl).href, url, "The old checker path must redirect to the exact same-origin root");
    await alias.body?.cancel();
  }

  for (const path of ["/api/launchpad/test-creation", "/api/launchpad/test-lifecycle", "/api/launchpad/test-mobile-review",
    "/wallet/mobile-review", "/create", "/api/rpc"]) {
    const target = new URL(path, url);
    const headers = { Origin: "https://separate-client.example.test" };
    for (const method of ["GET", "POST"]) {
      const body = method === "POST" ? "{}" : undefined;
      const denied = await read(target, { method, headers: { ...headers, ...(body && { "Content-Type": "application/json" }) }, body });
      assert.equal(denied.status, 404,
        "Execution or proxy route is reachable: " + method + " " + path + " (" + denied.status + ")");
      assert.equal(denied.headers.has("access-control-allow-origin"), false, "Unexpected CORS permission: " + path);
      await denied.body?.cancel();
    }
    // Netlify emits an empty platform-level preflight even for missing static paths.
    // The real cross-origin data requests above must both be denied.
    const preflight = await read(target, { method: "OPTIONS", headers: { ...headers,
      "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type" } });
    assert.equal(preflight.status, 200);
    assert.equal(preflight.headers.get("server"), "Netlify");
    assert.ok([null, "*"].includes(preflight.headers.get("access-control-allow-origin")));
    assert.equal(preflight.headers.has("access-control-allow-credentials"), false);
    assert.equal(await preflight.text(), "");
  }
  console.log("Actual remote HTTPS body, security headers, and execution/proxy route denials verified: " + url);
}

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...devices["iPhone 13"], serviceWorkers: "block" });
    page.setDefaultTimeout(10_000);
    const unexpectedRequests = [];
    const navigationUrls = new Set(aliasUrl ? [url, aliasUrl] : [url]);
    const allowedNavigation = (request) =>
      request.isNavigationRequest() && request.method() === "GET" && navigationUrls.has(request.url());
    if (remoteUrl) page.on("request", (request) => {
      if (!allowedNavigation(request)) unexpectedRequests.push(request.method() + " " + request.url());
    });
    let fixtureHtml = html;
    await page.route("**/*", (route) => {
      if (route.request().isNavigationRequest()) {
        if (!remoteUrl) return route.fulfill({ contentType: "text/html", body: fixtureHtml });
        if (allowedNavigation(route.request())) return route.continue();
      }
      if (!remoteUrl) unexpectedRequests.push(route.request().method() + " " + route.request().url());
      return route.abort();
    });
    const check = page.getByRole("button", { name: "Check connection" });
    const status = (text) => page.getByRole("status").filter({ hasText: text }).waitFor();
    if (!remoteUrl) {
      await page.goto(new URL("/copied.html", url).href);
      assert.equal(await check.isEnabled(), false);
      fixtureHtml = mobileConnectionCheck(url, { ...runtimeOptions, expiresAt: Date.now() - 1000 });
      await page.goto(url);
      await status(/temporary connection check has expired/i);
      assert.equal(await check.isEnabled(), false);
      fixtureHtml = html;
    }
    const first = await page.goto(aliasUrl ?? url);
    assert.equal(first?.status(), 200);
    assert.equal(page.url(), url);
    if (aliasUrl) {
      const alias = first.request().redirectedFrom();
      assert.equal(alias?.url(), aliasUrl, "Browser must follow the real old-path redirect");
      assert.equal(alias.redirectedFrom(), null, "Expected one redirect to the preview root");
      assert.equal((await alias.response())?.status(), 302);
    }
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
    await check.click();
    await status(/no compatible injected wallet/i);

    let account = wrongAccount, chain = correctChain;
    let denied = false, reorged = false, stale = false;
    let walletCode = designator, delegateCode = runtime;
    const calls = [];
    const forbidden = [];
    await page.exposeFunction("checkWalletRead", ({ method, params }) => {
      calls.push(method);
      switch (method) {
        case "eth_requestAccounts":
          return denied ? { denied: true } : { value: [account] };
        case "eth_accounts":
          return { value: [account] };
        case "eth_chainId":
          return { value: chain };
        case "eth_getBlockByNumber":
          assert.equal(params?.length, 2);
          assert.ok(["latest", blockTag].includes(params[0]));
          assert.equal(params[1], false);
          return { value: { number: blockTag, hash: reorged && params[0] === blockTag ? wrongBlockHash : blockHash,
            timestamp: "0x" + (Math.floor(Date.now() / 1000) - (stale ? 600 : 0)).toString(16) } };
        case "eth_getCode":
          assert.equal(params?.length, 2);
          assert.equal(params[1], blockTag, "Never accept unanchored code evidence");
          if (params[0]?.toLowerCase() === payer.toLowerCase()) return { value: walletCode };
          assert.equal(params[0]?.toLowerCase(), delegate);
          return { value: delegateCode };
        default:
          forbidden.push(method);
          throw new Error("Only wallet permission and verification reads are allowed");
      }
    });
    await page.addInitScript(() => {
      const listeners = new Map();
      window.ethereum = {
        on: (event, listener) => { listeners.set(event, listener); },
        request: async (intent) => {
          const response = await window.checkWalletRead(intent);
          if (response.denied) throw Object.assign(new Error("Declined"), { code: 4001 });
          return response.value;
        },
      };
      window.walletChanged = () => listeners.get("chainChanged")();
    });
    await page.goto(url);
    await check.waitFor();
    assert.deepEqual(calls, [], "Opening the page cannot request wallet permissions");
    assert.match(await page.locator("main").innerText(), /public address/i);
    const connectionReads = ["eth_requestAccounts", "eth_accounts", "eth_chainId"];
    const anchoredReads = ["eth_getBlockByNumber", "eth_getCode", "eth_getCode", "eth_getBlockByNumber"];
    const attempt = async (expectedStatus) => {
      const from = calls.length;
      await check.click();
      await status(expectedStatus);
      return calls.slice(from);
    };
    assert.deepEqual(await attempt(/select the proposed deployment account/i), connectionReads);
    account = payer;
    chain = "0x7a69";
    assert.deepEqual(await attempt(/select Robinhood Chain 4663/i), connectionReads);
    chain = correctChain;
    denied = true;
    assert.deepEqual(await attempt(/wallet connection declined or unavailable/i), ["eth_requestAccounts"]);
    denied = false;
    walletCode = "0x";
    await attempt(/current delegation does not match/i);
    walletCode = "0xef0100" + wrongAccount.slice(2);
    await attempt(/current delegation does not match/i);
    walletCode = designator;
    delegateCode = runtime.slice(0, -2) + (runtime.endsWith("ff") ? "00" : "ff");
    await attempt(/delegate runtime did not match/i);
    delegateCode = runtime;
    reorged = true;
    await attempt(/code or block evidence is unavailable/i);
    reorged = false;
    stale = true;
    assert.deepEqual(await attempt(/code or block evidence is unavailable/i), [...connectionReads, "eth_getBlockByNumber"]);
    stale = false;
    assert.deepEqual(await attempt(new RegExp("expected delegation and runtime matched at block " + blockNumber, "i")),
      [...connectionReads, ...anchoredReads, "eth_accounts", "eth_chainId"]);
    assert.deepEqual(forbidden, [], "A signing, transaction or unsupported wallet method was requested");
    assert.deepEqual(unexpectedRequests, [], "The page attempted to load an additional resource or transmit data");
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Portrait content must fit");
    if (process.env.RMT_WEBSITE_PREVIEW_ARTIFACTS) {
      await page.screenshot({ path: join(process.env.RMT_WEBSITE_PREVIEW_ARTIFACTS, "iphone-connection-" + name + ".png") });
    }
    await page.setViewportSize({ width: 844, height: 390 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Landscape content must fit");
    await page.evaluate(() => window.walletChanged());
    await status(/wallet selection changed/i);
  } finally {
    await browser.close();
  }
  console.log((remoteUrl ? "Actual remote HTTPS" : "Local HTTPS fixture") + " connection-only checks passed on " + name + " with an injected wallet test double");
}
