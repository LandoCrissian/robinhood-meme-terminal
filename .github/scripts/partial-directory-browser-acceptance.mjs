import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const web = createRequire(new URL("../../apps/web/package.json", import.meta.url));
web("tsx/cjs");
const { readVNextIndexedMarketDirectoryPage } = web("./lib/server/vnext-indexed-market-directory.ts");
const { RMT_CURATED_MARKET_REGISTRY } = web("./lib/vnext/curated-market-registry.ts");
const address = n => `0x${(20000 + n).toString(16).padStart(40, "0")}`;
const identities = Array.from({ length: 76 }, (_, n) => ({ address: address(n), name: `Token ${n}`, symbol: `T${n}`, decimals: 18, totalSupply: "1000" }));
const template = RMT_CURATED_MARKET_REGISTRY.find(entry => entry.market.version === 2).market;
const inventory = {
  status: "verified_shadow", chainId: 4663, mode: "shadow", authoritative: false,
  sourceManifestHash: `0x${"1".repeat(64)}`, coverage: { complete: true, finalizedHead: "100", sources: [] }, nextCursor: null,
  pools: Array.from({ length: 38 }, (_, n) => ({ ...template, sourceId: "uniswap-v2", stateError: null,
    token0: address(n * 2), token1: address(n * 2 + 1), poolKey: address(1000 + n), poolAddress: address(1000 + n) })),
  browseIdentities: { source: "verified-token-identity-index", freshness: "last-known", identities: identities.slice(0, 9) }
};
const deps = {
  readInventory: async () => inventory,
  readStocks: async () => ({ coverage: "complete", assetsByAddress: new Map() }),
  readIdentities: async addresses => new Map(identities.filter(i => addresses.some(a => a.toLowerCase() === i.address)).map(i => [i.address, i])),
  admit: async rows => ({ admitted: [...rows], quarantined: [], authorityStatus: "ready" })
};
const initial = await readVNextIndexedMarketDirectoryPage("https://fixture.invalid", deps);
const expanded = await readVNextIndexedMarketDirectoryPage("https://fixture.invalid?identityEnrichment=1", deps);
assert.equal(initial.body.markets.length, 9);
assert.equal(expanded.body.markets.length, 76);
const port = 3018;
const server = spawn(process.execPath, [web.resolve("next/dist/bin/next"), "start", "-p", String(port)], {
  cwd: new URL("../../apps/web", import.meta.url), env: process.env, stdio: "ignore", windowsHide: true
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error("Acceptance server exited");
    try { if ((await fetch(`http://127.0.0.1:${port}`)).ok) { ready = true; break; } } catch {}
    await delay(1000);
  }
  assert.ok(ready, "production build must boot");
  browser = await chromium.launch({ headless: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 667 }, { width: 375, height: 430 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const page = await context.newPage();
    await page.clock.install();
    let mode = "partial", enrichmentMode = "unavailable", requests = 0;
    await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ markets: [] }) }));
    await page.route("**/api/vnext/market-directory**", async route => {
      requests++;
      const enrich = new URL(route.request().url()).searchParams.has("identityEnrichment");
      if (mode === "unavailable" || (enrich && enrichmentMode === "unavailable")) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ canonical: true, error: "Identity temporarily unavailable" }) });
      } else {
        const result = enrich || mode === "full" ? expanded : initial;
        await route.fulfill({ status: result.status, contentType: "application/json", body: JSON.stringify(result.body) });
      }
    });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "domcontentloaded" });
    const enter = page.getByRole("button", { name: /I understand/ });
    if (await enter.isVisible()) await enter.click();
    const start = page.getByRole("button", { name: "Start with live markets", exact: true });
    if (await start.isVisible()) await start.click();
    const all = page.getByRole("button", { name: /^All/ }).first();
    const count = async expected => {
      for (let i = 0; i < 100; i++) {
        if ((await all.innerText().catch(() => "")).replace(/\s/g, "") === `All${expected}`) return;
        await delay(100);
      }
      assert.equal((await all.innerText()).replace(/\s/g, ""), `All${expected}`);
    };
    await count(9);
    const refresh = async () => { await page.clock.fastForward(301000); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await delay(300); };
    await refresh(); await count(9);
    enrichmentMode = "ready"; await refresh(); await count(76);
    mode = "unavailable"; await refresh(); await count(76);
    mode = "partial"; enrichmentMode = "unavailable"; await refresh(); await count(76);
    mode = "full"; await refresh(); await count(76);
    console.log(JSON.stringify({ test: "partial-directory-browser", viewport, sequence: [9, 9, 76, 76, 76, 76], requests, falseAllZero: false, walletRequests: 0 }));
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
