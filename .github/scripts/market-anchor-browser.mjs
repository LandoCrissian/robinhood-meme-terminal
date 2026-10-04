import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// Real canonical directory reader/UI, controlled optional public metric responses. Clock advancement
// covers scanner refresh; quote timing is measured with
// real wall time in stable-refresh-browser, not inferred from this test.
export async function runMarketAnchorBrowser({ browser, base, external, output }) {
  const results = [];
  for (const mobile of [true, false]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
    const page = await context.newPage();
    let changed = false, updates = 0;
    let catalog = [];
    let chartPhase = 'ready', chartRequests = 0;
    const reads = [];
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== base) {
        const result = external({ url: request.url(), method: request.method(), body: request.postData() });
        return route.fulfill({ status: result.status, json: result.body });
      }
      if (url.pathname === '/api/vnext/market-directory' && !url.search) {
        const response = await route.fetch(), body = await response.json();
        reads.push({ status: response.status(), marketCount: body.markets?.length, keys: Object.keys(body) });
        catalog = body.markets ?? [];
        return route.fulfill({ response, json: body });
      }
      if (url.pathname === '/api/markets/external' && !url.search) {
        for (let i = 0; !catalog.length && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 25));
        const markets = catalog.map((row, index, all) => ({ ...row,
            liquidityUsd: (changed ? index + 1 : all.length - index) * 10000,
            volume24h: (changed ? index + 1 : all.length - index) * 1000 }));
        if (changed) updates++;
        return route.fulfill({ status: 200, json: { markets, stale: false, delayedSources: [], updatedAt: new Date().toISOString() } });
      }
      if (url.pathname === '/api/markets/ohlcv') {
        chartRequests++;
        if (chartPhase === 'outage') return route.fulfill({ status: 503, json: { error: 'Controlled optional chart outage' } });
        await new Promise(resolve => setTimeout(resolve, 400));
        const now = Math.floor(Date.now() / 1000);
        return route.fulfill({ status: 200, json: { token: url.searchParams.get('token'), pair: url.searchParams.get('pair'), range: url.searchParams.get('range'), source: 'GeckoTerminal', stale: false,
          candles: [0, 1, 2, 3].map(index => ({ timestamp: now - (3 - index) * 900, open: 1, high: 1.2, low: 0.9, close: chartPhase === 'recovery' ? 1.1 : 1, volume: 10 })) } });
      }
      return route.continue();
    });
    try {
      const startedAt = Date.now();
      const resumeAt = async elapsed => {
        await page.clock.setFixedTime(new Date(startedAt + elapsed));
        await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      };
      await page.goto(base);
      await page.getByRole('button', { name: 'I understand', exact: false }).click();
      await page.locator('.rmtMarketViews .rmtExploreTrigger').first().click();
      await page.getByRole('button', { name: 'Any activity', exact: true }).click();
      const rows = page.locator(mobile ? '.rmtMobileMarketRow' : '.rmtMarketTableRow');
      await rows.first().waitFor();
      await page.waitForFunction(() => performance.getEntriesByName('rmt:market-enrichment:published').length > 0);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const names = () => rows.evaluateAll(rows => rows.map(row => row.querySelector('strong')?.textContent));
      const before = await names(); assert.ok(before.length > 1);
      const heldRow = rows.first();
      await heldRow.scrollIntoViewIfNeeded();
      const beforeBox = await heldRow.boundingBox();
      reads.push({ beforeBox });
      await page.evaluate(() => {
        window.__anchorPointer = [];
        window.addEventListener('pointerdown', event => window.__anchorPointer.push({ type: event.type, target: event.target?.tagName, insideList: Boolean(event.target?.closest('.rmtMarketTable, .rmtMobileMarketList')) }));
      });
      await page.mouse.move(beforeBox.x + beforeBox.width / 2, beforeBox.y + beforeBox.height / 2);
      await page.mouse.down();
      changed = true;
      await resumeAt(300100);
      for (let i = 0; updates === 0 && i < 100; i++) await page.waitForTimeout(50);
      assert.ok(updates > 0, 'real directory timer refreshed public metrics');
      await page.waitForTimeout(200);
      const during = await names();
      const duringBox = await heldRow.boundingBox();
      const anchorMovementPx = Math.abs(duringBox.y - beforeBox.y);
      assert.deepEqual(during, before, 'ready values may update, but rows stay under the pointer');
      assert.equal(anchorMovementPx, 0, 'passive refresh must not move the held row');
      await page.mouse.move(2, 2); await page.mouse.up();
      await page.waitForTimeout(1600);
      if (await page.evaluate(() => window.scrollY > 32)) {
        assert.deepEqual(await names(), before, 'displaced scanner keeps ranking until updates are requested');
        await page.locator('.rmtScannerUpdates button').click();
        await page.waitForTimeout(1600);
      }
      const after = await names();
      assert.notDeepEqual(after, before, 'canonical rank catches up after interaction');
      const result = { evidence: 'MOCKED_LOCAL_BROWSER', clock: 'freshness clock advanced; existing visibility resume schedules refresh', viewport: mobile ? 'mobile' : 'desktop', before, during, after, beforeBox, duringBox, anchorMovementPx, updates };
      results.push(result);
      await writeFile(path.join(output, `market-anchor-${result.viewport}.json`), JSON.stringify(result, null, 2));
      // Actual public chart, controlled optional OHLCV response: initial scaffold,
      // loaded instance, provider outage and recovery without losing range/geometry.
      await rows.filter({ hasText: 'CASHCAT' }).click();
      await page.locator('#vn-asset-heading').waitFor();
      await page.getByRole('tab', { name: '15M', exact: true }).click();
      const chart = page.locator('.vnChart'), shellBox = await chart.boundingBox();
      await chart.locator('.vnChartFrame svg').waitFor();
      await chart.evaluate(element => { window.__anchoredChartSvg = element.querySelector('.vnChartFrame svg'); });
      const loadedBox = await chart.boundingBox();
      chartPhase = 'outage'; const beforeRequests = chartRequests;
      await resumeAt(600200);
      for (let i = 0; chartRequests === beforeRequests && i < 100; i++) await page.waitForTimeout(25);
      await page.waitForTimeout(100);
      assert.ok(chartRequests > beforeRequests, 'existing chart timer reaches optional outage');
      assert.equal(await chart.evaluate(element => element.querySelector('.vnChartFrame svg') === window.__anchoredChartSvg), true);
      assert.equal(await page.locator('.vnChartRanges [aria-selected="true"]').innerText(), '15M');
      const staleBox = await chart.boundingBox();
      chartPhase = 'recovery'; await resumeAt(900300); await page.waitForTimeout(600);
      assert.equal(await chart.evaluate(element => element.querySelector('.vnChartFrame svg') === window.__anchoredChartSvg), true);
      const recoveredBox = await chart.boundingBox();
      const chartMovementPx = Math.max(...[loadedBox, staleBox, recoveredBox].map(box => Math.max(Math.abs(box.y - shellBox.y), Math.abs(box.height - shellBox.height))));
      assert.ok(chartMovementPx <= 1, `chart scaffold movement ${chartMovementPx}px`);
      result.chart = { evidence: 'MOCKED_LOCAL_BROWSER', boundary: 'controlled optional OHLCV API response', shellBox, loadedBox, staleBox, recoveredBox, chartMovementPx, chartRequests, selectedRange: '15M', retainedSvg: true };
      await writeFile(path.join(output, `market-anchor-${result.viewport}.json`), JSON.stringify(result, null, 2));
    } finally {
      await writeFile(path.join(output, `market-anchor-${mobile ? 'mobile' : 'desktop'}-diagnostics.json`), JSON.stringify({ reads, pointer: await page.evaluate(() => window.__anchorPointer), text: await page.locator('body').innerText() }, null, 2));
      await context.close();
    }
  }
  return results;
}
