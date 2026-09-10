import assert from 'node:assert/strict';

const peep = ['0xf0821f2b', 'f570ca4e', '7499a9ed', '9db7c788', 'fed9946f'].join('');
const zero = `0x${'0'.repeat(40)}`;

export function hotPathInventory(url, state, usdg) {
  if (url.hostname !== 'identity-indexer.fixture.invalid') return undefined;
  const target = url.searchParams.get('token')?.toLowerCase();
  if (!state.hotPathDurable || ![peep, usdg].includes(target)) return { status: 503, body: { error: 'Fixture inventory unavailable' } };
  state.durableReads = (state.durableReads ?? 0) + 1;
  const pool = {
    sourceId: 'uniswap-v2', protocol: 'uniswap', version: 2,
    poolKey: `0x${'2'.repeat(40)}`, poolAddress: `0x${'2'.repeat(40)}`,
    token0: peep, token1: usdg, stable: null, fee: null, tickSpacing: null, hooks: null,
    transactionHash: `0x${'3'.repeat(64)}`, blockNumber: '100', blockHash: `0x${'4'.repeat(64)}`,
    stateStatus: null, liveFee: null, feeDenominator: null, gaugeAddress: null, gaugeAlive: null,
    gaugeWeight: null, gaugeClaimable: null, feesAddress: null, bribeAddress: null,
    stateError: null, stateObservedBlock: null, stateObservedBlockHash: null
  };
  return { status: 200, body: {
    chainId: 4663, mode: 'shadow', authoritative: false, sourceManifestHash: `0x${'a'.repeat(64)}`,
    coverage: { complete: true, finalizedHead: '200', sources: ['sushiswap-v2', 'sushiswap-v3', 'uniswap-v2', 'uniswap-v3', 'uniswap-v4', 'up-v2', 'up-cl'].map(sourceId => ({ sourceId, status: 'shadow-ready', indexedThrough: '200' })) },
    nextCursor: null, pools: [pool], browseIdentities: {
      source: 'verified-token-identity-index', freshness: 'last-known', identities: [
        { address: peep, name: 'PEEP', symbol: 'PEEP', decimals: 18 },
        { address: usdg, name: 'Global Dollar', symbol: 'USDG', decimals: 6 }
      ]
    }
  } };
}

export async function runHotPathBrowserAcceptance({ browser, base, identity, state, wallet, usdg, stock }) {
  const results = [];
  state.hotPathDurable = true;
  state.metadataUnavailable = true;
  try {
    for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ viewport, isMobile: device === 'mobile' });
      try {
        const page = await context.newPage();
        // Same-origin browser requests exercise real authentication, durable reader,
        // admission, request validation and 0x adapter. No wallet is injected.
        await page.goto(`${base}/api/vnext/quotes`);
        const request = payload => page.evaluate(async ({ payload, identity }) => {
          const started = performance.now();
          const response = await fetch('/api/vnext/quotes', { method: 'POST', headers: { 'content-type': 'application/json', 'privy-id-token': identity }, body: JSON.stringify(payload) });
          return { status: response.status, body: await response.json(), ms: performance.now() - started };
        }, { payload, identity });
        for (const [direction, inputAsset, outputAsset, inputAmountAtomic] of [
          ['ETH->PEEP', zero, peep, '100000000000000'], ['PEEP->ETH', peep, zero, '1000000000000000000'],
          ['USDG->PEEP', usdg, peep, '1000000'], ['PEEP->USDG', peep, usdg, '1000000000000000000']
        ]) {
          const before = state.prices.length;
          const result = await request({ chainId: 4663, inputAsset, outputAsset, inputAmountAtomic, recipient: wallet });
          assert.equal(result.status, 200, JSON.stringify(result));
          assert.ok(state.prices.length > before, `${device} ${direction}: 0x must be reached despite metadata outage`);
          assert.ok(result.body.attempts.some(attempt => attempt.provider === 'zero-x-swap'));
          results.push({ device, direction, liveIdentity: 'unavailable', providerRequested: true, ms: result.ms });
        }
        const before = state.prices.length;
        const unknown = await request({ chainId: 4663, inputAsset: zero, outputAsset: `0x${'9'.repeat(40)}`, inputAmountAtomic: '1000', recipient: wallet });
        assert.equal(unknown.status, 422);
        assert.equal(unknown.body.phase, 'IDENTITY_UNAVAILABLE');
        assert.equal(state.prices.length, before);
        const wrongChain = await request({ chainId: 1, inputAsset: zero, outputAsset: peep, inputAmountAtomic: '1000', recipient: wallet });
        assert.equal(wrongChain.status, 400);
        const malformed = await request({ chainId: 4663, inputAsset: zero, outputAsset: '0x123', inputAmountAtomic: '1000', recipient: wallet });
        assert.equal(malformed.status, 400);
        // Healthy identity must not authorize a Stock Token.
        state.metadataUnavailable = false;
        const stockResult = await request({ chainId: 4663, inputAsset: zero, outputAsset: stock, inputAmountAtomic: '1000', recipient: wallet });
        assert.equal(stockResult.status, 451);
        assert.equal(state.prices.length, before);
        state.metadataUnavailable = true;
      } finally { await context.close(); }
    }
    assert.ok(state.durableReads > 0, 'real strict indexer reader must consume durable evidence');
    return results;
  } finally {
    state.metadataUnavailable = false;
    state.hotPathDurable = false;
  }
}
