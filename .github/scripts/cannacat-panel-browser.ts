import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "playwright/test";
import { createVNextZeroXProviderNativeFee } from "../../apps/web/lib/vnext/zero-x-settlement";
import { syntheticCannaCatBundle } from "./cannacat-firm-fixture";
import { formatUnits, keccak256, toEventSelector } from "viem";
async function main() {
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const output = path.join(root, "cannacat-browser-evidence");
await mkdir(output, { recursive: true });
const channel = process.env.CANNACAT_BROWSER ?? "chrome";
assert(["chrome", "msedge"].includes(channel));
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url!, "http://localhost");
    if (url.pathname === "/") {
      const real = url.searchParams.get("real") === "1";
      const baseline = url.searchParams.get("baseline") === "1";
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CannaCat panel acceptance</title><style>body{background:#080b07;color:#eef4e7;font-family:system-ui;margin:0;padding:24px}header{max-width:680px;margin:0 auto 24px;font-size:12px;letter-spacing:.08em}#panel{max-width:680px;margin:auto}</style><header>LAMMB GENESIS · ${baseline ? "TASK115 BEFORE LAYOUT" : "TASK117 CANDIDATE"} · SYNTHETIC WALLET TEST<br>NO REAL SIGNATURES OR TRANSACTIONS</header><main id="panel"></main><script type="module">import{mountCannaCatPanel}from'/${real ? "real" : baseline ? "baseline" : "fixture"}/cannacat-panel.mjs';mountCannaCatPanel(document.querySelector('#panel'),{enabled:${!real},apiBaseUrl:'https://rmt-fixture.invalid/api/embed/cannacat',privyAppId:'synthetic-app',privyClientId:'synthetic-client'});</script></html>`);
      return;
    }
    const match = url.pathname.match(/^\/(real|fixture|baseline)\/([A-Za-z0-9_./-]+\.mjs)$/);
    if (!match || match[2].includes("..")) { response.writeHead(404).end(); return; }
    const directory = match[1] === "real" ? "cannacat-sdk" : match[1] === "baseline" ? "cannacat-sdk-baseline" : "cannacat-sdk-fixture";
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(await readFile(path.join(root, "apps/web", directory, match[2])));
  } catch { response.writeHead(500).end("Fixture server failed"); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const base = `http://localhost:${port}`;
const browser = await chromium.launch({ channel, headless: true });
const results: object[] = [];
const layouts: object[] = [];
const longWalletName = "MetaMask · iPhone WalletConnect signing connection";
let checks = 0;
let spotCalls = 0; let spotFailure = 0; let delayObservation = false; let delayedObservation: (() => void) | null = null;
let quoteCalls = 0;
let balance = 10n ** 18n;
let balancesFail = false;
let usdPrice = "2000.00";
let verified = false;
let approvalAlreadyGranted = false;
let settlementAvailable = false;
let gasPrice = 1_000_000_000n;
let walletNonce = 0n;
let delayedQuote: (() => void) | null = null;
let delayQuote = false;
let variableMarket = false;
let quoteFailure = 0;
let quoteResumeAfter = 0;
let firmCalls = 0;
const bundles = new Map<string, ReturnType<typeof syntheticCannaCatBundle>>();
const transactions = new Map<string, { receipt: object; transaction: object; trace: object }>();
const tokenBalance = 50_000n * 10n ** 18n;
const hash = `0x${"a".repeat(64)}`;
const hex = (amount: bigint) => `0x${amount.toString(16)}`;
const saveSyntheticTransaction = (txHash: string, bundle: ReturnType<typeof syntheticCannaCatBundle>) => {
  const plan = bundle.plan, recipient = plan.recipient;
  const topicAddress = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
  const isBuy = plan.inputAsset === '0x0000000000000000000000000000000000000000';
  const logs = plan.kind === 'swap' && isBuy ? [{ address: plan.outputAsset, blockHash: hash, blockNumber: '0x64', data: `0x${BigInt(bundle.evidence.expectedOutputAtomic).toString(16).padStart(64, '0')}`,
    logIndex: '0x0', removed: false, transactionHash: txHash, transactionIndex: '0x0', topics: [toEventSelector('Transfer(address,address,uint256)'), topicAddress(plan.target), topicAddress(recipient)] }] : [];
  transactions.set(txHash.toLowerCase(), {
    transaction: { hash: txHash, chainId: '0x1237', blockHash: hash, blockNumber: '0x64', transactionIndex: '0x0', from: recipient, to: plan.target,
      input: plan.data, value: hex(BigInt(plan.value)), nonce: hex(walletNonce), type: '0x0', gas: hex(BigInt(plan.gasLimit)), gasPrice: '0x3b9aca00', v: '0x1b', r: hash, s: hash },
    receipt: { transactionHash: txHash, blockHash: hash, blockNumber: '0x64', transactionIndex: '0x0', from: recipient, to: plan.target, status: '0x1',
      cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x3b9aca00', type: '0x0', logs, logsBloom: `0x${'0'.repeat(512)}`, contractAddress: null },
    trace: { type: 'CALL', from: recipient.toLowerCase(), to: plan.target.toLowerCase(), value: hex(BigInt(plan.value)), inputHash: keccak256(plan.data), calls: [
      { type: 'CALL', from: plan.target.toLowerCase(), to: recipient.toLowerCase(), value: hex(BigInt(bundle.evidence.expectedOutputAtomic)), calls: [] } ] }
  });
};
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };
try {
  for (const width of [320, 375, 390, 430, 1440]) {
    verified = false; approvalAlreadyGranted = false; settlementAvailable = false;
    gasPrice = 1_000_000_000n; walletNonce = 0n; balance = 10n ** 18n;
    balancesFail = false; usdPrice = '2000.00'; delayQuote = false; delayedQuote = null;
    bundles.clear(); transactions.clear();
    const context = await browser.newContext({ viewport: { width, height: width < 768 ? 844 : 1000 } });
    const page = await context.newPage();
    await page.clock.install();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const routeHandler: Parameters<typeof context.route>[1] = async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base) { await route.continue(); return; }
      if (url.href === "https://api.exchange.coinbase.com/products/ETH-USD/ticker") {
        await route.fulfill({ json: { price: usdPrice, time: new Date().toISOString() }, headers: { "access-control-allow-origin": "*" } }); return;
      }
      if (url.origin === "https://rpc.mainnet.chain.robinhood.com") {
        if (balancesFail) { await route.fulfill({ status: 503, body: "Synthetic balance RPC outage" }); return; }
        const rpc = route.request().postDataJSON();
        const isSpot = (entry: {method?:string;params?:Array<{to?:string}>}) => entry.method === 'eth_call'
          && entry.params?.[0]?.to?.toLowerCase() === '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b';
        if ((Array.isArray(rpc) ? rpc : [rpc]).some(isSpot)) {
          spotCalls++;
          if (spotFailure) { await route.fulfill({status:spotFailure,body:'Synthetic read-only spot RPC outage'}); return; }
          if (delayObservation) await new Promise<void>(resolve => {delayedObservation=resolve;});
        }

        const answer = (entry: { id: number; method: string; params?: unknown[] }) => {
          const saved = transactions.get(typeof entry.params?.[0] === 'string' ? entry.params[0].toLowerCase() : '');
          const values: Record<string, unknown> = { eth_chainId: "0x1237", eth_getBalance: hex(balance), eth_gasPrice: hex(gasPrice), eth_getTransactionCount: hex(walletNonce), eth_call: `0x${tokenBalance.toString(16).padStart(64, "0")}`,
            eth_getTransactionByHash: saved?.transaction ?? null, eth_getTransactionReceipt: saved?.receipt ?? null,
            eth_getBlockByNumber: { number: "0x64", hash, parentHash: hash, transactions: [], timestamp: hex(BigInt(Math.floor(Date.now() / 1000))), gasLimit: "0x1c9c380", gasUsed: "0x0", baseFeePerGas: "0x3b9aca00", difficulty: "0x0", extraData: "0x", miner: `0x${"0".repeat(40)}`, size: "0x100", nonce: "0x0000000000000000", sha3Uncles: hash, transactionsRoot: hash, stateRoot: hash, receiptsRoot: hash, logsBloom: `0x${"0".repeat(512)}` } };
          if (!(entry.method in values)) throw new Error(`Unexpected read-only RPC: ${entry.method}`);
          if (isSpot(entry as never)) {
            const sqrt = (1000n + (variableMarket ? BigInt(spotCalls % 3) : 0n)) * 2n ** 96n;
            values.eth_call = '0x' + [sqrt, 0n, 0n, 0n].map(n=>n.toString(16).padStart(64,'0')).join('');
          }
          return { jsonrpc: "2.0", id: entry.id, result: values[entry.method] };
        };
        await route.fulfill({ json: Array.isArray(rpc) ? rpc.map(answer) : answer(rpc) }); return;
      }
      if (url.origin === "https://rmt-fixture.invalid") {
        const headers = { "access-control-allow-origin": base, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type,privy-id-token,x-rmt-client" };
        if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
        const input = route.request().postDataJSON();
        if (url.pathname.endsWith('/native-settlement-trace')) {
          check(input.wallet === '0x0000000000000000000000000000000000000123', 'Settlement read is bound to the synthetic owner');
          check(route.request().headers()['privy-id-token'] === 'synthetic-identity-only', 'Settlement read preserves authenticated identity');
          const saved = transactions.get(input.txHash.toLowerCase());
          await route.fulfill({ headers, json: settlementAvailable && saved ? { status: 'available', txHash: input.txHash, blockHash: hash, trace: saved.trace } : { status: 'unavailable' } }); return;
        }
        check(input.chainId === 4663 && input.recipient === "0x0000000000000000000000000000000000000123", "Exact synthetic wallet and chain binding");
        check(route.request().headers()["privy-id-token"] === "synthetic-identity-only", "Only fixture identity forwarded");
        if (!url.pathname.endsWith("/quotes")) {
          firmCalls += 1;
          if (!verified) { await route.fulfill({ status: 409, headers, json: { code: "ZERO_X_REPRICE_REQUIRED" } }); return; }
          if (url.pathname.endsWith("/verify")) {
            const bundle = syntheticCannaCatBundle(input, { approvalAlreadyGranted });
            bundles.set(bundle.evidence.verificationId, bundle);
            await route.fulfill({ headers, json: bundle.evidence }); return;
          }
          const bundle = bundles.get(input.verificationId);
          check(Boolean(bundle) && bundle!.evidence.zeroXFirmQuoteCommitment === input.zeroXFirmQuoteCommitment, "Exact fixture verification commitment reused");
          await route.fulfill({ headers, json: bundle }); return;
        }
        quoteCalls += 1;
        if (quoteResumeAfter) check(Date.now() >= quoteResumeAfter, 'Automatic pricing honors the complete provider Retry-After deadline');
        if (quoteFailure) {
          if (quoteFailure === 429) quoteResumeAfter = Date.now() + 60_000;
          await route.fulfill({ status: quoteFailure, headers: { ...headers, ...(quoteFailure === 429 ? { 'retry-after': '60' } : {}) }, json: { code: 'SYNTHETIC_PROVIDER_OUTAGE' } }); return;
        }
        if (delayQuote) await new Promise<void>(resolve => { delayedQuote = resolve; });
        const buying = input.inputAsset === "0x0000000000000000000000000000000000000000";
        const ratio = variableMarket ? 10_000_000n + BigInt(Math.floor(Date.now() / 15_000) % 1000) : 10_000_000n;
        const output = buying ? BigInt(input.inputAmountAtomic) * ratio : BigInt(input.inputAmountAtomic) / ratio;
        const minimum = output * 99n / 100n;
        const fee = createVNextZeroXProviderNativeFee({ inputAsset: input.inputAsset, outputAsset: input.outputAsset, userGrossInputAtomic: input.inputAmountAtomic, recipient: input.recipient,
          expectedOutputAtomic: String(output), protectedOutputAtomic: String(minimum), authorizationState: "indicative",
          quotedFeeAmountAtomic: input.inputAsset === "0x0000000000000000000000000000000000000000" ? undefined : String(output * 25n / 10_000n) });
        const now = Date.now();
        await route.fulfill({ headers, json: { requestId: "11111111-1111-4111-8111-111111111111", chainId: 4663, inputAsset: input.inputAsset, outputAsset: input.outputAsset, inputAmountAtomic: input.inputAmountAtomic,
          requestedAtMs: now - 10, completedAtMs: now, attempts: [{ provider: "zero-x-swap", providerLabel: "0x", providerFamily: "zeroex", adapterVersion: 1, status: "indicative", chainId: 4663,
            inputAsset: input.inputAsset, outputAsset: input.outputAsset, inputAmountAtomic: input.inputAmountAtomic, expectedOutputAtomic: String(output), protectedOutputAtomic: String(minimum), outputDecimals: 18,
            priceImpact: null, liquidityFeeEvidence: [], quotedAtMs: now, expiresAtMs: now + 10000, latencyMs: 10, executionKind: "aggregator", strictVerificationAvailable: true, publicWalletExecutionEligible: true,
            userPaysGas: true, providerFeeAsset: null, providerFeeAtomic: null, gasSponsorshipFeeAsset: null, gasSponsorshipFeeAtomic: null, explicitProviderFeeOutputAtomic: null,
            netEconomics: null, settlementMode: "PROVIDER_NATIVE_INPUT_FEE", providerNativeFee: fee, networkFeeNativeAtomic: "9000000000", networkFeeNativeSymbol: "ETH", protectedNetOutputAtomic: null,
            costState: "network_fee_pending", authorizationReady: false, detail: "Synthetic bounded price fixture." }] } }); return;
      }
      throw new Error(`Unexpected external browser request: ${url.origin}`);
    };
    await context.route("**/*", routeHandler);
    // Compile the exact Task115 panel source for before screenshots. The fixture
    // remains synthetic and is never included in the deliverable SDK.
    await page.goto(`${base}/?baseline=1`);
    await page.getByRole("button", { name: "I understand — continue", exact: true }).click();
    await expect.poll(() => page.evaluate(() => typeof window.__CANNACAT_FIXTURE_UPDATE__)).toBe("function");
    await page.evaluate((displayName) => window.__CANNACAT_FIXTURE_UPDATE__?.({ connected: true, authenticated: false, displayName }), longWalletName);
    await page.getByRole("button", { name: "Verify wallet ownership", exact: true }).waitFor();
    await page.locator('[data-wallet-status="wrong-chain"]').waitFor();
    await page.screenshot({ path: path.join(output, `${channel}-${width}-before-wallet.png`), fullPage: true });
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(`${base}/?real=1`);
    await page.getByRole("heading", { name: "Get your CannaCat." }).waitFor();
    check(await page.getByRole("button", { name: "Connect wallet · coming soon" }).isDisabled(), "Real bundle stays closed without configuration");
    await page.goto(base);
    await expect(page.getByRole("button", { name: "Connect wallet", exact: true })).toBeDisabled();
    check(await page.getByLabel("RMT trading acknowledgement").getByText("Trade with your eyes open").isVisible(), "Existing RMT acknowledgement is required before wallet access");
    await page.getByText("RMT trading terms", { exact: true }).click();
    await page.getByRole("article", { name: "Terms of Use" }).getByText("1. Acceptance and eligibility", { exact: true }).waitFor();
    check(page.url() === `${base}/`, "Canonical legal documents remain on the LAMMB surface");
    await page.getByText("RMT trading terms", { exact: true }).click();
    await page.getByRole("button", { name: "I understand — continue", exact: true }).click();
    await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
    await page.evaluate((displayName) => window.__CANNACAT_FIXTURE_UPDATE__?.({ displayName }), longWalletName);
    await page.locator('[data-wallet-status="wrong-chain"]').waitFor();
    const layout = await page.evaluate(() => {
      const root = document.querySelector(".rmtcat-wallet")!;
      const targets = [...root.querySelectorAll("button,select,.rmtcat-wallet-identity>span")].filter(element => element.getClientRects().length > 0);
      const boxes = targets.map(element => { const r = element.getBoundingClientRect(); return { text: element.textContent?.trim(), x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom }; });
      const collisions = boxes.flatMap((a,i)=>boxes.slice(i+1).filter(b=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1).map(b=>[a.text,b.text]));
      const interactive = [...document.querySelectorAll(".rmtcat-panel button,.rmtcat-panel select,.rmtcat-panel summary")].filter(element=>element.getClientRects().length>0).map(element=>({text:element.textContent?.trim(),width:element.getBoundingClientRect().width,height:element.getBoundingClientRect().height}));
      const address = document.querySelector(".rmtcat-wallet-address")!;
      return { viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,boxes,collisions,interactive,addressWhiteSpace:getComputedStyle(address).whiteSpace,addressHeight:address.getBoundingClientRect().height };
    });
    check(layout.collisions.length === 0, "Wallet identity, verification, network and disconnect controls never overlap");
    check(layout.documentWidth <= width, "Unverified wallet layout has no horizontal overflow");
    check(layout.interactive.every(target=>target.height>=44 && target.width>=44), "Every visible panel control has at least a 44px touch target");
    check(layout.addressWhiteSpace === "nowrap" && layout.addressHeight < 30, "Wallet address remains on one readable line");
    await page.getByRole("button", { name: "Verify wallet ownership", exact: true }).press("Tab");
    await expect(page.getByRole("button", { name: "Switch to Robinhood Chain", exact: true })).toBeFocused();
    check(true, "Keyboard focus follows the visible verification and network controls");
    layouts.push({channel,width,result:"PASS",...layout});
    await page.screenshot({ path: path.join(output, `${channel}-${width}-after-wallet.png`), fullPage: true });
    await page.getByRole("button", { name: "Verify wallet ownership" }).click();
    await page.getByRole("button", { name: "Switch to Robinhood Chain" }).click();
    await page.getByRole("button", { name: "Review trade" }).waitFor({ state: "visible" });
    await expect(page.getByRole("button", { name: "Review trade" })).toBeEnabled();
    await expect(page.getByLabel("Wallet balances")).toContainText("1 ETH");
    await expect(page.getByLabel("Wallet balances")).toContainText("50000 CannaCat");
    await expect(page.getByLabel("Wallet balances")).toContainText("$2,000.00");
    check(true, "Native ETH, timestamped USD and CannaCat balances load independently of a quote");
    checks += 1;
    await page.getByLabel("Minimum CannaCat to receive").fill("0");
    await page.getByRole("button", { name: "Review trade" }).click();
    await page.getByRole("alert").filter({ hasText: "positive token amount" }).waitFor();
    await page.getByRole("button", { name: "Sell CannaCat", exact: true }).click();
    await page.getByLabel("CannaCat to sell").fill("100000");
    await page.getByRole("button", { name: "Review trade" }).click();
    await page.getByRole("alert").filter({ hasText: "exceeds this wallet" }).waitFor();
    await page.getByRole("button", { name: "Buy CannaCat", exact: true }).click();
    await page.getByLabel("Minimum CannaCat to receive").fill("10000");
    balance = 0n;
    await page.getByRole("button", { name: "Review trade" }).click();
    await page.getByRole("alert").filter({ hasText: "Insufficient ETH for network gas" }).waitFor();
    balance = 10n ** 18n;
    await page.getByRole("button", { name: "Review trade" }).click();
    await page.getByRole("alert").filter({ hasText: "quote changed" }).waitFor();
    check(await page.getByRole("button", { name: /Confirm buy in wallet/ }).count() === 0, "Repriced quote cannot open a wallet request");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
    check(await page.locator("iframe").count() === 0, "No terminal iframe");
    check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 0, "No implicit signing or submission");
    check(page.url() === `${base}/`, "Website flow never redirects to RMT");
    check(errors.length === 0, `No browser runtime errors: ${errors.join("; ")}`);
    verified = true;
    await page.getByRole("button", { name: "Review trade" }).click();
    await page.getByRole("button", { name: "Confirm buy in wallet" }).waitFor();
    check(await page.getByLabel("Verified trade review").innerText().then((text) => text.includes("Protected minimum") && text.includes("RMT fee · 0.25%") && text.includes("Estimated network gas")), "Complete protected buy review and unchanged fee displayed");
    check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 0, "Verification never signs automatically");
    await page.screenshot({ path: path.join(output, `${channel}-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Confirm buy in wallet" }).click();
    await page.getByRole("alert").filter({ hasText: "declined" }).waitFor();
    check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 1, "One explicit wallet gesture; rejected request never repeats");
    await page.getByRole("button", { name: "Sell CannaCat", exact: true }).click();
    await page.getByLabel("CannaCat to sell").fill("10000");
    await page.getByRole("button", { name: "Review trade" }).click();
    await page.getByRole("button", { name: "Review token approval" }).waitFor();
    check(await page.getByLabel("Verified trade review").innerText().then((text) => text.includes("No swap fee is charged by this approval")), "Approval is distinguished from swap settlement and fees");
    await page.screenshot({ path: path.join(output, `${channel}-${width}-approval.png`), fullPage: true });
    await page.evaluate(() => { window.__CANNACAT_FIXTURE_SYNC_REJECT__ = true; });
    await page.getByRole("button", { name: "Review token approval" }).click();
    await page.getByRole("status").filter({ hasText: "declined" }).waitFor();
    await expect(page.getByRole("button", { name: "Review trade" })).toBeEnabled();
    check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 2, "Synchronous wallet rejection safely unlocks the panel without resubmission");
    await page.getByRole("button", { name: "Buy CannaCat", exact: true }).click();
    await page.getByLabel("Minimum CannaCat to receive").fill("1");
    await page.getByRole("button", { name: "Review trade", exact: true }).click();
    await page.getByRole("button", { name: "Confirm buy in wallet", exact: true }).waitFor();
    const tiny = [...bundles.values()].at(-1)!;
    const tinyReview = await page.getByLabel("Verified trade review").innerText();
    check(tinyReview.includes(formatUnits(BigInt(tiny.evidence.inputAmountAtomic),18)+" ETH"), "Small buy shows the full exact ETH input, not an eight-decimal truncation");
    check(tinyReview.includes(formatUnits(BigInt(tiny.evidence.providerNativeFee!.feeAmountAtomic),18)+" ETH"), "Sub-eight-decimal fees remain visible in exact wei precision");
    check(BigInt(tiny.evidence.providerNativeFee!.feeAmountAtomic)>0n && BigInt(tiny.evidence.providerNativeFee!.feeAmountAtomic)<10000000000n, "Tiny nonzero fee fixture covers the former display threshold");
    for (const label of ["Exact ETH input", "RMT fee · 0.25%"]) {
      const row = page.locator(".rmtcat-quote dl>div").filter({has:page.getByText(label,{exact:true})});
      check(await row.locator("dd").evaluate(element=>element.getBoundingClientRect().height<=24), "Exact tiny ETH amounts stay on one readable line at every target width");
    }
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), "Exact small amounts do not create horizontal overflow");
    check(await page.evaluate(()=>(window.__CANNACAT_FIXTURE_WALLET_REQUESTS__??[]).length)===2, "Precision and quote preparation do not request another wallet action");
    await page.screenshot({path:path.join(output,`${channel}-${width}-tiny-quote.png`),fullPage:true});
    results.push({ channel, width, checks: "PASS", scope: "Synthetic provider/wallet; real production bundle cold-load and real panel/SDK code", realTransactions: 0 });
    // Funds and input-mode acceptance. Background reads cannot rewrite intent
    // or authorize from stale balances. Every wallet request remains synthetic.
    await page.getByRole("button", { name: "USD target", exact: true }).click();
    await page.getByRole("button", { name: "$25", exact: true }).click();
    await page.getByRole("button", { name: "Review trade", exact: true }).click();
    await page.getByRole("button", { name: "Confirm buy in wallet", exact: true }).waitFor();
    await expect(page.getByLabel("Verified trade review")).toContainText("0.0125 ETH");
    check(true, "USD target becomes an exact native ETH input on the existing rail");
    const exactInputBefore = await page.locator(".rmtcat-quote dl>div").filter({has:page.getByText("Exact ETH input", {exact:true})}).locator("dd").innerText();
    balance = 0n;
    await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
    await expect(page.getByRole("button", { name: "Confirm buy in wallet", exact: true })).toBeDisabled();
    await expect(page.getByLabel("USD purchase target")).toHaveValue("25");
    check(await page.locator(".rmtcat-quote dl>div").filter({has:page.getByText("Exact ETH input", {exact:true})}).locator("dd").innerText() === exactInputBefore, "Balance refresh preserves entered USD target and exact quote display");
    balance = 10n ** 18n;
    await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
    await expect(page.getByRole("button", { name: "Confirm buy in wallet", exact: true })).toBeEnabled();
    balancesFail = true;
    await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
    await expect(page.getByLabel("Wallet balances")).toContainText("could not be refreshed");
    await expect(page.getByRole("button", { name: "Confirm buy in wallet", exact: true })).toBeDisabled();
    balancesFail = false;
    usdPrice = "2500.00";
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted:true})));
    await expect(page.getByLabel("USD purchase target")).toHaveValue("25");
    await expect(page.getByRole("button", { name: "Review trade", exact: true })).toBeEnabled();
    check(await page.getByRole("button", { name: "Confirm buy in wallet", exact: true }).count() === 0, "Page restoration invalidates transaction authority while retaining saved review");
    check(await page.locator(".rmtcat-quote dl>div").filter({has:page.getByText("Exact ETH input", {exact:true})}).locator("dd").innerText() === exactInputBefore, "Price refresh and page return never rewrite reviewed ETH input");
    await page.getByRole("button", { name: "ETH input", exact: true }).click();
    await page.getByLabel("ETH to spend").fill("1");
    await page.getByRole("button", { name: "Review trade", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Insufficient ETH: input plus gas reserve");
    await page.getByRole("button", { name: "0.01", exact: true }).click();
    await page.getByRole("button", { name: "Review trade", exact: true }).click();
    await page.getByRole("button", { name: "Confirm buy in wallet", exact: true }).waitFor();
    await expect(page.getByLabel("Verified trade review")).toContainText("0.01 ETH");
    await page.screenshot({path:path.join(output, `${channel}-${width}-eth-input.png`),fullPage:true});
    await page.getByRole("button", { name: "USD target", exact: true }).click();
    await expect(page.getByLabel("USD purchase target")).toHaveValue("25");
    await page.screenshot({path:path.join(output, `${channel}-${width}-usd-input.png`),fullPage:true});
    await page.getByRole("button", { name: "CannaCat target", exact: true }).click();
    await page.getByRole("button", { name: "10K", exact: true }).click();
    await page.getByRole("button", { name: "Sell CannaCat", exact: true }).click();
    await page.getByLabel("CannaCat to sell").fill("10000");
    await page.getByRole("button", { name: "Review trade", exact: true }).click();
    await page.getByRole("button", { name: "Review token approval", exact: true }).waitFor();
    await expect(page.getByLabel("Verified trade review")).toContainText("Estimated proceeds · USD");
    await expect(page.getByLabel("Wallet balances")).toContainText("50000 CannaCat");
    await page.screenshot({path:path.join(output, `${channel}-${width}-sell-usd.png`),fullPage:true});
    check(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth), "Balance cards, mode controls and USD proceeds fit the target viewport");
    usdPrice = "2000.00";
    for (const walletClientType of ["metamask", "rabby"]) {
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.goto(base);
      await page.getByRole("button", { name: "I understand — continue", exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.__CANNACAT_FIXTURE_UPDATE__)).toBe("function");
      await page.evaluate(({ client, transport }) => window.__CANNACAT_FIXTURE_UPDATE__?.({ connected: true, authenticated: true,
        walletClientType: client, connectorType: transport, chainId: "eip155:1", providerChainId: "0X1237" }),
        { client: walletClientType, transport: width < 768 ? "wallet_connect" : "injected" });
      await expect(page.getByRole("button", { name: "Review trade", exact: true })).toBeEnabled();
      check(await page.getByLabel("Choose signing wallet").count() === 0, `${walletClientType}: sole restored signer needs no USE or chooser`);
      check(await page.getByRole("button", { name: "Switch to Robinhood Chain" }).count() === 0, "Fresh provider chain wins over stale SDK metadata");
      check(await page.evaluate(() => window.__CANNACAT_FIXTURE_AUTH_REQUESTS__ ?? 0) === 0, "Restored session never triggers an authentication signature");
      check(await page.evaluate(() => window.__CANNACAT_FIXTURE_CHAIN_SWITCHES__ ?? 0) === 0, "No automatic network switch");
      await page.getByRole("button", { name: "Review trade", exact: true }).click();
      await page.getByRole("button", { name: "Confirm buy in wallet" }).waitFor();
      check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 0, "Auto-selection prepares a quote without any transaction request");
      await page.screenshot({ path: path.join(output, `${channel}-${width}-${walletClientType}-auto-selected.png`), fullPage: true });

      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ providerChainId: "0x1" }, "chainChanged"));
      await page.locator('[data-wallet-status="wrong-chain"]').waitFor();
      check(await page.getByRole("button", { name: "Review trade", exact: true }).isDisabled(), "Wrong live chain blocks quotes");
      check(await page.getByRole("button", { name: "Confirm buy in wallet" }).count() === 0, "Chain change invalidates prepared transaction");
      await page.getByRole("button", { name: "Switch to Robinhood Chain" }).click();
      await expect(page.getByRole("button", { name: "Review trade", exact: true })).toBeEnabled();
      check(await page.evaluate(() => window.__CANNACAT_FIXTURE_CHAIN_SWITCHES__) === 1, "Exactly one explicit network switch");

      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ accounts: ["0x1111111111111111111111111111111111111111", "0x0000000000000000000000000000000000000123"] }, "accountsChanged"));
      await expect(page.getByRole("button", { name: "Review trade", exact: true })).toBeEnabled();
      check(await page.locator('[data-wallet-status="ready"]').count() === 1, "Account-list order does not silently replace the exact selected SDK wallet");
      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ accounts: ["0x1111111111111111111111111111111111111111"] }, "accountsChanged"));
      await page.locator('[data-wallet-status="account-mismatch"]').waitFor();
      check(await page.getByRole("button", { name: "Review trade", exact: true }).isDisabled(), "Provider must expose the exact selected SDK wallet address");
      await page.evaluate(() => {
        window.__CANNACAT_FIXTURE_UPDATE__?.({ accounts: ["0x0000000000000000000000000000000000000123"], chainId: "eip155:1", providerChainId: "0x1237" });
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
      await expect(page.getByRole("button", { name: "Review trade", exact: true })).toBeEnabled();
      check(await page.locator('[data-wallet-status="ready"]').count() === 1, "Mobile return reacquires account and chain without a wallet-choice step");
      await page.getByRole("button", { name: "Review trade", exact: true }).click();
      await page.getByRole("button", { name: "Confirm buy in wallet" }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
      check(await page.getByRole("button", { name: "Confirm buy in wallet" }).count() === 0, "Suspension removes stale wallet confirmation");
      await page.evaluate(() => {
        window.__CANNACAT_FIXTURE_UPDATE__?.({ providerAvailable: false });
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
      await page.locator('[data-wallet-status="unavailable"]').waitFor();
      check(await page.getByRole("button", { name: "Review trade", exact: true }).isDisabled(), "Authenticated address without provider cannot quote");
      await page.getByRole("button", { name: "Reconnect wallet", exact: true }).click();
      await expect(page.getByRole("button", { name: "Review trade", exact: true })).toBeEnabled();
      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({}, "disconnect"));
      await page.locator('[data-wallet-status="disconnected"]').waitFor();
      check(await page.getByRole("button", { name: "Review trade", exact: true }).isDisabled(), "Provider disconnect invalidates signing readiness");
      await page.getByRole("button", { name: "Reconnect wallet", exact: true }).click();
      await expect(page.getByRole("button", { name: "Review trade", exact: true })).toBeEnabled();
      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ authenticated: false }));
      check(await page.getByRole("button", { name: "Review trade", exact: true }).isDisabled(), "Expired identity remains blocked despite an available provider");
      await page.getByRole("button", { name: "Verify wallet ownership" }).waitFor();

      // Attaching another connector during reconnect must not silently replace
      // the existing signer, even when both connectors expose the same address.
      await page.evaluate(() => { window.__CANNACAT_FIXTURE_ATTACH_SECOND__ = true; window.__CANNACAT_FIXTURE_UPDATE__?.({ providerAvailable: false }, 'chainChanged'); });
      await page.locator('[data-wallet-status="unavailable"]').waitFor();
      await page.getByRole('button', { name: 'Reconnect wallet', exact: true }).click();
      await page.getByLabel('Choose signing wallet').waitFor();
      check((await page.getByLabel('Choose signing wallet').inputValue()).includes(`synthetic-${walletClientType}`), 'Connecting a second signer never silently replaces the original explicit/sole selection');

      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await page.goto(base);
      await page.getByRole("button", { name: "I understand — continue", exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.__CANNACAT_FIXTURE_UPDATE__)).toBe("function");
      await page.evaluate((client) => window.__CANNACAT_FIXTURE_UPDATE__?.({ connected: true, authenticated: true, walletCount: 2,
        walletClientType: client, chainId: "eip155:4663", providerChainId: "0x1237" }), walletClientType);
      await page.getByLabel("Choose signing wallet").waitFor();
      check(await page.getByRole("button", { name: "Review trade", exact: true }).isDisabled(), "Two signing connectors never auto-select, even for the same address");
      check(await page.getByLabel("Choose signing wallet").inputValue() === "", "No first-option selection is implied");
      await page.getByLabel("Choose signing wallet").selectOption({ index: 1 });
      await expect(page.getByRole("button", { name: "Review trade", exact: true })).toBeEnabled();
      const chosen = await page.getByLabel("Choose signing wallet").inputValue();
      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ providerChainId: "0x1" }, "chainChanged"));
      await page.locator('[data-wallet-status="wrong-chain"]').waitFor();
      check(await page.getByLabel("Choose signing wallet").inputValue() === chosen, "Network changes preserve the explicit connector choice");
      check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 0, "No account/network/reconnect event signs or submits");
      check(await page.evaluate(() => window.__CANNACAT_FIXTURE_AUTH_REQUESTS__ ?? 0) === 0, "Multiple-wallet discovery never authenticates automatically");
      check(page.url() === `${base}/`, "Wallet flow stays on LAMMB");
      check(errors.length === 0, `No wallet-lifecycle browser errors: ${errors.join("; ")}`);
      results.push({ channel, width, walletClientType, autoSelection: "PASS", staleSdkChain: "PASS", providerAccountBinding: "PASS",
        transport: width < 768 ? "wallet_connect" : "injected", mobileResume: "SYNTHETIC_PASS", multipleWalletChoice: "PASS", realWalletSignatures: 0, realTransactions: 0 });
    }
    // One explicit connect starts the SDK authentication flow. Its completion
    // event, not a second Verify click or a bare address, advances the session.
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(base);
    await page.getByRole('button', { name: 'I understand — continue', exact: true }).click();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    check(await page.evaluate(() => window.__CANNACAT_FIXTURE_LOGIN_REQUESTS__) === 1, 'Connect requests one Privy wallet-authentication flow');
    check(await page.getByRole('button', { name: 'Review trade', exact: true }).isDisabled(), 'A connected address without signed identity never authorizes pricing');
    await page.evaluate(() => {
      window.__CANNACAT_FIXTURE_UPDATE__?.({ authenticated: true, chainId: 'eip155:4663', providerChainId: '0x1237' });
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(page.getByRole('button', { name: 'Review trade', exact: true })).toBeEnabled();
    check(await page.getByRole('button', { name: 'Verify wallet ownership', exact: true }).count() === 0, 'Signed authentication return needs no redundant verification click');
    check((await page.evaluate(() => window.__CANNACAT_FIXTURE_AUTH_REQUESTS__)) === undefined, 'The panel never requests a second loginOrLink signature after successful wallet login');
    check((await page.evaluate(() => window.__CANNACAT_FIXTURE_WALLET_REQUESTS__?.length ?? 0)) === 0, 'Authentication completion never signs or submits a transaction');
    // Full post-submission lifecycle uses real durable recovery code, disposable
    // wallet responses and synthetic RPC evidence. No funded wallet is involved.
    balance = 10n ** 18n; gasPrice = 1_000_000_000n; walletNonce = 0n; verified = true;
    approvalAlreadyGranted = false; settlementAvailable = false;
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto(base);
    await page.getByRole('button', { name: 'I understand — continue', exact: true }).click();
    const restoreConnection = async () => {
      await expect.poll(() => page.evaluate(() => typeof window.__CANNACAT_FIXTURE_UPDATE__)).toBe('function');
      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ connected: true, authenticated: true,
        walletClientType: 'metamask', connectorType: 'wallet_connect', chainId: 'eip155:4663', providerChainId: '0x1237' }));
      await expect(page.getByRole('button', { name: 'Review trade', exact: true })).toBeEnabled();
    };
    await restoreConnection();
    const submitSynthetic = async (label: string, digit: string) => {
      const txHash = `0x${digit.repeat(64)}`;
      const bundle = [...bundles.values()].at(-1)!;
      saveSyntheticTransaction(txHash, bundle);
      await page.evaluate(value => { window.__CANNACAT_FIXTURE_WALLET_MODE__ = 'hash'; window.__CANNACAT_FIXTURE_TX_HASH__ = value; }, txHash);
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.getByRole('status')).toContainText('Transaction submitted');
      walletNonce += 1n;
      await expect(page.getByRole('link', { name: `View transaction ${txHash.slice(0,6)}…${txHash.slice(-4)}`, exact: true })).toBeVisible();
      return txHash;
    };
    await page.getByRole('button', { name: 'Review trade', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm buy in wallet', exact: true }).waitFor();
    const buyHash = await submitSynthetic('Confirm buy in wallet', '1');
    await page.getByRole('button', { name: 'Check settlement', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Settlement verified:');
    check(true, 'Submitted buy verifies exact CannaCat receipt output and unlocks a fresh quote');
    await page.getByRole('button', { name: 'Sell CannaCat', exact: true }).click();
    await page.getByLabel('CannaCat to sell').fill('1');
    await page.getByRole('button', { name: 'Review trade', exact: true }).click();
    await page.getByRole('button', { name: 'Review token approval', exact: true }).waitFor();
    const approvalHash = await submitSynthetic('Review token approval', '2');
    await page.getByRole('button', { name: 'Check settlement', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Approval confirmed');
    check(true, 'Confirmed token approval is recovered without claiming that a sale occurred');
    approvalAlreadyGranted = true;
    await page.getByRole('button', { name: 'Review trade', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm sell in wallet', exact: true }).waitFor();
    const saleHash = await submitSynthetic('Confirm sell in wallet', '3');
    await page.getByRole('button', { name: 'Check settlement', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Receipt confirmed; output settlement is still unverified');
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Buy CannaCat', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Sell CannaCat', exact: true })).toBeEnabled();
    check(true, 'Unavailable native trace blocks resubmission without locking the rest of the interface');
    await page.getByRole('button', { name: 'Buy CannaCat', exact: true }).click();
    await page.getByRole('button', { name: 'ETH input', exact: true }).click();
    await page.getByLabel('ETH to spend').fill('0.001');
    balance = 78_950_000_000_000n; gasPrice = 20_078_000n;
    await page.reload();
    await restoreConnection();
    await expect(page.getByLabel('ETH to spend')).toHaveValue('0.001');
    await expect(page.getByLabel('Wallet balances')).toContainText('0.00007895 ETH');
    await expect(page.getByLabel('Amount availability')).toContainText('0.000060234 ETH gas reserve');
    await expect(page.getByLabel('Amount availability')).toContainText('Insufficient ETH');
    await expect(page.getByLabel('Transaction recovery')).toBeVisible();
    await page.getByRole('button', { name: 'Review trade', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Insufficient ETH');
    check(await page.getByRole('button', { name: /^Confirm .* in wallet$/ }).count() === 0, 'Owner balance/input/gas case cannot open another transaction');
    await page.getByRole('button', { name: 'Max ETH · leave gas', exact: true }).click();
    await expect(page.getByLabel('ETH to spend')).toHaveValue('0.000018716');
    await page.getByRole('button', { name: 'Review trade', exact: true }).click();
    await expect(page.getByLabel('Indicative quote review')).toBeVisible();
    check(await page.getByRole('button', { name: /^Confirm .* in wallet$/ }).count() === 0, 'Recovery permits an indicative quote but never authorizes another trade');
    const panelNode = await page.locator('.rmtcat-panel').elementHandle();
    const quoteNode = await page.getByLabel('Indicative quote review').elementHandle();
    balance = 78_940_000_000_000n;
    await page.getByRole('button', { name: 'Refresh balances', exact: true }).click();
    await expect(page.getByLabel('Wallet balances')).toContainText('0.00007894 ETH');
    check(await panelNode!.evaluate(element => element.isConnected) && await quoteNode!.evaluate(element => element.isConnected), 'Background balances preserve panel/quote DOM identity; no remount flicker');
    await expect(page.getByLabel('ETH to spend')).toHaveValue('0.000018716');
    await page.screenshot({ path: path.join(output, `${channel}-${width}-recovery-max.png`), fullPage: true });
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeEnabled();
    check(await page.evaluate(value => Object.values(localStorage).some(item => item.includes(value)), saleHash), 'Disconnect preserves the exact unresolved sale hash and journal');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Verify wallet ownership', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review trade', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Transaction recovery')).toBeVisible();
    settlementAvailable = true;
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    try {
      await expect(page.getByLabel('Saved transaction status')).toContainText('Settlement verified:');
      await expect(page.getByLabel('Saved transaction status')).toContainText('ETH received');
    } catch (cause) {
      await writeFile(path.join(output, channel + '-recovery-diagnostic.json'), JSON.stringify(await page.evaluate(() => ({
        syntheticJournal: localStorage.getItem('rmt:vnext-execution-journal:v1:4663'), panel: document.querySelector('.rmtcat-panel')?.textContent,
        status: document.querySelector('[role="status"]')?.textContent })), null, 2)); throw cause;
    }
    check(await page.getByLabel('Transaction recovery').count() === 0, 'Exact native-output proof resolves the saved sale after refresh and reconnect');
    const settledJournal = await page.evaluate(value => {
      const saved = JSON.parse(localStorage.getItem('rmt:vnext-execution-journal:v1:4663') || '{}');
      return saved.executions?.find((entry: { txHash: string }) => entry.txHash === value);
    }, saleHash);
    check(settledJournal?.state === 'confirmed' && Boolean(settledJournal?.outputSettlement), 'Automatic recovery persists canonical output proof, not just a cleared banner');
    await page.reload(); await restoreConnection();
    check(await page.getByLabel('Transaction recovery').count() === 0, 'Refreshing an authoritatively settled journal cannot restore an obsolete pending lock');
    for (const transactionHash of [buyHash, approvalHash, saleHash]) {
      check(await page.evaluate(value => Object.values(localStorage).some(item => item.includes(value)), transactionHash), 'Confirmed buy, approval and sale history remains preserved');
    }
    balance = 10n ** 18n; gasPrice = 1_000_000_000n;
    await page.getByRole('button', { name: '0.01', exact: true }).click();
    delayQuote = true;
    await page.getByRole('button', { name: 'Review trade', exact: true }).click();
    await page.getByRole('button', { name: 'Stop waiting', exact: true }).waitFor();
    await expect.poll(() => Boolean(delayedQuote)).toBe(true);
    await expect(page.getByRole('button', { name: 'Working…', exact: true })).toBeDisabled();
    await page.getByLabel('ETH to spend').fill('0.001');
    delayQuote = false; delayedQuote?.(); delayedQuote = null;
    await page.getByRole('button', { name: 'Review trade', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm buy in wallet', exact: true }).waitFor();
    await expect(page.getByLabel('Verified trade review')).toContainText('0.001 ETH');
    await expect(page.getByLabel('ETH to spend')).toHaveValue('0.001');
    check(true, 'Editing cancels an old quote and a late response cannot overwrite the new intent');
    const pendingHash = `0x${'4'.repeat(64)}`;
    saveSyntheticTransaction(pendingHash, [...bundles.values()].at(-1)!);
    await page.evaluate(value => { window.__CANNACAT_FIXTURE_WALLET_MODE__ = 'wait'; window.__CANNACAT_FIXTURE_TX_HASH__ = value; }, pendingHash);
    await page.getByRole('button', { name: 'Confirm buy in wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Stop waiting', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('It may still complete');
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
    await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await expect(page.getByRole('button', { name: 'Review trade', exact: true })).toBeEnabled();
    await page.evaluate(() => window.__CANNACAT_FIXTURE_RESOLVE_WALLET__?.());
    await expect(page.getByRole('status')).toContainText('Transaction submitted');
    walletNonce += 1n;
    await page.getByRole('button', { name: 'Check settlement', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Settlement verified:');
    check(true, 'A wallet response arriving after cancellation/mobile return is durably reconciled without resubmission');
    await page.getByRole('button', { name: 'Review trade', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm buy in wallet', exact: true }).waitFor();
    await page.evaluate(() => { window.__CANNACAT_FIXTURE_WALLET_MODE__ = 'wait'; });
    await page.getByRole('button', { name: 'Confirm buy in wallet', exact: true }).click();
    await page.clock.fastForward(46_000);
    await expect(page.getByRole('status')).toContainText('wallet response is still unresolved');
    await expect(page.getByRole('button', { name: 'Disconnect', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Buy CannaCat', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Sell CannaCat', exact: true })).toBeEnabled();
    check(await page.getByLabel('Transaction recovery').count() === 1, 'Watchdog releases transient UI loading but never clears unresolved wallet authority');
    await expect(page.getByLabel('Transaction hash from your wallet')).toBeVisible();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Post-trade recovery fits the viewport');
    check(errors.length === 0, `No post-trade refresh/recovery runtime errors: ${errors.join('; ')}`);
    await page.screenshot({ path: path.join(output, `${channel}-${width}-recovery-timeout.png`), fullPage: true });
    results.push({ channel, width, postTradeRefresh: 'PASS', unresolvedSale: 'PASS', independentNativeProof: 'SYNTHETIC_PASS', ownerInsufficientBalanceCase: 'PASS',
      maxGasReserve: 'PASS', disconnectReconnect: 'PASS', lateWalletResponse: 'PASS', loadingWatchdog: 'PASS', intentPersistence: 'PASS', realTransactions: 0 });

    // Close the preceding disposable trade/session before the independent
    // long-running observer. Its timers must not contaminate rate/outage counts.
    await context.close();
    if (width === 390) {
      // Fresh context uses REAL wall-clock time, not page.clock fast-forward.
      // API/wallet fixtures are disposable; execution authorization is never requested.
      balance = 10n ** 18n; gasPrice = 1_000_000_000n; verified = true; variableMarket = true;
      const stableContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await stableContext.route('**/*', routeHandler);
      const stable = await stableContext.newPage(); const stableErrors: string[] = [];
      stable.on('pageerror', error => stableErrors.push(error.message));
      await stable.goto(base);
      await stable.getByRole('button', { name: 'I understand — continue', exact: true }).click();
      await stable.getByRole('button', { name: 'Connect wallet', exact: true }).click();
      await stable.evaluate(() => {
        window.__CANNACAT_FIXTURE_UPDATE__?.({ authenticated: true, chainId: 'eip155:4663', providerChainId: '0x1237' });
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      const input = stable.getByLabel('Minimum CannaCat to receive');
      await expect(input).toHaveValue('10000');
      await stable.getByLabel('Indicative quote review').locator('dl').waitFor();
      // Passive observations share one pool read. A delayed read must resolve
      // against the latest intent, never restore a previous amount or call 0x.
      await new Promise(resolve => setTimeout(resolve, 16_000));
      delayObservation = true;
      await input.fill('10001');
      await expect.poll(() => Boolean(delayedObservation)).toBe(true);
      const releaseOldObservation = delayedObservation;
      delayObservation = false; delayedObservation = null;
      await input.fill('25000');
      (releaseOldObservation as (() => void) | null)?.();
      const expectedOutput = stable.getByLabel('Indicative quote review').locator('dl > div')
        .filter({ has: stable.getByText('Expected output', { exact: true }) }).locator('dd');
      await expect(expectedOutput).toHaveText('25000 CannaCat');
      check(await input.inputValue() === '25000', 'A late passive response cannot replace the latest target');
      await input.fill('10000');
      await expect(expectedOutput).toHaveText('10000 CannaCat');
      await expect(input).toHaveValue('10000');
      const panel = await stable.locator('.rmtcat-panel').elementHandle();
      const observation = await stable.getByLabel('Indicative quote review').elementHandle();
      const inputNode = await input.elementHandle();
      await input.focus(); await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(2, 2));
      const scroll = await stable.evaluate(() => ({ x: scrollX, y: scrollY }));
      const started = Date.now(); const callsAtStart = quoteCalls; const firmAtStart = firmCalls; const spotsAtStart = spotCalls; const samples: object[] = [];
      await stable.screenshot({ path: path.join(output, channel + '-stability-start.png'), fullPage: true });
      for (let sample = 0; sample < 30; sample += 1) {
        if (sample === 5) spotFailure = 503;
        if (sample === 6) spotFailure = 0;
        if (sample === 11) spotFailure = 429;
        if (sample === 12) spotFailure = 0;
        if (sample === 17 || sample === 18) await stable.evaluate(hidden => {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: hidden ? 'hidden' : 'visible' });
          document.dispatchEvent(new Event('visibilitychange'));
        }, sample === 17);
        const beforeHidden = spotCalls;
        await new Promise(resolve => setTimeout(resolve, 30_000));
        if (sample === 17) check(spotCalls === beforeHidden, 'Hidden browser pauses passive spot requests');
        check(await input.inputValue() === '10000', '15-minute monitoring preserves the 10000 token target');
        check(await panel!.evaluate(node => node.isConnected) && await observation!.evaluate(node => node.isConnected)
          && await inputNode!.evaluate(node => node.isConnected), 'Live pricing never remounts panel, observation or input');
        const state = await input.evaluate((node: HTMLInputElement) => ({ focused: document.activeElement === node, cursor: node.selectionStart,
          x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, viewport: innerWidth }));
        check(state.focused && state.cursor === 2, 'Background quotes preserve keyboard focus and cursor');
        check(state.x === scroll.x && Math.abs(state.y - scroll.y) <= 1, 'Background quotes never jump or reset scroll');
        check(state.width <= state.viewport, 'Live estimate remains inside iPhone-sized viewport');
        check(await stable.getByRole('button', { name: 'CannaCat target', exact: true }).getAttribute('aria-pressed') === 'true', 'Selected buy input mode stays unchanged');
        samples.push({ sample: sample + 1, elapsedMs: Date.now() - started, quoteCalls: quoteCalls - callsAtStart, spotCalls: spotCalls - spotsAtStart,
          freshness: await stable.locator('.rmtcat-freshness').innerText(), ...state });
      }
      const elapsedMs = Date.now() - started;
      check(elapsedMs >= 900_000, 'Fifteen minutes actually elapsed without virtual time');
      check(quoteCalls === callsAtStart, 'Fifteen minutes of passive monitoring makes zero 0x price requests');
      check(spotCalls - spotsAtStart >= 20 && spotCalls - spotsAtStart <= 40, 'Lightweight pool observations refresh within a bounded rate');
      check((await stable.evaluate(() => window.__CANNACAT_FIXTURE_WALLET_REQUESTS__?.length ?? 0)) === 0, 'Fifteen minutes of quotes never submits or signs');
      check(firmCalls === firmAtStart, 'Background estimates never call verification or authorization endpoints');
      check(stableErrors.length === 0, 'No long-running browser runtime errors');
      await stable.screenshot({ path: path.join(output, channel + '-stability-finish.png'), fullPage: true });
      // Existing modes and sell use automatic observations without a Review click.
      await stable.getByRole('button', { name: 'USD target', exact: true }).click();
      await expect(stable.getByLabel('USD purchase target')).toHaveValue('25');
      await expect(stable.getByLabel('Indicative quote review').locator('dl')).toBeVisible();
      await expect(stable.getByLabel('Indicative quote review')).toContainText('0.0125 ETH');
      await stable.getByRole('button', { name: 'ETH input', exact: true }).click();
      await stable.getByLabel('ETH to spend').fill('0.001');
      await expect(stable.getByLabel('Indicative quote review')).toContainText('0.001 ETH');
      await stable.getByRole('button', { name: 'Sell CannaCat', exact: true }).click();
      await stable.getByLabel('CannaCat to sell').fill('1');
      await expect(stable.getByLabel('Indicative quote review')).toContainText('1 CannaCat');
      check(await stable.getByRole('button', { name: /^Confirm .* in wallet$/ }).count() === 0, 'All automatic modes remain indicative, never executable');
      await writeFile(path.join(output, channel + '-15-minute-stability.json'), JSON.stringify({ result: 'PASS', channel, elapsedMs,
        clock: 'REAL_WALL_CLOCK', transport: 'SYNTHETIC_WALLET_AND_API', variableMarket: true, unavailable503: true, rateLimited429: true,
        hiddenPauseAndResume: true, manualQuoteClicks: 0, realSignatures: 0, realTransactions: 0, samples }, null, 2));
      variableMarket = false; quoteFailure = 0; quoteResumeAfter = 0; spotFailure = 0;
      await stableContext.close();
    }
  }
  await writeFile(path.join(output, `${channel}.json`), JSON.stringify({ result: "PASS", checks, quoteCalls, results, layouts, baselinePanelCommit:"af597d2d8ccf0c4db05e993ac5dd4bbf32171399", realTransactions: 0, realWalletSignatures: 0, nativeIphoneSafariTested: false }, null, 2));
  console.log(JSON.stringify({ result: "PASS", checks, quoteCalls, channel, viewports: 5, realTransactions: 0 }));
} finally { await browser.close(); server.close(); }
}
void main().catch((cause) => { console.error(cause); process.exitCode = 1; });
