import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, devices } from "playwright";

const site = new URL(process.env.RMT_CURVE_TEST_SITE ?? "http://127.0.0.1:3196");
const rpcUrl = new URL(process.env.RMT_CURVE_TEST_RPC ?? "http://127.0.0.1:8545");
const output = process.env.RMT_CURVE_TEST_OUTPUT ?? ".launch-qa";
for (const url of [site, rpcUrl]) {
  assert.equal(url.protocol, "http:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.ok(url.port && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash);
}
await mkdir(output, { recursive: true });
const allowed = new Set(["eth_chainId", "eth_accounts", "eth_getBlockByNumber", "eth_getTransactionReceipt", "eth_sendTransaction",
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
  await page.getByLabel("Recover wallet request").fill(hashes[0]);
  await button("Check transaction").click();
  await page.getByRole("link", { name: "Open RCV", exact: true }).click();
  await page.getByRole("heading", { name: "Curve Review", exact: true }).waitFor();
  assert.equal(hashes.length, 1);
  await screenshot("02-curve-phone");
  evidence.tokenPage = new URL(page.url()).pathname;
  const token = evidence.tokenPage.split("/").pop();
  const launchResponse = await fetch(new URL(`/api/launchpad/curve?token=${token}`, site));
  assert.equal(launchResponse.status, 200);
  const { state: registered } = await launchResponse.json();
  assert.equal(registered.project.registry, config.curve.projectRegistry);
  assert.equal(registered.project.currentVersion, 1);
  assert.match(registered.project.economicRules, /^0x[0-9a-f]{64}$/);
  assert.equal(registered.project.count, "0");
  assert.deepEqual(registered.project.migrations, []);
  await shown(/project version and migrations/i);
  evidence.registry = registered.project;
  await page.getByRole("checkbox").first().click();
  await page.getByRole("checkbox").waitFor({ state: "detached" });

  await page.getByLabel(/You pay \(ETH\)/i).fill("0.12");
  await button("Review trade").click();
  await button("Confirm buy in wallet").click();
  await shown(/curve settlement verified.*RCV/i);
  await receipt("curveBuy", 1);

  await button("Sell").click();
  await page.getByLabel(/You pay \(RCV\)/i).fill("100");
  await button("Review trade").click();
  await button("Confirm curve allowance").click();
  await shown(/allowance verified/i);
  await receipt("sellApproval", 2);
  await button("Review trade").click();
  await button("Confirm sell in wallet").click();
  await shown(/curve settlement verified.*ETH/i);
  await receipt("curveSell", 3);

  await button("Buy").click();
  await page.getByLabel(/You pay \(ETH\)/i).fill("2");
  await button("Review trade").click();
  await button("Confirm buy in wallet").click();
  await shown(/curve settlement verified.*RCV/i);
  await receipt("thresholdBuy", 4);
  await button("Review graduation").click();
  await button("Confirm graduation in wallet").click();
  await shown(/graduation and permanently locked v4 liquidity verified/i);
  await receipt("graduation", 5);
  await screenshot("03-graduated-phone");

  await button("Review fee claim").click();
  await button("Confirm fee claim in wallet").click();
  await shown(/fee payout|fee claim verified/i);
  await receipt("curveFeeClaim", 6);
  await page.getByRole("heading", { name: "Trade on Uniswap v4" }).waitFor();
  await page.getByLabel(/You pay \(ETH\)/i).fill("0.01");
  await button("Review trade").click();
  await button("Confirm buy in wallet").click();
  await shown(/v4 settlement verified.*RCV/i);
  await receipt("v4Buy", 7);
  await button("Sell").click();
  await page.getByLabel(/You pay \(RCV\)/i).fill("100");
  await button("Review trade").click();
  await button("Confirm token approval").click();
  await shown(/v4 token allowance verified/i);
  await receipt("v4TokenApproval", 8);
  await button("Review trade").click();
  await button("Confirm router approval").click();
  await shown(/v4 router allowance verified/i);
  await receipt("v4RouterApproval", 9);
  await button("Review trade").click();
  await button("Confirm sell in wallet").click();
  await shown(/v4 settlement verified.*ETH/i);
  await receipt("v4Sell", 10);
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
  await receipt("atomicLaunchCreation", 11);
  await page.getByLabel(/You pay \(ETH\)/i).fill("2");
  await button("Review trade").click();
  await button("Confirm buy and graduate in wallet").click();
  await shown(/curve settlement and locked v4 liquidity verified/i);
  await receipt("atomicBuyAndGraduate", 12);
  assert.deepEqual(pageErrors, []);
} finally {
  await writeFile(`${output}/curve-browser-evidence.json`, JSON.stringify({ evidence, pageErrors, observedBroadcasts: hashes }, null, 2));
  await browser.close();
}
