import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { VISIBLE_TOKEN_MARKETS, canonicalDirectoryMarkets } from './legion-fixtures.mjs';

// Presentation-only acceptance: real public components/application timers,
// controlled chart HTTP responses. Reader/Next/handler behavior is tested in
// chart-cold-cache-smoke.ts. This does not claim authenticated/live trading.
const base = process.env.RMT_VISUAL_BASE_URL ?? 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local acceptance only');
const output = path.resolve(process.env.RMT_VISUAL_OUTPUT ?? 'terminal-visual-v2', 'chart-refresh');
const fixture = JSON.parse(await readFile('apps/web/lib/server/chart-cold-cache-fixtures.json', 'utf8'))[2];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  await Promise.all([['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]].map(async ([profile, viewport]) => {
    const context = await browser.newContext({ viewport, isMobile: profile === 'mobile', hasTouch: profile === 'mobile', recordVideo: { dir: path.join(output, 'videos'), size: viewport } });
    const page = await context.newPage(), errors = [], states = [], samples = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__chartFinancialRequests = 0;
      window.ethereum = { on() {}, removeListener() {}, async request({ method }) {
        if (/sign|sendTransaction|wallet_sendCalls/.test(method)) { window.__chartFinancialRequests++; throw Error('Financial request not authorized'); }
        return method === 'eth_chainId' ? '0x1237' : [];
      } };
    });
    await page.route('**/api/**', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'CONTROLLED_OPTIONAL_EVIDENCE_UNAVAILABLE' }) }));
    await page.route(/\/api\/markets\/external(?:\?.*)?$/, route => route.fulfill({ json: { markets: VISIBLE_TOKEN_MARKETS, source: 'CONTROLLED_DIRECTORY', updatedAt: new Date().toISOString(), stale: false, stockAssetCoverage: 'complete' } }));
    await page.route(/\/api\/vnext\/market-directory(?:\?.*)?$/, route => route.fulfill({ json: { canonical: true, coverage: 'complete', nextCursor: null, markets: canonicalDirectoryMarkets(), updatedAt: new Date().toISOString() } }));
    let reads = 0;
    await page.route('**/api/markets/ohlcv?**', async route => {
      const url = new URL(route.request().url()), index = reads++;
      const state = ['FRESH', 'RETAINED_STALE', 'DELAYED_REFRESH', 'PROVIDER_FAILURE', 'RECOVERY'][Math.min(index, 4)];
      states.push({ state, range: url.searchParams.get('range'), at: Date.now() });
      if (state === 'DELAYED_REFRESH') await pause(1500);
      if (state === 'PROVIDER_FAILURE') return route.fulfill({ status: 503, json: { error: 'Price history is temporarily unavailable.' } });
      return route.fulfill({ json: { token: fixture.contract, pair: fixture.pool, range: url.searchParams.get('range'), candles: fixture.candles, source: 'GeckoTerminal', coverage: 'AVAILABLE', updatedAt: state === 'RETAINED_STALE' ? new Date(Date.now() - 120000).toISOString() : new Date().toISOString(), refreshMs: 30000, stale: state === 'RETAINED_STALE', lastTradeAt: null } });
    });
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 90000 });
      const consent = page.getByRole('button', { name: 'I understand', exact: false });
      await consent.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      if (await consent.isVisible()) await consent.click();
      await page.locator(profile === 'mobile' ? '.rmtMobileMarketRow' : '.rmtMarketTableRow').filter({ hasText: 'STONKBROKER' }).click();
      await page.locator('#vn-asset-heading').waitFor();
      await page.locator('.vnChartFrame svg').waitFor();
      if (profile === 'mobile') await page.locator('.rmtMobileTradeDock .isBuy').click();
      const input = page.getByLabel('Exact input amount', { exact: true }); await input.waitFor();
      await page.getByLabel('Pay with asset', { exact: true }).selectOption('eip155:4663/native');
      await input.fill('0.0005');
      await page.locator('.vnRouteCard > summary').click();
      await pause(1500); // Exclude intentional sheet-open animation/user navigation.
      await input.evaluate(node => { node.focus(); node.setSelectionRange(2, 2); window.__chartInput = node; window.__chartNode = document.querySelector('.vnChart'); const scroll = document.querySelector('.vnTradeScroll'); if (scroll) scroll.scrollTop = 30; });
      const measure = async () => samples.push(await page.evaluate(() => {
        const box = selector => { const b = document.querySelector(selector)?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null; };
        const input = window.__chartInput;
        return { at: Date.now(), amount: input.value, caret: [input.selectionStart, input.selectionEnd], focused: document.activeElement === input, sameInput: document.querySelector('input[aria-label="Exact input amount"]') === input, sameChart: document.querySelector('.vnChart') === window.__chartNode, scroll: [scrollX, scrollY, document.querySelector('.vnTradeScroll')?.scrollTop ?? null], payment: document.querySelector('select[aria-label="Pay with asset"]')?.value, range: document.querySelector('.vnChartRanges [aria-selected="true"]')?.textContent, details: document.querySelector('.vnRouteCard')?.open, chart: box('.vnChart'), action: box('.vnTradeActionDock'), buySell: box('.rmtMobileTradeDock'), overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), walletRequests: window.__chartFinancialRequests };
      }));
      await measure(); await page.screenshot({ path: path.join(output, `${profile}-fresh.png`) });
      // Real existing 30-second chart timer, no timer acceleration/manual fetch.
      for (let i = 0; i < 27; i++) { await pause(5000); await measure(); }
      assert.ok(states.some(state => state.state === 'RECOVERY'), `${profile}: real timer reached recovery`);
      const first = samples[0];
      for (const sample of samples) {
        for (const key of ['amount', 'caret', 'focused', 'sameInput', 'sameChart', 'scroll', 'payment', 'range', 'details', 'chart', 'action', 'buySell']) assert.deepEqual(sample[key], first[key], `${profile}: ${key} remains stable`);
        assert.equal(sample.walletRequests, 0); assert.ok(sample.overflow <= 1);
      }
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, `${profile}-recovered.png`) });
      results.push({ profile, viewport, scope: 'CONTROLLED_CHART_HTTP_REAL_PUBLIC_COMPONENTS_SIGNED_OUT_EMULATED_VIEWPORT_NOT_PHYSICAL_IPHONE', states, samples, errors, financialRequests: 0, measuredControlMovementPx: 0 });
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${profile}-failure.png`) }).catch(() => {});
      results.push({ profile, viewport, states, samples, failure: { name: error.name, message: error.message.slice(0, 400) } });
      throw error;
    } finally { await context.close(); }
  }));
} finally {
  await browser.close();
  await writeFile(path.join(output, 'stability.json'), JSON.stringify({ head: process.env.RMT_REVIEWED_HEAD ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checkoutTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(), identityProfile: process.env.NEXT_PUBLIC_RMT_PRIVY_BRIDGE_ACCEPTANCE_PROFILE === 'true' ? 'CONTROLLED_PRIVY_SDK_BOUNDARY_REAL_IDENTITY_BRIDGE_SIGNED_OUT' : 'NO_PRIVY_SDK_ACCEPTANCE_PROFILE', results }, null, 2));
}
console.log(JSON.stringify({ chartRefreshPresentation: results.map(({ profile, states, financialRequests, measuredControlMovementPx }) => ({ profile, states, financialRequests, measuredControlMovementPx })) }));
