import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, webkit, expect, type Page } from "playwright/test";
import { historicalSaleRecord, historicalSaleRpc, historicalSaleTransaction as transaction } from "../../apps/web/lib/testing/historical-cannacat-sale";
import { readHistoricalSettlementTrace } from "../../apps/web/lib/server/historical-settlement-trace";
declare global { interface Window { __HISTORICAL_COPY__?: string; } }

async function main() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const output = path.join(root, "cannacat-historical-evidence"); await mkdir(output, { recursive: true });
  const channel = process.env.CANNACAT_BROWSER ?? "chrome";
  assert(["chrome", "msedge", "webkit"].includes(channel));
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, "http://localhost");
      if (url.pathname === "/") {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Historical settlement recovery test</title><style>body{margin:0;padding:18px;background:#080b07;color:#eef4e7;font-family:system-ui}header,#panel{max-width:680px;margin:auto}header{font-size:12px;margin-bottom:20px}</style><header>EXACT PUBLIC HISTORICAL SALE · SYNTHETIC WALLET SESSION / JOURNAL AUTHORITY<br>NO REAL SIGNATURES OR TRANSACTIONS</header><main id="panel"></main><script type="module">import{mountCannaCatPanel}from'/sdk/cannacat-panel.mjs';mountCannaCatPanel(document.querySelector('#panel'),{enabled:true,apiBaseUrl:'https://historical-fixture.invalid/api/embed/cannacat',privyAppId:'fixture',privyClientId:'fixture'});</script></html>`); return;
      }
      const match = url.pathname.match(/^\/sdk\/([A-Za-z0-9_./-]+\.mjs)$/);
      if (!match || match[1].includes("..")) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Type", "text/javascript; charset=utf-8");
      response.end(await readFile(path.join(root, "apps/web/cannacat-sdk-fixture", match[1])));
    } catch { response.writeHead(500).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  // Match the existing SDK's explicit localhost-only HTTP acceptance boundary.
  // Production HTTPS checks are unchanged.
  const base = `http://localhost:${(server.address() as { port: number }).port}`;
  const browser = await (channel === "webkit" ? webkit.launch({ headless: true }) : chromium.launch({ channel, headless: true }));
  const results: object[] = []; let checks = 0, traceReads = 0;
  const check = (value: unknown, message: string) => { assert.ok(value, message); checks++; };
  const journalKey = "rmt:vnext-execution-journal:v1:4663";
  let diagnostic: { page: Page; errors: string[]; width: number; excessiveMinimum: boolean } | null = null;
  try {
    for (const width of [320, 390]) {
      for (const excessiveMinimum of [false, true]) {
        const context = await browser.newContext({ viewport: { width, height: 844 } });
        const page = await context.newPage(); const errors: string[] = [];
        diagnostic = { page, errors, width, excessiveMinimum };
        page.on("pageerror", error => errors.push(error.message));
        const record = historicalSaleRecord();
        if (excessiveMinimum) { record.providerNativeFee!.protectedOutputAtomic = "137068094859"; record.providerNativeFee!.expectedOutputAtomic = "137068094860"; }
        const initial = width === 320 ? [record] : { schemaVersion: 2, executions: [record], walletRequests: [] };
        // Raw fixture JavaScript avoids serializing tsx's injected __name helper
        // into a different browser realm. No application/runtime guard changes.
        await context.addInitScript({ content: `(() => {
          const key = ${JSON.stringify(journalKey)};
          if (!localStorage.getItem(key)) localStorage.setItem(key, ${JSON.stringify(JSON.stringify(initial))});
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
            async writeText(value) { window.__HISTORICAL_COPY__ = value; }
          } });
        })();` });
        let archiveAvailable = false;
        await context.route("**/*", async route => {
          const url = new URL(route.request().url());
          if (url.origin === base) { await route.continue(); return; }
          if (url.origin === "https://api.exchange.coinbase.com") {
            await route.fulfill({ json: { price: "2000", time: new Date().toISOString() }, headers: { "access-control-allow-origin": "*" } }); return;
          }
          if (url.origin === "https://rpc.mainnet.chain.robinhood.com") {
            const body = route.request().postDataJSON();
            const answer = (entry: { method: string; id: number; params?: unknown[] }) => {
              const lookup = String(entry.params?.[0] ?? "").toLowerCase() === record.txHash.toLowerCase();
              const values: Record<string, unknown> = {
                eth_chainId: "0x1237", eth_getBalance: "0x48b201e12600", eth_gasPrice: "0x3b9aca00", eth_getTransactionCount: "0x20",
                eth_call: `0x${(50_000n * 10n ** 18n).toString(16)}`,
                eth_getTransactionReceipt: lookup ? historicalSaleRpc.receipt : null,
                eth_getTransactionByHash: lookup ? historicalSaleRpc.transaction : null,
                eth_getBlockByNumber: { number: "0x5e0411e", hash: transaction.blockHash, parentHash: transaction.blockHash,
                  transactions: [], timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}`, gasLimit: "0x1c9c380", gasUsed: "0x0",
                  baseFeePerGas: "0x3b9aca00", difficulty: "0x0", extraData: "0x", miner: record.wallet, size: "0x100",
                  nonce: "0x0000000000000000", sha3Uncles: transaction.blockHash, transactionsRoot: transaction.blockHash,
                  stateRoot: transaction.blockHash, receiptsRoot: transaction.blockHash, logsBloom: `0x${"0".repeat(512)}` },
              };
              assert(entry.method in values, "Unexpected historical RPC " + entry.method);
              return { jsonrpc: "2.0", id: entry.id, result: values[entry.method] };
            };
            await route.fulfill({ json: Array.isArray(body) ? body.map(answer) : answer(body) }); return;
          }
          if (url.origin === "https://historical-fixture.invalid") {
            const headers = { "access-control-allow-origin": base, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type,privy-id-token,x-rmt-client" };
            if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
            check(route.request().headers()["privy-id-token"] === "synthetic-identity-only", "Recovery retains authenticated fixture identity");
            if (url.pathname.endsWith("/native-settlement-trace")) {
              traceReads++; const input = route.request().postDataJSON();
              check(input.txHash === record.txHash && input.wallet.toLowerCase() === record.wallet.toLowerCase(), "Exact historical hash and selected wallet reach reconciliation");
              const evidence = archiveAvailable ? readHistoricalSettlementTrace({ hash: transaction.hash, blockHash: transaction.blockHash!,
                blockNumber: transaction.blockNumber!, from: transaction.from, to: transaction.to!, input: transaction.input, value: transaction.value }) : null;
              await route.fulfill({ headers, json: evidence ?? { status: "unavailable" } }); return;
            }
            check(url.pathname.endsWith("/quotes"), "Recovery never asks for a new authorization or expired firm quote");
            await route.fulfill({ status: 503, headers, json: { code: "EXPIRED_QUOTE_UNAVAILABLE" } }); return;
          }
          throw Error("Unexpected external request: " + url.origin);
        });
        const restoreWallet = async () => {
          await expect.poll(() => page.evaluate(() => typeof window.__CANNACAT_FIXTURE_UPDATE__)).toBe("function");
          await page.evaluate(address => window.__CANNACAT_FIXTURE_UPDATE__?.({ address, accounts: [address], connected: true,
            authenticated: true, chainId: "eip155:4663", providerChainId: "0x1237", providerAvailable: true }), record.wallet);
          await page.locator('[data-wallet-status="ready"]').waitFor();
        };
        await page.goto(base);
        await page.getByRole("button", { name: "I understand — continue", exact: true }).click();
        await restoreWallet();
        await expect(page.getByRole("status")).toContainText("Receipt confirmed; output settlement is still unverified");
        await expect(page.getByLabel("Saved transaction status")).toContainText("Submitted; settlement is not yet verified");
        await expect(page.getByLabel("Transaction recovery")).toBeVisible();
        check(true, "Reproduced the owner's exact two warnings with the historical sale and unavailable trace");
        await page.screenshot({ path: path.join(output, `${channel}-${width}-${excessiveMinimum ? "rejected" : "before"}.png`), fullPage: true });
        archiveAvailable = true;
        const previousReads = traceReads;
        await page.getByRole("button", { name: "Check settlement", exact: true }).click();
        await expect.poll(() => traceReads).toBeGreaterThan(previousReads);
        await expect(page.getByRole("button", { name: "Check settlement", exact: true })).toBeEnabled();
        if (excessiveMinimum) {
          await expect(page.getByRole("status")).toContainText("Receipt confirmed; output settlement is still unverified");
          await expect(page.getByLabel("Transaction recovery")).toBeVisible();
          const saved = await page.evaluate(key => { const value = JSON.parse(localStorage.getItem(key)!); return Array.isArray(value) ? value[0] : value.executions[0]; }, journalKey);
          check(saved.state === "submitted" && !saved.outputSettlement, "Even this known hash cannot override an incompatible saved minimum");
          await page.getByText("Recovery support details", { exact: true }).click();
          await page.getByRole("button", { name: "Copy recovery details", exact: true }).click();
          await expect.poll(() => page.evaluate(() => window.__HISTORICAL_COPY__)).toBeTruthy();
          const copied = JSON.parse((await page.evaluate(() => window.__HISTORICAL_COPY__))!);
          check(copied.record.txHash === record.txHash && copied.record.providerNativeFee.protectedOutputAtomic === "137068094859", "Explicit copy preserves the exact saved recovery identity and minimum");
          check(copied.lastRecoveryResult === "trace_failed_saved_record_verification", "Support details distinguish available evidence from a saved-record mismatch");
          check(!JSON.stringify(copied).includes("synthetic-identity-only"), "Recovery diagnostic excludes authentication credentials");
        } else {
          await expect(page.getByLabel("Saved transaction status")).toContainText("Settlement verified: 0.000000137068094858 ETH received.");
          await expect(page.getByLabel("Transaction recovery")).toHaveCount(0);
          const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).executions[0], journalKey);
          check(saved.txHash === record.txHash && saved.state === "confirmed" && saved.outputSettlement.amountAtomic === "137068094858", "Original history is preserved with authoritative exact native output proof");
          await page.reload(); await restoreWallet();
          await expect(page.getByLabel("Saved transaction status")).toContainText("Settlement verified: 0.000000137068094858 ETH received.");
          await expect(page.getByLabel("Transaction recovery")).toHaveCount(0);
          await page.getByRole("button", { name: "Disconnect", exact: true }).click();
          // Explicit disconnect intentionally suppresses unsolicited selection.
          // Reconnect must start with the user's Connect gesture.
          await page.getByRole("button", { name: "Connect wallet", exact: true }).click();
          await restoreWallet();
          await expect(page.getByLabel("Saved transaction status")).toContainText("Settlement verified: 0.000000137068094858 ETH received.");
          await expect(page.getByLabel("Transaction recovery")).toHaveCount(0);
          check(true, "Hard refresh and reconnect cannot restore obsolete submitted status");
          await page.screenshot({ path: path.join(output, `${channel}-${width}-settled.png`), fullPage: true });
        }
        check(await page.evaluate(() => (window.__CANNACAT_FIXTURE_WALLET_REQUESTS__ ?? []).length) === 0, "Historical reconciliation never signs, approves or resends");
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Historical transaction UI has no horizontal overflow");
        check(errors.length === 0, "Historical recovery has no browser runtime errors");
        results.push({ width, excessiveMinimum, result: "PASS", exactPublicTransaction: record.txHash, ownerJournalAuthority: "REPRESENTATIVE_TEST_ONLY" });
        await context.close();
      }
    }
    await writeFile(path.join(output, `${channel}.json`), JSON.stringify({ result: "PASS", channel, checks, traceReads, results,
      nativeIphoneSafariTested: false, liveFundedWallet: false, realSignatures: 0, realTransactions: 0 }, null, 2));
    console.log(JSON.stringify({ result: "PASS", suite: "historical-native-browser", channel, checks, traceReads, realTransactions: 0 }));
  } catch (cause) {
    if (diagnostic && !diagnostic.page.isClosed()) {
      await writeFile(path.join(output, `${channel}-failure.json`), JSON.stringify({ error: String(cause), width: diagnostic.width,
        excessiveMinimum: diagnostic.excessiveMinimum, pageErrors: diagnostic.errors,
        visibleBody: await diagnostic.page.locator("body").innerText().catch(() => "Unavailable") }, null, 2));
      await diagnostic.page.screenshot({ path: path.join(output, `${channel}-failure.png`), fullPage: true }).catch(() => undefined);
    }
    throw cause;
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
