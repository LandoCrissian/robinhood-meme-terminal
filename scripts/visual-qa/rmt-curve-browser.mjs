import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const site = new URL(process.env.RMT_CURVE_TEST_SITE ?? "http://127.0.0.1:3196");
const rpcUrl = new URL(process.env.RMT_CURVE_TEST_RPC ?? "http://127.0.0.1:8545");
const output = process.env.RMT_CURVE_TEST_OUTPUT ?? ".launch-qa";
const compiler = process.env.RMT_CURVE_TEST_SOLC;
const accessFile = process.env.RMT_CURVE_TEST_ACCESS_FILE;
const privatePreview = Boolean(accessFile);
const backing = process.env.RMT_CURVE_TEST_BACKING_WEI ?? "1000000000000000000";
const migrationTool = fileURLToPath(new URL("../../packages/contracts/scripts/validate-curve-graduation-4663.mjs", import.meta.url));
const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
assert.ok(site.port && site.pathname === "/" && !site.username && !site.password && !site.search && !site.hash);
if (privatePreview) {
  assert.equal(site.protocol, "https:");
  assert.match(site.hostname, /^(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/);
  assert.equal(backing, "2000000000000000000");
  assert.ok(compiler);
} else {
  assert.equal(site.protocol, "http:");
  assert.equal(site.hostname, "127.0.0.1");
}
assert.equal(rpcUrl.protocol, "http:");
assert.equal(rpcUrl.hostname, "127.0.0.1");
assert.ok(rpcUrl.port && rpcUrl.pathname === "/" && !rpcUrl.username && !rpcUrl.password && !rpcUrl.search && !rpcUrl.hash);
assert.ok(["1000000000000000000", "2000000000000000000"].includes(backing));
// The private acceptance fixture uses a disposable signing key from a local test file.
// The gateway and operator runner never receive this key.
const signer = privatePreview ? webRequire("viem/accounts").privateKeyToAccount(
  (await readFile(process.env.RMT_CURVE_TEST_SIGNER_FILE, "utf8")).trim()) : undefined;
const fillBudget = backing === "2000000000000000000" ? "3" : "2";
await mkdir(output, { recursive: true });
const allowed = new Set(["eth_chainId", "eth_accounts", "eth_getBlockByNumber", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_sendTransaction",
  "web3_clientVersion", "evm_mine", "evm_setNextBlockTimestamp"]);
async function rpc(method, params = []) {
  assert.ok(allowed.has(method), "Browser fixture RPC method is outside its allowlist.");
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.ok(response.ok);
  const result = await response.json();
  if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.result;
}

assert.equal(await rpc("eth_chainId"), "0x7a69");
assert.match(await rpc("web3_clientVersion"), /^anvil/i);
const accounts = await rpc("eth_accounts");
const account = signer?.address ?? accounts[0];
if (privatePreview) assert.deepEqual(accounts, []);
assert.ok(account);
const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
const wallClock = Math.floor(Date.now() / 1_000);
if (Number(BigInt(latest.timestamp)) < wallClock) await rpc("evm_setNextBlockTimestamp", [wallClock]);
await rpc("evm_mine");
const requestHeaders = { Connection: "close" };
if (privatePreview) {
  const code = (await readFile(accessFile, "utf8")).trim();
  const unlock = await fetch(new URL("/preview-access", site), { method: "POST", redirect: "manual",
    headers: { ...requestHeaders, Origin: site.origin }, body: new URLSearchParams({ code }) });
  assert.equal(unlock.status, 303);
  requestHeaders.Cookie = unlock.headers.get("set-cookie").split(";")[0];
}
const config = await fetch(new URL("/api/launchpad/config", site), { headers: requestHeaders }).then((response) => response.json());
assert.equal(config.status, "ready");
assert.equal(config.deployment.chainId, 31337);
if (privatePreview) {
  const endpoint = new URL(config.deployment.rpcUrl);
  assert.equal(endpoint.origin, site.origin);
  assert.match(endpoint.pathname, /^\/preview-rpc\/[a-f0-9]{64}$/);
} else assert.equal(config.deployment.rpcUrl, rpcUrl.href);
assert.ok(config.curve.graduationEngine);
assert.ok(config.curve.projectRegistry);
assert.equal(config.curve.creationFee.amountWei, "400000000000000");
assert.match(config.curve.creationFee.recipient, /^0x[0-9a-f]{40}$/i);
assert.equal(config.curve.graduationBackingWei, backing);

const browserOptions = { executablePath: process.env.RMT_CURVE_TEST_CHROME };
if (privatePreview) {
  const certificate = new X509Certificate(await readFile(process.env.RMT_CURVE_TEST_TLS_CERT));
  const key = certificate.publicKey.export({ type: "spki", format: "der" });
  const pin = createHash("sha256").update(key).digest("base64");
  browserOptions.args = [`--ignore-certificate-errors-spki-list=${pin}`];
}
const browser = await chromium.launch(browserOptions);
const context = await browser.newContext(devices["iPhone 13"]);
if (privatePreview) {
  const [name, value] = requestHeaders.Cookie.split("=");
  await context.addCookies([{ name, value, url: site.origin, httpOnly: true, secure: true, sameSite: "Strict" }]);
}
const page = await context.newPage();
page.setDefaultTimeout(45_000);
const pageErrors = [];
const hashes = [];
const evidence = {};
async function walletRpc(method, params = []) {
  if (!privatePreview) return rpc(method, params);
  if (method === "eth_getBlockByNumber") return gatewayRpc(method, params);
  assert.equal(method, "eth_sendTransaction");
  const [tx] = params;
  assert.equal(tx.chainId, "0x7a69");
  const [nonce, gasPrice, gas] = (await Promise.all([
    gatewayRpc("eth_getTransactionCount", [account, "pending"]),
    gatewayRpc("eth_gasPrice", []),
    gatewayRpc("eth_estimateGas", [{ from: account, to: tx.to, data: tx.data, value: tx.value }]),
  ])).map(BigInt);
  const raw = await signer.signTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value), gas: gas * 125n / 100n,
    chainId: 31337, nonce: Number(nonce), gasPrice, type: "legacy" });
  return gatewayRpc("eth_sendRawTransaction", [raw]);
}

