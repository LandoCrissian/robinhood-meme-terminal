import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium, devices } from "playwright";

const site = process.env.RMT_LAUNCHPAD_TEST_URL ?? "http://127.0.0.1:3196";
const rpcUrl = process.env.RMT_LAUNCHPAD_TEST_RPC_URL ?? "http://127.0.0.1:8545";
const output = process.env.RMT_LAUNCHPAD_TEST_OUTPUT ?? ".launch-qa";
const executablePath = process.env.RMT_LAUNCHPAD_TEST_CHROME;
const privatePreview = process.env.RMT_LAUNCHPAD_TEST_PRIVATE_PREVIEW === "true";
const networkName = privatePreview ? "Private preview · Chain 31337" : "Local Anvil · Base Sepolia fork";
for (const input of [site, rpcUrl]) assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(input).hostname));
await mkdir(output, { recursive: true });
async function rpc(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result = await response.json();
  assert.ok(!result.error, result.error?.message);
  return result.result;
}
assert.equal(await rpc("eth_chainId"), "0x7a69");
let fixtureWallet;
if (privatePreview) {
  assert.equal(new URL(site).protocol, "https:");
  assert.equal(new URL(site).origin, new URL(rpcUrl).origin);
  const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const { createWalletClient, defineChain, http } = requireWeb("viem");
  const { privateKeyToAccount } = requireWeb("viem/accounts");
  const account = privateKeyToAccount(process.env.RMT_LAUNCHPAD_TEST_FIXTURE_KEY);
  fixtureWallet = createWalletClient({
    account,
    chain: defineChain({ id: 31337, name: "Private preview",
      nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } }),
    transport: http(rpcUrl, { retryCount: 0 }),
  });
}
const account = fixtureWallet?.account.address ?? (await rpc("eth_accounts"))[0];
const browser = await chromium.launch({ executablePath });
const base = devices["iPhone 13"];
const context = await browser.newContext({ ...base, ignoreHTTPSErrors: privatePreview });
const page = await context.newPage();
page.setDefaultTimeout(35_000);
const failures = [];
page.on("pageerror", (error) => failures.push(error.message));
const broadcasts = [];
const hashes = [];
await page.exposeFunction("rmtLocalRpc", async (method, params) => {
  if (method === "eth_sendTransaction") broadcasts.push(params[0]);
  const result = fixtureWallet && method === "eth_sendTransaction"
    ? await fixtureWallet.sendTransaction({ to: params[0].to, data: params[0].data, value: BigInt(params[0].value ?? "0x0") })
    : await rpc(method, params);
  if (method === "eth_sendTransaction") hashes.push(result);
  return result;
});
await page.addInitScript(({ account }) => {
  const listeners = new Map();
  window.rmtFixture = { rejectNext: false, dropNextHash: false };
  let chain = "0x1";
  window.ethereum = {
    on(event, callback) { listeners.set(event, callback); },
    removeListener(event, callback) { if (listeners.get(event) === callback) listeners.delete(event); },
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        chain = "0x7a69";
        listeners.get("chainChanged")?.(chain);
        return null;
      }
      if (method === "eth_sendTransaction" && window.rmtFixture.rejectNext) {
        window.rmtFixture.rejectNext = false;
        throw Object.assign(new Error("User rejected"), { code: 4001 });
      }
      const response = await window.rmtLocalRpc(method, params);
      if (method === "eth_sendTransaction" && window.rmtFixture.dropNextHash) {
        window.rmtFixture.dropNextHash = false;
        throw new Error("Wallet returned without its transaction hash");
      }
      return response;
    },
  };
}, { account });

async function noOverflow(target) {
  assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Viewport has horizontal overflow");
}
const capture = (target, name) => target.screenshot({ path: `${output}/${name}.png`, style: "nextjs-portal { display: none; }" });
const submit = (name) => page.getByRole("button", { name, exact: true }).click();

