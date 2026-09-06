import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runZeroXWalletJourneys } from './zerox-browser-wallet-journeys.mjs';
import { createRouteOnDemandFixtures, runRouteOnDemandJourneys } from './zerox-browser-route-on-demand.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const requireWeb = createRequire(path.join(root, 'apps/web/package.json'));
const { encodeAbiParameters, decodeFunctionData, encodeFunctionResult, parseAbi, keccak256, toFunctionSelector } = requireWeb('viem');
requireWeb('tsx/cjs');
const { RMT_CURATED_MARKET_REGISTRY: seeds } = requireWeb('./lib/vnext/curated-market-registry.ts');
const requireRoot = createRequire(path.join(root, 'package.json'));
const { chromium } = requireRoot('playwright');
const wallet = '0x3333333333333333333333333333333333333333';
const token = '0x39dbed3a2bd333467115de45665cc57f813c4571';
const usdg = '0x5fc5360d0400a0fd4f2af552add042d716f1d168';
const weth = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
const holder = '0x0000000000001ff3684f28c67538d4d072c22734';
const native = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const treasury = '0x61700479a4a1f62584fd3aba2c2b290ea727d2ec';
const runtime = '0x60006000';
const aggregateAbi = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
const word = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const hex = (n) => `0x${BigInt(n).toString(16)}`;
const string = (s) => encodeAbiParameters([{ type: 'string' }], [s]);
const hash = `0x${'a'.repeat(64)}`;
const output = process.env.RMT_ACCEPTANCE_OUTPUT ?? path.join(root, 'terminal-zerox-evidence');
const state = { prices: [], quotes: [], simulations: [], rpc: [], outbound: [], unexpected: [], approved: true };
const routeFixtures = createRouteOnDemandFixtures({ word, string, weth, runtime });

function call(transaction) {
  const data = transaction.data ?? transaction.input ?? '0x';
  const to = String(transaction.to).toLowerCase();
  if (data.startsWith('0x82ad56cb')) {
    const { args } = decodeFunctionData({ abi: aggregateAbi, data });
    const results = args[0].map((item) => {
      try { return { success: true, returnData: call({ to: item.target, data: item.callData }) }; }
      catch { return { success: false, returnData: '0x' }; }
    });
    return encodeFunctionResult({ abi: aggregateAbi, functionName: 'aggregate3', result: results });
  }
  const routeResult = routeFixtures.call(transaction);
  if (routeResult !== undefined) return routeResult;
  const seed = seeds.find((entry) => entry.token.toLowerCase() === to);
  if (seed) {
    if (data.startsWith('0x06fdde03')) return string(seed.aliases[0]);
    if (data.startsWith('0x95d89b41')) return string(seed.aliases[0]);
    if (data.startsWith('0x313ce567')) return word(18);
    if (data.startsWith('0x18160ddd') || data.startsWith('0x70a08231')) return word(10n ** 27n);
  }
  const pool = seeds.find((entry) => entry.market.poolAddress === to)?.market;
  if (pool) {
    if (data.startsWith('0x0dfe1681')) return word(pool.token0);
    if (data.startsWith('0xd21220a7')) return word(pool.token1);
    if (data.startsWith('0xc45a0155')) return word(pool.version === 3 ? '0x1f7d7550b1b028f7571e69a784071f0205fd2efa' : '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f');
    if (data.startsWith('0xddca3f43')) return word(pool.fee);
    if (data.startsWith('0xd0c93a7c')) return word(pool.tickSpacing);
  }
  if (data.startsWith(toFunctionSelector('getSlot0(bytes32)')) && seeds.some((entry) => entry.market.version === 4 && data.slice(10).toLowerCase() === entry.market.poolKey.slice(2))) {
    return encodeAbiParameters([{ type: 'uint160' }, { type: 'int24' }, { type: 'uint24' }, { type: 'uint24' }], [2n ** 96n, 0, 0, 10000]);
  }
  if (['0x1f7d7550b1b028f7571e69a784071f0205fd2efa', '0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f'].includes(to) && ['0x1698ee82', '0xe6a43905'].some((selector) => data.startsWith(selector))) {
    const market = seeds.find((entry) => entry.market.poolAddress && data.toLowerCase().includes(entry.market.token0.slice(2)) && data.toLowerCase().includes(entry.market.token1.slice(2)))?.market;
    return word(market?.poolAddress ?? 0);
  }
  if ([token, usdg, weth].includes(to)) {
    if (data.startsWith('0x06fdde03')) return string(to === usdg ? 'Global Dollar' : to === weth ? 'Wrapped Ether' : 'Pons');
    if (data.startsWith('0x95d89b41')) return string(to === usdg ? 'USDG' : to === weth ? 'WETH' : 'PONS');
    if (data.startsWith('0x313ce567')) return word(to === usdg ? 6 : 18);
    if (data.startsWith('0x70a08231') || data.startsWith('0x18160ddd')) return word(10n ** 27n);
    if (data.startsWith('0xdd62ed3e')) return word(state.approved ? 10n ** 27n : 0n);
    if (data.startsWith('0x095ea7b3')) return word(1);
  }
  if (to === '0x10cc6bd38112cac182db90b6a71d8bb5939526ba') {
    if (data.startsWith('0x0dfe1681')) return word(weth);
    if (data.startsWith('0xd21220a7')) return word(token);
    if (data.startsWith('0xc45a0155')) return word('0x1f7d7550b1b028f7571e69a784071f0205fd2efa');
    if (data.startsWith('0xddca3f43')) return word(10000);
    if (data.startsWith('0xd0c93a7c')) return word(200);
    if (data.startsWith('0x1a686502')) return word(10n ** 24n);
  }
  if (to === '0x1f7d7550b1b028f7571e69a784071f0205fd2efa' && data.startsWith('0x1698ee82')) {
    return data.toLowerCase().includes(token.slice(2)) && data.toLowerCase().includes(weth.slice(2))
      ? word('0x10cc6bd38112cac182db90b6a71d8bb5939526ba') : word(0);
  }
  if (to === holder || to === '0x0000000000000000000000000000000000012345') {
    state.simulations.push(structuredClone(transaction));
    if (state.simulationFails) throw new Error('Deterministic exact simulation reverted');
    return '0x';
  }
  throw new Error('No deterministic contract result for this call');
}

