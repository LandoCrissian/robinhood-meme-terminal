import assert from 'node:assert/strict';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(80); }
  throw new Error(message);
}
export async function exerciseTradeRefresh({ page, api, requests, scenario, viewportName }) {
  const authorizations = () => api.filter(item => item.path === '/api/vnext/authorize' && item.status === 200);
  const latest = () => authorizations().at(-1).body.plan;
  const review = page.getByRole('button', { name: /Review (exact approval|verified swap) in wallet/ });
  const sell = scenario.endsWith('sell');
  assert.equal(await page.locator('.vnTradePanel').evaluate(element => element.classList.contains('is-sell')), sell, 'expiry fixture uses the real requested trade side');
  assert.match(await review.innerText(), sell ? /^Sell / : /^Buy /);
  const color = await review.evaluate(element => {
    const style = getComputedStyle(element);
    return (style.backgroundImage.match(/rgba?\(([^)]+)\)/)?.[1] ?? style.backgroundColor).match(/[\d.]+/g).map(Number);
  });
  assert.ok(sell ? color[0] > color[1] : color[1] > color[0], 'Buy is green and Sell is red, including disabled signer readiness');
  for (const control of await page.locator('.vnPositionActions button.isSell, .rmtMobileTradeDock button.isSell').all()) {
    const rgb = await control.evaluate(element => getComputedStyle(element).backgroundColor.match(/[\d.]+/g).map(Number));
    assert.ok(rgb[0] > rgb[1], 'workspace and mobile navigation retain Sell trade-direction styling');
  }
  const assertVisible = async () => {
    const box = await review.boundingBox();
    const viewport = await page.evaluate(() => ({ height: visualViewport?.height ?? innerHeight, top: visualViewport?.offsetTop ?? 0 }));
    assert.ok(box && box.y >= viewport.top && box.y + box.height <= viewport.top + viewport.height + 1, 'trade CTA fits the visible viewport without scroll');
  };
  assert.equal(await page.getByRole('button', { name: 'Refresh verified request', exact: true }).count(), 0);
  if (viewportName === 'mobile') {
    for (const size of [{ width: 375, height: 667 }, { width: 375, height: 430 }, { width: 667, height: 375 }]) {
      await page.setViewportSize(size); await pause(100); await assertVisible();
      await page.locator('.vnRouteTop').click(); await assertVisible();
      assert.equal(await page.locator('.vnWalletFeeDisclosure').isVisible(), true, 'advanced evidence remains accessible');
      await page.locator('.vnRouteTop').click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  if (scenario.includes('click')) {
    const selector = page.getByRole('region', { name: 'Injected signer selection' });
    await selector.getByRole('button', { name: /Explicit test signer/ }).click();
    await selector.getByText('Selected signer: Explicit test signer', { exact: true }).waitFor();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/vnext/quotes', async route => { await gate; await route.fallback(); });
    const previous = latest().planId;
    // Jump Date without firing the expiry timer, click once, then let the real
    // server issue a new authority using its own clock. No response is forged.
    await page.clock.setSystemTime(latest().expiresAtMs);
    await review.click();
    await page.clock.setSystemTime(Date.now()); release();
    await until(() => requests.length === 1, 'one expiry-time intent must reach one wallet boundary');
    assert.notEqual(latest().planId, previous);
    await pause(300); assert.equal(requests.length, 1);
    if (scenario.endsWith('-again')) {
      await page.getByText('Buy confirmed', { exact: true }).first().waitFor();
      const count = authorizations().length;
      await page.getByRole('button', { name: 'Continue trading', exact: true }).click();
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await page.getByLabel('Exact input amount').fill('25');
      await until(() => authorizations().length > count, 'same-input next trade must release the completed wallet pause');
      await review.waitFor();
      const next = authorizations().length;
      let nextRelease;
      const nextGate = new Promise(resolve => { nextRelease = resolve; });
      await page.route('**/api/vnext/quotes', async route => { await nextGate; await route.fallback(); });
      await page.clock.fastForward(Math.max(0, latest().expiresAtMs - Date.now()) + 100);
      await page.clock.setSystemTime(Date.now()); nextRelease();
      await until(() => authorizations().length > next, 'same-input next trade must keep refreshing');
      assert.equal(requests.length, 1, 'continuing and refreshing do not initiate another trade');
    }
    return;
  }
  const cycles = scenario.includes('failure') || scenario.includes('recovery') ? 1 : 3;
  let providerCalls = 0;
  if (scenario.includes('failure') || scenario.includes('recovery')) {
    await page.route('**/api/vnext/quotes', async route => {
      providerCalls++;
      if (scenario.includes('failure') || providerCalls <= 2) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ phase: 'ZEROX_PROVIDER_UNAVAILABLE', error: 'Route provider temporarily unavailable' }) });
      } else await route.fallback();
    });
  }
  for (let cycle = 0; cycle < cycles; cycle++) {
    const before = authorizations().length;
    const oldPlan = latest().planId;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const hold = async route => { await gate; await route.fallback(); };
    await page.route('**/api/vnext/quotes', hold);
    await page.clock.fastForward(Math.max(0, latest().expiresAtMs - Date.now()) + 100);
    await page.clock.setSystemTime(Date.now()); release();
    await page.unroute('**/api/vnext/quotes', hold);
    if (scenario.includes('failure')) {
      await page.getByRole('button', { name: 'Retry quote', exact: true }).waitFor({ timeout: 30000 });
      assert.equal(providerCalls, 4, 'automatic recovery is bounded');
      const exhausted = providerCalls; await pause(1800); assert.equal(providerCalls, exhausted);
    } else {
      await until(() => authorizations().length > before, 'background expiry must publish fresh verified authority');
      await review.waitFor();
      assert.notEqual(latest().planId, oldPlan);
      if (viewportName === 'mobile') await assertVisible();
    }
    assert.equal(requests.length, 0, 'automatic refresh never requests wallet authorization');
    assert.equal(await page.getByRole('button', { name: 'Refresh verified request', exact: true }).count(), 0);
  }
  if (scenario.includes('recovery')) assert.equal(providerCalls, 3);
}
