import assert from "node:assert/strict";

export async function inspectTerminalStabilization(browser, { base, createContext, installRoutes, markets, canonicalDirectoryMarket, riskPayload }) {
  const results = {};
  results.freshWindow = await inspectFreshDirectoryWindow(browser, { base, createContext, installRoutes, markets, canonicalDirectoryMarket });
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
    let directoryMode = "indexed";
    let removedAddress = null;
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
        if (directoryMode === "fallback") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          canonical: true, inventorySource: "curated-fallback", revalidationComplete: false,
          coverage: "partial", updatedAt: new Date().toISOString(), markets: canonical.slice(0, 8), nextCursor: null
        }) });
        const inventory = canonical.filter((market) => market.address !== removedAddress);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ canonical: true,
          inventorySource: "indexed", revalidationComplete: true,
          coverage: directoryMode === "partial" ? "partial" : "complete", stale: directoryMode === "stale",
          updatedAt: new Date().toISOString(), markets: inventory.slice(index * 18, (index + 1) * 18),
          nextCursor: (index + 1) * 18 < inventory.length ? `g${generation}_${index + 1}` : null }) });
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
      // Fresh browser, no server/client last-good window: unavailable is not 0.
      failPage = 0;
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.getByText("Directory temporarily unavailable", { exact: true }).waitFor();
      const unknownCounts = await page.locator(".rmtMarketViews").first().innerText();
      assert.doesNotMatch(unknownCounts, /(?:Active|Trending|New|RWA|All)\s+0(?:\s|$)/);
      assert.match(unknownCounts, /All\s+—/);
      generation++; await page.clock.fastForward(300001);
      await page.getByText("Directory temporarily unavailable", { exact: true }).waitFor();
      assert.match(await page.locator(".rmtMarketViews").first().innerText(), /All\s+—/);
      failPage = -1;
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.locator(row).first().waitFor();
      assert.match(await page.locator(".rmtMarketViews").first().innerText(), /All\s+18/);
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
      const freshness = page.locator(options.isMobile ? ".rmtMobileContextHeading" : ".rmtMarketsHeading");
      const refreshRoot = async () => {
        generation++;
        await page.clock.fastForward(300001);
        for (let n = 0; n < 100 && !calls.some((call) => call.generation === generation && call.index === 0); n++) await page.waitForTimeout(25);
        assert.ok(calls.some((call) => call.generation === generation && call.index === 0));
        await page.waitForTimeout(100);
      };
      directoryMode = "fallback";
      await refreshRoot();
      assert.equal(await page.locator(row).count(), canonical.length, "HTTP 200 fallback retains all loaded rows");
      await freshness.getByText(/Last loaded/).waitFor();
      await refreshRoot();
      assert.equal(await page.locator(row).count(), canonical.length, "repeated fallback does not corrupt the window");
      directoryMode = "indexed"; await refresh();
      await freshness.getByText("Directory ready", { exact: true }).waitFor();
      directoryMode = "stale"; await refresh();
      await freshness.getByText(/Last loaded/).waitFor();
      directoryMode = "partial"; await refresh();
      await freshness.getByText("Directory ready", { exact: true }).waitFor();
      directoryMode = "indexed"; removedAddress = canonical.at(-1).address;
      await refreshRoot();
      for (let n = 0; n < 100 && await page.locator(row).count() !== canonical.length - 1; n++) await page.waitForTimeout(25);
      assert.equal(await page.locator(row).count(), canonical.length - 1, "authoritative removal remains effective");
      directoryMode = "fallback";
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /^All\s+/ }).click();
      await page.locator(row).first().waitFor();
      assert.equal(await page.locator(row).count(), 8);
      await freshness.getByText(/Limited fallback/).waitFor();
      directoryMode = "indexed"; removedAddress = null;
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
        freshUnavailableCounts: "unknown-not-zero", cold503Recovery: "PASS",
        fallbackRetention: "PASS", repeatedFallbackRetention: "PASS", fallbackStatus: "stale", coldFallbackStatus: "limited",
        indexedRecovery: "PASS", legitimateRemoval: "PASS", partialIndexedCoverage: "PASS", staleCanonicalStatus: "PASS",
        loadedAfterRefresh: canonical.length, failedRefreshRetention: "PASS", marketDisclosure: "PASS", feeSemantics: "PASS", separateActivityScopes: "PASS", independentSafety: "PASS", boundedLoading: "PASS" };
    } finally {
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      await context.close();
    }
  }
  return results;
}

