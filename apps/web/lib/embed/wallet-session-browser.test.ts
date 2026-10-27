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
const env = { RMT_WALLET_AUTH_ENABLED: 'true', RMT_WALLET_ORIGIN: '', RMT_WALLET_SESSION_SECRET: 'b'.repeat(64) };
const deps = { env, command, verifySignature: verifyMessage };
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (request, response) => {
  try {
    const url = new URL(request.url!, origin || 'https://localhost');
    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Task125 synthetic wallet acceptance</title><style>body{margin:0;padding:16px;background:#080b07;color:#eef4e7;font-family:system-ui}main{max-width:680px;margin:auto}</style><p>DISPOSABLE TEST WALLET · NO REAL TRADES</p><main id="panel"></main><script type="module">import{mountCannaCatPanel}from'/sdk/cannacat-panel.mjs';mountCannaCatPanel(document.querySelector('#panel'),{enabled:true,apiBaseUrl:location.origin+'/api/rmt/cannacat',walletConnectProjectId:''});</script></html>`); return;
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
      if (failures) { response.writeHead(failures, { 'content-type': 'application/json' }); response.end(JSON.stringify({ code: 'RATE_LIMITED' })); return; }
      // Provider failures are exercised without authorizing fake executable transactions.
      response.writeHead(503, { 'content-type': 'application/json' }); response.end(JSON.stringify({ code: 'PROVIDER_UNAVAILABLE' })); return;
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
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 } });
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
  await page.getByText('Rabby', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('[data-wallet-status]').getAttribute('data-wallet-status')).toBe('ready');
  await expect(page.getByRole('button', { name: 'Verify wallet ownership', exact: true })).toHaveCount(0);
  check(true, 'RabbyKit connection completes SIWE without a redundant verification click');
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
  await page.getByRole('button', { name: 'Review trade', exact: true }).click();
  await expect.poll(() => quoteCalls).toBeGreaterThan(0);
  await expect(input).toHaveValue('1'); check(true, 'Provider outage preserves Sell amount and controls');
  await page.getByRole('button', { name: 'Buy CannaCat', exact: true }).click();
  for (const name of ['USD target', 'ETH input', 'CannaCat target']) { await page.getByRole('button', { name, exact: true }).click(); await input.fill(name === 'USD target' ? '10' : name === 'ETH input' ? '0.001' : '10000'); }
  await page.screenshot({ path: path.join(output, `wallet-${width}.png`), fullPage: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  await page.reload(); await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible();
  check(authSignatures === signaturesBefore, 'Manual disconnect persists through reload');
  check(!await page.evaluate(() => localStorage.getItem('fixture.trade-attempt')), 'No approval or trade is requested');
  check(errors.length === 0, errors.join('; '));
  results.push({ width, result: 'PASS' }); await context.close(); quoteCalls = 0;
}
} finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
writeFileSync(path.join(output, 'RESULTS.json'), JSON.stringify({ result: 'PASS', channel, checks, results, authSignatures: 'synthetic only', ownerSignatures: 0,
  fundedTrades: 0, realRabbyKit: true, walletConnectRelay: 'requires owner project ID and physical mobile acceptance' }, null, 2));
console.log(JSON.stringify({ result: 'PASS', channel, checks }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
