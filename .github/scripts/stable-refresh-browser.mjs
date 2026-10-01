import { runMarketAnchorBrowser } from './market-anchor-browser.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(test, label, ms = 30000) {
  const start = Date.now();
  while (!await test()) { assert.ok(Date.now() - start < ms, label); await pause(100); }
}

async function snapshot(page) {
  return page.evaluate(() => {
    const input = document.querySelector('[aria-label="Exact input amount"]');
    const box = selector => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    };
    return {
      amount: input?.value, caret: [input?.selectionStart, input?.selectionEnd],
      focused: document.activeElement === input, sameInput: input === window.__stableInput, sameAction: document.querySelector('.vnTradeActionDock .vnReviewButton') === window.__stableAction,
      scroll: document.querySelector('.vnTradeScroll')?.scrollTop,
      details: document.querySelector('.vnRouteCard')?.open,
      displayedTermsId: document.querySelector('.vnTradePriceSummary')?.dataset.displayVerification,
      displayedProviderId: document.querySelector('.vnTradeEvidenceSummary')?.dataset.displayVerification,
      displayPhase: document.querySelector('[data-quote-display-state]')?.dataset.quoteDisplayState,
      payment: document.querySelector('[aria-label="Pay with asset"]')?.value,
      range: document.querySelector('.vnChartRanges [aria-selected="true"]')?.textContent,
      receive: document.querySelector('.vnReceiveField > div > strong')?.textContent,
      minimum: document.querySelector('.vnOutputProtection strong')?.textContent,
      receiveLabel: document.querySelector('.vnReceiveField > span')?.textContent,
      action: document.querySelector('.vnTradeActionDock .vnReviewButton')?.textContent,
      status: document.querySelector('.vnTradeActionStatus')?.textContent,
      actionBox: box('.vnTradeActionDock .vnReviewButton'), amountBox: box('[aria-label="Exact input amount"]'),
      chartBox: box('.vnChart'), overflow: document.documentElement.scrollWidth - innerWidth,
      walletRequests: window.__stableWalletRequests
    };
  });
}

