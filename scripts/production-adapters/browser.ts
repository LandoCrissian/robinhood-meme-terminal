import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium, webkit, devices } from "playwright";
import { type Address } from "viem";
import { owners } from "../../apps/launch-website/lib/server/claim-profile-test-fixture";
import { productionClaimFixture, syntheticClaimApproval } from "../../apps/launch-website/lib/server/production-earnings-test-fixture";
import { productionTradingFixture } from "../../apps/launch-website/lib/server/production-trading-test-fixture";
import { readEarningsContracts } from "../../apps/launch-website/lib/server/earnings-contracts";
import { handleProductionEarningsClaim } from "../../apps/launch-website/lib/server/production-earnings";
import { handleProductionLifecycle } from "../../apps/launch-website/lib/server/production-lifecycle";
import { parseProductionDiscovery } from "../../apps/launch-website/lib/server/production-discovery";
import type { ClaimExecutionReview } from "../../apps/launch-website/lib/claim-profiles";

const args = process.argv.slice(2), option = (name: string, fallback?: string) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
const engine = option("--browser", "chromium"), viewport = option("--viewport", "mobile"), output = option("--output");
assert.ok(engine === "chromium" || engine === "webkit"); assert.ok(viewport === "desktop" || viewport === "mobile"); assert.ok(output, "A fresh output directory is required");
const feeMode = option("--fee-mode", "positive"); assert.ok(feeMode === "positive" || feeMode === "zero-poster");
const root = resolve(process.cwd(), "../.."), out = resolve(output);
const origin = "https://www.rmtlaunch.fun";
const stringify = (value: unknown) => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
const cssFiles = ["styles/styles.css", "styles/mobile-polish.css", "styles/desktop-polish.css", "styles/launch-theme.css", "styles/token-detail.css",
  "launchpad.css", "profile-refinement.css", "creator-polish.css", "earnings.css"].map(file => "apps/launch-website/app/" + file);
const sourceFiles = ["scripts/production-adapters/browser.ts", "scripts/production-adapters/browser-entry.tsx",
  "apps/launch-website/app/_components/production-lifecycle-wallet.tsx", "apps/launch-website/app/_components/earnings-profile-wallet.tsx",
  "apps/launch-website/app/_components/production-creation-wallet.tsx",
  "apps/launch-website/lib/server/production-earnings.ts", "apps/launch-website/lib/server/production-lifecycle.ts",
  "apps/launch-website/lib/server/production-financial.ts", "apps/launch-website/lib/claim-recovery.ts", "apps/launch-website/lib/production-trading-wallet.ts",
  "apps/launch-website/lib/production-creation.ts", "apps/launch-website/lib/production-wallet.ts", "apps/launch-website/lib/claim-profiles.ts",
  "apps/launch-website/lib/production-nonce.ts", "apps/launch-website/lib/production-nonce-store.ts", "apps/launch-website/lib/production-lifecycle.ts", "apps/launch-website/lib/production-claims.ts", "apps/launch-website/lib/earnings-claims.ts",
  "apps/launch-website/lib/server/earnings-contracts.ts", "apps/launch-website/lib/server/claim-profiles.ts", "apps/launch-website/lib/server/earnings-claims.ts",
  "apps/launch-website/lib/server/production-birth.ts", "apps/launch-website/lib/server/production-project-birth.ts", "apps/launch-website/lib/server/production-project-templates.json",
  "apps/launch-website/lib/server/nitro-zero-poster.ts",
  "apps/launch-website/lib/server/production-claims-settlement.ts", "apps/launch-website/lib/server/curve-production.ts", "apps/launch-website/lib/server/production-discovery.ts",
  "apps/launch-website/lib/server/production-earnings-test-fixture.ts", "apps/launch-website/lib/server/production-trading-test-fixture.ts",
  "apps/launch-website/lib/server/earnings-test-fixture.ts", "apps/launch-website/lib/server/claim-profile-test-fixture.ts",
  "apps/launch-website/lib/server/earnings-production-runtime.test.json.gz", "apps/launch-website/lib/server/claim-delegate-runtime.test.json.gz",
  "packages/contracts/test/fixtures/task090-canonical-v4-runtime.json", "docs/evidence/mobile-signing/safe-runtime-4663.json.gz", ...cssFiles];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash("sha256").update(await readFile(join(root, path))).digest("hex")])));
