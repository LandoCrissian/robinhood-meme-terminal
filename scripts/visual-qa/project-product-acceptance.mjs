import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NFT_ONCHAIN } from './legion-fixtures.mjs';

const base = process.env.RMT_VISUAL_BASE_URL ?? 'http://127.0.0.1:3181';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Controlled acceptance is local only');
const output = path.resolve(process.env.RMT_VISUAL_OUTPUT ?? 'terminal-visual-v2', 'project-product');
await mkdir(output, { recursive: true });
let ownershipUnavailable = false;
const fixture = createServer((request, response) => {
  if (request.url !== '/internal/v1/projects/ccff00/onchain' || request.headers.authorization !== `Bearer ${'a'.repeat(64)}`) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'application/json');
  if (ownershipUnavailable) { response.writeHead(503).end(JSON.stringify({ error: 'CONTROLLED_OWNERSHIP_UNAVAILABLE' })); return; }
  response.end(JSON.stringify({ ...NFT_ONCHAIN, asOf: new Date().toISOString() }));
});
await new Promise(resolve => fixture.listen(43111, '127.0.0.1', resolve));
const browser = await chromium.launch();
const results = [], failures = [];
try {
  for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 768 });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let delayMarket = false, releaseMarket = [], marketUnavailable = false, artworkFailure = '';
    let marketPrice = 0.00003573, marketChange = -0.69;
    await page.addInitScript(() => {
      window.__walletRequests = 0;
      window.ethereum = { on() {}, removeListener() {}, async request({ method }) {
        if (/sign|sendTransaction|wallet_sendCalls/.test(method)) { window.__walletRequests++; throw Error('Financial action prohibited'); }
        return method === 'eth_chainId' ? '0x1237' : [];
      } };
    });
    await page.route('**/api/vnext/asset-workspace?**', async route => {
      const url = new URL(route.request().url()), contract = url.searchParams.get('address');
      if (url.searchParams.get('view') !== 'market') return route.continue();
      if (delayMarket) await new Promise(resolve => releaseMarket.push(resolve));
      if (marketUnavailable) return route.fulfill({ status: 503, json: { error: 'CONTROLLED_MARKET_UNAVAILABLE' } });
      return route.fulfill({ json: { chainId: 4663, contract, state: 'READY', observedAt: new Date().toISOString(), provenance: 'GECKOTERMINAL_TOKEN_POOLS', data: { token: contract, pool: '0x1111111111111111111111111111111111111111', priceUsd: marketPrice, liquidityUsd: 18560, volume24hUsd: 142.25, priceChange24h: marketChange, createdAt: null, dex: null, buys24h: null, sells24h: null } } });
    });
    await page.route('**/project-art/**', route => artworkFailure && (artworkFailure === 'all' || route.request().url().includes(artworkFailure)) ? route.fulfill({ status: 404 }) : route.continue());
    await page.route('**/api/vnext/token-artwork?**', route => route.fulfill({ status: 404 }));
    const assertPriceFits = async (name, expected) => {
      const measured = await page.locator('.rmtProjectMetricStrip').first().evaluate(strip => {
        const metrics = [...strip.querySelectorAll(':scope > span')].map(cell => {
          const strong = cell.querySelector('strong'), range = document.createRange();
          range.selectNodeContents(strong);
          const bounds = cell.getBoundingClientRect(), text = [...range.getClientRects()];
          return { text: strong.textContent, lines: new Set(text.map(rect => rect.y)).size,
            contained: text.every(rect => rect.x >= bounds.x - 0.5 && rect.right <= bounds.right + 0.5),
            height: strong.getBoundingClientRect().height, fontSize: getComputedStyle(strong).fontSize };
        });
        return { metrics, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth) };
      });
      results.push({ viewport, name: `price-${name}`, evidence: 'REAL_PROJECT_COMPONENT_CONTROLLED_MARKET_PRICE', ...measured });
      assert.equal(measured.metrics[0].lines, 1, `${name}: the complete price must occupy one line`);
      if (expected) assert.equal(measured.metrics[0].text, expected, 'Keep the existing price formatter and precision');
      for (const metric of measured.metrics) {
        assert.equal(metric.contained, true, `${name}: ${metric.text} fits its own column`);
        assert.equal(metric.lines, 1, `${name}: neighboring metric figures remain coherent`);
        assert.equal(metric.fontSize, '16px', 'Do not reduce readability to fit the price');
      }
      assert.equal(measured.overflow, 0, name);
    };
    const capture = async (name, label = 'REAL_COMPONENTS_CONTROLLED_EXTERNAL_METRICS_RETAINED_VERIFIED_ARTWORK') => {
      await page.evaluate(() => document.fonts.ready);
      const measured = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), walletRequests: window.__walletRequests, cardCount: document.querySelectorAll('.rmtProjectAssetCard').length }));
      assert.equal(measured.overflow, 0, name); assert.equal(measured.walletRequests, 0);
      await page.screenshot({ path: path.join(output, `${viewport.width}-${name}.png`), fullPage: true });
      results.push({ viewport, name, evidence: label, ...measured });
    };
    await page.goto(`${base}/projects`, { waitUntil: 'networkidle', timeout: 180000 });
    assert.equal(await page.locator('.rmtProjectCard').count(), 4);
    assert.equal(await page.getByRole('link', { name: 'Explore Founding Feathers project', exact: true }).locator('.rmtProjectPair.isNftLed').count(), 1);
    assert.equal(await page.getByRole('link', { name: 'Explore Founding Feathers project', exact: true }).getByText('Token', { exact: true }).count(), 0);
    assert.equal(await page.locator('.rmtProjectCardIdentity img').evaluateAll(images => images.filter(image => image.complete && image.naturalWidth > 0).length), 4);
    await capture('landing');
    for (const id of ['cannacats', 'hopium-machines', 'peeps', 'ccff00']) {
      marketPrice = id === 'hopium-machines' ? 0.00001503 : 0.00003573;
      marketChange = id === 'hopium-machines' ? 0.44 : -0.69;
      await page.goto(`${base}/projects/${id}`, { waitUntil: 'networkidle' });
      assert.equal(await page.locator('.isHeroArt img').evaluate(image => image.complete && image.naturalWidth > 0), true, id);
      const paired = ['cannacats', 'hopium-machines'].includes(id);
      assert.equal(await page.getByRole('link', { name: 'Trade token', exact: true }).count(), paired ? 1 : 0);
      assert.equal(await page.locator('.rmtProjectAssetCard').count(), paired ? 2 : 1);
      assert.equal(await page.locator('.rmtProjectMetricStrip').getByText('—', { exact: true }).count(), 0);
      if (id === 'ccff00') assert.match(await page.locator('.rmtProjectAssetsGrid').innerText(), /9,750/, 'Controlled current complete authority response is rendered');
      if (paired) await assertPriceFits(id);
      await capture(id);
    }
    for (const id of ['cannacats', 'hopium-machines']) {
      for (const [shape, value, change, expected] of [
        ['very-small', 0.000000000001234, 2.5, '$0.000000000001234'],
        ['long-fraction', 0.0000987654321, -2.5, '$0.00009877'],
        ['sub-dollar', 0.123456789, 0.44, '$0.1235'],
        ['multi-digit', 1234.56, -0.69, '$1,234.56'],
        ['large', 123456789.12, 12.34, '$123,456,789.12'],
        ['zero', 0, -12.34, '$0']
      ]) {
        marketPrice = value; marketChange = change;
        await page.goto(`${base}/projects/${id}`, { waitUntil: 'networkidle' });
        await assertPriceFits(`${id}-${shape}`, expected);
      }
    }
    marketPrice = 0.00003573; marketChange = -0.69;
    // Observe actual delayed external enrichment with real cards, not frozen screenshots.
    delayMarket = true;
    await page.goto(`${base}/projects/cannacats`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('.rmtProjectQuietState')?.textContent?.includes('Loading market'));
    await page.waitForFunction(() => [...document.querySelectorAll('.rmtProjectArt img')].every(image => image.complete && image.naturalWidth > 0 && getComputedStyle(image).visibility === 'visible'));
    await page.evaluate(() => {
      window.__projectContinuity = { replacements: 0, missingArtFrames: 0, opacityFlashes: 0, frames: 0, done: false };
      window.__projectObserver = new MutationObserver(records => {
        for (const record of records) for (const node of record.removedNodes) if (node.nodeType === 1 && (node.matches('.rmtProjectAssetCard') || node.querySelector('.rmtProjectAssetCard'))) window.__projectContinuity.replacements++;
      });
      window.__projectObserver.observe(document.querySelector('main'), { subtree: true, childList: true });
      const frame = () => {
        const evidence = window.__projectContinuity;
        if (evidence.done) return;
        evidence.frames++;
        if ([...document.querySelectorAll('.rmtProjectAssetCard')].some(card => Number(getComputedStyle(card).opacity) < 1)) evidence.opacityFlashes++;
        if ([...document.querySelectorAll('.rmtProjectArt')].some(art => {
          const image = art.querySelector('img');
          return image ? !image.complete || !image.naturalWidth || getComputedStyle(image).visibility !== 'visible' || Number(getComputedStyle(image).opacity) < 1 : !art.querySelector('.rmtProjectArtFallback')?.textContent;
        })) evidence.missingArtFrames++;
        requestAnimationFrame(frame);
      }; requestAnimationFrame(frame);
    });
    const measure = () => page.evaluate(() => {
      const box = selector => { const node = document.querySelector(selector), r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return { scroll: scrollY, action: box('.isTradeToken'), card: box('.rmtProjectAssetCard'), art: box('.isHeroArt'), title: document.querySelector('h1').textContent };
    });
    // Complete the deliberate user scroll before recording passive-update
    // stability. Global smooth scrolling otherwise leaves a zero baseline.
    await page.evaluate(() => scrollTo({ top: 100, behavior: 'instant' }));
    await page.waitForFunction(() => scrollY === Math.min(100, Math.max(0, document.documentElement.scrollHeight - innerHeight)));
    const before = await measure();
    await page.waitForTimeout(1800); delayMarket = false; releaseMarket.splice(0).forEach(resolve => resolve());
    await page.waitForFunction(() => document.querySelector('.rmtProjectMetricStrip')?.textContent?.includes('Price'));
    const after = await measure(); assert.deepEqual(after, before, 'Delayed metrics cannot replace cards, move actions or reset scroll');
    const continuity = await page.evaluate(() => { window.__projectObserver.disconnect(); window.__projectContinuity.done = true; return window.__projectContinuity; });
    assert.equal(continuity.replacements, 0);
    assert.equal(continuity.opacityFlashes, 0); assert.equal(continuity.missingArtFrames, 0); assert.ok(continuity.frames > 0);
    results.push({ viewport, name: 'delayed-enrichment', evidence: 'CONTROLLED_DELAY', before, after, ...continuity });
    marketUnavailable = true; await page.reload({ waitUntil: 'networkidle' }); await capture('market-unavailable', 'CONTROLLED_MARKET_FAILURE');
    assert.equal(await page.locator('.rmtProjectMetricStrip').count(), 0, 'No empty metric cells');
    assert.equal(await page.getByRole('link', { name: 'Trade token', exact: true }).isVisible(), true);
    artworkFailure = 'hopium-token'; await page.goto(`${base}/projects/hopium-machines`, { waitUntil: 'networkidle' }); await capture('token-art-fallback', 'CONTROLLED_TOKEN_ART_FAILURE_PROJECT_ART_RETAINED');
    assert.equal(await page.locator('.isAssetArt').first().locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    artworkFailure = 'hopium-machines.avif'; await page.reload({ waitUntil: 'networkidle' }); await capture('nft-art-fallback', 'CONTROLLED_NFT_ART_FAILURE_PROJECT_IDENTITY_RETAINED');
    assert.equal(await page.locator('.isHeroArt img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    artworkFailure = 'all'; await page.reload({ waitUntil: 'networkidle' }); await capture('all-art-monogram', 'CONTROLLED_ALL_ART_FAILURE_LAST_RESORT_MONOGRAM');
    assert.equal(await page.locator('.isHeroArt[data-artwork-state="fallback"]').count(), 1);
    ownershipUnavailable = true; artworkFailure = ''; await page.goto(`${base}/projects/ccff00`, { waitUntil: 'networkidle' }); await capture('ownership-unavailable', 'CONTROLLED_OWNERSHIP_FAILURE');
    assert.match(await page.locator('.rmtProjectAssetsGrid').innerText(), /Ownership data unavailable/);
    assert.equal(await page.locator('.rmtProjectMetricStrip').count(), 0);
    ownershipUnavailable = false;
    assert.deepEqual(errors, []); await context.close();
  }
} catch (error) { failures.push(error.stack); throw error; }
finally { await browser.close(); await new Promise(resolve => fixture.close(resolve)); await writeFile(path.join(output, 'acceptance.json'), JSON.stringify({ evidence: 'CONTROLLED_PUBLIC_COMPONENT_ACCEPTANCE_NOT_LIVE_FINANCIAL_ACCEPTANCE', results, failures }, null, 2)); }
