import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, devices } from "playwright";

const site = new URL(process.env.RMT_CURVE_TEST_SITE ?? "http://127.0.0.1:3196");
const rpcUrl = new URL(process.env.RMT_CURVE_TEST_RPC ?? "http://127.0.0.1:8545");
const output = process.env.RMT_CURVE_TEST_OUTPUT ?? ".launch-qa";
const compiler = process.env.RMT_CURVE_TEST_SOLC;
const migrationTool = fileURLToPath(new URL("../../packages/contracts/scripts/validate-curve-graduation-4663.mjs", import.meta.url));
for (const url of [site, rpcUrl]) {
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash);
}
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
const [account] = accounts;
assert.ok(account);
const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
const wallClock = Math.floor(Date.now() / 1_000);
if (Number(BigInt(latest.timestamp)) < wallClock) await rpc("evm_setNextBlockTimestamp", [wallClock]);
await rpc("evm_mine");
const config = await fetch(new URL("/api/launchpad/config", site)).then((response) => response.json());
assert.equal(config.status, "ready");
assert.equal(config.deployment.chainId, 31337);
assert.equal(config.deployment.rpcUrl, rpcUrl.href);
assert.ok(config.curve.graduationEngine);
assert.ok(config.curve.projectRegistry);
assert.equal(config.curve.creationFee.amountWei, "400000000000000");
assert.match(config.curve.creationFee.recipient, /^0x[0-9a-f]{40}$/i);

const browser = await chromium.launch({ executablePath: process.env.RMT_CURVE_TEST_CHROME });
const context = await browser.newContext(devices["iPhone 13"]);
const page = await context.newPage();
page.setDefaultTimeout(45_000);
const pageErrors = [];
const hashes = [];
const evidence = {};
page.on("pageerror", (error) => pageErrors.push(error.message));
await page.exposeFunction("curveFixtureRpc", async (method, params) => {
  if (method !== "eth_sendTransaction") {
    assert.equal(method, "eth_getBlockByNumber", "Only a reviewed network read is routed through the injected wallet.");
    return rpc(method, params);
  }
  assert.equal(params.length, 1);
  const [tx] = params;
  assert.equal(tx.from.toLowerCase(), account.toLowerCase());
  const hash = await rpc(method, params);
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
  await page.getByRole("button", { name: /^Switch to Local curve review/ }).click();
  await button("Review creation").click();
  await shown("0.0004 ETH");
  await shown("$1.00 at $2,500 per ETH");
  await shown("Estimated separately by your wallet");
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
    const response = await fetch(new URL(`/api/launchpad/curve?token=${token}&account=${account}`, site));
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
      const result = execFileSync(process.execPath, [migrationTool, "--rpc", rpcUrl.href, "--operator", account,
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

  await button("Buy").click();
  await page.getByLabel(/You pay \(ETH\)/i).fill("2");
  await button("Review trade").click();
  await button("Confirm buy in wallet").click();
  await settled(/curve settlement verified.*RCV/i);
  await receipt("thresholdBuy", 4 + migrationTradeCount);
  await button("Review graduation").click();
  await button("Confirm graduation in wallet").click();
  await settled(/graduation and permanently locked v4 liquidity verified/i);
  await receipt("graduation", 5 + migrationTradeCount);
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
  await page.getByLabel(/You pay \(ETH\)/i).fill("2");
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
