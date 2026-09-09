import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const { decodeFunctionData, erc20Abi, keccak256 } = createRequire(new URL('../../apps/web/package.json', import.meta.url))('viem');

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message) {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await predicate()) return; await pause(100); }
  throw new Error(message);
}

// The real quote, verify and authorize routes execute unchanged. Only external
// price/RPC/wallet boundaries and adversarial in-transit request bytes are mocked.
export async function runZeroXFirmCommitmentJourneys({ browser, base, identity, external, state, wallet, usdg, holder, output }) {
  const results = [];
  const mutations = {
    requestedSlippage: 'providerRequestedSlippagePpm', maximumUserSlippage: 'maximumUserSlippagePpm', providerMinimum: 'providerReportedMinBuyAmount', executableMinimum: 'encodedExecutableMinBuyAmount', settlerRuntime: 'executableSettlerRuntimeHash', expected: 'expectedOutputAtomic', protected: 'protectedOutputAtomic',
    feeAsset: 'providerNativeFee.feeAsset', feeAmount: 'providerNativeFee.feeAmountAtomic',
    treasury: 'providerNativeFee.treasury', target: 'router', calldataHash: 'calldataHash',
    value: 'transactionValueAtomic', gas: 'gasLimitUnits', spender: 'approvalSpender',
    expiry: 'providerNativeFee.firmQuote.expiresAtMs', wallet: 'binding', recipient: 'recipient'
  };
  const slippageCases = {
    'slippage-live-rounding': ['397592518509179', '393616593315000', false],
    'slippage-exact-100bps': ['100000000', '99000000', true],
    'slippage-rounding-boundary': ['1000000', '990000', true],
    'slippage-outside-boundary': ['1000000', '989999', false],
    'slippage-catastrophic': ['100000', '1', false],
    'slippage-ten-percent': ['100000', '90000', false],
    'slippage-api-weaker-safe-executable': ['1000000', '989999', true, '990000'],
    'slippage-api-stronger-unsafe-executable': ['1000000', '990000', false, '989999'],
    'slippage-api-stronger-safe-executable': ['1000000', '999000', true, '990000'],
    'slippage-captured-native': ['2500750', '2476000', true]
  };
  for (const viewport of ['desktop', 'mobile']) {
    for (const scenario of ['one-usdg-normal-reprice', 'native-normal-reprice-rejection', 'material-reprice', 'expired-commitment', ...Object.keys(slippageCases), ...Object.keys(mutations).map((key) => `tamper-${key}`)]) {
      const slippageCase = slippageCases[scenario];
      const native = scenario === 'native-normal-reprice-rejection';
      const inputAmountAtomic = native ? '1000000000000000' : '1000000';
      state.approved = native;
      state.priceDisabled = false;
      state.simulationFails = false;
      state.rpcOverride = undefined;
      state.modifyPrice = (quote) => { quote.buyAmount = '100000'; quote.minBuyAmount = '99000'; quote.fees.zeroExFee = null; };
      state.modifyFirm = (quote) => {
        quote.buyAmount = scenario === 'material-reprice' ? '98999' : '99500';
        quote.minBuyAmount = scenario === 'material-reprice' ? '98010' : '98505';
        if (slippageCase) { [quote.buyAmount, quote.minBuyAmount] = slippageCase; quote.executableMinimumForTest = slippageCase[3] ?? slippageCase[1]; }
        quote.fees.zeroExFee = null;
      };
      const quoteStart = state.quotes.length;
      const api = [], prompts = [];
      const currentApi = () => api.filter((entry) => entry.inputAmountAtomic === inputAmountAtomic);
      const context = await browser.newContext({ viewport: viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 }, ...(viewport === 'mobile' ? { isMobile: true, hasTouch: true } : {}) });
      await context.exposeFunction('__FIRM_CAPTURE__', (transaction) => { prompts.push(transaction); });
      await context.addInitScript(({ wallet }) => {
        window.ethereum = {
          isMetaMask: true, on() {}, removeListener() {},
          async request({ method, params }) {
            if (method === 'eth_chainId') return '0x1237';
            if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [wallet];
            if (method === 'eth_getTransactionCount') return '0x1';
            if (method === 'eth_sendTransaction') {
              await window.__FIRM_CAPTURE__(params[0]);
              const error = new Error('User rejected the request'); error.code = 4001; throw error;
            }
            return null;
          }
        };
        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
          info: { uuid: 'd0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0', name: 'Explicit test signer', rdns: 'io.rmt.test', icon: 'data:image/png;base64,' },
          provider: window.ethereum
        } }));
        window.addEventListener('eip6963:requestProvider', announce);
        announce();
      }, { wallet });
      const page = await context.newPage();
      page.on('response', async (response) => {
        const pathname = new URL(response.url()).pathname;
        if (/\/api\/vnext\/(quotes|verify|authorize)$/.test(pathname)) api.push({ path: pathname,
          inputAmountAtomic: response.request().postDataJSON()?.inputAmountAtomic,
          status: response.status(), body: await response.json().catch(() => null) });
      });
      await page.route('**/*', async (route) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === base) {
          const headers = request.headers();
          if (headers['privy-id-token']) headers['privy-id-token'] = identity;
          if (url.pathname === '/api/vnext/authorize') {
            const body = request.postDataJSON();
            if (scenario === 'expired-commitment') await pause(10500);
            if (scenario.startsWith('tamper-')) {
              const [prefix, payload, signature] = body.zeroXFirmQuoteCommitment.split('.');
              const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
              const field = mutations[scenario.slice(7)];
              if (field === 'binding') claims.binding = 'tampered';
              else {
                const parts = field.split('.'); let target = claims.evidence;
                for (const part of parts.slice(0, -1)) target = target[part];
                target[parts.at(-1)] = 'tampered';
              }
              body.zeroXFirmQuoteCommitment = `${prefix}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`;
            }
            return route.continue({ headers, postData: JSON.stringify(body) });
          }
          return route.continue({ headers });
        }
        const result = external({ url: request.url(), method: request.method(), body: request.postData() });
        return route.fulfill({ status: result.status, contentType: 'application/json', body: JSON.stringify(result.body) });
      });
      const prefix = `${viewport}-firm-commitment-${scenario}`;
      try {
        await page.goto(`${base}/?market=${usdg}&side=${native ? 'buy' : 'sell'}`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'I understand', exact: false }).click();
        await page.getByRole('button', { name: 'Start with live markets', exact: true }).click();
        await page.getByLabel('Exact input amount').waitFor({ timeout: 30000 });
        const select = page.getByLabel(native ? 'Pay with asset' : 'Receive asset');
        if (await select.inputValue() !== 'eip155:4663/native') await select.selectOption('eip155:4663/native');
        if (native) {
          await page.getByLabel('Exact input amount').fill('0.0005');
          await until(() => api.some((entry) => entry.path.endsWith('/authorize') && entry.status === 200
            && entry.inputAmountAtomic === '500000000000000'), 'Prepare the earlier amount before deliberately replacing it');
          assert.equal(prompts.length, 0, 'Preparing an earlier amount does not open a wallet request');
        }
        await page.getByLabel('Exact input amount').fill(native ? '0.001' : '1');
        // Read-only 0x preparation follows amount readiness; the wallet still needs its explicit CTA.
        await until(() => currentApi().some((entry) => entry.path.endsWith('/verify')), 'Real verification for the exact entered amount was not reached');
        if (slippageCase && !slippageCase[2]) {
          const verified = currentApi().find((entry) => entry.path.endsWith('/verify'));
          assert.equal(verified.status, 422);
          assert.match(verified.body.error, /slippage envelope/);
          assert.notEqual(verified.body.error, 'ZERO_X_REPRICE_REQUIRED');
          assert.equal(verified.body.zeroXFirmQuoteCommitment, undefined);
          await pause(300);
          assert.equal(api.filter((entry) => entry.path.endsWith('/authorize')).length, 0);
          assert.equal(prompts.length, 0);
        } else if (scenario === 'material-reprice') {
          const verified = currentApi().find((entry) => entry.path.endsWith('/verify'));
          assert.equal(verified.status, 409);
          assert.equal(verified.body.error, 'ZERO_X_REPRICE_REQUIRED');
          assert.equal(verified.body.zeroXFirmQuoteCommitment, undefined);
          await page.getByRole('button', { name: 'Retry quote', exact: true }).waitFor();
          assert.equal(currentApi().filter(entry => entry.path.endsWith('/verify') && entry.status === 409).length, 4, 'Material repricing retries are bounded and every rejected firm quote remains rejected');
          assert.match(await page.locator('.vnTradePanel').innerText(), /Price changed\. Retry quote\./);
          assert.equal(api.filter((entry) => entry.path.endsWith('/authorize')).length, 0);
          assert.equal(prompts.length, 0);
        } else {
          await until(() => currentApi().some((entry) => entry.path.endsWith('/authorize')), 'Real authorization for the exact entered amount was not reached');
          const verification = currentApi().find((entry) => entry.path.endsWith('/verify')).body;
          const authorized = currentApi().find((entry) => entry.path.endsWith('/authorize'));
          assert.equal(verification.expectedOutputAtomic, slippageCase?.[0] ?? '99500');
          assert.equal(verification.protectedOutputAtomic, slippageCase?.[3] ?? slippageCase?.[1] ?? '98505');
          assert.equal(verification.providerRequestedSlippagePpm, 9900);
          assert.match(verification.zeroXFirmQuoteCommitment, /^zx1\./);
          if (scenario.startsWith('tamper-') || scenario === 'expired-commitment') {
            assert.equal(authorized.status, 409);
            assert.equal(authorized.body.error, 'REQUOTE_REQUIRED');
            assert.equal(prompts.length, 0);
          } else {
            assert.equal(authorized.status, 200);
            const { plan, evidence } = authorized.body;
            assert.equal(plan.inputAmountAtomic, inputAmountAtomic);
            assert.equal(evidence.zeroXFirmQuoteCommitment, verification.zeroXFirmQuoteCommitment);
            assert.equal(plan.protectedOutputAtomic, slippageCase?.[3] ?? slippageCase?.[1] ?? '98505');
            assert.equal(evidence.providerRequestedSlippagePpm, 9900);
            assert.equal(plan.providerNativeFee.firmQuote.identity, verification.providerNativeFee.firmQuote.identity);
            assert.equal(plan.providerNativeFee.feeBps, 25);
            assert.equal(plan.providerNativeFee.treasury.toLowerCase(), '0x61700479a4a1f62584fd3aba2c2b290ea727d2ec');
            await page.locator('.vnRouteTop').click();
            await page.locator('.vnWalletFeeDisclosure').waitFor();
            assert.match(await page.locator('.vnWalletFeeDisclosure').innerText(), /Expected receive[\s\S]*Minimum receive/);
            assert.match(await page.locator('.vnTradePanel').innerText(), /Fresh firm quote[\s\S]*Updated executable minimum/);
            assert.doesNotMatch(await page.locator('.vnTradePanel').innerText(), /Continuity check failed/);
            assert.equal(prompts.length, 0, 'Fresh economics must not automatically open the wallet');
            const review = page.getByRole('button', { name: /Review (exact approval|verified swap) in wallet/, exact: true });
            await review.scrollIntoViewIfNeeded();
            await page.getByRole('region', { name: 'Injected signer selection' }).getByRole('button', { name: /Explicit test signer/ }).click();
            await review.click();
            await until(() => prompts.length === 1, 'Explicit wallet action must open the exact request');
            const transaction = prompts[0];
            assert.equal(transaction.to.toLowerCase(), plan.target.toLowerCase());
            assert.equal(transaction.data, plan.data);
            assert.equal(BigInt(transaction.value), BigInt(plan.value));
            assert.equal(BigInt(transaction.gas), BigInt(plan.gasLimit));
            if (plan.gasPrice) assert.equal(BigInt(transaction.gasPrice), BigInt(plan.gasPrice));
            if (native) {
              assert.equal(plan.kind, 'swap');
              assert.equal(plan.value, '1000000000000000');
              assert.equal(keccak256(transaction.data), verification.calldataHash);
            } else {
              assert.equal(plan.kind, 'erc20_approval');
              const decoded = decodeFunctionData({ abi: erc20Abi, data: transaction.data });
              assert.equal(decoded.functionName, 'approve');
              assert.equal(transaction.to.toLowerCase(), usdg.toLowerCase());
              assert.equal(decoded.args[0].toLowerCase(), holder.toLowerCase());
              assert.equal(decoded.args[1], 1000000n);
              assert.equal(plan.value, '0');
            }
            await until(async () => /rejected by the owner|Nothing was broadcast/i.test(await page.locator('body').innerText()), 'Rejection recovery missing');
            await pause(300);
            assert.equal(prompts.length, 1, 'No automatic second prompt');
            const journal = await page.evaluate(() => Object.values(localStorage).join('\n'));
            assert.doesNotMatch(journal, /"state":"(?:submitted|confirmed)"/);
          }
        }
        const expectedFirmCalls = scenario === 'material-reprice' ? 4 : 1;
        assert.equal(state.quotes.slice(quoteStart).filter((quote) => quote.sellAmount === inputAmountAtomic).length, expectedFirmCalls, 'One firm quote per preparation attempt; authorization never refetches, repricing has exactly four bounded attempts');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
        assert.deepEqual(state.unexpected, []);
        results.push({ viewport, scenario: `firm-commitment-${scenario}`, status: 'PASS', firmQuoteCalls: expectedFirmCalls, walletPrompts: prompts.length });
        console.log(`${prefix}: PASS`);
      } finally {
        await page.screenshot({ path: path.join(output, `${prefix}.png`), fullPage: true });
        await writeFile(path.join(output, `${prefix}.json`), JSON.stringify({ api, prompts, text: await page.locator('body').innerText() }, null, 2));
        await context.close();
      }
    }
  }
  state.modifyPrice = undefined;
  state.modifyFirm = undefined;
  return results;
}
