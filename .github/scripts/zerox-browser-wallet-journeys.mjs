import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireWeb = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { decodeFunctionData, encodeFunctionData, erc20Abi, keccak256, maxUint256 } = requireWeb('viem');
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
    'weakened-protected-output': (quote) => { quote.minBuyAmount = '1'; },
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
    const scenarios = ['direct-confirmation', 'approval-requote', 'native', 'rejection', 'pending', 'expired-quote', 'quote-only', ...Object.keys(faults), 'simulation-failure', ...Object.keys(wireFaults)];
    for (const scenario of scenarios) {
      state.approved = !['approval-requote', 'approval-over-sell', 'approval-unlimited', 'stale-post-approval'].includes(scenario);
      state.priceDisabled = scenario === 'quote-only';
      state.simulationFails = scenario === 'simulation-failure';
      state.modifyFirm = faults[scenario];
      state.simulations = [];
      const transactions = new Map();
      const requests = [];
      const api = [];
      let corrupted = 0;
      let block = 50000000;
      let receiptsEnabled = true;
      const isMobile = viewportName === 'mobile';
      const context = await browser.newContext({ viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, ...(isMobile ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.clock.install();
      state.rpcOverride = (request) => {
        if (request.method === 'eth_blockNumber') return hex(++block);
        if (!['eth_getTransactionReceipt', 'eth_getTransactionByHash'].includes(request.method)) return undefined;
        const txHash = lower(request.params[0]);
        const tx = transactions.get(txHash);
        if (!tx || !receiptsEnabled) return null;
        const approval = lower(tx.to) === usdg;
        if (approval) state.approved = true;
        if (request.method === 'eth_getTransactionByHash') return {
          blockHash: h('a'), blockNumber: hex(50000000), chainId: '0x1237', from: wallet, gas: tx.gas, gasPrice: tx.gasPrice,
          hash: txHash, input: tx.data, nonce: approval ? '0x1' : '0x2', to: tx.to, transactionIndex: '0x0', type: '0x0', value: tx.value,
          v: '0x1b', r: h('1'), s: h('2')
        };
        return { blockHash: h('a'), blockNumber: hex(50000000), contractAddress: null, cumulativeGasUsed: '0x30d40', effectiveGasPrice: tx.gasPrice,
          from: wallet, gasUsed: approval ? '0xc350' : '0x186a0', logs: [], logsBloom: `0x${'0'.repeat(512)}`,
          status: '0x1', to: tx.to, transactionHash: txHash, transactionIndex: '0x0', type: '0x0' };
      };
      await page.exposeFunction('__ZEROX_CAPTURE__', (transaction) => {
        requests.push(transaction);
        const bundle = api.filter((entry) => entry.path === '/api/vnext/authorize' && entry.status === 200).at(-1)?.body;
        assert.ok(bundle, 'Wallet requests require a real server authorization');
        const plan = bundle.plan;
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
          assert.equal(lower(transaction.to), usdg);
          assert.equal(lower(decoded.args[0]), holder);
          assert.equal(decoded.args[1], BigInt(plan.inputAmountAtomic));
          assert.equal(decoded.args[1], 25000000n);
          assert.equal(BigInt(transaction.value), 0n);
        }
        const txHash = h(plan.kind === 'erc20_approval' ? 'b' : 'c');
        if (!['rejection', 'pending'].includes(scenario)) transactions.set(txHash, transaction);
        return txHash;
      });
      await context.addInitScript(({ wallet, scenario }) => {
        const listeners = new Map();
        window.__ZEROX_PROMPTS__ = 0;
        window.ethereum = {
          isMetaMask: true,
          on(event, fn) { listeners.set(event, [...(listeners.get(event) ?? []), fn]); },
          removeListener(event, fn) { listeners.set(event, (listeners.get(event) ?? []).filter((item) => item !== fn)); },
          async request({ method, params }) {
            if (method === 'eth_chainId') return '0x1237';
            if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet];
            if (method === 'eth_getTransactionCount') return '0x1';
            if (method === 'eth_estimateGas') return '0x2bf20';
            if (method === 'eth_sendTransaction') {
              window.__ZEROX_PROMPTS__++;
              const result = await window.__ZEROX_CAPTURE__(params[0]);
              if (scenario === 'rejection') { const error = new Error('User rejected the request'); error.code = 4001; throw error; }
              if (scenario === 'pending') return new Promise(() => {});
              return result;
            }
            return null;
          }
        };
      }, { wallet, scenario });
      page.on('response', async (response) => {
        if (/\/api\/vnext\/(quotes|verify|authorize|wallet-request-recovery)$/.test(new URL(response.url()).pathname)) {
          api.push({ path: new URL(response.url()).pathname, status: response.status(), body: await response.json().catch(() => null) });
        }
      });
      await page.route('**/*', async (route) => {
        const request = route.request();
        if (new URL(request.url()).origin === base) {
          const headers = request.headers();
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
        await page.goto(`${base}/?market=${token}&side=buy`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'I understand', exact: false }).click();
        await page.getByRole('button', { name: 'Start with live markets', exact: true }).click();
        await page.getByLabel('Exact input amount').waitFor();
        if (scenario === 'native') await page.getByLabel('Pay with asset').selectOption('eip155:4663/native');
        await page.getByLabel('Exact input amount').fill(scenario === 'native' ? '0.0005' : '25');
        await page.locator('.vnReviewButton').click();
        if (scenario === 'quote-only') {
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
        } else if (faults[scenario] || scenario === 'simulation-failure') {
          await until(() => api.some((entry) => entry.path.endsWith('/verify')), `Verification missing for ${scenario}`);
          await pause(200);
          assert.equal(api.filter((entry) => entry.path.endsWith('/authorize')).length, 0, 'Invalid firm evidence cannot authorize');
          assert.equal(requests.length, 0, 'Invalid firm evidence cannot prompt wallet');
        } else {
          await until(() => api.some((entry) => entry.path.endsWith('/authorize') && entry.status === 200), `${scenario} did not authorize`);
          await page.locator('.vnWalletFeeDisclosure').waitFor();
          const bundle = api.filter((entry) => entry.path.endsWith('/authorize')).at(-1).body;
          assert.equal(bundle.plan.provider, 'zero-x-swap');
          assert.equal(bundle.plan.providerNativeFee.feeBps, 25);
          assert.equal(lower(bundle.plan.providerNativeFee.treasury), '0x61700479a4a1f62584fd3aba2c2b290ea727d2ec');
          const quote = api.find((entry) => entry.path.endsWith('/quotes') && entry.status === 200).body;
          assert.deepEqual(quote.attempts.filter((attempt) => attempt.publicWalletExecutionEligible).map((attempt) => attempt.provider), ['zero-x-swap']);
          assert.ok(quote.attempts.filter((attempt) => attempt.provider !== 'zero-x-swap').every((attempt) => !attempt.publicWalletExecutionEligible));
          const review = page.locator('button').filter({ hasText: /^Review .*Deterministic browser wallet/ });
          await review.scrollIntoViewIfNeeded();
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'No horizontal overflow');
          if (scenario === 'expired-quote') {
            await page.clock.fastForward(11000);
            await page.locator('button').filter({ hasText: /^Refresh verified request$/ }).waitFor();
            assert.equal(requests.length, 0);
          } else {
            await review.click();
            await until(() => requests.length === 1, `${scenario} wallet request missing`);
            if (scenario === 'rejection') {
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
              await review.click();
              await until(() => requests.length === 2, 'Fresh swap wallet request missing');
              assert.equal(requests[1].data, '0x1234567822222222');
              assert.notEqual(keccak256(requests[1].data), bundle.plan.providerNativeFee.transactionCalldataHash);
            } else {
              assert.equal(bundle.plan.kind, 'swap');
              if (scenario === 'native') { assert.ok(BigInt(requests[0].value) > 0n); assert.notEqual(lower(requests[0].to), usdg); }
              await until(async () => /confirmed/i.test(await page.locator('body').innerText()), 'Confirmed receipt missing', 30000);
              const receipt = await page.locator('body').innerText();
              assert.match(receipt, /quoted/i);
              assert.doesNotMatch(receipt, /RMT fee settled|confirmed RMT revenue/i);
              assert.equal(requests.length, 1);
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
        results.push({ viewport: viewportName, scenario, status: 'PASS', walletPrompts: requests.length });
        console.log(`${prefix}: PASS`);
      } finally {
        await page.screenshot({ path: path.join(output, `${prefix}.png`), fullPage: true });
        await writeFile(path.join(output, `${prefix}.json`), JSON.stringify({ api, requests, text: await page.locator('body').innerText(), journal: await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => /execution|wallet.request/i.test(key)))) }, null, 2));
        await context.close();
        state.rpcOverride = undefined;
      }
    }
  }
  return results;
}
