import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const address = (n) => `0x${n.toString(16).padStart(40, '0')}`;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(100); }
  throw new Error(message);
}

export function createRouteOnDemandFixtures({ word, string, weth }) {
  const assets = { identityOnly: address(0x9901), noRoute: address(0x9902), observed: address(0x9903), stock: address(0x9904), unverified: address(0x9905) };
  const names = new Map(Object.entries(assets).map(([name, token]) => [token, name]));
  const pools = new Map([assets.observed, assets.stock, assets.unverified].map((token, i) => [token, address(0x9910 + i)]));
  return {
    assets,
    contracts: [...names.keys(), ...pools.values()],
    call(transaction) {
      const to = String(transaction.to).toLowerCase(), data = transaction.data ?? transaction.input ?? '0x';
      if (!names.has(to)) return undefined;
      if (to === assets.unverified) throw new Error('Deterministic token identity read unavailable');
      if (data.startsWith('0x06fdde03')) return string(`Route fixture ${names.get(to)}`);
      if (data.startsWith('0x95d89b41')) return string(names.get(to).toUpperCase());
      if (data.startsWith('0x313ce567')) return word(18);
      if (data.startsWith('0x18160ddd') || data.startsWith('0x70a08231') || data.startsWith('0xdd62ed3e')) return word(10n ** 27n);
      return undefined;
    },
    external(input) {
      const url = new URL(input.url);
      if (url.origin === 'https://api.robinhood.com' && url.pathname === '/rhj/assets') return { status: 200, body: { assets: [{
        id: 'route-fixture-stock', tokenSymbol: 'STOCK', tokenName: 'Route fixture stock',
        deployments: [{ contractAddress: assets.stock, chainId: 4663 }], currentMultiplier: '1', status: 'ASSET_STATUS_ACTIVE'
      }] } };
      if (url.hostname !== 'api.dexscreener.com') return undefined;
      const token = [...pools.keys()].find((candidate) => url.pathname.toLowerCase().includes(candidate));
      if (!token) return undefined;
      const pair = { chainId: 'robinhood', dexId: 'uniswap', labels: ['v3'], pairAddress: pools.get(token),
        url: `https://dexscreener.com/robinhood/${pools.get(token)}`,
        baseToken: { address: token, name: `Route fixture ${names.get(token)}`, symbol: names.get(token).toUpperCase() },
        quoteToken: { address: weth, name: 'Wrapped Ether', symbol: 'WETH' },
        priceUsd: '1', liquidity: { usd: 10000 }, volume: { h24: 1000 }, txns: { h24: { buys: 1, sells: 1 } }
      };
      if (url.pathname.startsWith('/token-pairs/v1/') || url.pathname.startsWith('/tokens/v1/')) return { status: 200, body: [pair] };
      return undefined;
    }
  };
}

