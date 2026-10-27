// Real RabbyKit + Wagmi + panel + SIWE handler. Disposable provider/RPC/market fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, webkit, expect } from 'playwright/test';
import { numberToHex, verifyMessage, getAddress, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { handleWalletAuth, requireWalletSession, CONSUME_CHALLENGE, type RedisCommand } from '../server/wallet-session';
import { syntheticCannaCatBundle } from '../../../../.github/scripts/cannacat-firm-fixture';
import { createVNextZeroXProviderNativeFee } from '../vnext/zero-x-settlement';

async function main() {
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Disposable CI only');
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const output = path.join(root, 'task125-browser-' + process.env.CANNACAT_BROWSER); mkdirSync(output, { recursive: true });
const key = path.join(output, 'localhost.key'), cert = path.join(output, 'localhost.crt');
execFileSync(process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl',
  ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const alice = privateKeyToAccount(numberToHex(1n, { size: 32 }));
const bob = privateKeyToAccount(numberToHex(2n, { size: 32 }));
const store = new Map<string, string>();
const command: RedisCommand = async args => {
  const [op, ...p] = args.map(String);
  if (op === 'GET') return store.get(p[0]) ?? null;
  if (op === 'DEL') { p.forEach(k => store.delete(k)); return 1; }
  if (op === 'SET') { if (p.includes('NX') && store.has(p[0])) return null; store.set(p[0], p[1]); return 'OK'; }
  if (op === 'EVAL') {
    const [script, count, ...rest] = p, keys = rest.slice(0, Number(count)), values = rest.slice(Number(count));
    if (script === CONSUME_CHALLENGE) { if (store.get(keys[0]) !== values[0] || store.has(keys[1])) return 0;
      store.delete(keys[0]); store.delete(keys[2]); store.set(keys[1], values[1]); store.set(keys[3], keys[1]); return 1; }
    if (script.includes('local completed=')) { const completed = store.get(keys[2]); if (completed?.startsWith(values[0])) store.delete(completed); keys.forEach(k => store.delete(k)); return 1; }
    const n = Number(store.get(keys[0]) ?? '0') + 1; store.set(keys[0], String(n)); return n;
  }
  throw Error('Unexpected fixture store operation');
};
let origin = '', authSignatures = 0, quoteCalls = 0, failures = 0;
const bundles = new Map<string, ReturnType<typeof syntheticCannaCatBundle>>();
const env = { RMT_WALLET_AUTH_ENABLED: 'true', RMT_WALLET_ORIGIN: '', RMT_WALLET_SESSION_SECRET: 'b'.repeat(64) };
const deps = { env, command, verifySignature: verifyMessage };
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (request, response) => {
  try {
    const url = new URL(request.url!, origin || 'https://localhost');
    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task125 synthetic wallet acceptance</title><style>body{margin:0;padding:16px;background:#080b07;color:#eef4e7;font-family:system-ui}main{max-width:680px;margin:auto}</style><p>DISPOSABLE TEST WALLET · NO REAL TRADES</p><main id="panel"></main><script type="module">import{mountCannaCatPanel}from'/sdk/cannacat-panel.mjs';mountCannaCatPanel(document.querySelector('#panel'),{enabled:true,apiBaseUrl:location.origin+'/api/rmt/cannacat',walletConnectProjectId:'04cbaa4efb50ff78c719a886ee6e54c4'});</script></html>`); return;
    }
    if (url.pathname.startsWith('/sdk/')) {
      const file = path.resolve(root, 'task125-artifact/sdk', url.pathname.slice(5));
      assert(file.startsWith(path.resolve(root, 'task125-artifact/sdk') + path.sep));
      response.setHeader('content-type', 'text/javascript'); response.end(readFileSync(file)); return;
    }
    let text = ''; for await (const chunk of request) text += chunk;
    if (url.pathname === '/synthetic-sign') {
      authSignatures++; const input = JSON.parse(text);
      const account = input.address.toLowerCase() === alice.address.toLowerCase() ? alice : bob;
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ signature: await account.signMessage({ message: { raw: input.message } }) })); return;
    }
    if (url.pathname.startsWith('/api/rmt/cannacat/auth-')) {
      const result = await handleWalletAuth(new Request(origin + url.pathname, { method: 'POST', headers: request.headers as HeadersInit, body: text }), url.pathname.split('auth-')[1], deps);
      response.writeHead(result.status, { ...Object.fromEntries(result.headers), 'set-cookie': result.headers.getSetCookie() });
      response.end(await result.text()); return;
    }
    if (url.pathname.startsWith('/api/rmt/cannacat/')) {
      const body = JSON.parse(text);
      await requireWalletSession(new Request(origin + url.pathname, { method: 'POST', headers: request.headers as HeadersInit, body: text }), getAddress(body.recipient ?? body.wallet), deps);
      quoteCalls++;
      if (failures) { response.writeHead(failures, { 'content-type': 'application/json' }); response.end(JSON.stringify({ code: failures === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE' })); return; }
      response.setHeader('content-type', 'application/json');
      if (url.pathname.endsWith('/verify')) {
        const bundle = syntheticCannaCatBundle(body, { approvalAlreadyGranted: true });
        bundles.set(bundle.evidence.verificationId, bundle); response.end(JSON.stringify(bundle.evidence)); return;
      }
      if (url.pathname.endsWith('/authorize')) {
        const bundle = bundles.get(body.verificationId);
        assert(bundle && bundle.evidence.zeroXFirmQuoteCommitment === body.zeroXFirmQuoteCommitment);
        response.end(JSON.stringify(bundle)); return;
      }
      assert(url.pathname.endsWith('/quotes'));
      const buying = body.inputAsset === zeroAddress, now = Date.now();
      const output = buying ? BigInt(body.inputAmountAtomic) * 10_000_000n : BigInt(body.inputAmountAtomic) / 10_000_000n;
      const minimum = output * 99n / 100n;
      const fee = createVNextZeroXProviderNativeFee({ ...body, userGrossInputAtomic: body.inputAmountAtomic,
        expectedOutputAtomic: String(output), protectedOutputAtomic: String(minimum), authorizationState: 'indicative',
        quotedFeeAmountAtomic: buying ? undefined : String(output * 25n / 10_000n) });
      response.end(JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111', ...body,
        requestedAtMs: now - 10, completedAtMs: now, attempts: [{ provider: 'zero-x-swap', providerLabel: '0x', providerFamily: 'zeroex', adapterVersion: 1,
        status: 'indicative', ...body, expectedOutputAtomic: String(output), protectedOutputAtomic: String(minimum), outputDecimals: 18, priceImpact: null,
        liquidityFeeEvidence: [], quotedAtMs: now, expiresAtMs: now + 10000, latencyMs: 10, executionKind: 'aggregator', strictVerificationAvailable: true,
        publicWalletExecutionEligible: true, userPaysGas: true, providerFeeAsset: null, providerFeeAtomic: null, gasSponsorshipFeeAsset: null,
        gasSponsorshipFeeAtomic: null, explicitProviderFeeOutputAtomic: null, netEconomics: null, settlementMode: 'PROVIDER_NATIVE_INPUT_FEE', providerNativeFee: fee,
        networkFeeNativeAtomic: '9000000000', networkFeeNativeSymbol: 'ETH', protectedNetOutputAtomic: null, costState: 'network_fee_pending', authorizationReady: false,
        detail: 'Disposable synthetic fixture only.' }] })); return;
    }
    response.writeHead(404).end();
  } catch { response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'AUTH_FAILURE' })); }
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `https://localhost:${(server.address() as { port: number }).port}`; env.RMT_WALLET_ORIGIN = origin;
const channel = process.env.CANNACAT_BROWSER ?? 'chrome';
const browser = await (channel === 'webkit' ? webkit.launch() : chromium.launch({ channel, headless: true }));
const results: object[] = []; let checks = 0;
const check = (condition: unknown, label: string) => { assert(condition, label); checks++; };
try {
for (const width of [320, 375, 390, 430, 1440]) {
  store.clear();
  // The vendor uses user-agent mobile detection, not a responsive desktop modal.
  // Connect the injected synthetic desktop provider at desktop size, then verify
  // the real trading panel at each requested width. Physical relay handoff is a
  // separate owner iPhone check; it is never claimed by these injected fixtures.
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  const setupWallet = ({ address, other }: { address: string; other: string }) => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    const state = { address: localStorage.getItem('fixture.account') ?? address, chain: '0x1237' };
    const provider = {
      isRabby: true, isMetaMask: false,
      on(event: string, callback: (...args: any[]) => void) { const set = listeners.get(event) ?? new Set(); set.add(callback); listeners.set(event, set); },
      removeListener(event: string, callback: (...args: any[]) => void) { listeners.get(event)?.delete(callback); },
      async request({ method, params }: { method: string; params?: any[] }) {
        if (method === 'eth_accounts') return localStorage.getItem('fixture.connected') === 'yes' ? [state.address] : [];
        if (method === 'eth_requestAccounts') { localStorage.setItem('fixture.connected', 'yes'); return [state.address]; }
        if (method === 'eth_chainId') return state.chain;
        if (method === 'net_version') return String(Number(state.chain));
        if (method === 'wallet_getPermissions') return [];
        if (method === 'wallet_requestPermissions') { localStorage.setItem('fixture.connected', 'yes'); return [{ parentCapability: 'eth_accounts' }]; }
        if (method === 'wallet_revokePermissions') { localStorage.removeItem('fixture.connected'); return null; }
        if (method === 'personal_sign') {
          const result = await fetch('/synthetic-sign', { method: 'POST', body: JSON.stringify({ message: params![0], address: params![1] }) }); return (await result.json()).signature;
        }
        if (method === 'wallet_switchEthereumChain') { state.chain = params![0].chainId; listeners.get('chainChanged')?.forEach(cb => cb(state.chain)); return null; }
        if (method.startsWith('eth_send') || method.startsWith('eth_sign') || method === 'wallet_sendCalls') { localStorage.setItem('fixture.trade-attempt', 'yes'); throw Error('No trade permitted in this test'); }
        throw Error('Unsupported test RPC ' + method);
      }
    };
    (window as any).ethereum = provider;
    (window as any).fixtureWallet = { account: (changed: boolean) => { state.address = changed ? other : address; localStorage.setItem('fixture.account', state.address); listeners.get('accountsChanged')?.forEach(cb => cb([state.address])); },
      chain: (chain: string) => { state.chain = chain; listeners.get('chainChanged')?.forEach(cb => cb(chain)); } };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { uuid: 'ecb12f76-f841-47cd-ab91-4856b924d643', name: 'Rabby synthetic wallet', icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>', rdns: 'io.rabby' }, provider } }));
    window.addEventListener('eip6963:requestProvider', announce); announce();
  };
  // tsx preserves function names with __name. Serialize its test-only bootstrap
  // explicitly; the application SDK does not contain this fixture or helper.
  await context.addInitScript({ content: `const __name=(value)=>value; (${setupWallet.toString()})(${JSON.stringify({ address: alice.address, other: bob.address })});` });
  await context.route('https://api.exchange.coinbase.com/**', route => route.fulfill({ json: { price: '2000', time: new Date().toISOString() }, headers: { 'access-control-allow-origin': '*' } }));
  await context.route('https://rpc.mainnet.chain.robinhood.com/**', async route => {
    const input = route.request().postDataJSON(), hash = '0x' + 'a'.repeat(64);
    const rpc = (r: { id: number; method: string; params?: any[] }) => {
      const slot = r.method === 'eth_call' && r.params?.[0]?.to?.toLowerCase() === '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
      const values: Record<string, unknown> = { eth_chainId: '0x1237', eth_getBalance: '0xde0b6b3a7640000', eth_gasPrice: '0x3b9aca00', eth_getTransactionCount: '0x0',
        eth_call: slot ? '0x' + [1000n * 2n ** 96n, 0n, 0n, 0n].map(x => x.toString(16).padStart(64, '0')).join('') : '0x' + (50000n * 10n ** 18n).toString(16).padStart(64, '0'),
        eth_getBlockByNumber: { number: '0x64', hash, parentHash: hash, transactions: [], timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16), gasLimit: '0x1c9c380', gasUsed: '0x0', baseFeePerGas: '0x3b9aca00', difficulty: '0x0', extraData: '0x', miner: zeroAddress, size: '0x100', nonce: '0x0000000000000000', sha3Uncles: hash, transactionsRoot: hash, stateRoot: hash, receiptsRoot: hash, logsBloom: '0x' + '0'.repeat(512) } };
      assert(r.method in values, 'Unexpected chain read ' + r.method); return { jsonrpc: '2.0', id: r.id, result: values[r.method] };
    };
    await route.fulfill({ json: Array.isArray(input) ? input.map(rpc) : rpc(input), headers: { 'access-control-allow-origin': '*' } });
  });
  const page = await context.newPage(), errors: string[] = []; page.on('pageerror', e => { errors.push(e.message); console.error('BROWSER_RUNTIME:', e.message); });
  page.on('console', event => { if (event.type() === 'error') console.error('BROWSER_CONSOLE:', event.text().slice(0, 500)); });
  await page.goto(origin); check(errors.length === 0, errors.join('; '));
  await page.getByRole('button', { name: 'I understand — continue', exact: true }).click();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByText('Rabby Wallet', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('[data-wallet-status]').getAttribute('data-wallet-status')).toBe('ready');
  await expect(page.getByRole('button', { name: 'Verify wallet ownership', exact: true })).toHaveCount(0);
  check(true, 'RabbyKit connection completes SIWE without a redundant verification click');
  await page.setViewportSize({ width, height: 900 });
  const cookies = await context.cookies(); check(cookies.some(c => c.name === '__Host-rmt-session' && c.httpOnly && c.secure), 'HttpOnly Secure session cookie');
  check(!await page.evaluate(() => document.cookie.includes('__Host-rmt-session')), 'Session cookie is not script-readable');
  const signaturesBefore = authSignatures;
  await page.reload(); await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify wallet ownership', exact: true })).toHaveCount(0);
  check(authSignatures === signaturesBefore, 'Returning wallet restores without signing again');
  const input = page.locator('.rmtcat-amount input'); await input.fill('10000');
  await expect(page.locator('.rmtcat-observation dl')).toBeVisible();
  check(quoteCalls === 0, 'Passive estimates do not call executable quote endpoints');
  await page.getByRole('button', { name: 'Sell CannaCat', exact: true }).click(); await input.fill('1');
  failures = 503;
  await page.getByRole('button', { name: 'Review trade', exact: true }).click();
  await expect.poll(() => quoteCalls).toBeGreaterThan(0);
  await expect(page.getByText('0x could not provide trading terms right now.', { exact: false })).toBeVisible();
  await expect(input).toHaveValue('1'); check(true, 'Provider outage preserves Sell amount and controls');
  failures = 0;
  await page.getByRole('button', { name: 'Review trade', exact: true }).click();
  await expect(page.getByRole('button', { name: /Confirm sell in wallet/i })).toBeVisible();
  check(true, 'Authenticated Sell review passes the unchanged browser evidence and authorization parsers; no signing');
  await page.getByRole('button', { name: 'Buy CannaCat', exact: true }).click();
  for (const name of ['USD target', 'ETH input', 'CannaCat target']) { await page.getByRole('button', { name, exact: true }).click(); await input.fill(name === 'USD target' ? '10' : name === 'ETH input' ? '0.001' : '10000'); }
  await page.screenshot({ path: path.join(output, `wallet-${width}.png`), fullPage: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
  await page.evaluate(() => (window as any).fixtureWallet.chain('0x1'));
  await expect(page.getByRole('button', { name: 'Switch to Robinhood Chain', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review trade', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Switch to Robinhood Chain', exact: true }).click();
  await expect.poll(() => page.locator('[data-wallet-status]').getAttribute('data-wallet-status')).toBe('ready');
  check(authSignatures === signaturesBefore, 'Explicit network correction does not repeat SIWE or sign a trade');
  await page.evaluate(() => (window as any).fixtureWallet.account(true));
  const selection = page.getByRole('combobox', { name: 'Choose signing wallet', exact: true });
  await expect(selection).toBeVisible();
  const selectedValue = await selection.locator('option:not([disabled])').getAttribute('value');
  assert(selectedValue); await selection.selectOption(selectedValue);
  await expect(page.getByRole('button', { name: 'Verify wallet ownership', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review trade', exact: true })).toBeDisabled();
  await expect.poll(async () => {
    const read = await context.request.post(origin + '/api/rmt/cannacat/auth-session', {
      headers: { origin, 'x-rmt-client': 'rmt-cannacat-embed-v1' }, data: {} });
    return (await read.json()).authenticated;
  }).toBe(false);
  check(authSignatures === signaturesBefore, 'Account switching invalidates the old server session and requires explicit reauthentication');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.reload(); await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  check(authSignatures === signaturesBefore, 'Manual disconnect persists through reload');
  check(!await page.evaluate(() => localStorage.getItem('fixture.trade-attempt')), 'No approval or trade is requested');
  check(errors.length === 0, errors.join('; '));
  results.push({ width, result: 'PASS' }); await context.close(); quoteCalls = 0;
}
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => undefined);
    writeFileSync(path.join(output, 'FAILURE.json'), JSON.stringify({ message: String(error), body: await page.locator('body').innerText().catch(() => '') }, null, 2));
  }
  throw error;
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
writeFileSync(path.join(output, 'RESULTS.json'), JSON.stringify({ result: 'PASS', channel, checks, results, authSignatures: 'synthetic only', ownerSignatures: 0,
  fundedTrades: 0, realRabbyKit: true, walletConnectRelay: 'owner project configured; physical mobile acceptance pending', modalConnection: 'desktop injected fixture' }, null, 2));
console.log(JSON.stringify({ result: 'PASS', channel, checks }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
