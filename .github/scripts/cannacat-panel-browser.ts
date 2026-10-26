import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, expect } from "playwright/test";
import { createVNextZeroXProviderNativeFee } from "../../apps/web/lib/vnext/zero-x-settlement";
import { syntheticCannaCatBundle } from "./cannacat-firm-fixture";
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
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CannaCat panel acceptance</title><style>body{background:#080b07;color:#eef4e7;font-family:system-ui;margin:0;padding:24px}header{max-width:680px;margin:0 auto 24px;font-size:12px;letter-spacing:.08em}#panel{max-width:680px;margin:auto}</style><header>LAMMB GENESIS · SYNTHETIC WALLET TEST<br>NO REAL SIGNATURES OR TRANSACTIONS</header><main id="panel"></main><script type="module">import{mountCannaCatPanel}from'/${real ? "real" : "fixture"}/cannacat-panel.mjs';mountCannaCatPanel(document.querySelector('#panel'),{enabled:${!real},apiBaseUrl:'https://rmt-fixture.invalid/api/embed/cannacat',privyAppId:'synthetic-app',privyClientId:'synthetic-client'});</script></html>`);
      return;
    }
    const match = url.pathname.match(/^\/(real|fixture)\/([A-Za-z0-9_./-]+\.mjs)$/);
    if (!match || match[2].includes("..")) { response.writeHead(404).end(); return; }
    const directory = match[1] === "real" ? "cannacat-sdk" : "cannacat-sdk-fixture";
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(await readFile(path.join(root, "apps/web", directory, match[2])));
  } catch { response.writeHead(500).end("Fixture server failed"); }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
