// Hosted relay handshake only. No wallet accepts the pairing, signs, or trades.
import { chromium, expect } from 'playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  mkdirSync('task125-relay', { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const events: object[] = [];
  const clean = (s: unknown) => String(s ?? '').replace(/(?:https?|wss?):\/\/[^\s"']+/g, '[URL omitted]').slice(0, 600);
  page.on('console', async message => {
    if (message.type() !== 'error' && message.type() !== 'warn') return;
    const args = await Promise.all(message.args().map(arg => arg.evaluate(value => ({ name: value?.name, code: value?.code, message: value?.message })).catch(() => ({}))));
    const firstUrl = message.text().match(/(?:https?|wss?):\/\/[^\s"']+/)?.[0];
    const target = firstUrl ? { host: new URL(firstUrl).host, path: new URL(firstUrl).pathname } : undefined;
    events.push({ kind: 'console', text: clean(message.text()), target, args: args.map(arg => ({ name: arg.name, code: arg.code, message: clean(arg.message) })) });
  });
  page.on('websocket', socket => { events.push({ kind: 'websocket', host: new URL(socket.url()).host }); socket.on('socketerror', error => events.push({ kind: 'websocket-error', error: clean(error) })); });
  page.on('requestfailed', request => events.push({ kind: 'request-failed', host: new URL(request.url()).host, path: new URL(request.url()).pathname, reason: clean(request.failure()?.errorText) }));
  page.on('response', response => { if (response.status() >= 400) events.push({ kind: 'http-error', host: new URL(response.url()).host, path: new URL(response.url()).pathname, status: response.status() }); });
  let failure: string | undefined;
  try {
    await page.goto('https://task125-wallet--lammb.netlify.app/mint#cannacat-purchase');
    await page.getByRole('button', { name: 'I understand — continue', exact: true }).click();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Mobile Wallet', exact: true }).click();
    await page.locator('.sub-page.show').getByRole('button', { name: 'MetaMask', exact: true }).click();
    await expect(page.getByText('Scan with your Mobile wallet', { exact: true })).toBeVisible({ timeout: 15000 });
  } catch (error) { failure = clean(error); }
  finally {
    const result = { result: failure ? 'FAIL' : 'PASS', at: new Date().toISOString(), pairingOnly: true, ownerSignatures: 0, fundedTrades: 0,
      pairingUriPrinted: false, failure, events };
    writeFileSync('task125-relay/RESULTS.json', JSON.stringify(result, null, 2));
    await browser.close();
  }
  assert(!failure, 'Hosted WalletConnect pairing did not become ready; inspect sanitized relay evidence');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
