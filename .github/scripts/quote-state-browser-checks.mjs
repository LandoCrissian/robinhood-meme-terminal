import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await pause(80); }
  throw new Error(message);
}

// Real component/API lifecycle; only network/wallet boundaries are synthetic.
// Restore a receipt without a retained wallet-handoff intent, then expire it.
export async function exerciseRestoredQuoteState({ page, api, requests, scenario, enableReceipts, output, prefix }) {
  await until(async () => (await page.evaluate(() => localStorage.getItem('rmt:vnext-execution-journal:v1:4663') ?? '')).includes('submitted'), 'approval must be journaled');
  await page.evaluate(() => sessionStorage.removeItem('rmt:pending-approval-journey:v1:4663'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const expectedContract = new URL(page.url()).searchParams.get('market')?.toLowerCase();
  assert.match(expectedContract ?? '', /^0x[0-9a-f]{40}$/);
  const restoredSnapshot = () => page.evaluate(() => ({
    heading: document.querySelector('.vnTradeHeader h2')?.textContent ?? null,
    amount: document.querySelector('[aria-label="Exact input amount"]')?.value ?? null,
    contract: document.querySelector('.vnIdentityActionBar a')?.getAttribute('href') ?? null,
    side: document.querySelector('.vnSideTabs [aria-selected="true"]')?.textContent ?? null
  }));
  const initialRestore = await restoredSnapshot();
  // The URL-selected side exists on the first client mount. That is not proof
  // that the ordinary token lookup/draft restoration has completed. Enter the
  // reconstructed amount on the exact selected destination, not its empty shell.
  if (page.viewportSize().width <= 760) await page.locator('.rmtMobileSheetLayer.isOpen').waitFor();
  await page.getByRole('tab', { name: 'Sell', exact: true, selected: true }).waitFor();
  await until(async () => {
    const snapshot = await restoredSnapshot();
    return snapshot.contract?.toLowerCase().includes(`/token/${expectedContract}`)
      && snapshot.heading !== 'Select an asset' && snapshot.side === 'Sell';
  }, 'restored ticket must belong to the exact URL-selected contract');
  await page.getByLabel('Exact input amount').fill('25');
  await writeFile(path.join(output, `${prefix}-restore-initialization.json`), JSON.stringify({
    evidence: 'CONTROLLED_BROWSER', expectedContract, initialRestore,
    enteredOnDestination: await restoredSnapshot()
  }, null, 2));
  enableReceipts();
  const authorizations = () => api.filter(x => x.path.endsWith('/authorize') && x.status === 200 && x.body.plan.kind === 'swap');
  await until(() => authorizations().length > 0, 'restored confirmed approval must freshly verify');
  await page.locator('.vnWalletSubmission').waitFor();
  assert.equal(requests.length, 1, 'restored receipt alone must not request a swap');
  const prior = authorizations().at(-1).body;
  const estimate = await page.locator('.vnReceiveField > div > strong').first().innerText();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let pending = 0, calls = 0, maximumPending = 0;
  const hold = async route => {
    calls++; pending++; maximumPending = Math.max(maximumPending, pending);
    await gate;
    pending--;
    if (scenario.endsWith('failure')) return route.fulfill({ status: 422, json: scenario.includes('expired')
      ? { phase: 'QUOTE_EXPIRED', retryable: false, error: 'Refreshing price...' }
      : { phase: 'ZEROX_POLICY_REJECTED', retryable: false, error: 'Controlled replacement rejection' } });
    await route.fallback();
  };
  const heldPath = scenario.endsWith('verification') ? '**/api/vnext/verify' : '**/api/vnext/quotes';
  await page.route(heldPath, hold);
  let releasePrice;
  if (scenario.endsWith('verification')) {
    const priceGate = new Promise(resolve => { releasePrice = resolve; });
    await page.route('**/api/vnext/quotes', async route => { await priceGate; await route.fallback(); });
  }
  await page.clock.fastForward(Math.max(0, prior.plan.expiresAtMs - Date.now()) + 300);
  const panel = await page.locator('.vnTradePanel').innerText();
  assert.doesNotMatch(panel, /Fresh swap verification passed|Verified request ready|Exact simulation passed/, 'expired authority must not coexist with current verified claims');
  for (const heading of await page.locator('.rmtMobileTradeSheet > header').allTextContents()) {
    assert.doesNotMatch(heading, /Verified trade/, 'sheet title must not claim quote authority');
  }
  assert.match(await page.locator('[data-quote-display-state]').innerText(), /Last quoted/i, 'retained terms are explicitly historical, never current authority');
  assert.notEqual(await page.locator('.vnOutputProtection strong').innerText(), 'Set when you trade');
  assert.equal(await page.locator('.vnReceiveField > div > strong').first().innerText(), estimate, 'refresh preserves the last displayed output');
  assert.equal(await page.locator('[data-quote-display-state]').getAttribute('data-quote-display-state'), 'EXPIRED', 'retained output is explicitly expired');
  // Advance expiry without making newly issued server evidence artificially old.
  // Preparation has already cleared authority; restoring real time cannot reuse it.
  await page.clock.setSystemTime(Date.now());
  releasePrice?.();
  await until(() => calls === 1, 'restored approval ready state must not strand automatic refresh');
  await pause(1500);
  assert.equal(calls, 1, 'slow response must not start concurrent refresh');
  assert.equal(maximumPending, 1);
  await page.screenshot({ path: path.join(output, `${prefix}-refreshing.png`), fullPage: true });
  await writeFile(path.join(output, `${prefix}-refreshing.json`), JSON.stringify({
    evidence: 'LOCAL_MOCKED', scenario, expiredPlanId: prior.plan.planId, retainedOutput: estimate,
    pendingRequests: pending, refreshCalls: calls, maximumPending,
    panel: await page.locator('.vnTradePanel').innerText()
  }, null, 2));
  if (scenario.endsWith('click')) {
    const action = page.locator('.vnTradeActionDock .vnReviewButton');
    assert.equal(await action.isEnabled(), true, 'Trade can retain explicit intent during refresh');
    await action.click();
    await pause(200);
    assert.equal(calls, 1, 'Trade joins the same bounded refresh');
  }
  await page.clock.setSystemTime(Date.now());
  release();
  if (scenario.endsWith('failure')) {
    await page.getByRole('button', { name: 'Retry quote', exact: true }).waitFor();
    await page.locator('.vnRouteCard').evaluate(details => { details.open = true; });
    const failed = await page.locator('.vnTradePanel').innerText();
    assert.doesNotMatch(failed, /Fresh swap verification passed|Verified request ready|Exact simulation passed|Refreshing price/);
    assert.equal(await page.locator('.vnReceiveField > div > strong').first().innerText(), estimate);
    await pause(9500); assert.equal(calls, 1, 'permanent failure must stop across the next cadence, not retry');
    await page.unroute(heldPath, hold);
    await page.getByRole('button', { name: 'Retry quote', exact: true }).click();
    await until(() => requests.length === 2, 'explicit retry must freshly verify before mocked handoff');
  } else {
    await until(() => authorizations().length > 1, 'replacement must publish fresh authority');
    assert.notEqual(authorizations().at(-1).body.plan.planId, prior.plan.planId);
    if (scenario.endsWith('click')) await until(() => requests.length === 2, 'one retained click hands off after fresh verification');
    else {
      await page.locator('.vnWalletSubmission').waitFor();
      assert.equal(requests.length, 1, 'automatic refresh cannot hand off');
      const beforeTrade = authorizations().at(-1).body.plan.planId;
      await page.getByRole('button', { name: 'Review verified swap in wallet', exact: true }).click();
      await until(() => requests.length === 2, 'Trade must obtain fresh authority and reach mocked wallet');
      assert.notEqual(authorizations().at(-1).body.plan.planId, beforeTrade, 'Trade replaces even a still-fresh idle plan');
    }
  }
  assert.equal(requests.filter(x => x.data.startsWith('0x095ea7b3')).length, 1, 'restoration/refresh never repeats approval');
}