function rpc(request) {
  state.rpc.push({ method: request.method, params: request.params });
  try {
    const overridden = state.rpcOverride?.(request);
    if (overridden !== undefined) return { jsonrpc: '2.0', id: request.id, result: overridden };
    let result;
    switch (request.method) {
      case 'eth_chainId': result = '0x1237'; break;
      case 'eth_blockNumber': result = '0x2faf080'; break;
      case 'eth_getBalance': result = hex(10n ** 21n); break;
      case 'eth_gasPrice': result = hex(50000000); break;
      case 'eth_estimateGas': result = hex(50000); break;
      case 'eth_getTransactionCount': result = '0x1'; break;
      case 'eth_getLogs': result = []; break;
      case 'eth_getTransactionReceipt': case 'eth_getTransactionByHash': result = null; break;
      case 'eth_getCode': result = [token, usdg, weth, holder, '0x0000000000000000000000000000000000012345', ...routeFixtures.contracts, ...seeds.flatMap((entry) => [entry.token.toLowerCase(), entry.market.poolAddress])].includes(String(request.params[0]).toLowerCase()) ? runtime : '0x'; break;
      case 'eth_call': result = call(request.params[0]); break;
      case 'eth_getBlockByNumber': result = { number: '0x2faf080', hash, parentHash: hash, timestamp: hex(Math.floor(Date.now() / 1000)), baseFeePerGas: hex(50000000), gasLimit: '0x1c9c380', gasUsed: '0x0', transactions: [], nonce: '0x0000000000000000', difficulty: '0x0', extraData: '0x', size: '0x1', miner: wallet, receiptsRoot: hash, stateRoot: hash, transactionsRoot: hash, logsBloom: `0x${'0'.repeat(512)}` }; break;
      default: throw new Error(`Unmocked read-only RPC method ${request.method}`);
    }
    return { jsonrpc: '2.0', id: request.id, result };
  } catch (error) {
    return { jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error.message } };
  }
}

