import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { chromium, devices } from "playwright";
import { exerciseLocalGrowth } from "./launchpad-growth-fixture.mjs";

const site = process.env.RMT_LAUNCHPAD_TEST_URL ?? "http://127.0.0.1:3196";
const rpcUrl = process.env.RMT_LAUNCHPAD_TEST_RPC_URL ?? "http://127.0.0.1:8545";
const output = process.env.RMT_LAUNCHPAD_TEST_OUTPUT ?? ".launch-qa";
const executablePath = process.env.RMT_LAUNCHPAD_TEST_CHROME;
const privatePreview = process.env.RMT_LAUNCHPAD_TEST_PRIVATE_PREVIEW === "true";
const longevity = process.env.RMT_LAUNCHPAD_TEST_LONGEVITY === "true";
const routerVersion = process.env.RMT_LAUNCHPAD_ROUTER_VERSION ?? "2.0";
assert.ok(routerVersion === "2.0" || (routerVersion === "2.1.2" && longevity && !privatePreview));
const requireWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const growthPath = process.env.RMT_LAUNCHPAD_TEST_GROWTH_FIXTURE;
const growth = growthPath ? JSON.parse(readFileSync(growthPath, "utf8")) : undefined;
if (growth) assert.ok(longevity && !privatePreview, "Growth acceptance requires the direct loopback V2 fixture.");
const networkName = privatePreview ? "Private preview · Chain 31337" : "Local Anvil · Base Sepolia fork";
for (const input of [site, rpcUrl]) assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(input).hostname));
await mkdir(output, { recursive: true });
async function rpcResponse(method, params = []) {
  const response = await fetch(rpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return response.json();
}
async function rpc(method, params = []) {
  const result = await rpcResponse(method, params);
  assert.ok(!result.error, result.error?.message);
  return result.result;
}
assert.equal(await rpc("eth_chainId"), "0x7a69");
// A resumed idle fork's latest block can predate the factory's narrow deadline window.
if (!privatePreview) await rpc("evm_mine");
let fixtureWallet;
if (privatePreview) {
  assert.equal(new URL(site).protocol, "https:");
  assert.equal(new URL(site).origin, new URL(rpcUrl).origin);
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
const localAccounts = fixtureWallet ? [] : await rpc("eth_accounts");
const account = fixtureWallet?.account.address ?? localAccounts[0];
if (longevity) assert.ok(localAccounts.length >= 3, "Longevity acceptance requires three isolated fixture accounts.");
if (growth) assert.equal(account.toLowerCase(), growth.creator.toLowerCase());
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

async function proveBrowserRouter(token) {
  const { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, keccak256,
    parseAbi, parseAbiItem, toFunctionSelector, toHex, zeroAddress } = requireWeb("viem");
  const pin = JSON.parse(readFileSync(new URL("../../packages/contracts/test/fixtures/rmt-v4-deployment-identities.json", import.meta.url), "utf8")).baseSepolia;
  const router = getAddress((routerVersion === "2.1.2" ? pin.universalRouter212 : pin.universalRouter).address);
  const config = await context.request.get(`${site}/api/launchpad/config`);
  assert.equal(config.status(), 200);
  const { deployment } = await config.json();
  assert.equal(deployment.universalRouter, router);
  assert.equal(deployment.universalRouterVersion, routerVersion);
  const launchReceipt = await rpc("eth_getTransactionReceipt", [hashes[0]]);
  assert.equal(launchReceipt.status, "0x1");
  const read = async (operation, chainId = 31337) => {
    const response = await context.request.get(`${site}/api/launchpad/public/${operation}?chainId=${chainId}&token=${token}`);
    assert.equal(response.status(), chainId === 31337 ? 200 : 404);
    return response.json();
  };
  const [{ data: { launch } }, { data: pool }, { data: activity }, wrongChain] = await Promise.all([
    read("get_launch"), read("get_pool_state"), read("get_launch_activity"), read("get_launch", 84532),
  ]);
  assert.equal(wrongChain.status, "disabled");
  const keyAbi = parseAbiItem("function key((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey)").inputs[0];
  const poolKey = { currency0: zeroAddress, currency1: getAddress(token), fee: 3000, tickSpacing: 60, hooks: deployment.initializationGuard };
  const poolId = keccak256(encodeAbiParameters([keyAbi], [poolKey]));
  assert.equal(launch.transactionHash, hashes[0]);
  assert.equal(launch.blockHash, launchReceipt.blockHash);
  for (const identity of [launch, pool.evidence, activity.evidence]) {
    assert.equal(identity.chainId, 31337);
    assert.equal(getAddress(identity.poolManager), getAddress(pin.poolManager.address));
    assert.deepEqual(identity.poolKey, poolKey);
    assert.equal(identity.poolId, poolId);
  }

  const buyHash = hashes[1];
  const sellHash = hashes[4];
  const abi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
  const actionsAbi = [{ type: "bytes" }, { type: "bytes[]" }];
  const swapAbi = parseAbiItem(`function swap(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,${routerVersion === "2.1.2" ? "uint256 minHopPriceX36," : ""}bytes hookData) params)`).inputs[0];
  for (const [hash, buy] of [[buyHash, true], [sellHash, false]]) {
    const [tx, receipt] = await Promise.all([rpc("eth_getTransactionByHash", [hash]), rpc("eth_getTransactionReceipt", [hash])]);
    assert.equal(getAddress(tx.to), router);
    assert.equal(receipt.status, "0x1");
    assert.ok(activity.activity.some((event) => event.transactionHash === hash && event.blockHash === receipt.blockHash));
    const { args: [commands, inputs, deadline] } = decodeFunctionData({ abi, data: tx.input });
    const [actions, parameters] = decodeAbiParameters(actionsAbi, inputs[0]);
    const [swap] = decodeAbiParameters([swapAbi], parameters[0]);
    assert.equal(commands, "0x10");
    assert.equal(actions, "0x060b0f");
    assert.equal(swap.zeroForOne, buy);
    assert.deepEqual(swap.poolKey, poolKey);
    assert.ok(swap.amountOutMinimum > 0n);
    if (routerVersion === "2.1.2") {
      assert.equal(swap.minHopPriceX36, swap.amountOutMinimum * 10n ** 36n / swap.amountIn);
      assert.ok(swap.minHopPriceX36 > 0n);
      if (buy) {
        const impossible = encodeAbiParameters([swapAbi], [{ ...swap, minHopPriceX36: (1n << 256n) - 1n }]);
        const input = encodeAbiParameters(actionsAbi, [actions, [impossible, parameters[1], parameters[2]]]);
        const data = encodeFunctionData({ abi, functionName: "execute", args: [commands, [input], deadline] });
        const prior = toHex(BigInt(receipt.blockNumber) - 1n);
        const reverted = await rpcResponse("eth_call", [{ from: tx.from, to: tx.to, value: tx.value, data }, prior]);
        const selector = toFunctionSelector("V4TooLittleReceivedPerHopSingle(uint256,uint256)");
        const revertData = reverted.error?.data;
        const encodedError = typeof revertData === "string" ? revertData : revertData?.data;
        assert.ok(typeof encodedError === "string" && encodedError.startsWith(selector),
          "The official router must reject a stricter per-hop bound in simulation.");
      }
    }
  }
  await writeFile(`${output}/guarded-pool.txt`, `${token} ${BigInt(launchReceipt.blockNumber)}\n`);
  await writeFile(`${output}/browser-router.json`, JSON.stringify({
    chainId: 31337, router, routerVersion, poolManager: deployment.poolManager, poolKey, poolId, buyHash, sellHash,
    perHopRevertSimulated: routerVersion === "2.1.2",
  }, null, 2));
}

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
  for (const operation of ["quotes", "verify", "authorize", "native-settlement-trace"]) {
    const path = `/api/embed/cannacat/${operation}`;
    assert.equal((await context.request.post(site + path, { data: {} })).status(), 404, path);
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
  if (longevity) {
    await page.getByLabel("Split earned LP fees at launch").check();
    await page.getByLabel("Creator fee share (%)").fill("60");
    await page.getByLabel("Treasury fee share (%)").fill("25");
    await page.getByLabel("Liquidity reserve fee share (%)").fill("15");
    await page.getByLabel("Project treasury wallet").fill(localAccounts[1]);
    if (growth) {
      await page.getByLabel("Commit the reserve to a test growth vault").check();
      await page.getByLabel("Prepared vault intent").fill(growth.intentId);
    } else await page.getByLabel("Liquidity reserve wallet").fill(localAccounts[2]);
    await noOverflow(page);
    await capture(page.getByRole("group", { name: /RMT Longevity/ }), "longevity-setup-phone");
  }
  await submit("Review launch");
  await page.getByRole("heading", { name: "Review and confirm" }).waitFor();
  if (longevity) await page.getByText("60% creator · 25% treasury · 15% reserve", { exact: true }).waitFor();
  if (growth) await page.getByText("Test vault · held for two-reviewer liquidity adds", { exact: true }).waitFor();
  await capture(page, "create-review-phone");
  await page.getByRole("checkbox", { name: /I reviewed the allocations/ }).check();
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
  await page.getByRole("heading", { name: "Launch health" }).waitFor();
  const checks = page.getByText("Launch checks", { exact: true });
  await checks.click();
  await page.getByText("Factory origin", { exact: true }).waitFor();
  await checks.click();
  await page.getByRole("checkbox").click();
  await page.getByRole("checkbox").waitFor({ state: "detached" });
  await page.getByLabel("You pay (ETH)").fill(growth ? "0.0001" : "0.005");
  await submit("Review trade");
  if (routerVersion === "2.1.2") await page.evaluate(() => { window.rmtFixture.dropNextHash = true; });
  await submit("Confirm buy in wallet");
  if (routerVersion === "2.1.2") {
    const recover = page.getByLabel("Recover wallet request");
    await recover.fill(hashes[0]);
    await submit("Check transaction");
    await page.getByText("This transaction does not match the reviewed wallet request.", { exact: true }).waitFor();
    await recover.fill(hashes[1]);
    await submit("Check transaction");
  }
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
  if (longevity && !privatePreview) await proveBrowserRouter(token);
  if (longevity) {
    await submit("Review fee collection");
    await submit("Confirm fee collection in wallet");
    await page.getByText("LP fees collected into the committed shares.", { exact: true }).waitFor();
    await submit("Review fee payout");
    await submit("Confirm fee payout in wallet");
    await page.getByText("Fee payout to your committed wallet verified.", { exact: true }).waitFor();
    const response = await context.request.get(`${site}/api/launchpad/public/get_launch_checks?chainId=31337&token=${token}`);
    const { data } = await response.json();
    assert.equal(response.status(), 200);
    assert.equal(data.health.fees.status, "verified");
    const [creator, treasury, reserve] = data.health.fees.buckets;
    assert.ok(BigInt(creator.nativeDistributed) > 0n && BigInt(creator.tokenDistributed) > 0n);
    assert.ok(BigInt(treasury.nativeClaimable) > 0n && BigInt(reserve.tokenClaimable) > 0n);
    await page.getByText(/Paid (?!0 ETH \+ 0 )/).first().waitFor();
    await capture(page.getByRole("heading", { name: "Launch health" }).locator(".."), "launch-health-phone");
    if (growth) {
      const details = await context.request.get(`${site}/api/launchpad/public/get_launch?chainId=31337&token=${token}`);
      assert.equal(details.status(), 200);
      const { data: { launch } } = await details.json();
      assert.equal(launch.feePolicy.reserve.toLowerCase(), growth.vault.toLowerCase());
      const receipts = await exerciseLocalGrowth({ rpcUrl, fixture: growth, launch, onDeferred: async () => {
        await submit("Refresh vault evidence");
        await page.getByText("Deferred · price outside signed bounds", { exact: false }).waitFor();
        await capture(page.getByRole("heading", { name: "Liquidity growth vault · Test only" }).locator(".."), "growth-deferred-phone");
      } });
      console.log("Verified growth fixture receipts:", JSON.stringify(receipts));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText(/Permanently vault held/).waitFor();
      const final = await context.request.get(`${site}/api/launchpad/public/get_launch_checks?chainId=31337&token=${token}`);
      assert.equal(final.status(), 200);
      const { data: { health } } = await final.json();
      assert.equal(health.growth.status, "verified");
      assert.equal(health.growth.lastReinvestment.outcome, "added");
      assert.equal(health.growth.positionCustody.status, "locked");
      assert.ok(BigInt(health.growth.liquidityAdded.units) > 0n);
      await capture(page.getByRole("heading", { name: "Liquidity growth vault · Test only" }).locator(".."), "growth-added-phone");
    }
  } else {
    await submit("Review fee claim");
    await submit("Confirm fee claim in wallet");
    await page.getByText("Creator fee collection confirmed.", { exact: true }).waitFor();
  }
  assert.equal(broadcasts.length, longevity ? 7 : 6);
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
  const creatorLaunch = page.getByRole("link", { name: new RegExp(symbol) });
  if (growth) {
    const connect = page.getByRole("button", { name: "Connect Browser wallet", exact: true });
    await creatorLaunch.or(connect).first().waitFor();
    if (await connect.isVisible()) await connect.click();
  }
  await creatorLaunch.waitFor();
  assert.deepEqual(failures, []);
  console.log(`${privatePreview ? "Private HTTPS gateway with a locally signed wallet fixture" : "Loopback browser/fork"} passed launch, rejection, buy, two bounded sell approvals, sell, fee claim and creator view for ${token}.`);
} finally {
  if (failures.length) console.error("Browser page errors:", failures);
  if (page.url().startsWith(site)) await capture(page, "launchpad-last").catch(() => {});
  await browser.close();
}
