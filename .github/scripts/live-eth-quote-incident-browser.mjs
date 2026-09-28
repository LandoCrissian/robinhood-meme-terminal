import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, message, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await pause(100);
  }
  throw new Error(message);
}

const scenarios = [
  { name: "missing-token", tokenMode: "missing", refreshSucceeds: false, outcome: "missing" },
  { name: "delayed-token", tokenMode: "delayed", tokenDelayMs: 900, refreshSucceeds: false, outcome: "success" },
  { name: "expired-token", tokenMode: "ready", header: "expired", outcome: "success" },
  { name: "unlinked-wallet", tokenMode: "ready", header: "unlinked", outcome: "403", desktopOnly: true },
  { name: "server-configuration", tokenMode: "ready", responseStatus: 503, outcome: "503", desktopOnly: true },
  { name: "timeout", tokenMode: "ready", timeout: true, outcome: "timeout", desktopOnly: true },
  { name: "identity-reader-retry", tokenMode: "ready", identityFailure: true, outcome: "identity-retry" },
  { name: "valid-route", tokenMode: "ready", outcome: "success" },
  { name: "no-route", tokenMode: "ready", outcome: "no-route", noRoute: true }
];

/**
 * Exercises the real terminal component and Next quote handler. Provider, RPC,
 * browser-wallet and selected transport failures remain deterministic boundaries.
 */