// Real public React/controller and real quote/verify/authorize handlers. Only
// external RPC, provider, SDK/wallet transports and timed outages are controlled.
// The 90-second observation uses wall-clock application timers, not fastForward.
export async function runStableRefreshBrowser({ browser, base, identity, external, state, wallet, token, output }) {
  const baseline = process.env.RMT_STABILITY_BASELINE === 'true';
  const results = [];
  for (const mobile of [true, false]) {
    const name = `${baseline ? 'before' : 'after'}-${mobile ? 'mobile' : 'desktop'}`;
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      isMobile: mobile, hasTouch: mobile, recordVideo: { dir: path.join(output, 'videos'), size: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 } } });
    await context.addInitScript(({ wallet }) => {
      window.__stableWalletRequests = 0;
      window.ethereum = { isMetaMask: true, on(){}, removeListener(){}, async request({ method }) {
        if (method === 'eth_chainId') return '0x1237';
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet];
        if (method === 'eth_getTransactionCount') return '0x1';
        if (method === 'eth_estimateGas') return '0x2bf20';
        if (/sign|sendTransaction/.test(method)) { window.__stableWalletRequests++; const error = new Error('Controlled owner rejection'); error.code = 4001; throw error; }
        return null;
      }};
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
        info: { uuid: 'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0', name: 'Explicit stability signer', rdns: 'io.rmt.stability', icon: 'data:image/png;base64,' }, provider: window.ethereum
      } }));
      window.addEventListener('eip6963:requestProvider', announce);
    }, { wallet });
    const page = await context.newPage();
    const calls = [], errors = [], samples = [];
    let phase = 'initial', held = false, pending = 0, maxPending = 0, failed = false;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/\/api\/vnext\/(quotes|verify|authorize)$/.test(new URL(request.url()).pathname)) {
        const body = request.postDataJSON();
        calls.push({ at: Date.now(), path: new URL(request.url()).pathname, amount: body?.inputAmountAtomic ?? null,
          input: body?.inputAsset ?? null, output: body?.outputAsset ?? null });
      }
    });
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === base) {
        if (phase === 'delay' && url.pathname === '/api/vnext/verify' && !held) {
          held = true; pending++; maxPending = Math.max(pending, maxPending);
          await pause(14000); pending--;
        }
        if (phase === 'outage' && url.pathname === '/api/vnext/quotes') {
          failed = true;
          return route.fulfill({ status: 503, json: { code: 'QUOTE_SERVICE_UNAVAILABLE', phase: 'QUOTE_SERVICE_UNAVAILABLE', retryable: true, error: 'Controlled temporary provider outage' } });
        }
        const headers = request.headers(); if (headers['privy-id-token']) headers['privy-id-token'] = identity;
        return route.continue({ headers });
      }
      const result = external({ url: request.url(), method: request.method(), body: request.postData() });
      return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
    });
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'I understand', exact: false }).click();
      await page.screenshot({ path: path.join(output, `${name}-markets.png`), fullPage: true });
      const search = page.locator(mobile ? '#rmt-mobile-market-search' : '#rmt-desktop-market-search');
      await search.fill(token); await search.press('Enter');
      await page.locator('#vn-asset-heading').waitFor();
      await page.getByRole('tab', { name: '15M', exact: true }).click();
      await page.screenshot({ path: path.join(output, `${name}-token.png`) });
      if (mobile) await page.locator('.rmtMobileTradeDock .isBuy').click();
      const input = page.getByLabel('Exact input amount');
      await input.waitFor();
      await page.getByLabel('Pay with asset', { exact: true }).selectOption('eip155:4663/native');
      const ready = page.waitForResponse(r => r.url().endsWith('/api/vnext/authorize') && r.status() === 200);
      await input.fill('0.0005'); await ready;
      await page.locator('.vnTradeActionDock .vnReviewButton').waitFor();
      await page.screenshot({ path: path.join(output, `${name}-ticket.png`) });
      await page.locator('.vnRouteTop').click();
      if (!baseline) {
        assert.equal(await page.locator('.vnExecutionEvidence').getAttribute('open'), null, 'Execution Evidence starts collapsed inside trader-facing Trade Details');
        assert.ok(!/Calldata|Payload|atomic|Spender/.test(await page.locator('.vnTraderDetails').innerText()), 'Level 1 is trader-facing');
        await page.screenshot({ path: path.join(output, `${name}-trade-details.png`), fullPage: true });
        await page.locator('.vnExecutionEvidence > summary').click();
      }
      await page.getByRole('button', { name: /Explicit stability signer/ }).click();
      await page.evaluate(() => {
        const input = document.querySelector('[aria-label="Exact input amount"]');
        window.__stableInput = input; window.__stableAction = document.querySelector('.vnTradeActionDock .vnReviewButton');
        input.focus({ preventScroll: true }); input.setSelectionRange(3, 3);
        document.querySelector('.vnTradeScroll').scrollTop = 90;
        const selectors = ['.vnTradePanel', '.vnReceiveField', '.vnTradePriceSummary', '.vnVerificationEvidence', '.vnAuthorizationPlan', '.vnWalletPrimaryReview'];
        const previous = new Map(selectors.map(selector => [selector, document.querySelector(selector)]));
        window.__refreshVisual = { frames: 0, componentReplacements: 0, missingCardFrames: 0, opacityFlashFrames: 0, labelChanges: 0, tracking: true };
        let receiveLabel = document.querySelector('.vnReceiveField > span')?.textContent;
        const frame = () => {
          const metric = window.__refreshVisual;
          if (!metric.tracking) return;
          metric.frames++;
          for (const selector of selectors) {
            const node = document.querySelector(selector), old = previous.get(selector);
            if (node !== old) { metric.componentReplacements++; previous.set(selector, node); }
            if (!node) metric.missingCardFrames++;
            else if (Number(getComputedStyle(node).opacity) < 0.99) metric.opacityFlashFrames++;
          }
          const label = document.querySelector('.vnReceiveField > span')?.textContent;
          if (label !== receiveLabel) { metric.labelChanges++; receiveLabel = label; }
          requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      const initial = await snapshot(page), started = Date.now();
      phase = 'delay';
      // Capture the exact expired same-intent display, including input identity,
      // caret/scroll/Details and action coordinates throughout real timer cycles.
      while (Date.now() - started < 42000) {
        samples.push({ ms: Date.now() - started, pending, ...await snapshot(page) });
        await pause(350);
      }
      const visual = await page.evaluate(() => { window.__refreshVisual.tracking = false; return window.__refreshVisual; });
      phase = 'outage';
      if ((await snapshot(page)).action === 'Retry quote') await page.locator('.vnTradeActionDock .vnReviewButton').click();
      await until(() => failed, 'quote reaches controlled outage', 15000);
      await until(async () => (await snapshot(page)).action === 'Retry quote', 'truthful outage action');
      const outage = await snapshot(page);
      phase = 'recovery';
      const recovered = page.waitForResponse(r => r.url().endsWith('/api/vnext/authorize') && r.status() === 200);
      // This deliberately rejected mocked wallet request tests explicit retry only.
      // Observation of passive work above must contain zero wallet calls.
      await page.locator('.vnTradeActionDock .vnReviewButton').click();
      await recovered;
      await until(async () => await page.evaluate(() => window.__stableWalletRequests === 1), 'one explicit mocked handoff');
      await page.evaluate(() => {
        const input = document.querySelector('[aria-label="Exact input amount"]');
        input.focus({ preventScroll: true }); input.setSelectionRange(3, 3);
        document.querySelector('.vnTradeScroll').scrollTop = 90;
      });
      const recovery = await snapshot(page);
      while (Date.now() - started < 90000) {
        samples.push({ ms: Date.now() - started, pending, ...await snapshot(page) });
        await pause(350);
      }
      const preOutage = samples.filter(s => s.ms < 42000);
      const stale = preOutage.find(s => (s.displayPhase === 'EXPIRED' || /stale/i.test(s.receiveLabel ?? '')) && s.pending === 1);
      const movement = Math.max(...preOutage.filter(s => s.actionBox).map(s => Math.abs(s.actionBox.y - initial.actionBox.y)));
      const lostInput = preOutage.filter(s => !s.sameInput || !s.focused || s.amount !== initial.amount || s.caret.join(':') !== initial.caret.join(':'));
      const scrollMovement = Math.max(...preOutage.map(s => Math.abs(s.scroll - initial.scroll)));
      const chartMovement = Math.max(...preOutage.filter(s => s.chartBox && initial.chartBox).map(s => Math.max(Math.abs(s.chartBox.y - initial.chartBox.y), Math.abs(s.chartBox.height - initial.chartBox.height))));
      const passiveRequests = calls.filter(c => c.at >= started && c.at < started + 42000);
      const result = { evidence: 'MOCKED_LOCAL_BROWSER', baseline, viewport: mobile ? '390x844' : '1440x900', observationMs: Date.now() - started,
        delayMs: 14000, initial, stale, outage, recovery, maxPending, actionMovementPx: movement, scrollMovementPx: scrollMovement,
        chartMovementPx: chartMovement, inputInstabilitySamples: lostInput.length, visual, passiveRequests, calls, errors, samples };
      results.push(result);
      await writeFile(path.join(output, `${name}-stability.json`), JSON.stringify(result, null, 2));
      await page.screenshot({ path: path.join(output, `${name}-after-renewal.png`), fullPage: true });
      if (!baseline) {
        assert.ok(stale, 'expired terms are retained and explicitly stale while delayed renewal is pending');
        assert.equal(stale.minimum, initial.minimum, 'minimum belongs to the same retained snapshot');
        assert.equal(stale.receive, initial.receive);
        assert.equal(maxPending, 1);
        assert.equal(visual.componentReplacements, 0, 'passive renewal retains the actual term/evidence card nodes');
        assert.equal(visual.missingCardFrames, 0, 'no transient disappearance of prior terms/evidence');
        assert.equal(visual.opacityFlashFrames, 0, 'no opacity flash in retained cards');
        assert.equal(visual.labelChanges, 0, 'ordinary renewal does not replace the primary receive heading');
        assert.ok(movement <= 1, `persistent action movement ${movement}px`);
        assert.ok(scrollMovement <= 1, `passive scroll movement ${scrollMovement}px`);
        assert.ok(chartMovement <= 1, `passive chart movement ${chartMovement}px`);
        assert.ok(preOutage.every(s => s.sameAction), 'renewal does not replace the primary control');
        assert.ok(preOutage.every(s => s.displayedTermsId === s.displayedProviderId), 'fees and provider use the same retained or fresh response');
        assert.equal(lostInput.length, 0, 'passive renewal keeps input element, focus, caret and amount');
        assert.ok(preOutage.every(s => s.range === '15M'), 'chart range remains selected');
        assert.ok(preOutage.every(s => s.details && s.walletRequests === 0 && s.payment === 'eip155:4663/native'));
        assert.ok(preOutage.every(s => s.action === initial.action), 'passive updates retain Buy/Sell intent');
        assert.ok(preOutage.every(s => s.overflow <= 2));
        assert.ok(passiveRequests.filter(c => c.path.endsWith('/verify')).length <= 5, 'no extra firm loops');
      }
      // A new Sell ticket is an explicit interaction: reveal its amount without
      // borrowing the Buy quote, and retain the deliberately selected ETH output.
      await page.locator('.vnSideTabs').getByRole('tab', { name: 'Sell', exact: true }).click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const sell = await snapshot(page);
      result.sell = { ...sell, receiveAsset: await page.getByLabel('Receive asset', { exact: true }).inputValue() };
      if (!baseline) { assert.equal(sell.scroll, 0); assert.equal(sell.amount, ''); assert.equal(result.sell.receiveAsset, 'eip155:4663/native'); }
      await page.locator('.vnSideTabs').getByRole('tab', { name: 'Buy', exact: true }).click();
      await input.fill('0.0006');
      if (!baseline) {
        await page.evaluate(() => { window.__stableInput = document.querySelector('[aria-label="Exact input amount"]'); });
        await page.setViewportSize({ width: mobile ? 1440 : 390, height: mobile ? 900 : 844 });
        await pause(500);
        assert.equal(await page.evaluate(() => window.__stableInput === document.querySelector('[aria-label="Exact input amount"]')), true, 'orientation/breakpoint never remounts composer');
        assert.equal(await input.inputValue(), '0.0006');
        assert.equal(await page.locator('.vnTradePanel').count(), 1);
        if (!mobile) await page.locator('.rmtMobileTradeDock .isBuy').click();
        for (const width of [375, 390, 430, 768]) {
          await page.setViewportSize({ width, height: 844 }); await pause(100);
          assert.ok((await snapshot(page)).overflow <= 2, `${width}px no horizontal overflow`);
        }
        // Reduced viewport is keyboard emulation, not an actual iPhone keyboard.
        await input.click();
        await input.evaluate(element => element.setSelectionRange(3, 3));
        await page.setViewportSize({ width: 390, height: 440 }); await pause(300);
        const keyboard = await snapshot(page); result.keyboardEmulation = keyboard;
        assert.ok(keyboard.focused && keyboard.caret.join(':') === '3:3', 'emulated keyboard resize retains the deliberately focused input and caret');
        assert.ok(keyboard.amountBox.y >= 0 && keyboard.amountBox.y + keyboard.amountBox.height <= 440, 'amount stays visible with the emulated keyboard');
        assert.ok(keyboard.actionBox.y + keyboard.actionBox.height <= 440, 'action remains visible above emulated keyboard');
        assert.ok(keyboard.actionBox.height >= 44);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload();
        await page.locator('#vn-asset-heading').waitFor();
        if (!await page.locator('.rmtMobileSheetLayer.isOpen').count()) await page.locator('.rmtMobileTradeDock .isBuy').click();
        await page.getByLabel('Pay with asset', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('Pay with asset', { exact: true }).inputValue(), 'eip155:4663/native', 'reload retains the deliberately selected wallet-scoped payment');
        await pause(1200);
        assert.equal(await page.evaluate(() => window.__stableWalletRequests), 0, 'restored preference and fresh quote never create a financial request');
        result.reloadPayment = 'eip155:4663/native';
      }
      assert.deepEqual(errors, []);
      await writeFile(path.join(output, `${name}-stability.json`), JSON.stringify(result, null, 2));
    } finally {
      await writeFile(path.join(output, `${name}-trace.json`), JSON.stringify({ calls, errors, samples, final: await snapshot(page), text: await page.locator('.vnTradePanel').innerText() }, null, 2));
      await page.screenshot({ path: path.join(output, `${name}-final.png`), fullPage: true });
      await context.close();
      await writeFile(path.join(output, `${name}-video.json`), JSON.stringify({ evidence: 'MOCKED_LOCAL_BROWSER', path: await page.video().path() }));
    }
  }
  if (!baseline) results.push(...await runMarketAnchorBrowser({ browser, base, external, output }));
  return results.map(({ samples, ...result }) => result);
}