async function gatewayRpc(method, params) {
  const response = await fetch(config.deployment.rpcUrl, { method: "POST", redirect: "error",
    headers: { "Content-Type": "application/json", Origin: site.origin, Connection: "close" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(15_000) });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(`Preview wallet method ${method} failed (HTTP ${response.status}).`);
  return payload.result;
}

if (privatePreview) {
  assert.equal(await gatewayRpc("eth_chainId", []), "0x7a69");
  for (const method of ["anvil_setBalance", "eth_sendTransaction"]) {
    await assert.rejects(gatewayRpc(method, []), /failed/);
  }
}
page.on("pageerror", (error) => pageErrors.push(error.message));
await page.exposeFunction("curveFixtureRpc", async (method, params) => {
  if (method !== "eth_sendTransaction") {
    assert.equal(method, "eth_getBlockByNumber", "Only a reviewed network read is routed through the injected wallet.");
    return walletRpc(method, params);
  }
  assert.equal(params.length, 1);
  const [tx] = params;
  assert.equal(tx.from.toLowerCase(), account.toLowerCase());
  const hash = await walletRpc(method, params);
  hashes.push(hash);
  return hash;
});
await page.addInitScript(({ account }) => {
  const listeners = new Map();
  let chain = "0x1";
  window.curveFixture = { reject: false, loseHash: false };
  window.ethereum = {
    on(event, callback) { listeners.set(event, callback); },
    removeListener(event) { listeners.delete(event); },
    async request({ method, params }) {
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        if (params?.[0]?.chainId !== "0x7a69") throw new Error("Wrong fixture chain");
        chain = "0x7a69";
        listeners.get("chainChanged")?.(chain);
        return null;
      }
      if (method === "eth_sendTransaction" && window.curveFixture.reject) {
        window.curveFixture.reject = false;
        throw Object.assign(new Error("User rejected"), { code: 4001 });
      }
      const result = await window.curveFixtureRpc(method, params);
      if (method === "eth_sendTransaction" && window.curveFixture.loseHash) {
        window.curveFixture.loseHash = false;
        throw new Error("Wallet returned without its transaction hash");
      }
      return result;
    },
  };
}, { account });