function external(input) {
  const url = new URL(input.url);
  state.outbound.push(`${input.method} ${url.origin}${url.pathname}`);
  const routeResponse = routeFixtures.external(input);
  if (routeResponse) return routeResponse;
  if (url.hostname === 'browser-acceptance.invalid') {
    const body = JSON.parse(input.body);
    assert.ok(body.jsonrpc || Array.isArray(body), 'Expected JSON-RPC at the explicit fixture endpoint');
    return { status: 200, body: Array.isArray(body) ? body.map(rpc) : rpc(body) };
  }
  if (['cca-lite.coinbase.com', 'cca.coinbase.com', 'pulse.walletconnect.org'].includes(url.hostname)) return { status: 200, body: {} };
  if (url.origin === 'https://api.robinhood.com' && url.pathname === '/rhj/assets') return { status: 200, body: { assets: [] } };
  if (url.origin === 'https://robinhoodchain.blockscout.com' && url.pathname === `/api/v2/addresses/${wallet}/token-balances`) return { status: 200, body: [] };
  if (state.priceDisabled && url.origin === 'https://api.0x.org' && url.pathname === '/gasless/price') {
    const q = Object.fromEntries(url.searchParams);
    return { status: 200, body: { liquidityAvailable: true, sellToken: q.sellToken, buyToken: q.buyToken, sellAmount: q.sellAmount,
      buyAmount: '2000000000000000000000', minBuyAmount: '1900000000000000000000',
      fees: { zeroExFee: { token: q.buyToken, amount: '1000000000000000000' }, gasFee: { token: q.buyToken, amount: '2000000000000000000' } } } };
  }
  if (url.origin === 'https://api.0x.org' && url.pathname.startsWith('/swap/allowance-holder/')) {
    if (state.priceDisabled && url.pathname.endsWith('/price')) return { status: 400, body: { name: 'NO_LIQUIDITY_AVAILABLE' } };
    assert.equal(input.credentialIsFixture, true);
    assert.equal(input.version, 'v2');
    const q = Object.fromEntries(url.searchParams);
    assert.equal(q.chainId, '4663');
    assert.equal(q.swapFeeRecipient.toLowerCase(), treasury);
    assert.equal(q.swapFeeBps, '25');
    assert.equal(q.swapFeeToken, q.sellToken);
    assert.notEqual(q.sellToken, `0x${'0'.repeat(40)}`);
    assert.equal(q.taker.toLowerCase(), wallet);
    assert.equal(q.recipient.toLowerCase(), wallet);
    const firm = url.pathname.endsWith('/quote');
    (firm ? state.quotes : state.prices).push(q);
    if (q.buyToken.toLowerCase() === routeFixtures.assets.noRoute) return { status: 400, body: { name: 'NO_LIQUIDITY_AVAILABLE' } };
    const nativeSell = q.sellToken.toLowerCase() === native;
    const response = { status: 200, body: {
      liquidityAvailable: true, chainId: 4663, sellToken: q.sellToken, buyToken: q.buyToken,
      sellAmount: q.sellAmount, buyAmount: '1000000000000000000000', minBuyAmount: '990000000000000000000',
      totalNetworkFee: '9000000000000',
      fees: { integratorFee: { token: q.sellToken, amount: (BigInt(q.sellAmount) * 25n / 10000n).toString(), type: 'volume' }, zeroExFee: { token: q.buyToken, amount: '1000000000000000000', type: 'volume' }, gasFee: null },
      issues: { allowance: nativeSell || state.approved ? null : { actual: '0', spender: holder }, balance: null, simulationIncomplete: false, invalidSourcesPassed: [] },
      allowanceTarget: nativeSell ? null : holder, blockNumber: '50000000', zid: state.approved ? '0x222222222222222222222222' : '0x111111111111111111111111',
      transaction: { to: nativeSell ? '0x0000000000000000000000000000000000012345' : holder, data: state.approved ? '0x1234567822222222' : '0x1234567811111111', value: nativeSell ? q.sellAmount : '0', gas: '180000', gasPrice: '50000000' }
    } };
    if (firm) state.modifyFirm?.(response.body);
    return response;
  }
  if ((url.origin === 'https://api.0x.org' && url.pathname === '/gasless/price')
    || ['api.coingecko.com', 'pro-api.coingecko.com', 'api.geckoterminal.com', 'api.dexscreener.com'].includes(url.hostname)
    || (url.hostname === 'api.coinbase.com' && url.pathname === '/v2/prices/ETH-USD/spot')
    || (url.hostname === 'api.llama.fi' && ['/v2/chains', '/overview/dexs/Robinhood%20Chain', '/overview/fees/Robinhood%20Chain'].includes(url.pathname))
    || (url.hostname === 'stablecoins.llama.fi' && ['/stablecoinchains', '/stablecoins', '/stablecoincharts/Robinhood'].includes(url.pathname))
    || (url.hostname === 'api.robinhood.com' && url.pathname === '/rhj/assets')
    || (url.hostname === 'lemon.fun' && url.pathname.startsWith('/api/public/launchpad/'))
    || (url.hostname === 'robinhoodchain.blockscout.com' && /^\/api\/v2\/addresses\/0x[0-9a-fA-F]{40}\/logs$/.test(url.pathname))
    || (url.hostname === 'production.data-gcp.sushi.com' && url.pathname === '/api/graphql')) {
    return { status: 503, body: { error: 'External dependency unavailable in deterministic acceptance' } };
  }
  const failure = `Unexpected external request: ${input.method} ${url.origin}${url.pathname}`;
  state.unexpected.push(failure);
  throw new Error(failure);
}

