import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Real workspace/chart/quote components and real RMT routes. Only upstream
// Gecko/RPC/0x/SDK transports are controlled. No direct POST substitutes for UI.
export async function runTokenEnrichmentBrowser({ browser, base, identity, external, state, wallet, token, output }) {
  const results = [];
  for (const [profile, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    state.enrichmentToken = token; state.enrichmentMode = 'ready'; state.enrichmentCalls = [];
    const context = await browser.newContext({ viewport, isMobile: profile === 'mobile', hasTouch: profile === 'mobile', recordVideo: { dir: path.join(output, 'videos'), size: viewport } });
    await context.addInitScript(({ wallet }) => {
      window.__enrichmentWalletCalls = 0;
      window.ethereum = { isMetaMask: true, on(){}, removeListener(){}, async request({ method }) {
        if (method === 'eth_chainId') return '0x1237';
        if (['eth_accounts', 'eth_requestAccounts'].includes(method)) return [wallet];
        if (/sign|sendTransaction/.test(method)) { window.__enrichmentWalletCalls++; throw new Error('No financial request authorized by enrichment test'); }
        return null;
      }};
    }, { wallet });
    const page = await context.newPage(); const requests = [], errors = [], delayedPublications = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const url = new URL(request.url()); if (url.origin === base && /\/api\/(?:vnext|markets)/.test(url.pathname)) requests.push({ path: url.pathname, query: url.search, method: request.method() }); });
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === base) {
        const headers = request.headers(); if (headers['privy-id-token']) headers['privy-id-token'] = identity;
        if (url.pathname === '/api/vnext/asset-workspace' && ['core', 'visual'].includes(url.searchParams.get('view'))) {
          const response = await route.fetch({ headers });
          const view = url.searchParams.get('view');
          await pause(view === 'core' ? 6000 : 8000);
          delayedPublications.push(view);
          return route.fulfill({ response });
        }
        return route.continue({ headers });
      }
      const result = external({ url: request.url(), method: request.method(), body: request.postData() });
      return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
    });
    try {
      const navigationStart = Date.now();
      await page.goto(`${base}/?market=${token}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'I understand', exact: false }).click();
      await page.locator('#vn-asset-heading').waitFor();
      const shellMs = Date.now() - navigationStart;
      assert.equal(delayedPublications.length, 0, 'Known shell is visible before delayed identity/visual responses');
      await page.locator('.vnChartFrame svg').waitFor({ timeout: 30000 });
      assert.equal(delayedPublications.includes('visual'), false, 'Ready chart is independent of slow visual metadata');
      await page.screenshot({ path: path.join(output, `enrichment-${profile}-initial.png`) });
      assert.ok(requests.some(request => request.path === '/api/markets/ohlcv' && !new URLSearchParams(request.query).has('pair')), 'Poolless workspace requests chart by exact token');
      if (profile === 'desktop') {
        assert.ok(state.enrichmentCalls.some(call => call.endsWith('/pools')), 'Server discovers exact-token pools');
        assert.ok(state.enrichmentCalls.some(call => call.includes('/ohlcv/')), 'Discovered pool reaches real OHLCV reader');
      }
      await page.locator('.vnAssetTechnicalDetails > summary').click();
      await page.getByText('Controlled provider description', { exact: true }).waitFor();
      assert.equal(await page.getByText('No owner-confirmed token/project relationship recorded.', { exact: false }).count(), 1);
      await page.getByRole('tab', { name: '15M', exact: true }).click();
      await page.locator('.vnChartFrame svg').waitFor();
      await page.screenshot({ path: path.join(output, `enrichment-${profile}-workspace.png`), fullPage: true });
      if (profile === 'mobile') await page.locator('.rmtMobileTradeDock .isBuy').click();
      const input = page.getByLabel('Exact input amount'); await input.waitFor();
      await page.getByLabel('Pay with asset', { exact: true }).selectOption('eip155:4663/native');
      const authorized = page.waitForResponse(response => response.url().endsWith('/api/vnext/authorize') && response.status() === 200);
      await input.fill('0.0005'); await authorized;
      await page.evaluate(() => { const input = document.querySelector('[aria-label="Exact input amount"]'); window.__enrichmentInput = input; window.__enrichmentChart = document.querySelector('.vnChart'); input.focus({ preventScroll: true }); input.setSelectionRange(3, 3); });
      const measure = () => page.evaluate(() => { const input = document.querySelector('[aria-label="Exact input amount"]'); const chart = document.querySelector('.vnChart'); const rect = chart.getBoundingClientRect(); return { amount: input.value, caret: [input.selectionStart, input.selectionEnd], focused: document.activeElement === input, sameInput: input === window.__enrichmentInput, sameChart: chart === window.__enrichmentChart, chart: { height: rect.height, width: rect.width }, range: document.querySelector('.vnChartRanges [aria-selected="true"]')?.textContent, scroll: document.querySelector('.vnTradeScroll')?.scrollTop ?? scrollY, walletCalls: window.__enrichmentWalletCalls, overflow: document.documentElement.scrollWidth - innerWidth }; });
      const before = await measure(); state.enrichmentMode = 'outage';
      await pause(65000); // Real chart and existing 60s workspace timer cycles.
      const after = await measure();
      for (const key of ['amount', 'caret', 'focused', 'sameInput', 'sameChart', 'chart', 'range', 'scroll']) assert.deepEqual(after[key], before[key], `${profile} ${key} stable across enrichment outage/refresh`);
      assert.equal(after.walletCalls, 0); assert.ok(after.overflow <= 1); assert.deepEqual(errors, []);
      assert.ok(await page.locator('.vnChartFrame svg').count(), 'Last-good chart remains present on outage');
      await page.screenshot({ path: path.join(output, `enrichment-${profile}-outage-ticket.png`) });
      results.push({ profile, evidence: 'CONTROLLED_EXTERNAL_BOUNDARIES_REAL_PUBLIC_COMPONENTS_AND_HANDLERS', shellMs, delayedPublications, before, after, upstreamCalls: state.enrichmentCalls, requests, errors, financialRequests: 0 });
    } finally { await context.close(); delete state.enrichmentToken; delete state.enrichmentMode; }
  }
  await writeFile(path.join(output, 'token-enrichment-browser.json'), JSON.stringify(results, null, 2));
  return results;
}

export function tokenEnrichmentExternal(url, state) {
  if (url.hostname !== 'api.geckoterminal.com' || !state.enrichmentToken) return null;
  const token = state.enrichmentToken.toLowerCase(); const pool = `0x${'cd'.repeat(32)}`; const root = '/api/v2/networks/robinhood';
  if (![`${root}/tokens/${token}/info`, `${root}/tokens/${token}/pools`, `${root}/pools/${pool}/ohlcv/minute`, `${root}/pools/${pool}/ohlcv/hour`].includes(url.pathname)) return null;
  state.enrichmentCalls.push(url.pathname);
  if (state.enrichmentMode === 'outage') return { status: 503, body: { error: 'Controlled enrichment-only provider outage' } };
  if (url.pathname.endsWith('/info')) return { status: 200, body: { data: { id: `robinhood_${token}`, attributes: { address: token, name: 'Controlled provider token', symbol: 'CTRL', image_url: null, description: 'Controlled provider description', websites: ['https://project.example/'] } } } };
  if (url.pathname.endsWith('/pools')) return { status: 200, body: { data: [{ id: `robinhood_${pool}`, attributes: { address: pool, reserve_in_usd: '2500', base_token_price_usd: '0.001', volume_usd: { h24: '12' } }, relationships: { base_token: { data: { id: `robinhood_${token}` } }, quote_token: { data: { id: `robinhood_0x${'0'.repeat(40)}` } }, dex: { data: { id: 'unfamiliar-provider-route' } } } }] } };
  return { status: 200, body: { data: { attributes: { ohlcv_list: Array.from({ length: 12 }, (_, index) => [Math.floor(Date.now() / 1000) - (12 - index) * 60, .001, .0012, .0009, .0011, index + 1]) } }, meta: { base: { address: token }, quote: { address: `0x${'0'.repeat(40)}` } } } };
}