const evidence: any = { schemaVersion: 1, profile: "rmt-task092-production-adapter-browser-v1", chainId: 4663,
  scope: "ISOLATED_SYNTHETIC_STATE_AND_WALLET_NOT_HOSTED_PRODUCTION_OR_PHYSICAL_DEVICE", browser: engine, viewport,
  feeMode,
  status: "incomplete", commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  source: {}, cases: [], externalRequests: [], pageErrors: [] };

async function main() {
  await mkdir(out, { recursive: true }); assert.equal((await readdir(out)).length, 0, "Refusing to overwrite previous browser evidence");
  evidence.source = await sourceHashes();
  const require = createRequire(join(root, "apps/launch-website/node_modules/tsx/package.json"));
  const { build } = require("esbuild");
  const bundled = await build({ absWorkingDir: root, entryPoints: ["scripts/production-adapters/browser-entry.tsx"], bundle: true, write: false,
    platform: "browser", format: "iife", jsx: "automatic", nodePaths: [join(root, "apps/launch-website/node_modules")],
    define: { "process.env.NODE_ENV": '"production"' }, banner: { js: 'var process={env:{NODE_ENV:"production"},platform:"browser",browser:true};' },
    tsconfig: "apps/launch-website/tsconfig.test.json" });
  const script = bundled.outputFiles[0].text;
  const css = (await Promise.all(cssFiles.map(file => readFile(join(root, file), "utf8")))).join("\n")
    + "\n.task092Harness{max-width:1100px;margin:24px auto;padding:20px}.task092Harness>section{margin-block:20px}";
  const browser = await (engine === "chromium" ? chromium : webkit).launch({ headless: true });
  try {
    for (const mode of ["disabled", "trading", "eoa", "metamask-7702", "safe-1.4.1"] as const) {
      const claims = productionClaimFixture(mode === "safe-1.4.1" || mode === "metamask-7702" ? mode : "eoa", false), trade = productionTradingFixture();
      if (feeMode === "zero-poster") { claims.knobs.poster = 0n; claims.knobs.l1Base = 0n; claims.knobs.nativeL2Base = 3n;
        trade.knobs.zeroPoster = true; trade.knobs.zeroNativeDifferent = true; }
      const snap = await readEarningsContracts(claims.contexts()[0].context, claims.registration, claims.f.creator); assert.equal(snap.status, "ready");
      const record: any = { mode, status: "incomplete", walletMethods: [], requests: [], sends: [], reviews: [], checks: {}, screenshots: [] };
      evidence.cases.push(record); let enabled = mode !== "disabled", decision = "normal", currentReview: ClaimExecutionReview | undefined, tradeReview: any;
      const context = await browser.newContext(viewport === "mobile" ? { ...devices["iPhone 13"], browserName: undefined } as any : { viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(); page.setDefaultTimeout(30_000);
      page.on("pageerror", error => evidence.pageErrors.push({ mode, message: error.message }));
      const props = { mode: mode === "disabled" ? "disabled" : mode === "trading" ? "trading" : "claims", token: claims.f.token, curve: claims.f.origin,
        factory: claims.contexts()[0].context.factory, beneficiary: claims.f.creator, snapshot: snap };
      await context.exposeBinding("__task092Wallet", async (source, method: string, params: unknown[] = []) => {
        record.walletMethods.push(method);
        const f = mode === "trading" ? trade.p : claims, rpc = mode === "trading" ? trade.rpc : claims.rpc;
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [mode === "trading" ? trade.p.f.creator : claims.f.input.account];
        if (method === "eth_chainId") return "0x1237";
        if (method === "eth_getCode") return await rpc.getCode({ address: params[0] as Address, blockTag: params[1] as any }) ?? "0x";
        if (method === "eth_getTransactionCount") return "0x" + (await rpc.getTransactionCount({ address: params[0] as Address, blockTag: params[1] as any })).toString(16);
        if (method === "eth_getBlockByNumber") { const number = params[0] === "latest" ? undefined : BigInt(params[0] as string);
          const block = await rpc.getBlock(number === undefined ? { blockTag: "latest" } : { blockNumber: number });
          return { number: "0x" + block.number.toString(16), hash: block.hash, timestamp: "0x" + block.timestamp.toString(16),
            ...(block.baseFeePerGas !== null && block.baseFeePerGas !== undefined && { baseFeePerGas: "0x" + block.baseFeePerGas.toString(16) }) }; }
        if (method === "eth_getBalance") return "0x" + (await rpc.getBalance({ address: params[0] as Address })).toString(16);
        if (method === "eth_gasPrice") return "0x2";
        if (method === "eth_estimateGas") return "0xc350";
        if (method === "eth_call") return "0x";
        assert.equal(method, "eth_sendTransaction", "The browser wallet has no signing, broadcasting, account creation or generic RPC capability");
        const envelope = params[0] as any;
        const journal = await source.page.evaluate(() => Object.entries(localStorage).filter(([key]) => /claim\.execution|production:trade/.test(key)).map(([key, value]) => ({ key, value: JSON.parse(value) })));
        assert.ok(journal.some(row => mode === "trading" ? row.value.request?.operation === tradeReview.request.operation && row.value.request?.data === tradeReview.request.data : row.value.stage === "awaiting-wallet"), "Intent was durably stored before wallet confirmation");
        if (mode === "trading") {
          const r = tradeReview.request, q = tradeReview.quote;
          assert.deepEqual(envelope, { from: r.from, to: r.to, data: r.data, value: r.value, nonce: r.nonce, chainId: r.chainId, type: "0x2",
            gas: "0x" + BigInt(q.gasUnits).toString(16), maxFeePerGas: "0x" + BigInt(q.gasPriceWei).toString(16), maxPriorityFeePerGas: "0x" + BigInt(q.maxPriorityFeePerGasWei).toString(16) });
        } else { assert.ok(currentReview?.outer); assert.deepEqual(envelope, currentReview.outer); }
        record.sends.push({ decision, envelope, durable: true });
        if (decision === "reject") return { fixtureDecision: "reject" };
        if (mode === "trading") { trade.knobs.mined = true; trade.knobs.request = tradeReview.request; trade.knobs.missingIndex = decision === "lose"; trade.knobs.peerOffline = decision === "lose"; }
        else { claims.knobs.review = currentReview!; claims.f.baseState.request = currentReview!.inner; claims.f.baseState.head = 32n;
          claims.f.baseState.mined = true; claims.f.baseState.afterClaim = true; claims.f.state.payerNonce = 1; claims.f.state.receiptNonce = 1;
          claims.f.baseState.receiptNative = 75n; claims.f.baseState.receiptToken = 0n; claims.knobs.offline = decision === "lose"; }
        return decision === "lose" ? null : f.f.txHash;
      });
      await context.addInitScript(() => {
        const w = window as any, listeners = new Map<string, Set<(...args: unknown[]) => void>>(); let chain = "0x1237";
        w.__task092Controls = { chain(value: string) { chain = value; for (const listener of listeners.get("chainChanged") ?? []) listener(value); } };
        w.ethereum = { on(event: string, listener: (...args: unknown[]) => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener); },
          removeListener(event: string, listener: (...args: unknown[]) => void) { listeners.get(event)?.delete(listener); },
          async request(input: { method: string; params?: unknown[] }) {
            if (input.method === "eth_chainId" && chain !== "0x1237") return chain;
            const result = await w.__task092Wallet(input.method, input.params ?? []);
            if (result?.fixtureDecision === "reject") { const error = new Error("Explicit synthetic wallet rejection") as Error & { code: number }; error.code = 4001; throw error; }
            return result;
          } };
      });
      await context.route("**/*", async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin !== origin) { evidence.externalRequests.push(req.url()); return route.abort(); }
        if (url.pathname === "/__task092" && req.method() === "GET") return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/__task092.css"></head><body><div id="root"></div><script>window.__task092=${JSON.stringify(props).replace(/</g, "\\u003c")}</script><script src="/__task092.js"></script></body></html>` });
        if (url.pathname === "/__task092.js") return route.fulfill({ contentType: "text/javascript", body: script });
        if (url.pathname === "/__task092.css") return route.fulfill({ contentType: "text/css", body: css });
        if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
        if (url.pathname === "/api/launchpad/config") return route.fulfill({ json: enabled ? { status: "production-financial", chainId: 4663, trading: "enabled", claims: "enabled",
          approvals: { trading: syntheticClaimApproval, claims: syntheticClaimApproval } } : { status: "production-read-only", chainId: 4663, trading: "disabled", claims: "disabled" } });
        if (req.method() === "POST" && ["/api/launchpad/production-earnings", "/api/launchpad/production-lifecycle"].includes(url.pathname)) {
          const body = req.postDataJSON(), request = new Request(req.url(), { method: "POST", headers: { "content-type": "application/json", host: "www.rmtlaunch.fun", origin }, body: req.postData()! });
          let response: Response;
          if (url.pathname.endsWith("production-earnings")) response = await handleProductionEarningsClaim(request, enabled ? claims.options : { env: {} });
          else response = await handleProductionLifecycle(request, enabled ? { configured: (() => ({ scope: "trading", approvalBinding: syntheticClaimApproval, release: {} })) as any,
            resolve: (async () => ({ ...trade.context(), scope: "trading", release: {} })) as any,
            discovery: (async token => parseProductionDiscovery(trade.directory(), token)) as any, activity: trade.activity } : {});
          const data = await response.json(); record.requests.push({ path: url.pathname, action: body.action, status: response.status, result: data.status ?? data.stage });
          if (data.review) { currentReview = data.review;
            if (data.status === "prepared" && feeMode === "zero-poster") assert.equal(data.review.fees.status, "verified-nitro-zero-poster");
            if (data.status === "prepared" || data.status === "awaiting-safe-approvals") record.reviews.push(data.review); }
          if (data.request) { tradeReview = data; if (feeMode === "zero-poster") assert.equal(data.quote.feeEvidence, "verified-nitro-zero-poster"); trade.knobs.request = data.request; record.reviews.push(data); }
          return route.fulfill({ status: response.status, contentType: "application/json", body: stringify(data) });
        }
        evidence.externalRequests.push(req.url()); return route.abort();
      });
      const button = (name: string) => page.getByRole("button", { name, exact: true });
      try {
        await page.goto(origin + "/__task092");
        if (mode === "disabled") {
          await button("Connect trading wallet").click(); await page.getByRole("alert").waitFor();
          await button("Connect claim wallet").click(); await page.getByText("This financial capability is not activated", { exact: true }).last().waitFor();
          assert.equal(record.walletMethods.length, 0); record.checks.disabledWithoutWalletPrompt = true;
          const statuses = await page.evaluate(async () => Promise.all(["production-earnings", "production-lifecycle"].map(async path => (await fetch("/api/launchpad/" + path,
            { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status)));
          assert.deepEqual(statuses, [404, 404]);
          const accountA = claims.f.creator, accountB = "0x00000000000000000000000000000000000186a7";
          const second = await context.newPage(); second.on("pageerror", error => evidence.pageErrors.push({ mode, message: error.message }));
          await second.goto(origin + "/__task092");
          await page.evaluate(account => { const w = window as any, h = w.__task092Nonce;
            w.__task092FloorHold = navigator.locks.request(h.lockKey(account), async () => {
              w.__task092FloorEntered = true; await new Promise<void>(resolve => { w.__task092FloorRelease = resolve; });
              await h.record(localStorage, account, "0", "0x" + "1".repeat(64));
            });
          }, accountA);
          await page.waitForFunction(() => (window as any).__task092FloorEntered === true);
          const blocked = await second.evaluate(account => { const h = (window as any).__task092Nonce;
            return navigator.locks.request(h.lockKey(account), { ifAvailable: true }, lock => !!lock);
          }, accountB);
          assert.equal(blocked, false, "Different accounts serialize the shared consumed-nonce map");
          await page.evaluate(async () => { const w = window as any; w.__task092FloorRelease(); await w.__task092FloorHold; });
          const floors = await second.evaluate(async account => { const h = (window as any).__task092Nonce;
            await navigator.locks.request(h.lockKey(account), { ifAvailable: true }, async lock => {
              if (!lock) throw Error("Released storage lock remained unavailable"); await h.record(localStorage, account, "0", "0x" + "2".repeat(64));
            }); return JSON.parse(localStorage.getItem(h.key)!).floors;
          }, accountB);
          assert.equal(floors.length, 2); assert.deepEqual(floors.map((floor: any) => floor.account).sort(), [accountA.toLowerCase(), accountB].sort());
          // Reproduce a stale localStorage replica deterministically after both
          // receipts were persisted. A third write must recover both floors.
          const repaired = await second.evaluate(async account => {
            const h = (window as any).__task092Nonce;
            localStorage.setItem(h.key, JSON.stringify({schemaVersion: 1, floors: []}));
            await h.record(localStorage, account, "1", "0x" + "3".repeat(64));
            return JSON.parse(localStorage.getItem(h.key)!).floors;
          }, accountB);
          assert.deepEqual(repaired.map((r: any) => [r.account,r.nonce]).sort(), [[accountA.toLowerCase(),"0x0"],[accountB,"0x1"]].sort());
          record.checks.staleNonceReplicaRestored = true;
          record.checks.nativeCrossAccountStorageLock = true; record.consumedNonceFloors = floors; await second.close();
        } else if (mode === "trading") {
          await button("Connect trading wallet").click(); await page.getByText(/Connected account/).waitFor();
          await page.getByLabel(/^Trade amount/).fill("2"); await page.getByText(/^Estimated output .* at block /).waitFor(); await button("Review buy").click(); await button("Confirm buy").waitFor();
          assert.equal(record.sends.length, 0); assert.equal(tradeReview.quote.feeWei, "20000000000000000"); record.checks.twoEthGross = true;
          await page.getByLabel(/^Trade amount/).fill("4"); await button("Confirm buy").waitFor({ state: "hidden" }); record.checks.editInvalidates = true;
          await button("Review final buy and v4 graduation").click(); await button("Confirm final buy and v4 graduation").waitFor(); assert.equal(tradeReview.request.operation,"buy-graduate"); assert.ok(BigInt(tradeReview.quote.refundWei) > 10n ** 18n); record.checks.fourEthRefundTwoEthTarget = true;
          decision = "reject"; await button("Confirm final buy and v4 graduation").click(); await page.getByRole("alert").waitFor(); assert.equal(record.sends.length, 1);
          decision = "lose"; await button("Review final buy and v4 graduation").click(); await button("Confirm final buy and v4 graduation").click(); await page.getByText("Wallet hash missing · original payer and nonce retained", { exact: true }).waitFor();
          assert.equal(record.sends.length, 2); trade.knobs.missingIndex = false; trade.knobs.peerOffline = false;
          await page.reload(); await button("Connect trading wallet").click(); await button("Check original transaction").waitFor();
          await button("Check original transaction").click(); await page.getByText("Canonical L2 receipt and indexed activity verified. Ethereum L1 finality remains unverified.", { exact: true }).waitFor();
          assert.equal(record.sends.length, 2); record.checks.explicitRejectThenLostHashRecoveryNoResend = true;
        } else {
          await button("Connect claim wallet").click(); await button("Review claim wallet profile").click();
          if (mode === "safe-1.4.1") {
            await page.getByLabel("Safe owner approvals", { exact: true }).waitFor(); assert.ok(currentReview?.wallet.safe);
            const signed = await Promise.all(owners.slice(0, 2).map(async owner => ({ address: owner.address, signature: await owner.sign({ hash: currentReview!.wallet.safe!.transactionHash }) })));
            await page.getByLabel("Safe owner approvals", { exact: true }).fill("0x" + signed.sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map(item => item.signature.slice(2)).join(""));
            await button("Validate Safe approvals").click(); record.checks.genuineTwoOfThreeCall = true;
          }
          await button("Confirm claim transaction").waitFor(); assert.equal(record.sends.length, 0); record.checks.previewBeforeSend = true;
          if (mode === "eoa") {
            await page.evaluate(() => (window as any).__task092Controls.chain("0x1")); await button("Confirm claim transaction").waitFor({ state: "hidden" });
            assert.equal(record.sends.length, 0); await page.evaluate(() => (window as any).__task092Controls.chain("0x1237"));
            await button("Connect claim wallet").click(); await button("Review claim wallet profile").click(); await button("Confirm claim transaction").waitFor(); record.checks.chainChangeInvalidates = true;
          }
          decision = "reject"; await button("Confirm claim transaction").click(); await page.getByText(/Wallet request rejected/).last().waitFor();
          assert.equal(record.sends.length, 1); decision = "lose"; await button("Confirm claim transaction").click();
          await page.waitForFunction(() => Object.entries(localStorage).some(([key, raw]) => key.startsWith("rmt.claim.execution.v1:4663:") && JSON.parse(raw).stage === "hash-missing"));
          await page.getByText("Claim profile evidence is unavailable.", { exact: true }).waitFor();
          assert.equal(record.sends.length, 2); await page.reload(); claims.knobs.offline = false; await button("Recover profiled claim receipt").waitFor();
          await button("Recover profiled claim receipt").click();
          await page.waitForFunction(() => Object.entries(localStorage).some(([key, raw]) => key.startsWith("rmt.claim.execution.v1:4663:") && JSON.parse(raw).stage === "canonical-l2"));
          assert.equal(record.sends.length, 2); record.checks.rejectionLostHashReloadCanonicalL2NoResend = true;
        }
        const image = `${mode}-${engine}-${viewport}.png`; await page.screenshot({ path: join(out, image), fullPage: true }); record.screenshots.push(image);
        const layout = await page.evaluate(() => ({ width: window.innerWidth, document: document.documentElement.scrollWidth }));
        assert.ok(layout.document <= layout.width + 2, "Core adapter content fits the selected viewport"); record.layout = layout; record.status = "passed";
      } catch (error) {
        record.error = error instanceof Error ? error.stack : String(error);
        await page.screenshot({ path: join(out, `${mode}-failed.png`), fullPage: true }).catch(() => undefined);
        await writeFile(join(out, `${mode}-failed.html`), await page.content()); throw error;
      } finally { await context.close(); }
    }
    assert.deepEqual(evidence.externalRequests, []); assert.deepEqual(evidence.pageErrors, []); assert.deepEqual(await sourceHashes(), evidence.source, "Sources changed during browser rehearsal");
    evidence.status = "passed";
  } finally { await browser.close(); await writeFile(join(out, "production-adapter-browser.json"), stringify(evidence)); }
}
main().then(() => console.log(`${engine}/${viewport}: production adapter browser checks passed`)).catch(async error => {
  evidence.error = error instanceof Error ? error.stack : String(error); await mkdir(out, { recursive: true });
  await writeFile(join(out, "production-adapter-browser.json"), stringify(evidence)); console.error(evidence.error); process.exitCode = 1;
});