try {
  assert.equal((await page.goto(site, { timeout: 180_000, waitUntil: "domcontentloaded" })).status(), 200);
  if (privatePreview) {
    assert.equal(new URL(page.url()).pathname, "/preview-access");
    await page.getByLabel("Preview access code").fill(process.env.RMT_LAUNCHPAD_TEST_ACCESS_CODE);
    await submit("Open preview");
  }
  await page.getByRole("heading", { name: "Launches", exact: true }).waitFor();
  await noOverflow(page);
  await page.getByText(networkName, { exact: true }).waitFor();
  await capture(page, "launches-phone");
  for (const path of ["/nft", "/projects", "/profile", "/api/vnext/chain-pulse", "/api/nft/mint-preflight"]) {
    assert.equal((await context.request.get(site + path)).status(), privatePreview ? 404 : 410, path);
  }
  await page.getByRole("navigation", { name: "Launchpad navigation" }).getByRole("link", { name: "Create Token" }).click();
  await page.getByLabel("Token name").fill("Fork Proof");
  const symbol = `F${Date.now().toString(36).toUpperCase()}`;
  await page.getByLabel("Symbol", { exact: true }).fill(symbol);
  await page.getByLabel("Project link").fill("https://example.com");
  await page.reload();
  await page.waitForFunction((expected) => [...document.querySelectorAll("input")].some((input) => input.value === expected), symbol);
  assert.equal(await page.getByLabel("Symbol", { exact: true }).inputValue(), symbol);
  await submit("Connect Browser wallet");
  await page.getByRole("button", { name: /^Switch to (?:Local Anvil|Private preview)/ }).click();
  await submit("Review launch");
  await page.getByRole("heading", { name: "Review and confirm" }).waitFor();
  await capture(page, "create-review-phone");
  await page.getByRole("checkbox").check();
  await page.evaluate(() => { window.rmtFixture.rejectNext = true; });
  await submit("Confirm in wallet");
  await page.getByRole("alert").getByText("Request declined in your wallet.").waitFor();
  assert.equal(broadcasts.length, 0);
  await noOverflow(page);
  await capture(page, "create-rejection-phone");
  await page.evaluate(() => { window.rmtFixture.dropNextHash = true; });
  await submit("Confirm in wallet");
  await page.getByLabel("Recover wallet request").waitFor();
  await page.getByLabel("Recover wallet request").fill(hashes[0]);
  await submit("Check transaction");
  await page.getByRole("link", { name: `Open ${symbol}` }).click({ timeout: 75_000 });
  await page.getByText("Funded pool verified", { exact: true }).waitFor();
  const token = new URL(page.url()).pathname.split("/").at(-1);
  assert.match(token, /^0x[0-9a-fA-F]{40}$/);
  await page.getByRole("heading", { name: "Launch checks" }).waitFor();
  await page.getByText("Factory origin", { exact: true }).waitFor();
  await page.getByRole("checkbox").click();
  await page.getByRole("checkbox").waitFor({ state: "detached" });
  await page.getByLabel("You pay (ETH)").fill("0.005");
  await submit("Review trade");
  await submit("Confirm buy in wallet");
  await page.getByText(/Settlement verified\. Received .*F/).waitFor();
  await submit("Sell");
  await page.getByLabel(`You pay (${symbol})`).fill("10");
  await submit("Review trade");
  await submit("Confirm token approval");
  await page.getByText("Approval confirmed. Review the next step to continue the sale.").waitFor();
  await submit("Review trade");
  await submit("Confirm router approval");
  await page.getByText("Approval confirmed. Review the next step to continue the sale.").waitFor();
  await submit("Review trade");
  await submit("Confirm sell in wallet");
  await page.getByText(/Settlement verified\. Received .* ETH\./).waitFor();
  await submit("Review fee claim");
  await submit("Confirm fee claim in wallet");
  await page.getByText("Creator fee collection confirmed.", { exact: true }).waitFor();
  assert.equal(broadcasts.length, 6);
  assert.ok(broadcasts.every((tx) => tx.from.toLowerCase() === account.toLowerCase() && tx.chainId === "0x7a69"));
  await noOverflow(page);
  await capture(page, "token-phone");

  const authorization = privatePreview ? { ignoreHTTPSErrors: true, storageState: await context.storageState() } : {};
  const landscape = await browser.newPage({ ...authorization, viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  await landscape.goto(page.url());
  await landscape.getByText("Funded pool verified", { exact: true }).waitFor();
  await noOverflow(landscape);
  await capture(landscape, "token-phone-landscape");

  const desktop = await browser.newPage({ ...authorization, viewport: { width: 1440, height: 900 } });
  await desktop.goto(site);
  await desktop.getByRole("link", { name: new RegExp(symbol) }).waitFor();
  await noOverflow(desktop);
  await capture(desktop, "launches-desktop");
  await desktop.goto(page.url());
  await desktop.getByText("Funded pool verified", { exact: true }).waitFor();
  await noOverflow(desktop);
  await capture(desktop, "token-desktop");
  await page.getByRole("link", { name: "My Launches", exact: true }).click();
  await page.getByRole("link", { name: new RegExp(symbol) }).waitFor();
  assert.deepEqual(failures, []);
  console.log(`${privatePreview ? "Private HTTPS gateway with a locally signed wallet fixture" : "Loopback browser/fork"} passed launch, rejection, buy, two bounded sell approvals, sell, fee claim and creator view for ${token}.`);
} finally {
  if (failures.length) console.error("Browser page errors:", failures);
  if (page.url().startsWith(site)) await capture(page, "launchpad-last").catch(() => {});
  await browser.close();
}
