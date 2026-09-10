import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

export async function runDirectoryQueueBrowserAcceptance(browser, base, completeBody) {
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 375, height: 667 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
    const page = await context.newPage();
    await page.clock.install();
    const held = new Map();
    const attempted = [];
    let active = 0, maximum = 0, automatic = false, quarantine = false;
    const body = (n, enriched) => ({ ...completeBody, coverage: "partial", revalidationComplete: false, stale: true,
      markets: completeBody.markets.slice(n * 15, n * 15 + (enriched ? 15 : 10)),
      nextCursor: n < 4 ? `queue_p${n + 1}` : null,
      quarantinedAddresses: quarantine ? [completeBody.markets[1].address.toLowerCase()] : [] });
    await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: '{"markets":[]}' }));
    await page.route("**/api/vnext/market-directory**", async route => {
      const url = new URL(route.request().url());
      const cursor = url.searchParams.get("cursor");
      const n = cursor ? Number(cursor.slice("queue_p".length)) : 0;
      const enrichment = url.searchParams.has("identityEnrichment");
      if (enrichment) {
        attempted.push(n); maximum = Math.max(maximum, ++active);
        if (!automatic) await new Promise(resolve => held.set(n, resolve));
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body(n, enrichment)) });
      if (enrichment) active--;
    });
    try {
      await page.goto(base, { waitUntil: "domcontentloaded" });
      const enter = page.getByRole("button", { name: /I understand/ });
      await enter.waitFor({ state: "visible", timeout: 20000 });
      await enter.click();
      const start = page.getByRole("button", { name: "Start with live markets", exact: true });
      await start.waitFor({ state: "visible", timeout: 20000 });
      await start.click();
      const all = page.getByRole("button", { name: /^All/ }).first();
      const until = async (condition, message) => {
        for (let i = 0; i < 100; i++) { if (await condition()) return; await delay(100); }
        assert.fail(message);
      };
      const count = expected => until(async () => (await all.innerText().catch(() => "")).replace(/\s/g, "") === `All${expected}`, `expected All ${expected}`);
      await count(10); await all.click();
      for (let n = 1; n < 5; n++) {
        await page.getByRole("button", { name: /^Load more markets/ }).click();
        await count((n + 1) * 10);
      }
      await until(() => held.size === 4, "first four enrichments must start");
      assert.deepEqual(attempted, [0, 1, 2, 3]);
      held.get(0)(); held.delete(0);
      await until(() => held.has(4), "fifth page must drain without refresh or click");
      assert.deepEqual(attempted, [0, 1, 2, 3, 4]);
      for (const release of held.values()) release();
      held.clear(); await count(75);
      automatic = true;
      await page.clock.fastForward(301000); await count(75);
      await until(() => attempted.length === 10, "all five pages must be attempted in next generation");
      quarantine = true;
      await page.clock.fastForward(301000); await count(74);
      assert.ok(maximum <= 4);
      console.log(JSON.stringify({ test: "directory-queue-multipage-browser", viewport, pages: 5, initial: 50, enriched: 75, quarantineRetained: 74, fifthDrained: true, maximum, walletRequests: 0 }));
    } finally {
      automatic = true;
      for (const release of held.values()) release();
      await context.close();
    }
  }
}