const button = (name) => page.getByRole("button", { name, exact: true });
const shown = (message) => page.getByText(message).first().waitFor();
const settled = (message) => page.locator('[role="status"] strong').filter({ hasText: message }).waitFor();
async function screenshot(name) {
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${name} overflow`);
  await page.screenshot({ path: `${output}/${name}.png` });
}

async function receipt(operation, index) {
  assert.equal(hashes.length, index + 1, operation + " did not broadcast exactly once");
  const tx = await rpc("eth_getTransactionReceipt", [hashes[index]]);
  assert.equal(tx.status, "0x1", operation);
  evidence[operation] = { hash: tx.transactionHash, blockHash: tx.blockHash, blockNumber: tx.blockNumber };
  return tx;
}

try {
  await page.goto(new URL("/create-token", site).href);
  await page.getByLabel("Token name").fill("Curve Review");
  await page.getByLabel("Symbol", { exact: true }).fill("RCV");
  await page.getByRole("button", { name: /Browser wallet/ }).click();
  await page.getByRole("button", { name: /^Switch to (?:Local curve review|Private curve test)/ }).click();
  await button("Review creation").click();
  await shown("0.0004 ETH");
  await shown("$1.00 at $2,500 per ETH");
  await shown("Estimated separately by your wallet");
  await button("Confirm creation in wallet").waitFor();
  await screenshot("01-create-review-phone");
  await page.evaluate(() => { window.curveFixture.reject = true; });
  await button("Confirm creation in wallet").click();
  await shown(/request declined in your wallet/i);
  assert.equal(hashes.length, 0);
  if (!(await button("Confirm creation in wallet").isVisible())) await button("Review creation").click();
  await page.evaluate(() => { window.curveFixture.loseHash = true; });
  await button("Confirm creation in wallet").click();
  await page.getByLabel("Recover wallet request").waitFor();
  const created = await receipt("creation", 0);
  assert.equal(created.from.toLowerCase(), account.toLowerCase());
  const creationTransaction = await rpc("eth_getTransactionByHash", [created.transactionHash]);
  assert.equal(BigInt(creationTransaction.value), BigInt(config.curve.creationFee.amountWei));
  await page.getByLabel("Recover wallet request").fill(hashes[0]);
  await button("Check transaction").click();
  await page.getByRole("link", { name: "Open RCV", exact: true }).click();
  await page.getByRole("heading", { name: "Curve Review", exact: true }).waitFor();
  assert.equal(hashes.length, 1);
  await screenshot("02-curve-phone");
  evidence.tokenPage = new URL(page.url()).pathname;
  const token = evidence.tokenPage.split("/").pop();
  const readLaunch = async () => {
    // A fixture compiler invocation between reads can outlive Next's keep-alive window.
    const url = new URL(`/api/launchpad/curve?token=${token}&account=${account}`, site);
    let response = await fetch(url, { headers: requestHeaders });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after"));
      assert.ok(Number.isInteger(seconds) && seconds > 0 && seconds <= 60, "Expected a bounded curve read retry");
      await response.body?.cancel();
      evidence.rateLimitedReads = (evidence.rateLimitedReads ?? 0) + 1;
      // Retry only this evidence read. The wallet transaction and receipt checks have already run.
      await delay(seconds * 1_000);
      response = await fetch(url, { headers: requestHeaders });
    }
    assert.equal(response.status, 200);
    return response.json();
  };
  const { state: registered, launch: indexedCreation } = await readLaunch();
  assert.deepEqual(indexedCreation.creationFee, { ...config.curve.creationFee, refundWei: "0", logIndex: indexedCreation.creationFee.logIndex });
  assert.ok(Number.isSafeInteger(indexedCreation.creationFee.logIndex));
  evidence.creationFee = indexedCreation.creationFee;
  assert.equal(registered.project.registry, config.curve.projectRegistry);
  assert.equal(registered.project.currentVersion, 1);
  assert.match(registered.project.economicRules, /^0x[0-9a-f]{64}$/);
  assert.equal(registered.project.count, "0");
  assert.equal(registered.project.eligibility, "eligible");
  assert.equal(registered.project.nextVersion, 2);
  assert.deepEqual(registered.project.migrations, []);
  await shown(/project version and migrations/i);
  evidence.registry = registered.project;
  await page.getByRole("checkbox").first().click();
  await page.getByRole("checkbox").waitFor({ state: "detached" });

  await page.getByLabel(/You pay \(ETH\)/i).fill("0.12");
  await button("Review trade").click();
  if (compiler) await page.evaluate(() => { window.curveFixture.loseHash = true; });
  await button("Confirm buy in wallet").click();
  if (compiler) await page.getByLabel("Recover wallet request").waitFor();
  else await settled(/curve settlement verified.*RCV/i);
  await receipt("curveBuy", 1);
  const migrationTradeCount = compiler ? 1 : 0;

  if (compiler) {
    evidence.migrations = [];
    for (const nextVersion of [2, 3]) {
      const before = await readLaunch();
      const mode = privatePreview ? ["--owner-test", "--simulate-creator"] : ["--operator", account];
      const result = execFileSync(process.execPath, [migrationTool, "--rpc", rpcUrl.href, ...mode, "--backing-wei", backing,
        "--solc", compiler, "--factory", config.deployment.factory, "--migrate-token", token, "--creator", account],
      { encoding: "utf8", timeout: 180_000, maxBuffer: 1024 * 1024 });
      const after = await readLaunch();
      assert.deepEqual(after.launch, before.launch);
      assert.notEqual(after.state.activeCurve, before.state.activeCurve);
      assert.equal(after.state.backingReserve, before.state.backingReserve);
      assert.equal(after.state.sold, before.state.sold);
      assert.equal(after.state.claimable, before.state.claimable);
      assert.equal(after.state.project.currentVersion, nextVersion);
      assert.equal(after.state.project.migrations.length, nextVersion - 1);
      assert.equal(after.state.project.migrations[0].previousEngine, before.state.activeCurve);
      assert.equal(after.state.project.migrations[0].nextEngine, after.state.activeCurve);
      assert.equal(after.state.project.migrations.at(-1).previousEngine, before.launch.curve);
      evidence.migrations.push({ fixture: JSON.parse(result), registry: after.state.project });
      await page.getByLabel("Recover wallet request").fill(hashes[nextVersion - 1]);
      await button("Check transaction").click();
      await settled(/curve settlement verified.*RCV/i);
      assert.equal(hashes.length, nextVersion, "Historical curve recovery must never resubmit the trade.");
      await page.getByRole("link", { name: "My Launches", exact: true }).click();
      await page.locator(`a[href="${evidence.tokenPage}"]`).click();
      await page.getByRole("heading", { name: "Curve Review", exact: true }).waitFor();
      await page.getByText("Project version and migrations", { exact: true }).click();
      await page.locator(".lpFacts dd").getByText(`Version ${nextVersion}`, { exact: true }).waitFor();
      await shown(`Version ${nextVersion - 1} to ${nextVersion}`);
      await screenshot(nextVersion === 2 ? "06-migration-phone" : "07-repeated-migration-phone");
      if (nextVersion === 2) {
        assert.equal(after.state.project.nextVersion, 3);
        await page.getByLabel(/You pay \(ETH\)/i).fill("0.01");
        await button("Review trade").click();
        await page.evaluate(() => { window.curveFixture.loseHash = true; });
        await button("Confirm buy in wallet").click();
        await page.getByLabel("Recover wallet request").waitFor();
        const buyOnV2 = await receipt("secondCurveBuy", 2);
        assert.equal(buyOnV2.to.toLowerCase(), after.state.activeCurve.toLowerCase());
      }
    }
  }

  await button("Sell").click();
  await page.getByLabel(/You pay \(RCV\)/i).fill("100");
  await button("Review trade").click();
  await button("Confirm curve allowance").click();
  await settled(/curve allowance verified/i);
  await receipt("sellApproval", 2 + migrationTradeCount);
  await button("Review trade").click();
  await button("Confirm sell in wallet").click();
  await settled(/curve settlement verified.*ETH/i);
  await receipt("curveSell", 3 + migrationTradeCount);
  const feeState = (await readLaunch()).state;
  const grossFees = BigInt(feeState.totalAccrued);
  const platform = grossFees / 10n;
  assert.ok(platform > 0n);
  assert.deepEqual(feeState.bucketAccrued.map(BigInt), [grossFees - platform, 0n, platform / 2n, platform - platform / 2n]);
  evidence.curveFeeBuckets = feeState.bucketAccrued;

  await button("Buy").click();
  await page.getByLabel(/You pay \(ETH\)/i).fill(fillBudget);
  await button("Review trade").click();
  await button("Confirm buy in wallet").click();
  await settled(/curve settlement verified.*RCV/i);
  await receipt("thresholdBuy", 4 + migrationTradeCount);
  const funded = (await readLaunch()).state;
  assert.equal(funded.backingReserve, backing);
  await button("Review graduation").click();
  await button("Confirm graduation in wallet").click();
  await settled(/graduation and permanently locked v4 liquidity verified/i);
  await receipt("graduation", 5 + migrationTradeCount);
  const graduated = (await readLaunch()).state;
  assert.ok(BigInt(graduated.position.amount0) > 0n && BigInt(graduated.position.amount0) <= BigInt(backing));
  assert.ok(BigInt(graduated.position.amount1) > 0n && BigInt(graduated.position.liquidity) > 0n);
  evidence.graduationFunding = {
    backingWei: funded.backingReserve,
    nativeDepositedWei: graduated.position.amount0,
    tokensDeposited: graduated.position.amount1,
    positionOwner: graduated.positionOwner,
    positionTokenId: graduated.position.positionTokenId,
    liquidity: graduated.position.liquidity,
    poolKey: graduated.position.poolKey,
    poolId: graduated.position.poolId,
  };
  await screenshot("03-graduated-phone");

  await button("Review fee claim").click();
  await button("Confirm fee claim in wallet").click();
  await settled(/fee payout|fee claim verified/i);
  await receipt("curveFeeClaim", 6 + migrationTradeCount);
  await page.getByRole("heading", { name: "Trade on Uniswap v4" }).waitFor();
  await page.getByLabel(/You pay \(ETH\)/i).fill("0.01");
  await button("Review trade").click();
  await button("Confirm buy in wallet").click();
  await settled(/v4 settlement verified.*RCV/i);
  await receipt("v4Buy", 7 + migrationTradeCount);
  await button("Sell").click();
  await page.getByLabel(/You pay \(RCV\)/i).fill("100");
  await button("Review trade").click();
  await button("Confirm token approval").click();
  await settled(/v4 token allowance verified/i);
  await receipt("v4TokenApproval", 8 + migrationTradeCount);
  await button("Review trade").click();
  await button("Confirm router approval").click();
  await settled(/v4 router allowance verified/i);
  await receipt("v4RouterApproval", 9 + migrationTradeCount);
  await button("Review trade").click();
  await button("Confirm sell in wallet").click();
  await settled(/v4 settlement verified.*ETH/i);
  await receipt("v4Sell", 10 + migrationTradeCount);
  const earned = await readLaunch();
  assert.ok(BigInt(earned.state.lpFees.uncollected.native) > 0n && BigInt(earned.state.lpFees.uncollected.token) > 0n);
  await button("Review LP fee collection").click();
  await button("Confirm LP fee collection in wallet").click();
  await settled(/LP fee collection verified/i);
  const collection = await receipt("lpCollection", 11 + migrationTradeCount);
  const collected = await readLaunch();
  assert.equal(collected.state.lpFees.latestCollection.transactionHash, collection.transactionHash);
  assert.ok(BigInt(collected.state.lpFees.claimable.native) > 0n && BigInt(collected.state.lpFees.claimable.token) > 0n);
  await button("Review LP fee claim").click();
  await button("Confirm LP fee claim in wallet").click();
  await settled(/LP fee payout verified/i);
  await receipt("lpFeeClaim", 12 + migrationTradeCount);
  const paid = await readLaunch();
  assert.deepEqual(paid.state.lpFees.claimable, { native: "0", token: "0" });
  assert.equal(paid.state.positionOwner, earned.state.positionOwner);
  assert.equal(paid.state.position.liquidity, earned.state.position.liquidity);
  await page.setViewportSize({ width: 844, height: 390 });
  await screenshot("04-graduated-landscape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await screenshot("05-graduated-desktop");
  await page.getByRole("link", { name: "My Launches", exact: true }).click();
  await page.locator(`a[href="${evidence.tokenPage}"]`).waitFor();
  await page.getByRole("navigation", { name: "Launchpad navigation" }).getByRole("link", { name: "Create Token", exact: true }).click();
  await page.getByLabel("Token name").fill("Atomic Review");
  await page.getByLabel("Symbol", { exact: true }).fill("RATOM");
  await button("Review creation").click();
  await button("Confirm creation in wallet").click();
  await page.getByRole("link", { name: "Open RATOM", exact: true }).click();
  await receipt("atomicLaunchCreation", 13 + migrationTradeCount);
  await page.getByLabel(/You pay \(ETH\)/i).fill(fillBudget);
  await button("Review trade").click();
  await button("Confirm buy and graduate in wallet").click();
  await settled(/curve settlement and locked v4 liquidity verified/i);
  await receipt("atomicBuyAndGraduate", 14 + migrationTradeCount);
  assert.deepEqual(pageErrors, []);
} catch (error) {
  evidence.browserFailure = { path: new URL(page.url()).pathname,
    alerts: await page.getByRole("alert").allTextContents(),
    statuses: await page.getByRole("status").allTextContents() };
  throw error;
} finally {
  await writeFile(`${output}/curve-browser-evidence.json`, JSON.stringify({ evidence, pageErrors, observedBroadcasts: hashes }, null, 2));
  await browser.close();
}
