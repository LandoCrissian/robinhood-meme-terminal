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
    expected: 'expectedOutputAtomic', protected: 'protectedOutputAtomic',
    feeAsset: 'providerNativeFee.feeAsset', feeAmount: 'providerNativeFee.feeAmountAtomic',
    treasury: 'providerNativeFee.treasury', target: 'router', calldataHash: 'calldataHash',
    value: 'transactionValueAtomic', gas: 'gasLimitUnits', spender: 'approvalSpender',
    expiry: 'providerNativeFee.firmQuote.expiresAtMs', wallet: 'binding', recipient: 'recipient'
  };
  for (const viewport of ['desktop', 'mobile']) {
    for (const scenario of ['one-usdg-normal-reprice', 'native-normal-reprice-rejection', 'material-reprice', 'expired-commitment', ...Object.keys(mutations).map((key) => `tamper-${key}`)]) {
      const native = scenario === 'native-normal-reprice-rejection';
      state.approved = native;
      state.priceDisabled = false;
      state.simulationFails = false;
      state.rpcOverride = undefined;
      state.modifyPrice = (quote) => { quote.buyAmount = '100000'; quote.minBuyAmount = '99000'; quote.fees.zeroExFee = null; };
      state.modifyFirm = (quote) => {
        quote.buyAmount = scenario === 'material-reprice' ? '98999' : '99500';
        quote.minBuyAmount = scenario === 'material-reprice' ? '98009' : '98505';
        quote.fees.zeroExFee = null;
      };
      const quoteStart = state.quotes.length;
      const api = [], prompts = [];
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
      }, { wallet });
      const page = await context.newPage();
      page.on('response', async (response) => {
        const pathname = new URL(response.url()).pathname;
        if (/\/api\/vnext\/(quotes|verify|authorize)$/.test(pathname)) api.push({ path: pathname, status: response.status(), body: await response.json().catch(() => null) });
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
        await page.getByLabel('Exact input amount').fill(native ? '0.001' : '1');
        await page.locator('.vnReviewButton').click();
        await until(() => api.some((entry) => entry.path.endsWith('/verify')), 'Real verification was not reached');
        if (scenario === 'material-reprice') {
          const verified = api.find((entry) => entry.path.endsWith('/verify'));
          assert.equal(verified.status, 409);
          assert.equal(verified.body.error, 'ZERO_X_REPRICE_REQUIRED');
          assert.equal(verified.body.zeroXFirmQuoteCommitment, undefined);
          await page.locator('.vnRouteTop').click();
          await until(async () => /Price moved\. Review the refreshed quote\./.test(await page.locator('.vnTradePanel').innerText()), 'Market repricing must have its own review-required state');
          assert.equal(api.filter((entry) => entry.path.endsWith('/authorize')).length, 0);
          assert.equal(prompts.length, 0);
        } else {
          await until(() => api.some((entry) => entry.path.endsWith('/authorize')), 'Real authorization was not reached');
          const verification = api.find((entry) => entry.path.endsWith('/verify')).body;
          const authorized = api.find((entry) => entry.path.endsWith('/authorize'));
          assert.equal(verification.expectedOutputAtomic, '99500');
          assert.equal(verification.protectedOutputAtomic, '98505');
          assert.match(verification.zeroXFirmQuoteCommitment, /^zx1\./);
          if (scenario.startsWith('tamper-') || scenario === 'expired-commitment') {
            assert.equal(authorized.status, 409);
            assert.equal(authorized.body.error, 'REQUOTE_REQUIRED');
            assert.equal(prompts.length, 0);
          } else {
            assert.equal(authorized.status, 200);
            const { plan, evidence } = authorized.body;
            assert.equal(evidence.zeroXFirmQuoteCommitment, verification.zeroXFirmQuoteCommitment);
            assert.equal(plan.protectedOutputAtomic, '98505');
            assert.equal(plan.providerNativeFee.firmQuote.identity, verification.providerNativeFee.firmQuote.identity);
            assert.equal(plan.providerNativeFee.feeBps, 25);
            assert.equal(plan.providerNativeFee.treasury.toLowerCase(), '0x61700479a4a1f62584fd3aba2c2b290ea727d2ec');
            await page.locator('.vnWalletFeeDisclosure').waitFor();
            assert.match(await page.locator('.vnWalletFeeDisclosure').innerText(), /Expected receive[\s\S]*Minimum receive/);
            await page.locator('.vnRouteTop').click();
            assert.match(await page.locator('.vnTradePanel').innerText(), /Fresh firm quote[\s\S]*Updated executable minimum/);
            assert.doesNotMatch(await page.locator('.vnTradePanel').innerText(), /Continuity check failed/);
            assert.equal(prompts.length, 0, 'Fresh economics must not automatically open the wallet');
            const review = page.locator('button').filter({ hasText: /^Review .*Deterministic browser wallet/ });
            await review.scrollIntoViewIfNeeded();
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
        assert.equal(state.quotes.length - quoteStart, 1, 'Exactly one firm quote; authorization never refetches');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
        assert.deepEqual(state.unexpected, []);
        results.push({ viewport, scenario: `firm-commitment-${scenario}`, status: 'PASS', firmQuoteCalls: 1, walletPrompts: prompts.length });
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