export async function runLiveEthQuoteIncidentJourneys({
  browser, base, external, identity, expiredIdentity, unlinkedIdentity, output, state, token, identityRetryTokens, noRouteToken, wallet
}) {
  const results = [];
  for (const viewport of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }]
  ]) {
    for (const scenario of scenarios) {
      if (scenario.desktopOnly && viewport[0] === "mobile") continue;
      const context = await browser.newContext({
        viewport: viewport[1],
        ...(viewport[0] === "mobile" ? { isMobile: true, hasTouch: true } : {})
      });
      await context.addInitScript(({ scenario, wallet }) => {
        window.__RMT_QUOTE_IDENTITY_ACCEPTANCE__ = {
          refreshSucceeds: scenario.refreshSucceeds,
          tokenDelayMs: scenario.tokenDelayMs,
          tokenMode: scenario.tokenMode
        };
        window.__LIVE_ETH_QUOTE_WALLET_REQUESTS__ = 0;
        const listeners = new Map();
        window.ethereum = {
          isMetaMask: true,
          on(event, listener) { listeners.set(event, [...(listeners.get(event) ?? []), listener]); },
          removeListener(event, listener) { listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== listener)); },
          async request({ method }) {
            if (method === "eth_chainId") return "0x1237";
            if (method === "eth_accounts" || method === "eth_requestAccounts") return [wallet];
            if (method === "eth_sendTransaction" || /sign/i.test(method)) {
              window.__LIVE_ETH_QUOTE_WALLET_REQUESTS__ += 1;
              throw new Error("No wallet action is permitted in quote incident acceptance");
            }
            return null;
          }
        };
      }, { scenario, wallet });
      const page = await context.newPage();
      const api = [];
      const errors = [];
      let quoteRequests = 0;
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
      page.on("request", (request) => {
        if (new URL(request.url()).origin === base && new URL(request.url()).pathname === "/api/vnext/quotes") {
          if (scenario.identityFailure && quoteRequests === 0) state.metadataUnavailable = true;
          quoteRequests += 1;
        }
      });
      page.on("response", async (response) => {
        const url = new URL(response.url());
        if (url.origin === base && url.pathname.startsWith("/api/vnext/")) {
          const body = await response.json().catch(() => null);
          api.push({ path: url.pathname, status: response.status(), body });
          if (scenario.identityFailure && url.pathname === "/api/vnext/quotes" && response.status() === 503) {
            state.metadataUnavailable = false;
          }
        }
      });
      await page.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === base) {
          if (url.pathname === "/api/vnext/quotes") {
            if (scenario.timeout) {
              await pause(13_000);
              return route.abort("timedout");
            }
            if (scenario.responseStatus === 503) {
              return route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ error: "Trade authentication is not configured.", code: "SERVER_CONFIGURATION_ERROR", retryable: false, stage: "quote", phase: "AUTHENTICATION_FAILED" })
              });
            }
          }
          const headers = request.headers();
          if (headers["privy-id-token"]) {
            const firstQuote = url.pathname === "/api/vnext/quotes" && quoteRequests === 1;
            headers["privy-id-token"] = scenario.header === "expired" && firstQuote
              ? expiredIdentity
              : scenario.header === "unlinked"
                ? unlinkedIdentity
                : identity;
          }
          return route.continue({ headers });
        }
        try {
          const result = external({ url: request.url(), method: request.method(), body: request.postData() });
          return route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
        } catch {
          return route.abort("blockedbyclient");
        }
      });
      const name = `${viewport[0]}-live-eth-${scenario.name}`;
      const selectedToken = scenario.noRoute ? noRouteToken
        : scenario.identityFailure ? identityRetryTokens[viewport[0]] : token;
      const previousPriceDisabled = state.priceDisabled;
      state.priceDisabled = Boolean(scenario.noRoute);
      try {
        await page.goto(`${base}/?market=${selectedToken}&side=buy`, { waitUntil: "domcontentloaded" });
        await page.getByRole("button", { name: "I understand", exact: false }).click({ timeout: 15_000 });
        await page.getByLabel("Exact input amount").waitFor({ timeout: 30_000 });
        const inputAsset = page.getByLabel("Pay with asset");
        if (await inputAsset.inputValue() !== "eip155:4663/native") await inputAsset.selectOption("eip155:4663/native");
        await page.getByLabel("Exact input amount").fill("0.001");

        if (scenario.outcome === "missing") {
          await until(async () => /could not establish the secure trade session/i.test(await page.locator(".vnTradeActionStatus").innerText()), "Missing identity token must become a visible bounded failure");
          assert.equal(quoteRequests, 0, "No quote request may leave the browser without an identity token");
          await page.getByRole("button", { name: "Retry secure session", exact: true }).click();
          await pause(500);
          assert.equal(quoteRequests, 0, "A failed identity retry must not create an unauthenticated quote request");
        } else if (scenario.outcome === "success") {
          await until(() => api.some((entry) => entry.path === "/api/vnext/quotes" && entry.status === 200), `${scenario.name} must reach the real quote handler`);
          await until(async () => !/securing your trading session/i.test(await page.locator(".vnTradeActionDock").innerText()), `${scenario.name} must leave identity recovery`);
          if (scenario.header === "expired") {
            assert.deepEqual(api.filter((entry) => entry.path === "/api/vnext/quotes").map((entry) => entry.status).slice(0, 2), [401, 200], "An expired token gets one supported refresh and one retry");
          }
        } else if (scenario.outcome === "403") {
          await until(() => api.some((entry) => entry.path === "/api/vnext/quotes" && entry.status === 403), "Unlinked wallet must reach the real 403 identity boundary");
          await until(async () => /sign in and select the exact verified trading wallet/i.test(await page.locator(".vnTradeActionStatus").innerText()), "403 must be visible beside the action");
          await pause(9_500);
          assert.equal(quoteRequests, 1, "A linked-wallet mismatch is not retried as token expiry");
        } else if (scenario.outcome === "503") {
          await until(async () => /authentication is not configured/i.test(await page.locator(".vnTradeActionStatus").innerText()), "503 configuration failure must be visible beside the action");
        } else if (scenario.outcome === "timeout") {
          await until(async () => /did not answer before the protected quote timeout/i.test(await page.locator(".vnTradeActionStatus").innerText()), "Timeout must be visible beside the action", 20_000);
        } else if (scenario.outcome === "identity-retry") {
          await until(() => api.some((entry) => entry.path === "/api/vnext/quotes" && entry.status === 503
            && entry.body?.code === "IDENTITY_RPC_UNAVAILABLE" && entry.body?.phase === "IDENTITY_UNAVAILABLE"),
          "The real quote handler must expose the transient identity-reader failure");
          await until(async () => /token identity rpc is temporarily unavailable/i.test(await page.locator(".vnTradeActionStatus").innerText()),
            "Identity failure must be visible beside the trade action");
          await page.getByRole("button", { name: "Retry token verification", exact: true }).click();
          await until(() => api.some((entry) => entry.path === "/api/vnext/quotes" && entry.status === 200),
            "Explicit retry must recover through the real quote handler");
        } else {
          await until(() => api.some((entry) => entry.path === "/api/vnext/quotes" && entry.status === 200), "No-route case must reach the real quote handler");
          await until(async () => /no current route/i.test(await page.locator(".vnTradeActionStatus").innerText()), "Genuine no-route must be visible beside the action");
        }
        assert.equal(await page.evaluate(() => window.__LIVE_ETH_QUOTE_WALLET_REQUESTS__), 0, "Quote readiness never requests a wallet action");
        assert.equal(await page.getByLabel("Pay with asset").inputValue(), "eip155:4663/native", "The selected input remains native ETH");
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), "Quote readiness UI must not overflow horizontally");
        results.push({ viewport: viewport[0], scenario: scenario.name, quoteRequests, statuses: api.filter((entry) => entry.path === "/api/vnext/quotes").map((entry) => entry.status) });
      } finally {
        state.priceDisabled = previousPriceDisabled;
        state.metadataUnavailable = false;
        await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
        await writeFile(path.join(output, `${name}.json`), JSON.stringify({ api, errors, quoteRequests, text: await page.locator("body").innerText() }, null, 2));
        await context.close();
      }
    }
  }
  return results;
}
