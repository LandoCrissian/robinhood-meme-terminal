import { exerciseTradeRefresh } from './trade-refresh-browser-checks.mjs';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { decodeFunctionData, encodeFunctionData, encodeEventTopics, erc20Abi, keccak256, maxUint256, parseUnits } = requireWeb('viem');
requireWeb('tsx/cjs');
const { authorizationPayloadHash } = requireWeb('./lib/vnext/authorization-plan.ts');
const hex = (value) => `0x${BigInt(value).toString(16)}`;
const h = (letter) => `0x${letter.repeat(64)}`;
const lower = (value) => String(value).toLowerCase();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await pause(100); }
  throw new Error(message);
}

export async function runZeroXWalletJourneys(options) {
  const { browser, base, identity, external, state, wallet, token, usdg, holder, output } = options;
  const results = [];
  // These probes corrupt one field in a REAL server response in transit. They
  // do not fabricate a quote, verification, or authorization implementation.
  const wireFaults = {
    'wrong-treasury': (plan) => { plan.providerNativeFee.treasury = token; },
    'wrong-bps': (plan) => { plan.providerNativeFee.feeBps = 26; },
    'wrong-bound-fee-asset': (plan) => { plan.providerNativeFee.feeAsset = token; },
    'wrong-bound-fee-amount': (plan) => { plan.providerNativeFee.feeAmountAtomic = '1'; },
    'missing-bound-fee': (plan) => { delete plan.providerNativeFee; },
    'changed-protected-output': (plan) => { plan.protectedOutputAtomic = '1'; },
    'changed-wallet-target': (plan) => { plan.target = token; },
    'changed-wallet-calldata': (plan) => { plan.data = '0x1234567899999999'; },
    'changed-wallet-value': (plan) => { plan.value = '1'; },
    'changed-wallet-gas': (plan) => { plan.gasLimit = '180001'; },
    'changed-wallet-gas-price': (plan) => { plan.gasPrice = '50000001'; },
    'approval-over-sell': (plan) => { plan.data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [holder, 25000001n] }); },
    'approval-unlimited': (plan) => { plan.data = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [holder, maxUint256] }); },
    'stale-post-approval': (plan) => { plan.data = '0x1234567811111111'; }
  };
  const faults = {
    'wrong-fee-asset': (quote) => { quote.fees.integratorFee.token = quote.buyToken; },
    'wrong-fee-amount': (quote) => { quote.fees.integratorFee.amount = '1'; },
    'missing-integrator-fee': (quote) => { quote.fees.integratorFee = null; },
    'weakened-protected-output': (quote) => { quote.buyAmount = '2'; quote.minBuyAmount = '1'; },
    'malformed-target': (quote) => { quote.transaction.to = '0x1234'; },
    'changed-target': (quote) => { quote.transaction.to = token; },
    'empty-calldata': (quote) => { quote.transaction.data = '0x'; },
    'unexplained-value': (quote) => { quote.transaction.value = '1'; },
    'invalid-gas': (quote) => { quote.transaction.gas = '0'; },
    'simulation-incomplete': (quote) => { quote.issues.simulationIncomplete = true; },
    'wrong-allowance-holder': (quote) => { quote.allowanceTarget = token; },
    'duplicate-integrator-fee': (quote) => { quote.fees.integratorFees = [quote.fees.integratorFee, quote.fees.integratorFee]; }
  };
  for (const viewportName of ['desktop', 'mobile']) {
    const scenarios = ['identity-not-requested', 'sell-approval-identity-retry', 'sell-approval-expired', 'sell-approval-provider-retry', 'sell-approval-return', 'sell-approval-uuid-return', 'sell-approval-account-change', 'sell-approval-chain-change', 'sell-approval-rejected', 'direct-confirmation', 'returning-signer', 'mobile-walletconnect', 'mobile-walletconnect-sell', 'native-sell', 'approval-only', 'confirmed-without-output', 'reverted', 'multi-account-owner-second', 'signer-two-providers', 'signer-disappeared', 'signer-account-change', 'signer-provider-conflict', 'approval-requote', 'native', 'rejection', 'pending', 'expired-quote', 'expired-quote-sell', 'refresh-click-buy', 'refresh-click-buy-again', 'refresh-click-sell', 'refresh-provider-recovery', 'refresh-provider-failure', 'quote-only', ...Object.keys(faults), 'simulation-failure', ...Object.keys(wireFaults)];
    scenarios.splice(2, 0, 'sell-approval-healthy', 'sell-approval-identity-multiple-retry',
      'sell-approval-identity-persistent', 'sell-approval-identity-account-change',
      'sell-approval-identity-chain-change', 'sell-approval-identity-uuid-return');
    for (const scenario of (options.scenarios ?? [...scenarios, 'contract-paused', 'contract-unregistered', 'contract-incompatible', 'contract-previous', 'contract-history'])) {
      state.registryPaused = scenario === 'contract-paused';
      state.registryUnregistered = scenario === 'contract-unregistered';
      state.incompatibleRuntime = scenario === 'contract-incompatible';
      state.registryPrevious = scenario === 'contract-previous';
      const contractRejected = ['contract-paused','contract-unregistered','contract-incompatible'].includes(scenario);
      state.approved = !scenario.startsWith('sell-approval') && !['approval-only', 'approval-requote', 'approval-over-sell', 'approval-unlimited', 'stale-post-approval'].includes(scenario);
      state.priceDisabled = scenario === 'quote-only';
      state.simulationFails = scenario === 'simulation-failure';
      state.modifyFirm = faults[scenario];
      state.simulations = [];
      const transactions = new Map();
      const requests = [];
      const api = [];
      let corrupted = 0;
      let validatedDispatches = 0;
      let block = 50000000;
      let receiptsEnabled = !['sell-approval-return', 'sell-approval-uuid-return', 'sell-approval-account-change', 'sell-approval-chain-change'].includes(scenario);
      let transientInjected = false;
      let identityFailuresInjected = 0;
      const identityFailureLimit = scenario === 'sell-approval-identity-persistent' ? 4
        : scenario === 'sell-approval-identity-multiple-retry' ? 3 : 1;
      const approvalJourney = scenario.startsWith('sell-approval');
      const identityRecovery = scenario.startsWith('sell-approval-identity');
      let settledOutputAsset = null;
      let settledOutputBalanceReads = 0;
      const isMobile = viewportName === 'mobile';
      const context = await browser.newContext({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(isMobile ? { isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36' } : {}) });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.install();
      // These journeys call a real Next server with real Date.now() deadlines.
      // Advancing only browser time made a fresh ~10s server plan expire before
      // arrival (9,847ms clock skew in the regression). Keep both clocks moving
      // together; expiry-specific scenarios still inject their explicit failure.
      await page.clock.resume();
      state.rpcOverride = (request) => {
        if (settledOutputAsset && (request.method === 'eth_call'
          && (lower(request.params[0]?.to) === settledOutputAsset && request.params[0]?.data?.startsWith('0x70a08231')
            || !request.params[0]?.to && request.params[0]?.data?.toLowerCase().includes(settledOutputAsset.slice(2)) && request.params[0]?.data?.includes('70a08231'))
          || request.method === 'eth_getBalance' && settledOutputAsset === '0x0000000000000000000000000000000000000000' && lower(request.params[0]) === wallet)) settledOutputBalanceReads++;
        if (request.method === 'eth_blockNumber') return hex(++block);
        if (request.method === 'debug_traceTransaction') {
          const tx = transactions.get(lower(request.params[0]));
          const plan = tx && api.filter((entry) => entry.path === '/api/vnext/authorize' && entry.status === 200 && entry.body.plan.data === tx.data).at(-1)?.body.plan;
          if (!tx || !plan) return null;
          return { type: 'CALL', from: wallet, to: tx.to, value: tx.value, input: tx.data,
            calls: [{ type: 'CALL', from: holder, to: wallet, input: '0x', value: hex(BigInt(plan.providerNativeFee.expectedOutputAtomic)) }] };
        }
        if (!['eth_getTransactionReceipt', 'eth_getTransactionByHash'].includes(request.method)) return undefined;
        const txHash = lower(request.params[0]);
        const tx = transactions.get(txHash);
        if (!tx || !receiptsEnabled) return null;
        const approval = tx.data.startsWith('0x095ea7b3');
        if (approval) { state.approved = true; if (scenario === 'approval-only') state.priceDisabled = true; }
        if (request.method === 'eth_getTransactionByHash') return {
          blockHash: h('a'), blockNumber: hex(50000000), chainId: '0x1237', from: wallet, gas: tx.gas, gasPrice: tx.gasPrice,
          hash: txHash, input: tx.data, nonce: approval ? '0x1' : '0x2', to: tx.to, transactionIndex: '0x0', type: '0x0', value: tx.value,
          v: '0x1b', r: h('1'), s: h('2')
        };
        return { blockHash: h('a'), blockNumber: hex(50000000), contractAddress: null, cumulativeGasUsed: '0x30d40', effectiveGasPrice: tx.gasPrice,
          from: wallet, gasUsed: approval ? '0xc350' : '0x186a0', logs: approval || ['confirmed-without-output', 'reverted'].includes(scenario) ? [] : (() => {
            const plan = api.filter((entry) => entry.path === '/api/vnext/authorize' && entry.status === 200 && entry.body.plan.data === tx.data).at(-1)?.body.plan;
            assert.ok(plan, 'Settlement receipt must match the exact submitted plan');
            settledOutputAsset = lower(plan.outputAsset);
            return [{ address: plan.outputAsset, data: '0x' + BigInt(plan.providerNativeFee.expectedOutputAtomic).toString(16).padStart(64, '0'),
              topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: holder, to: wallet } }),
              blockHash: h('a'), blockNumber: hex(50000000), transactionHash: txHash, transactionIndex: '0x0', logIndex: '0x0', removed: false }];
          })(), logsBloom: `0x${'0'.repeat(512)}`,
          status: scenario === 'reverted' ? '0x0' : '0x1', to: tx.to, transactionHash: txHash, transactionIndex: '0x0', type: '0x0' };
      };
      await page.exposeFunction('__ZEROX_CAPTURE__', async (transaction) => {
        requests.push(transaction);
        const bundle = api.filter((entry) => entry.path === '/api/vnext/authorize' && entry.status === 200).at(-1)?.body;
        assert.ok(bundle, 'Wallet requests require a real server authorization');
        const plan = bundle.plan;
        if (scenario === 'approval-requote' && plan.kind === 'swap') {
          const remembered = page.getByRole('region', { name: 'Injected signer selection' });
          assert.equal(await remembered.getByText('Selected signer: Explicit test signer', { exact: true }).count(), 1);
          assert.equal(await remembered.getByRole('button', { name: 'Change signer', exact: true }).count(), 1);
          assert.equal(await remembered.getByText('Choose the injected signer for 0x', { exact: true }).count(), 0,
            'the exact explicit signer is reused at the fresh swap dispatch, before its result can close the panel');
        }
        assert.equal(lower(transaction.from), wallet);
        assert.equal(lower(transaction.to), lower(plan.target));
        assert.equal(transaction.data, plan.data);
        assert.equal(BigInt(transaction.value), BigInt(plan.value));
        assert.equal(BigInt(transaction.gas), BigInt(plan.gasLimit));
        assert.equal(BigInt(transaction.gasPrice), BigInt(plan.gasPrice));
        assert.equal(keccak256(transaction.data), plan.kind === 'swap' ? plan.providerNativeFee.transactionCalldataHash : bundle.evidence.nextActionCalldataHash);
        if (plan.kind === 'swap') {
          assert.ok(state.simulations.some((call) => lower(call.from) === wallet && lower(call.to) === lower(transaction.to)
            && call.data === transaction.data && BigInt(call.value) === BigInt(transaction.value)
            && BigInt(call.gas) === BigInt(transaction.gas) && BigInt(call.gasPrice) === BigInt(transaction.gasPrice)), 'Wallet envelope must equal the exact simulated envelope');
        } else {
          const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
          assert.equal(decoded.functionName, 'approve');
          assert.equal(lower(transaction.to), lower(plan.inputAsset));
          assert.equal(lower(decoded.args[0]), holder);
          assert.equal(decoded.args[1], BigInt(plan.inputAmountAtomic));
          assert.equal(decoded.args[1], lower(plan.inputAsset) === usdg ? 25000000n : 25n * 10n ** 18n);
          assert.equal(BigInt(transaction.value), 0n);
        }
        const txHash = h(plan.kind === 'erc20_approval' ? 'b' : 'c');
        if (!['rejection', 'pending', 'sell-approval-rejected'].includes(scenario)) transactions.set(txHash, transaction);
        validatedDispatches++;
        return txHash;
      });
      await context.addInitScript(({ wallet, scenario }) => {
        window.__RMT_ACCEPTANCE_READ_WALLET_ASSETS__ = true;
        const listeners = new Map();
        window.__ZEROX_PROMPTS__ = 0;
        const lifecycle = Number(sessionStorage.getItem('journey-lifecycle') || '0') + 1;
        sessionStorage.setItem('journey-lifecycle', String(lifecycle));
        let signerAccounts = [wallet], signerChain = '0x1237';
        const uuid = (scenario.includes('uuid-return') || scenario === 'returning-signer') && lifecycle > 1
          ? 'e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0' : 'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0';
        const selectedSigner = {
          isMetaMask: true,
          on(event, fn) { listeners.set(event, [...(listeners.get(event) ?? []), fn]); },
          removeListener(event, fn) { listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== fn)); },
          async request({ method, params }) {
            if (method === 'eth_chainId') return signerChain;
            if (method === 'eth_requestAccounts' && scenario === 'multi-account-owner-second') throw new Error('Selected signer must not request new permissions');
            if (method === 'eth_accounts' || method === 'eth_requestAccounts') return scenario === 'multi-account-owner-second'
              ? ['0x1111111111111111111111111111111111111111', wallet] : signerAccounts;
            if (method === 'eth_getTransactionCount') return '0x1';
            if (method === 'eth_estimateGas') return '0x2bf20';
            if (method === 'eth_sendTransaction') {
              if (scenario === 'multi-account-owner-second' && params[0].from.toLowerCase() !== wallet.toLowerCase()) {
                throw new Error('Permitted account order changed the authenticated transaction sender');
              }
              window.__ZEROX_PROMPTS__++;
              const result = await window.__ZEROX_CAPTURE__(params[0]);
              if (scenario === 'rejection' || scenario === 'sell-approval-rejected') { const error = new Error('User rejected the request'); error.code = 4001; throw error; }
              if (scenario === 'pending') return new Promise(() => {});
              return result;
            }
            return null;
          }
        };
        if (scenario.startsWith('mobile-walletconnect')) window.__RMT_ACCEPTANCE_WALLETCONNECT_PROVIDER__ = selectedSigner;
        // Model the already-selected authenticated identity independently from
        // the raw signer permitted account set, just as the normal integration does.
        window.ethereum = scenario === 'multi-account-owner-second' ? {
          ...selectedSigner,
          async request(args) {
            if (args.method === 'eth_accounts' || args.method === 'eth_requestAccounts') return [wallet];
            if (args.method === 'eth_sendTransaction') throw new Error('Identity-facing provider must not dispatch the selected signer transaction');
            return selectedSigner.request(args);
          }
        } : selectedSigner;
        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
          info: { uuid, name: 'Explicit test signer', rdns: 'io.rmt.test', icon: 'data:image/png;base64,' },
          provider: selectedSigner
        } }));
        window.addEventListener('eip6963:requestProvider', announce);
        window.__ZEROX_CHANGE_CONTEXT__ = (kind) => {
          if (kind === 'chain') { signerChain = '0x1'; for (const fn of listeners.get('chainChanged') ?? []) fn(signerChain); }
          else { signerAccounts = ['0x1111111111111111111111111111111111111111']; for (const fn of listeners.get('accountsChanged') ?? []) fn(signerAccounts); }
        };
        window.__ZEROX_INVALIDATE_SIGNER__ = () => {
          if (scenario === 'signer-provider-conflict') window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
            info: { uuid: 'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0', name: 'Changed provider identity', rdns: 'io.changed.test' }, provider: { ...selectedSigner }
          } }));
          else for (const listener of listeners.get(scenario === 'signer-account-change' ? 'accountsChanged' : 'disconnect') ?? []) listener(scenario === 'signer-account-change' ? ['0x1111111111111111111111111111111111111111'] : { code: 4900 });
        };
        if (scenario === 'signer-two-providers') {
          const second = { ...selectedSigner };
          const announceSecond = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
            info: { uuid: 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0', name: 'Other explicit signer', rdns: 'io.other.test' }, provider: second
          } }));
          window.addEventListener('eip6963:requestProvider', announceSecond); announceSecond();
        }
        announce();
      }, { wallet, scenario });
      page.on('response', async (response) => {
        if (/\/api\/vnext\/(quotes|verify|authorize|wallet-request-recovery)$/.test(new URL(response.url()).pathname)) {
          api.push({ clientObservedAtMs: await page.evaluate(() => Date.now()).catch(() => null),
            path: new URL(response.url()).pathname, status: response.status(), body: await response.json().catch(() => null) });
        }
      });
      await page.route('**/*', async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin === base) {
          const headers = request.headers();
          const apiPath = new URL(request.url()).pathname;
          if (scenario === 'identity-not-requested' && apiPath === '/api/vnext/quotes') {
            return route.fulfill({ status: 422, json: { error: 'Both quote assets require verified Robinhood Chain identity and decimals.', phase: 'IDENTITY_UNAVAILABLE', providerRequestAttempted: false } });
          }
          if (state.approved && requests.length === 1 &&
            ((identityRecovery && identityFailuresInjected < identityFailureLimit && apiPath === '/api/vnext/authorize')
              || !transientInjected && scenario === 'sell-approval-expired' && apiPath === '/api/vnext/authorize'
              || !transientInjected && scenario === 'sell-approval-provider-retry' && apiPath === '/api/vnext/quotes')) {
            transientInjected = true;
            if (identityRecovery) identityFailuresInjected++;
            return route.fulfill({ status: scenario === 'sell-approval-expired' ? 409 : 503,
              json: { error: 'Controlled transient readiness failure', phase: scenario === 'sell-approval-expired' ? 'QUOTE_EXPIRED'
                : scenario === 'sell-approval-provider-retry' ? 'ZEROX_PROVIDER_UNAVAILABLE' : 'IDENTITY_UNAVAILABLE' } });
          }
          // Reproduce nonzero transport latency without moving the client ahead
          // of the authority that issued the transaction envelope.
          if (identityRecovery && state.approved && requests.length === 1 && apiPath === '/api/vnext/authorize') await pause(750);
          if (headers['privy-id-token']) headers['privy-id-token'] = identity;
          if (wireFaults[scenario] && new URL(request.url()).pathname === '/api/vnext/authorize') {
            const response = await route.fetch({ headers });
            const body = await response.json();
            assert.equal(response.status(), 200, 'Corruption probes require genuine valid server authority first');
            if (scenario !== 'stale-post-approval' || body.plan.kind === 'swap') {
              wireFaults[scenario](body.plan);
              body.plan.payloadHash = authorizationPayloadHash(body.plan);
              corrupted++;
            }
            return route.fulfill({ response, json: body });
          }
          return route.continue({ headers });
        }
        try {
          const response = external({ url: request.url(), method: request.method(), body: request.postData() });
          return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
        } catch { return route.abort('blockedbyclient'); }
      });
      const prefix = `${viewportName}-${scenario}`;
      try {
        const sell = scenario.startsWith('sell-approval') || ['native-sell', 'mobile-walletconnect-sell', 'expired-quote-sell', 'refresh-click-sell'].includes(scenario);
        await page.goto(`${base}/?market=${token}&side=${sell ? 'sell' : 'buy'}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'I understand', exact: false }).click();
        await page.getByRole('button', { name: 'Start with live markets', exact: true }).click();
        await page.getByLabel('Exact input amount').waitFor();
        if (scenario === 'native') await page.getByLabel('Pay with asset').selectOption('eip155:4663/native');
        if (sell && !scenario.startsWith('sell-approval')) await page.locator('.vnTradePanel select').first().selectOption('eip155:4663/native');
        await page.getByLabel('Exact input amount').fill(scenario === 'native' ? '0.0005' : '25');
        // Connected 0x amount readiness prepares authority without another RMT confirmation.
        if (scenario === 'identity-not-requested') {
          await page.getByText('Token verification temporarily unavailable', { exact: true }).first().waitFor();
          assert.equal(await page.getByText('Route temporarily unavailable', { exact: true }).count(), 0);
          assert.equal(await page.getByText('Route provider temporarily unavailable', { exact: true }).count(), 0);
          assert.equal(await page.getByRole('button', { name: 'Retry token verification', exact: true }).count(), 1);
          assert.equal(api.filter((entry) => entry.path.endsWith('/verify')).length, 0);
          assert.equal(requests.length, 0);
        } else if (scenario === 'quote-only') {
          await until(() => api.some((entry) => entry.path.endsWith('/quotes')), 'Quote-only observation missing');
          const gasless = api.find((entry) => entry.path.endsWith('/quotes')).body.attempts.find((attempt) => attempt.provider === 'zero-x-gasless');
          assert.equal(gasless.status, 'indicative', 'A genuine quote-only candidate must be observed');
          assert.equal(gasless.strictVerificationAvailable, false);
          assert.equal(gasless.publicWalletExecutionEligible, false);
          await pause(500);
          assert.equal(api.filter((entry) => entry.path.endsWith('/verify')).length, 0, 'Non-public providers never reach verification');
          assert.equal(requests.length, 0);
        } else if (wireFaults[scenario] && scenario !== 'stale-post-approval') {
          await until(() => corrupted === 1, `Missing corruption probe ${scenario}`);
          await page.locator('.vnRouteTop').click();
          await until(async () => /reject|changed|inconsistent|invalid|authority|mismatch/i.test(await page.locator('.vnTradePanel').innerText()), 'Corrupted authority must produce a rejection state');
          assert.equal(requests.length, 0, 'Corrupted authority cannot prompt the wallet');
        } else if (faults[scenario] || scenario === 'simulation-failure' || contractRejected) {
          await until(() => api.some((entry) => entry.path.endsWith('/verify')), `Verification missing for ${scenario}`);
          await pause(200);
          assert.equal(api.filter((entry) => entry.path.endsWith('/authorize')).length, 0, 'Invalid firm evidence cannot authorize');
          assert.equal(requests.length, 0, 'Invalid firm evidence cannot prompt wallet');
          assert.match(await page.locator('.vnOutputProtection').innerText(), /Set when you trade/);
          if (contractRejected) {
            const failed = api.find(entry => entry.path.endsWith('/verify') && entry.status === 422);
            assert.equal(failed.body.phase, 'FIRM_VERIFY_FAILED');
            assert.equal(failed.body.retryable, false);
            await pause(1800);
            assert.equal(api.filter(entry => entry.path.endsWith('/verify')).length, 1, 'No automatic recovery for unchanged incompatible authority');
            assert.equal(await page.locator('.vnTradeReceipt').count(), 0);
          }
        } else {
          await until(() => api.some((entry) => entry.path.endsWith('/authorize') && entry.status === 200), `${scenario} did not authorize`);
          await page.locator('.vnWalletFeeDisclosure').waitFor({ state: 'attached' });
          const bundle = api.filter((entry) => entry.path.endsWith('/authorize')).at(-1).body;
          assert.equal(bundle.plan.provider, 'zero-x-swap');
          const economics = async () => {
            const minimum = await page.locator('.vnOutputProtection strong').innerText();
            const output = await page.locator('.vnReceiveField > div > strong').first().innerText();
            const quote = api.filter(entry => entry.path.endsWith('/quotes') && entry.status === 200).at(-1).body;
            const decimals = quote.attempts.find(attempt => attempt.provider === bundle.plan.provider).outputDecimals;
            const atomic = text => parseUnits(text.split(' ')[0].replaceAll(',', ''), decimals).toString();
            assert.equal(atomic(minimum), bundle.plan.protectedOutputAtomic);
            assert.equal(atomic(output), bundle.evidence.expectedOutputAtomic);
            assert.equal(bundle.evidence.sourceQuoteRequestId, bundle.plan.sourceQuoteRequestId);
            assert.equal(bundle.evidence.verificationId, bundle.plan.sourceVerificationId);
          };
          await economics();
          assert.equal(bundle.plan.providerNativeFee.feeBps, 25);
          assert.equal(lower(bundle.plan.providerNativeFee.treasury), '0x61700479a4a1f62584fd3aba2c2b290ea727d2ec');
          const quote = api.find((entry) => entry.path.endsWith('/quotes') && entry.status === 200).body;
          assert.deepEqual(quote.attempts.filter((attempt) => attempt.publicWalletExecutionEligible).map((attempt) => attempt.provider), ['zero-x-swap']);
          assert.ok(quote.attempts.filter((attempt) => attempt.provider !== 'zero-x-swap').every((attempt) => !attempt.publicWalletExecutionEligible));
          const review = page.getByRole('button', { name: /Review (exact approval|verified swap) in wallet/, exact: true });
          await review.scrollIntoViewIfNeeded();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal overflow');
          if (scenario.startsWith('expired-quote') || scenario.startsWith('refresh-')) { await exerciseTradeRefresh({ page, api, requests, scenario, viewportName }); } else {
            assert.equal(requests.length, 0, 'quote, verification and signer discovery never auto-open a wallet');
            const selector = page.getByRole('region', { name: 'Injected signer selection' });
            if (scenario === 'signer-two-providers') {
              assert.equal(await selector.getByRole('button', { name: /Other explicit signer/ }).count(), 1);
              assert.equal(await selector.getByText(/Selected signer:/).count(), 0, 'multiple new providers require explicit choice');
            }
            if (!scenario.startsWith('mobile-walletconnect')) await selector.getByRole('button', { name: /Explicit test signer/ }).click();
            if (scenario === 'returning-signer') {
              await page.reload({ waitUntil: 'domcontentloaded' });
              await page.getByText('Selected signer: Explicit test signer', { exact: true }).waitFor();
              await review.waitFor();
              assert.equal(await page.getByRole('button', { name: /Explicit test signer.*SELECT/ }).count(), 0);
              assert.equal(requests.length, 0, 'preference restoration cannot dispatch');
            }
            if (['signer-disappeared', 'signer-account-change', 'signer-provider-conflict'].includes(scenario)) {
              await page.evaluate(() => window.__ZEROX_INVALIDATE_SIGNER__());
              // A disconnect may also unmount the now-ineligible wallet review.
              // Neither an absent review nor an eligible-but-unselected review may dispatch.
              await until(async () => await page.getByText('Selected signer: Explicit test signer', { exact: true }).count() === 0, 'Changed wallet context must invalidate the remembered signer');
              if (await review.isVisible()) await review.click();
              await pause(200);
              assert.equal(requests.length, 0);
              assert.equal(await selector.getByText(/Selected signer:/).count(), 0);
              results.push({ viewport: viewportName, scenario, status: 'PASS', walletPrompts: 0 });
              console.log(prefix + ': PASS');
              continue;
            }
            await review.click();
            await until(() => requests.length === 1, `${scenario} wallet request missing`);
            if (scenario === 'rejection' || scenario === 'sell-approval-rejected') {
              await until(async () => /reject|cancel/i.test(await page.locator('body').innerText()), 'Rejection state missing');
              const journal = await page.evaluate(() => Object.values(localStorage).join('\n'));
              assert.ok(!journal.includes('"state":"submitted"') && !journal.includes('"state":"confirmed"'), 'Rejection must not fake a submission');
              await pause(500);
              assert.equal(requests.length, 1, 'No automatic duplicate prompt after rejection');
            } else if (scenario === 'pending') {
              receiptsEnabled = false;
              await page.clock.fastForward(45000);
              await until(async () => /pending|unknown|waiting/i.test(await page.locator('body').innerText()), 'Truthful pending state missing');
              assert.equal(requests.length, 1);
              await page.reload({ waitUntil: 'domcontentloaded' });
              await until(async () => /pending|unknown|recovery|waiting/i.test(await page.locator('body').innerText()), 'Durable recovery state missing');
              assert.equal(requests.length, 1, 'Recovery must not resubmit');
            } else if (scenario.startsWith('sell-approval')) {
              if (scenario.endsWith('account-change') || scenario.endsWith('chain-change')) {
                if (identityRecovery) await until(() => identityFailuresInjected > 0, 'Identity retry must begin before the binding changes');
                await page.evaluate((kind) => window.__ZEROX_CHANGE_CONTEXT__(kind), scenario.endsWith('chain-change') ? 'chain' : 'account');
                receiptsEnabled = true;
                await pause(16000);
                assert.equal(requests.length, 1, 'Changed account/chain cannot continue to a swap');
              } else if (scenario === 'sell-approval-identity-persistent') {
                await until(() => identityFailuresInjected === 4, 'Bounded identity retries must exhaust', 30000);
                await until(async () => /Retry quote|Retry token verification/.test(await page.locator('body').innerText()), 'Exhaustion must expose truthful recovery');
                await pause(2500);
                assert.equal(identityFailuresInjected, 4, 'No tight or unbounded identity retry loop');
                assert.equal(requests.length, 1, 'No duplicate approval or swap after exhausted identity recovery');
                assert.equal(await page.locator('.vnTradeReceipt').count(), 0, 'Approval is not settlement');
              } else {
                if (scenario.endsWith('return')) {
                  await page.reload({ waitUntil: 'domcontentloaded' });
                  receiptsEnabled = true;
                }
                await until(() => requests.length === 2, `${scenario} must continue after one Sell initiation`, 30000);
                const plans = api.filter((entry) => entry.path.endsWith('/authorize') && entry.status === 200).map((entry) => entry.body.plan);
                assert.equal(plans[0].kind, 'erc20_approval');
                assert.equal(plans.at(-1).kind, 'swap');
                assert.notEqual(plans[0].sourceQuoteRequestId, plans.at(-1).sourceQuoteRequestId);
                assert.equal(requests.filter((request) => request.data.startsWith('0x095ea7b3')).length, 1, 'Retry never repeats approval');
                if (identityRecovery) assert.equal(identityFailuresInjected, identityFailureLimit);
                assert.equal(lower(plans.at(-1).inputAsset), token);
                assert.equal(lower(plans.at(-1).outputAsset), usdg);
                if (scenario.includes('retry') || scenario.endsWith('expired')) assert.equal(transientInjected, true);
                await page.locator('.vnTradeReceipt').waitFor({ state: 'visible', timeout: 30000 });
                assert.match(await page.locator('.vnTradeReceipt').innerText(), /Sell confirmed/i);
                await until(() => settledOutputBalanceReads > 0, 'Settled sell must refresh its exact proceeds balance');
              }
            } else if (scenario === 'approval-only') {
              await page.getByText('Exact approval confirmed', { exact: true }).waitFor({ timeout: 30000 });
              await pause(500);
              assert.equal(await page.locator('.vnTradeReceipt').count(), 0, 'approval is not a purchase');
              assert.equal(requests.length, 1, 'no executable fresh swap means no second wallet request');
            } else if (scenario === 'confirmed-without-output') {
              await page.getByText('Transaction confirmed. Swap settlement not yet verified.', { exact: true }).waitFor({ timeout: 30000 });
              assert.equal(await page.locator('.vnTradeReceipt').count(), 0, 'receipt without output cannot claim a purchase');
              assert.equal(requests.length, 1);
            } else if (scenario === 'reverted') {
              await until(async () => /reverted/i.test(await page.locator('body').innerText()), 'Revert must be visible');
              assert.equal(await page.locator('.vnTradeReceipt').count(), 0);
              assert.equal(requests.length, 1);
            } else if (scenario === 'stale-post-approval') {
              await until(() => corrupted === 1, 'Fresh post-approval response was not exercised', 30000);
              await until(async () => /reject|changed|inconsistent|invalid|authority|mismatch/i.test(await page.locator('.vnTradePanel').innerText()), 'Stale post-approval calldata must be rejected');
              assert.equal(requests.length, 1, 'Only the exact approval may reach the wallet');
            } else if (scenario === 'approval-requote') {
              assert.equal(bundle.plan.kind, 'erc20_approval');
              await until(() => api.filter((entry) => entry.path.endsWith('/authorize') && entry.status === 200).length >= 2, 'Fresh post-approval authorization missing', 30000);
              const fresh = api.filter((entry) => entry.path.endsWith('/authorize') && entry.status === 200).at(-1).body;
              assert.notEqual(fresh.plan.sourceQuoteRequestId, bundle.plan.sourceQuoteRequestId);
              assert.notEqual(fresh.plan.sourceVerificationId, bundle.plan.sourceVerificationId);
              assert.notEqual(fresh.plan.providerNativeFee.firmQuote.zid, bundle.plan.providerNativeFee.firmQuote.zid);
              assert.notEqual(fresh.plan.providerNativeFee.transactionCalldataHash, bundle.plan.providerNativeFee.transactionCalldataHash);
              assert.equal(fresh.plan.kind, 'swap');
              await until(() => requests.length === 2 && validatedDispatches === 2, 'Fresh swap wallet request or exact signer/envelope validation missing after original trade action');
              assert.equal(requests[1].data, fresh.plan.data);
              assert.notEqual(keccak256(requests[1].data), bundle.plan.providerNativeFee.transactionCalldataHash);
            } else {
              assert.equal(bundle.plan.kind, 'swap');
              if (scenario === 'native') { assert.ok(BigInt(requests[0].value) > 0n); assert.notEqual(lower(requests[0].to), usdg); }
              await page.locator('.vnTradeReceipt').waitFor({ state: 'visible', timeout: 30000 });
              const receipt = await page.locator('.vnTradeReceipt').innerText();
              assert.match(receipt, /confirmed/i);
              assert.match(receipt, /quoted/i);
              assert.doesNotMatch(receipt, /RMT fee settled|confirmed RMT revenue/i);
              await until(() => settledOutputBalanceReads > 0, 'Verified settlement must refresh the exact output wallet balance');
              assert.equal(requests.length, 1);
              if (scenario === 'contract-history') {
                state.incompatibleRuntime = true;
                await page.reload({waitUntil:'domcontentloaded'});
                await page.getByText('Verified swap history', {exact:true}).waitFor();
                const history = page.locator('.vnRecoveryBanner').filter({hasText:'Verified swap history'});
                assert.match(await history.innerText(), /Submitted:/);
                assert.ok((await history.locator('a').getAttribute('href')).includes(h('c')));
                await page.getByLabel('Exact input amount').fill('26');
                await until(() => api.some(entry => entry.path.endsWith('/verify') && entry.body?.code === 'CONTRACT_VERSION_UNSUPPORTED'), 'New attempt must reject runtime');
                assert.equal(await page.locator('.vnTradeReceipt').count(), 0, 'History must not become a new success dialog');
                assert.equal(requests.length, 1, 'New failed attempt cannot hand off');
              }
            }
          }
          // Server is final authority even when a caller directly requests another provider.
          if (scenario === 'direct-confirmation') {
            for (const provider of ['zero-x-gasless', 'uniswap-v2', 'uniswap-v3', 'uniswap-v4', 'sushi', 'up-v2', 'up-cl']) {
              const rejected = await page.evaluate(async ({ provider, plan, identity }) => {
                const response = await fetch('/api/vnext/authorize', { method: 'POST', headers: { 'content-type': 'application/json', 'privy-id-token': identity }, body: JSON.stringify({ chainId: 4663, provider, quoteRequestId: plan.sourceQuoteRequestId, verificationId: plan.sourceVerificationId, inputAsset: plan.inputAsset, outputAsset: plan.outputAsset, inputAmountAtomic: plan.inputAmountAtomic, recipient: plan.recipient, expectedStatus: 'verified', indicativeProtectedOutputFloorAtomic: plan.protectedOutputAtomic, expectedProtectedOutputAtomic: plan.protectedOutputAtomic, settlementMode: plan.settlementMode }) });
                return response.status;
              }, { provider, plan: bundle.plan, identity });
              assert.ok([400, 403].includes(rejected), `${provider} cannot authorize in ZERO_X_ONLY`);
            }
          }
        }
        assert.deepEqual(state.unexpected, []);
        results.push({ viewport: viewportName, scenario, status: 'PASS', walletPrompts: requests.length,
          ...(approvalJourney ? { approvalWalletRequests: requests.filter((request) => request.data.startsWith('0x095ea7b3')).length,
            swapWalletRequests: requests.filter((request) => !request.data.startsWith('0x095ea7b3')).length,
            identityFailuresInjected, clockMode: 'real-client-and-server',
            authorizationTimeline: api.filter((entry) => entry.path.endsWith('/authorize')).map((entry) => ({
              httpStatus: entry.status, phase: entry.body?.phase ?? null, kind: entry.body?.plan?.kind ?? null,
              remainingMs: entry.body?.plan ? entry.body.plan.expiresAtMs - entry.clientObservedAtMs : null })) } : {}) });
        console.log(`${prefix}: PASS`);
      } finally {
        await page.screenshot({ path: path.join(output, `${prefix}.png`), fullPage: true });
        await writeFile(path.join(output, `${prefix}.json`), JSON.stringify({ api, requests, text: await page.locator('body').innerText(), journal: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /execution|wallet.request/i.test(key)))) }, null, 2));
        await context.close();
        state.rpcOverride = undefined;
        state.registryPaused = state.registryUnregistered = state.incompatibleRuntime = state.registryPrevious = false;
      }
    }
  }
  return results;
}