const base = `http://localhost:${port}`;
const browser = await chromium.launch({ channel, headless: true });
const results: object[] = [];
let checks = 0;
let quoteCalls = 0;
let balance = 10n ** 18n;
let verified = false;
const bundles = new Map<string, ReturnType<typeof syntheticCannaCatBundle>>();
const tokenBalance = 50_000n * 10n ** 18n;
const hash = `0x${"a".repeat(64)}`;
const hex = (amount: bigint) => `0x${amount.toString(16)}`;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };
try {
  for (const width of [390, 1440]) {
    verified = false;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === base) { await route.continue(); return; }
      if (url.origin === "https://rpc.mainnet.chain.robinhood.com") {
        const rpc = route.request().postDataJSON();
        const answer = (entry: { id: number; method: string }) => {
          const values: Record<string, unknown> = { eth_chainId: "0x1237", eth_getBalance: hex(balance), eth_gasPrice: "0x3b9aca00", eth_getTransactionCount: "0x0", eth_call: `0x${tokenBalance.toString(16).padStart(64, "0")}`,
            eth_getBlockByNumber: { number: "0x64", hash, parentHash: hash, transactions: [], timestamp: hex(BigInt(Math.floor(Date.now() / 1000))), gasLimit: "0x1c9c380", gasUsed: "0x0", baseFeePerGas: "0x3b9aca00", difficulty: "0x0", extraData: "0x", miner: `0x${"0".repeat(40)}`, size: "0x100", nonce: "0x0000000000000000", sha3Uncles: hash, transactionsRoot: hash, stateRoot: hash, receiptsRoot: hash, logsBloom: `0x${"0".repeat(512)}` } };
          if (!(entry.method in values)) throw new Error(`Unexpected read-only RPC: ${entry.method}`);
          return { jsonrpc: "2.0", id: entry.id, result: values[entry.method] };
        };
        await route.fulfill({ json: Array.isArray(rpc) ? rpc.map(answer) : answer(rpc) }); return;
      }
      if (url.origin === "https://rmt-fixture.invalid") {
        const headers = { "access-control-allow-origin": base, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type,privy-id-token,x-rmt-client" };
        if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
        const input = route.request().postDataJSON();
        check(input.chainId === 4663 && input.recipient === "0x0000000000000000000000000000000000000123", "Exact synthetic wallet and chain binding");
        check(route.request().headers()["privy-id-token"] === "synthetic-identity-only", "Only fixture identity forwarded");
        if (!url.pathname.endsWith("/quotes")) {
          if (!verified) { await route.fulfill({ status: 409, headers, json: { code: "ZERO_X_REPRICE_REQUIRED" } }); return; }
          if (url.pathname.endsWith("/verify")) {
            const bundle = syntheticCannaCatBundle(input);
            bundles.set(bundle.evidence.verificationId, bundle);
            await route.fulfill({ headers, json: bundle.evidence }); return;
          }
          const bundle = bundles.get(input.verificationId);
          check(Boolean(bundle) && bundle!.evidence.zeroXFirmQuoteCommitment === input.zeroXFirmQuoteCommitment, "Exact fixture verification commitment reused");
          await route.fulfill({ headers, json: bundle }); return;
        }
        quoteCalls += 1;
        const buying = input.inputAsset === "0x0000000000000000000000000000000000000000";
        const output = buying ? BigInt(input.inputAmountAtomic) * 10_000_000n : BigInt(input.inputAmountAtomic) / 10_000_000n;
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
    });
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
    await page.getByRole("button", { name: "Verify wallet ownership" }).click();
    await page.getByRole("button", { name: "Switch to Robinhood Chain" }).click();
    await page.getByRole("button", { name: "Get live quote" }).waitFor({ state: "visible" });
    await expect(page.getByRole("button", { name: "Get live quote" })).toBeEnabled();
    checks += 1;
    await page.getByLabel("Minimum CannaCat to receive").fill("0");
    await page.getByRole("button", { name: "Get live quote" }).click();
    await page.getByRole("alert").filter({ hasText: "positive token amount" }).waitFor();
    await page.getByRole("button", { name: "Sell CannaCat", exact: true }).click();
    await page.getByLabel("CannaCat to sell").fill("100000");
    await page.getByRole("button", { name: "Get live quote" }).click();
    await page.getByRole("alert").filter({ hasText: "exceeds this wallet" }).waitFor();
    await page.getByRole("button", { name: "Buy CannaCat", exact: true }).click();
    await page.getByLabel("Minimum CannaCat to receive").fill("10000");
    balance = 0n;
    await page.getByRole("button", { name: "Get live quote" }).click();
    await page.getByRole("alert").filter({ hasText: "ETH is needed" }).waitFor();
    balance = 10n ** 18n;
    await page.getByRole("button", { name: "Get live quote" }).click();
    await page.getByRole("alert").filter({ hasText: "quote changed" }).waitFor();
    check(await page.getByRole("button", { name: /Confirm buy in wallet/ }).count() === 0, "Repriced quote cannot open a wallet request");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal overflow");
    check(await page.locator("iframe").count() === 0, "No terminal iframe");
    check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 0, "No implicit signing or submission");
    check(page.url() === `${base}/`, "Website flow never redirects to RMT");
    check(errors.length === 0, `No browser runtime errors: ${errors.join("; ")}`);
    verified = true;
    await page.getByRole("button", { name: "Get live quote" }).click();
    await page.getByRole("button", { name: "Confirm buy in wallet" }).waitFor();
    check(await page.getByLabel("Verified trade review").innerText().then((text) => text.includes("Protected minimum") && text.includes("RMT fee · 0.25%") && text.includes("Estimated network gas")), "Complete protected buy review and unchanged fee displayed");
    check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 0, "Verification never signs automatically");
    await page.screenshot({ path: path.join(output, `${channel}-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Confirm buy in wallet" }).click();
    await page.getByRole("alert").filter({ hasText: "declined" }).waitFor();
    check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 1, "One explicit wallet gesture; rejected request never repeats");
    await page.getByRole("button", { name: "Sell CannaCat", exact: true }).click();
    await page.getByLabel("CannaCat to sell").fill("10000");
    await page.getByRole("button", { name: "Get live quote" }).click();
    await page.getByRole("button", { name: "Review token approval" }).waitFor();
    check(await page.getByLabel("Verified trade review").innerText().then((text) => text.includes("No swap fee is charged by this approval")), "Approval is distinguished from swap settlement and fees");
    await page.screenshot({ path: path.join(output, `${channel}-${width}-approval.png`), fullPage: true });
    await page.evaluate(() => { window.__CANNACAT_FIXTURE_SYNC_REJECT__ = true; });
    await page.getByRole("button", { name: "Review token approval" }).click();
    await page.getByRole("status").filter({ hasText: "declined" }).waitFor();
    await expect(page.getByRole("button", { name: "Get live quote" })).toBeEnabled();
    check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 2, "Synchronous wallet rejection safely unlocks the panel without resubmission");
    results.push({ channel, width, checks: "PASS", scope: "Synthetic provider/wallet; real production bundle cold-load and real panel/SDK code", realTransactions: 0 });
    for (const walletClientType of ["metamask", "rabby"]) {
      await page.evaluate(() => localStorage.clear());
      await page.goto(base);
      await page.getByRole("button", { name: "I understand — continue", exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.__CANNACAT_FIXTURE_UPDATE__)).toBe("function");
      await page.evaluate(({ client, transport }) => window.__CANNACAT_FIXTURE_UPDATE__?.({ connected: true, authenticated: true,
        walletClientType: client, connectorType: transport, chainId: "eip155:1", providerChainId: "0X1237" }),
        { client: walletClientType, transport: width === 390 ? "wallet_connect" : "injected" });
      await expect(page.getByRole("button", { name: "Get live quote", exact: true })).toBeEnabled();
      check(await page.getByLabel("Choose signing wallet").count() === 0, `${walletClientType}: sole restored signer needs no USE or chooser`);
      check(await page.getByRole("button", { name: "Switch to Robinhood Chain" }).count() === 0, "Fresh provider chain wins over stale SDK metadata");
      check(await page.evaluate(() => window.__CANNACAT_FIXTURE_AUTH_REQUESTS__ ?? 0) === 0, "Restored session never triggers an authentication signature");
      check(await page.evaluate(() => window.__CANNACAT_FIXTURE_CHAIN_SWITCHES__ ?? 0) === 0, "No automatic network switch");
      await page.getByRole("button", { name: "Get live quote", exact: true }).click();
      await page.getByRole("button", { name: "Confirm buy in wallet" }).waitFor();
      check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 0, "Auto-selection prepares a quote without any transaction request");
      await page.screenshot({ path: path.join(output, `${channel}-${width}-${walletClientType}-auto-selected.png`), fullPage: true });

      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ providerChainId: "0x1" }, "chainChanged"));
      await page.locator('[data-wallet-status="wrong-chain"]').waitFor();
      check(await page.getByRole("button", { name: "Get live quote", exact: true }).isDisabled(), "Wrong live chain blocks quotes");
      check(await page.getByRole("button", { name: "Confirm buy in wallet" }).count() === 0, "Chain change invalidates prepared transaction");
      await page.getByRole("button", { name: "Switch to Robinhood Chain" }).click();
      await expect(page.getByRole("button", { name: "Get live quote", exact: true })).toBeEnabled();
      check(await page.evaluate(() => window.__CANNACAT_FIXTURE_CHAIN_SWITCHES__) === 1, "Exactly one explicit network switch");

      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ accounts: ["0x1111111111111111111111111111111111111111", "0x0000000000000000000000000000000000000123"] }, "accountsChanged"));
      await expect(page.getByRole("button", { name: "Get live quote", exact: true })).toBeEnabled();
      check(await page.locator('[data-wallet-status="ready"]').count() === 1, "Account-list order does not silently replace the exact selected SDK wallet");
      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ accounts: ["0x1111111111111111111111111111111111111111"] }, "accountsChanged"));
      await page.locator('[data-wallet-status="account-mismatch"]').waitFor();
      check(await page.getByRole("button", { name: "Get live quote", exact: true }).isDisabled(), "Provider must expose the exact selected SDK wallet address");
      await page.evaluate(() => {
        window.__CANNACAT_FIXTURE_UPDATE__?.({ accounts: ["0x0000000000000000000000000000000000000123"], chainId: "eip155:1", providerChainId: "0x1237" });
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
      await expect(page.getByRole("button", { name: "Get live quote", exact: true })).toBeEnabled();
      check(await page.locator('[data-wallet-status="ready"]').count() === 1, "Mobile return reacquires account and chain without a wallet-choice step");
      await page.getByRole("button", { name: "Get live quote", exact: true }).click();
      await page.getByRole("button", { name: "Confirm buy in wallet" }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
      check(await page.getByRole("button", { name: "Confirm buy in wallet" }).count() === 0, "Suspension removes stale wallet confirmation");
      await page.evaluate(() => {
        window.__CANNACAT_FIXTURE_UPDATE__?.({ providerAvailable: false });
        window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
      });
      await page.locator('[data-wallet-status="unavailable"]').waitFor();
      check(await page.getByRole("button", { name: "Get live quote", exact: true }).isDisabled(), "Authenticated address without provider cannot quote");
      await page.getByRole("button", { name: "Reconnect wallet", exact: true }).click();
      await expect(page.getByRole("button", { name: "Get live quote", exact: true })).toBeEnabled();
      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({}, "disconnect"));
      await page.locator('[data-wallet-status="disconnected"]').waitFor();
      check(await page.getByRole("button", { name: "Get live quote", exact: true }).isDisabled(), "Provider disconnect invalidates signing readiness");
      await page.getByRole("button", { name: "Reconnect wallet", exact: true }).click();
      await expect(page.getByRole("button", { name: "Get live quote", exact: true })).toBeEnabled();
      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ authenticated: false }));
      check(await page.getByRole("button", { name: "Get live quote", exact: true }).isDisabled(), "Expired identity remains blocked despite an available provider");
      await page.getByRole("button", { name: "Verify wallet ownership" }).waitFor();

      await page.evaluate(() => localStorage.clear());
      await page.goto(base);
      await page.getByRole("button", { name: "I understand — continue", exact: true }).click();
      await expect.poll(() => page.evaluate(() => typeof window.__CANNACAT_FIXTURE_UPDATE__)).toBe("function");
      await page.evaluate((client) => window.__CANNACAT_FIXTURE_UPDATE__?.({ connected: true, authenticated: true, walletCount: 2,
        walletClientType: client, chainId: "eip155:4663", providerChainId: "0x1237" }), walletClientType);
      await page.getByLabel("Choose signing wallet").waitFor();
      check(await page.getByRole("button", { name: "Get live quote", exact: true }).isDisabled(), "Two signing connectors never auto-select, even for the same address");
      check(await page.getByLabel("Choose signing wallet").inputValue() === "", "No first-option selection is implied");
      await page.getByLabel("Choose signing wallet").selectOption({ index: 1 });
      await expect(page.getByRole("button", { name: "Get live quote", exact: true })).toBeEnabled();
      const chosen = await page.getByLabel("Choose signing wallet").inputValue();
      await page.evaluate(() => window.__CANNACAT_FIXTURE_UPDATE__?.({ providerChainId: "0x1" }, "chainChanged"));
      await page.locator('[data-wallet-status="wrong-chain"]').waitFor();
      check(await page.getByLabel("Choose signing wallet").inputValue() === chosen, "Network changes preserve the explicit connector choice");
      check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 0, "No account/network/reconnect event signs or submits");
      check(await page.evaluate(() => window.__CANNACAT_FIXTURE_AUTH_REQUESTS__ ?? 0) === 0, "Multiple-wallet discovery never authenticates automatically");
      check(page.url() === `${base}/`, "Wallet flow stays on LAMMB");
      check(errors.length === 0, `No wallet-lifecycle browser errors: ${errors.join("; ")}`);
      results.push({ channel, width, walletClientType, autoSelection: "PASS", staleSdkChain: "PASS", providerAccountBinding: "PASS",
        transport: width === 390 ? "wallet_connect" : "injected", mobileResume: "SYNTHETIC_PASS", multipleWalletChoice: "PASS", realWalletSignatures: 0, realTransactions: 0 });
    }
    await context.close();
  }
  await writeFile(path.join(output, `${channel}.json`), JSON.stringify({ result: "PASS", checks, quoteCalls, results, realTransactions: 0, realWalletSignatures: 0, nativeIphoneSafariTested: false }, null, 2));
  console.log(JSON.stringify({ result: "PASS", checks, quoteCalls, channel, viewports: 2, realTransactions: 0 }));
} finally { await browser.close(); server.close(); }
}
void main().catch((cause) => { console.error(cause); process.exitCode = 1; });