// Real terminal and API routes. Only provider HTTP, RPC and wallet transports
// are fixtures; no directory, verification or authorization response is replaced.
export async function runRouteOnDemandJourneys({ browser, base, identity, external, state, wallet, usdg, output, fixtures }) {
  const results = [];
  state.approved = true;
  state.priceDisabled = false;
  state.simulationFails = false;
  state.modifyFirm = undefined;
  state.rpcOverride = undefined;
  for (const viewport of ['desktop', 'mobile']) {
    for (const [scenario, token] of Object.entries({ ...fixtures.assets, nativeToUsdg: usdg, usdgToNative: usdg })) {
      const context = await browser.newContext({ viewport: viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 }, ...(viewport === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
      const api = [];
      const errors = [];
      const priceStart = state.prices.length;
      await context.addInitScript(({ wallet }) => {
        const listeners = new Map();
        window.__ROUTE_ON_DEMAND_PROMPTS__ = 0;
        window.ethereum = {
          isMetaMask: true,
          on(event, fn) { listeners.set(event, [...(listeners.get(event) ?? []), fn]); },
          removeListener(event, fn) { listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== fn)); },
          async request({ method }) {
            if (method === 'eth_chainId') return '0x1237';
            if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet];
            if (method === 'eth_sendTransaction' || /sign/i.test(method)) { window.__ROUTE_ON_DEMAND_PROMPTS__++; throw new Error('No wallet action allowed in route-on-demand review acceptance'); }
            return null;
          }
        };
      }, { wallet });
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('response', async (response) => {
        const url = new URL(response.url());
        if (url.origin === base && (url.pathname.startsWith('/api/vnext/') || url.pathname === '/api/markets/external')) api.push({ path: url.pathname, query: url.search, status: response.status(), body: await response.json().catch(() => null) });
      });
      await page.route('**/*', async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin === base) {
          const headers = request.headers();
          if (headers['privy-id-token']) headers['privy-id-token'] = identity;
          return route.continue({ headers });
        }
        try { const response = external({ url: request.url(), method: request.method(), body: request.postData() }); return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) }); }
        catch { return route.abort('blockedbyclient'); }
      });
      const prefix = `${viewport}-route-on-demand-${scenario}`;
      const sellingToken = scenario === 'usdgToNative' || scenario === 'identityOnly';
      try {
        await page.goto(`${base}/?market=${token}&side=${sellingToken ? 'sell' : 'buy'}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'I understand', exact: false }).click();
        const welcome = page.getByRole('button', { name: 'Start with live markets', exact: true });
        try { await welcome.click({ timeout: 1500 }); }
        catch (error) { if (await welcome.isVisible()) throw error; }
        if (scenario === 'stock' || scenario === 'unverified') {
          await until(() => api.some((entry) => entry.path === '/api/markets/external' && entry.query.toLowerCase().includes(token)), 'Selected asset evidence was not evaluated');
          await pause(1500);
          const text = await page.locator('body').innerText();
          if (scenario === 'stock') {
            assert.match(text, /view.only/i);
            assert.equal(await page.locator('.vnReviewButton:enabled').count(), 0, 'Stock-token execution controls must remain disabled');
          } else {
            assert.equal(await page.locator('.vnReviewButton:enabled').count(), 0, 'Unverified identity cannot produce an executable intent');
          }
        } else {
          await page.getByLabel('Exact input amount').waitFor({ timeout: 30000 });
          assert.doesNotMatch(await page.locator('.vnTradePanel').innerText(), /Asset only|Market evidence unavailable/);
          if (scenario === 'identityOnly') await page.getByLabel('Receive asset').selectOption({ label: 'USDG' });
          else {
            const settlementSelect = page.getByLabel(scenario === 'usdgToNative' ? 'Receive asset' : 'Pay with asset');
            if (await settlementSelect.inputValue() !== 'eip155:4663/native') await settlementSelect.selectOption('eip155:4663/native');
            assert.equal(await settlementSelect.inputValue(), 'eip155:4663/native');
          }
          await page.getByLabel('Exact input amount').fill(sellingToken ? '1' : '0.001');
          await page.locator('.vnReviewButton').click();
          await until(() => api.some((entry) => entry.path === '/api/vnext/quotes' && entry.status === 200), 'Identity-only asset must reach real quote API');
          assert.ok(state.prices.slice(priceStart).some((quote) => sellingToken ? quote.sellToken.toLowerCase() === token : quote.buyToken.toLowerCase() === token), 'Actual 0x price boundary must be reached');
          if (['nativeToUsdg', 'usdgToNative'].includes(scenario)) {
            for (const entry of api.filter((item) => item.path === '/api/vnext/quotes' && item.status === 200)) assert.deepEqual(entry.body.attempts.map((attempt) => attempt.provider), ['zero-x-swap'], 'Settlement-only pairs must never attempt direct V2/V3 or gasless');
          } else {
            const selected = api.find((entry) => entry.path === '/api/vnext/market-search' && entry.body?.results?.some((item) => item.address.toLowerCase() === token));
            assert.ok(selected, 'Real exact search must establish the selected asset');
            assert.deepEqual(selected.body.results.find((item) => item.address.toLowerCase() === token).markets, [], 'No canonical directory market may be fabricated');
          }
          if (scenario === 'noRoute') {
            await until(async () => /no route|route.*unavailable/i.test(await page.locator('.vnTradePanel').innerText()), 'No liquidity must produce a truthful unavailable route');
            assert.ok(api.some((entry) => entry.path === '/api/vnext/quotes' && entry.body?.attempts?.some((attempt) => attempt.provider === 'zero-x-swap' && attempt.status === 'no_route')));
          } else {
            await until(() => api.some((entry) => entry.path === '/api/vnext/authorize' && entry.status === 200), 'Identity-only asset must reach real authorization');
            assert.ok(api.some((entry) => entry.path === '/api/vnext/verify' && entry.status === 200));
            await page.locator('.vnWalletFeeDisclosure').waitFor();
            const bundle = api.find((entry) => entry.path === '/api/vnext/authorize' && entry.status === 200).body;
            assert.equal(bundle.plan.provider, 'zero-x-swap');
            assert.equal(bundle.plan.providerNativeFee.feeBps, 25);
            assert.equal(bundle.plan.kind, 'swap');
            assert.equal(bundle.plan.value, sellingToken ? '0' : '1000000000000000');
            if (scenario === 'observed') {
              assert.match(await page.locator('body').innerText(), /provider observed/i);
              assert.match(await page.getByLabel('Market activity by time window').innerText(), /Unknown buys.*Unknown sells/);
            }
          }
        }
        if (['noRoute', 'stock', 'unverified'].includes(scenario)) {
          assert.equal(api.filter((entry) => entry.path === '/api/vnext/verify' || entry.path === '/api/vnext/authorize').length, 0);
        }
        assert.equal(await page.evaluate(() => window.__ROUTE_ON_DEMAND_PROMPTS__), 0);
        assert.ok(!errors.some((error) => /TypeError|client recovery activated/.test(error)), 'Partial evidence must not crash the workspace');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal overflow');
        assert.deepEqual(state.unexpected, []);
        results.push({ viewport, scenario: `route-on-demand-${scenario}`, status: 'PASS', walletPrompts: 0 });
        console.log(`${prefix}: PASS`);
      } finally {
        await page.screenshot({ path: path.join(output, `${prefix}.png`), fullPage: true });
        await writeFile(path.join(output, `${prefix}.json`), JSON.stringify({ api, errors, text: await page.locator('body').innerText() }, null, 2));
        await context.close();
      }
    }
  }
  return results;
}