async function inspectFreshDirectoryWindow(browser, { base, createContext, installRoutes, markets, canonicalDirectoryMarket }) {
  const results = {};
  const addr = (n) => `0x${n.toString(16).padStart(40, "0")}`;
  const template = canonicalDirectoryMarket(markets[0]);
  const canonical = Array.from({ length: 120 }, (_, i) => {
    const address = addr(50000 + i);
    return { ...template, address, assetId: `eip155:4663/contract:${address}`, name: `Browse ${i}`, symbol: `B${i}`,
      verifiedIdentity: { address, name: `Browse ${i}`, symbol: `B${i}`, decimals: 18 },
      canonicalMarkets: [{ ...template.canonicalMarkets[0], sourceId: "uniswap-v3", protocol: "uniswap", version: 3,
        token0: address, token1: addr(999), poolKey: addr(60000 + i), poolAddress: addr(60000 + i), fee: 3000, tickSpacing: 60, hooks: null }] };
  });
  for (const [label, options] of Object.entries({ desktop: { viewport: { width: 1440, height: 900 } }, mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } })) {
    const context = await createContext(browser, options);
    const page = await context.newPage();
    const timers = new Set();
    let closed = false, mode = "503", generation = 0, reads = 0;
    try {
      await page.clock.install(); await installRoutes(page);
      await page.route(/\/api\/markets\/external(?:\?.*)?$/, async (route) => {
        await new Promise((resolve) => { const timer = setTimeout(resolve, 45000); timers.add(timer); });
        if (!closed) await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ markets: [], updatedAt: new Date().toISOString() }) });
      });
      await page.route(/\/api\/vnext\/market-directory(?:\?.*)?$/, (route) => {
        reads++;
        if (mode === "503") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ canonical: true, error: "Directory evidence unavailable", failureReasons: ["IDENTITY_RPC_UNAVAILABLE"] }) });
        const cursor = new URL(route.request().url()).searchParams.get("cursor");
        const index = cursor ? Number(cursor.split("_")[1]) : 0;
        if (cursor) assert.equal(cursor.split("_")[0], `fresh${generation}`);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ canonical: true, inventorySource: "indexed",
          revalidationComplete: mode !== "PARTIAL", coverage: mode === "PARTIAL" ? "partial" : "complete", stale: mode === "PARTIAL",
          markets: canonical.slice(index * 40, index * 40 + (mode === "PARTIAL" ? 32 : 40)), updatedAt: new Date().toISOString(), nextCursor: index < 2 ? `fresh${generation}_${index + 1}` : null }) });
      });
      await page.goto(base, { waitUntil: "domcontentloaded" });
      await page.getByText("Directory temporarily unavailable", { exact: true }).waitFor();
      assert.match(await page.locator(".rmtMarketViews").first().innerText(), /All\s+—/);
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.getByText("Directory temporarily unavailable", { exact: true }).waitFor();
      assert.match(await page.locator(".rmtMarketViews").first().innerText(), /All\s+—/);
      mode = "GOOD";
      const start = performance.now();
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      const row = options.isMobile ? ".rmtMobileMarketRow" : ".rmtMarketTableRow";
      await page.locator(row).first().waitFor();
      const firstMs = Math.round(performance.now() - start);
      assert.ok(firstMs <= 2000, `${label}: healthy first publication ${firstMs}ms`);
      await page.getByRole("button", { name: /^All\s+/ }).click();
      for (let i = 0; i < 12 && await page.locator(row).count() < 120; i++) { await page.locator(".rmtMarketLoadMore").click(); await page.waitForTimeout(100); }
      assert.equal(await page.locator(row).count(), 120);
      for (const state of ["GOOD", "503", "503", "GOOD", "PARTIAL", "GOOD"]) {
        mode = state; generation++; const prior = reads;
        await page.clock.fastForward(300001);
        for (let i = 0; i < 100 && reads === prior; i++) await page.waitForTimeout(20);
        assert.ok(reads > prior);
        await page.waitForTimeout(150);
        assert.equal(await page.locator(row).count(), 120, `${label}: ${state} must retain the loaded window`);
        assert.match(await page.locator(".rmtMarketViews").first().innerText(), /All\s+120/);
      }
      results[label] = { firstMs, canonicalPages: 3, loaded: 120, sequence: "GOOD_503_503_GOOD_PARTIAL_GOOD", falseZero: false, enrichmentDelayMs: 45000 };
    } finally { closed = true; for (const timer of timers) clearTimeout(timer); await context.close(); }
  }
  return results;
}
