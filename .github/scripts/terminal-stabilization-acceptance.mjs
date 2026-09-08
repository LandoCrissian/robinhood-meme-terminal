import assert from "node:assert/strict";

export async function inspectTerminalStabilization(browser, { base, createContext, installRoutes, markets, canonicalDirectoryMarket, riskPayload }) {
  const results = {};
  for (const [label, options] of Object.entries({ desktop: { viewport: { width: 1440, height: 900 } }, mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } })) {
    const context = await createContext(browser, options);
    const page = await context.newPage();
    const timers = new Set();
    let closed = false;
    let generation = 0;
    let failPage = -1;
    let riskPending = false;
    let riskStarted = false;
    let enrichmentResolved = false;
    const calls = [];
    const canonical = markets.map(canonicalDirectoryMarket);
    const first = canonical[0];
    first.canonicalMarkets.push(...Array.from({ length: 8 }, (_, index) => ({ ...first.canonicalMarkets[0],
      sourceId: "uniswap-v4", protocol: "uniswap", version: 4, poolAddress: null,
      poolKey: `0x${(index + 500).toString(16).padStart(64, "0")}`, hooks: `0x${"0".repeat(40)}`,
      fee: index === 0 ? 0x800000 : index === 1 ? 999999 : 3000, tickSpacing: 60
    })));
    const wait = (ms) => new Promise((resolve) => { const timer = setTimeout(() => { timers.delete(timer); resolve(); }, ms); timers.add(timer); });
    try {
      await page.clock.install();
      await installRoutes(page);
      await page.route(/\/api\/vnext\/market-directory(?:\?.*)?$/, async (route) => {
        const cursor = new URL(route.request().url()).searchParams.get("cursor");
        const index = cursor ? Number(cursor.split("_")[1]) : 0;
        if (cursor) assert.equal(cursor.split("_")[0], `g${generation}`, "refresh must follow the new cursor chain");
        calls.push({ generation, index });
        if (index === failPage) return route.fulfill({ status: 503, body: "{}" });
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ canonical: true,
          coverage: "complete", updatedAt: new Date().toISOString(), markets: canonical.slice(index * 18, (index + 1) * 18),
          nextCursor: (index + 1) * 18 < canonical.length ? `g${generation}_${index + 1}` : null }) });
      });
      await page.route(/\/api\/markets\/external(?:\?.*)?$/, async (route) => {
        const contract = new URL(route.request().url()).searchParams.get("contract");
        if (contract) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ markets: markets.filter((market) => market.address.toLowerCase() === contract.toLowerCase()), updatedAt: new Date().toISOString() }) });
        await wait(45000);
        if (closed) return;
        enrichmentResolved = true;
        // Deliberately no later-page assets: enrichment cannot repair a pagination loss.
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ markets: markets.slice(0, 4), updatedAt: new Date().toISOString(), delayedSources: ["fixture-partial-feed"] }) });
      });
      await page.route(/\/api\/markets\/token-risk(?:\?.*)?$/, async (route) => {
        riskStarted = true;
        if (riskPending) { await wait(45000); if (closed) return; }
        const query = new URL(route.request().url()).searchParams;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...riskPayload,
          token: query.get("token"), pair: query.get("pair"), marketVerified: Boolean(query.get("pair")),
          holders: { ...riskPayload.holders, count: null, topHolders: [] },
          domains: { ...riskPayload.domains, holders: "unavailable" } }) });
      });
      await page.route(/\/api\/markets\/(?:wallet-constellation|external-stream|external-trades)(?:\?.*)?$/, (route) => route.fulfill({ status: 503, body: "{}" }));
      const row = options.isMobile ? ".rmtMobileMarketRow" : ".rmtMarketTableRow";
      const start = performance.now();
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.locator(row).first().waitFor();
      const directoryMs = Math.round(performance.now() - start);
      assert.ok(directoryMs <= 2000, `${label}: directory took ${directoryMs}ms`);
      assert.ok(await page.locator(row).count() > 8);
      assert.equal(enrichmentResolved, false);
      await page.getByRole("button", { name: /^All\s+/ }).click();
      for (let n = 0; n < 8 && await page.locator(row).count() < canonical.length; n++) {
        await page.locator(".rmtMarketLoadMore").click();
        await page.waitForTimeout(80);
      }
      assert.equal(await page.locator(row).count(), canonical.length);
      assert.equal(new Set(calls.map((call) => call.index)).size, 3);
      const refresh = async (failed = false) => {
        generation++;
        failPage = failed ? 2 : -1;
        await page.clock.fastForward(300001);
        for (let n = 0; n < 100 && !calls.some((call) => call.generation === generation && call.index === 2); n++) await page.waitForTimeout(25);
        assert.ok(calls.some((call) => call.generation === generation && call.index === 2));
        assert.equal(await page.locator(row).count(), canonical.length, "normal and partial refresh preserve the loaded window");
      };
      await refresh();
      await refresh(true);
      await refresh();
      assert.equal(enrichmentResolved, false);
      failPage = -1;
      await page.goto(`${base}/?market=${first.address}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: "Observed market activity", exact: true }).waitFor();
      assert.equal(await page.getByText("Confirmed activity", { exact: true }).count(), 0);
      await page.getByRole("region", { name: "Exact-pool trade tape", exact: true }).waitFor();
      assert.match(await page.getByLabel("Market activity by time window").innerText(), /buys/);
      await page.getByRole("tab", { name: "Markets", exact: true }).click();
      const card = page.locator(".vnMarketsCard");
      assert.equal(await card.locator(":scope > .vnVerifiedMarkets > a:visible").count(), 3);
      assert.match(await card.innerText(), /Primary canonical market/);
      assert.doesNotMatch(await card.innerText(), /100 found|838\.8608%/);
      assert.match(await card.innerText(), /Dynamic fee/);
      await card.locator("summary").click();
      assert.equal(await card.locator(".vnVerifiedMarkets > a:visible").count(), 9);
      await page.getByRole("tab", { name: "Safety", exact: true }).click();
      await page.locator('[data-evidence-domain="risk"][data-evidence-state="ready"]').waitFor();
      await page.locator('[data-evidence-domain="holders"][data-evidence-state="unavailable"]').waitFor();
      await page.locator('[data-evidence-domain="liquidity"][data-evidence-state="ready"]').waitFor();
      riskPending = true; riskStarted = false;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: "Safety", exact: true }).click();
      for (let n = 0; n < 100 && !riskStarted; n++) await page.waitForTimeout(20);
      assert.equal(riskStarted, true);
      await page.clock.fastForward(15001);
      await page.locator('[data-evidence-domain="risk"][data-evidence-state="unavailable"]').waitFor();
      await page.locator('[data-evidence-domain="liquidity"][data-evidence-state="ready"]').waitFor();
      results[label] = { directoryMs, enrichmentDelayMs: 45000, canonicalPages: 3, loadedBeforeRefresh: canonical.length,
        loadedAfterRefresh: canonical.length, failedRefreshRetention: "PASS", marketDisclosure: "PASS", feeSemantics: "PASS", separateActivityScopes: "PASS", independentSafety: "PASS", boundedLoading: "PASS" };
    } finally {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      await context.close();
    }
  }
  return results;
}