export async function runZeroXBrowserAcceptance() {
  await mkdir(output, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'privy.io', aud: 'rmt-local-browser-acceptance', sub: 'did:privy:rmt-local-acceptance', iat: now, exp: now + 3600, cr: String(now), linked_accounts: JSON.stringify([{ type: 'wallet', address: wallet, chain_type: 'ethereum', lv: now }]) };
  const unsigned = `${Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const identity = `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  const boundary = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const result = external(JSON.parse(Buffer.concat(chunks).toString()));
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve) => boundary.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env,
    RMT_ACCEPTANCE_BOUNDARY_URL: `http://127.0.0.1:${boundary.address().port}`,
    RMT_RPC_URL: 'https://browser-acceptance.invalid', RMT_MAINNET_RPC_URL: 'https://browser-acceptance.invalid', ROBINHOOD_MAINNET_RPC_URL: 'https://browser-acceptance.invalid', NEXT_PUBLIC_RMT_RPC_URL: 'https://browser-acceptance.invalid',
    RMT_VNEXT_AUTHORIZATION_ENABLED: 'true', RMT_VNEXT_PUBLIC_EXECUTION_PROVIDERS: 'zero-x-swap',
    RMT_VNEXT_ZEROX_OBSERVATION_ENABLED: 'true', RMT_VNEXT_ZEROX_FIRM_QUOTE_VERIFICATION_ENABLED: 'true',
    RMT_ZEROX_API_KEY: 'server-only-test-key', RMT_ZEROX_ALLOWANCE_HOLDER: holder, RMT_ZEROX_ALLOWANCE_HOLDER_CODE_HASH: keccak256(runtime),
    NEXT_PUBLIC_PRIVY_APP_ID: claims.aud, PRIVY_VERIFICATION_KEY: publicKey.export({ format: 'pem', type: 'spki' })
  };
  const port = 3100;
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['--require', path.join(root, '.github/scripts/zerox-browser-boundary.cjs'), requireWeb.resolve('next/dist/bin/next'), 'start', '-p', String(port)], { cwd: path.join(root, 'apps/web'), env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let serverLog = '';
  child.stdout.on('data', (chunk) => { serverLog += chunk; });
  child.stderr.on('data', (chunk) => { serverLog += chunk; });
  let browser;
  const results = [];
  try {
    for (let attempt = 0; ; attempt++) {
      if (child.exitCode !== null) throw new Error(`Local server exited: ${serverLog}`);
      if (await fetch(base).then((r) => r.ok).catch(() => false)) break;
      if (attempt >= 30) throw new Error('Local acceptance server did not become ready');
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    browser = await chromium.launch({ headless: true });
    for (const [name, viewport] of (process.env.RMT_ACCEPTANCE_ROUTE_ON_DEMAND_ONLY === 'true' ? [] : [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]])) {
      const context = await browser.newContext({ viewport, ...(name === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
      await context.addInitScript(({ wallet }) => {
        const listeners = new Map();
        window.__ZEROX_WALLET_REQUESTS__ = [];
        window.ethereum = {
          isMetaMask: true,
          on(event, fn) { listeners.set(event, [...(listeners.get(event) ?? []), fn]); },
          removeListener(event, fn) { listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== fn)); },
          async request({ method, params }) {
            if (method === 'eth_chainId') return '0x1237';
            if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet];
            if (method === 'eth_sendTransaction') {
              window.__ZEROX_WALLET_REQUESTS__.push(params[0]);
              const error = new Error('User rejected the request'); error.code = 4001; throw error;
            }
            if (method === 'eth_getTransactionCount') return '0x1';
            if (method === 'eth_estimateGas') return '0x2bf20';
            return null;
          }
        };
      }, { wallet });
      const page = await context.newPage();
      const api = [];
      page.on('response', async (response) => {
        if (response.url().includes('/api/')) api.push({ path: new URL(response.url()).pathname, status: response.status(), body: await response.json().catch(() => null) });
      });
      await page.route('**/*', async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin === base) {
          const headers = request.headers();
          if (headers['privy-id-token']) headers['privy-id-token'] = identity;
          return route.continue({ headers });
        }
        const result = external({ url: request.url(), method: request.method(), body: request.postData() });
        return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
      });
      try {
        await page.goto(`${base}/?market=${token}&side=buy`, { waitUntil: 'domcontentloaded' });
        const terms = page.getByRole('button', { name: 'I understand', exact: false });
        await terms.click({ timeout: 15000 });
        await page.getByRole('button', { name: 'Start with live markets', exact: true }).click({ timeout: 15000 });
        await page.locator('.vnTradePanel').waitFor({ timeout: 30000 });
        await page.getByLabel('Exact input amount').fill('25');
        await page.locator('.vnReviewButton').click();
        await page.waitForResponse((r) => r.url().endsWith('/api/vnext/authorize') && r.status() === 200, { timeout: 20000 });
        assert.ok(api.some((r) => r.path === '/api/vnext/verify' && r.status === 200), '0x reaches real verification');
        await page.locator('.vnWalletFeeDisclosure').waitFor();
        const disclosure = await page.locator('.vnWalletFeeDisclosure').innerText();
        for (const text of ['0.25%', 'USDG', 'Expected receive', 'Minimum receive', '0x/provider fee', 'Network fee']) assert.ok(disclosure.includes(text), `Missing disclosure: ${text}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal overflow');
        assert.deepEqual(state.unexpected, [], 'Unexpected external traffic fails acceptance');
        results.push({ viewport: name, status: 'wallet-review-ready' });
      } finally {
        await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
        await writeFile(path.join(output, `${name}-evidence.json`), JSON.stringify({ api, state, text: await page.locator('body').innerText() }, null, 2));
        await context.close();
      }
    }
    if (process.env.RMT_ACCEPTANCE_ROUTE_ON_DEMAND_ONLY !== 'true') results.push(...await runZeroXWalletJourneys({ browser, base, identity, external, state, wallet, token, usdg, holder, output }));
    results.push(...await runRouteOnDemandJourneys({ browser, base, identity, external, state, wallet, usdg, output, fixtures: routeFixtures }));
  } finally {
    await browser?.close();
    child.kill();
    await new Promise((resolve) => boundary.close(resolve));
    await writeFile(path.join(output, 'report.json'), JSON.stringify({ results, signatures: 0, transactions: 0 }, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runZeroXBrowserAcceptance();
