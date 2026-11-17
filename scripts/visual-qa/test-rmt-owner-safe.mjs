import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { chromium, devices, webkit } from "playwright";
import { buildOwnerSafeReview, ownerSafeConfiguration } from "./export-rmt-owner-safe.mjs";

const { values } = parseArgs({ options: { runtimes: { type: "string" } } });
const evidence = JSON.parse(values.runtimes ? readFileSync(values.runtimes)
  : gunzipSync(readFileSync(new URL("../../docs/evidence/mobile-signing/safe-runtime-4663.json.gz", import.meta.url))));
const pinRows = evidence.pins ?? evidence.contracts;
const runtimeAt = Object.fromEntries(pinRows.map(({ address, code }) => [address.toLowerCase(), code]));
const proxyCode = evidence.proxyRuntimeCode ?? pinRows.find(({ role }) => role === "proxy").code;
const word = (value) => BigInt(value).toString(16).padStart(64, "0");
const quantity = (value) => "0x" + BigInt(value).toString(16);
const txHash = "0x" + "9".repeat(64);
const blockHash = "0x" + "a".repeat(64);
const operationsVerification = {
  status: "L2_CREATION_VERIFIED", chainId: 4663, role: "RMT-OPERATIONS",
  safe: "0xAF9F10258b091719618c19D057F9cDAB72eFFd8b",
  hash: "0x7306d15f2ffcab498bd2063615ddaa862b6ff956415e39e4d278f75de84cdad6",
  receiptBlock: "128", blockHash: "0x" + "b".repeat(64), logIndex: "3", finality: "L1_UNVERIFIED", broadcastAuthorized: false,
};
const reserveEndpoint = "https://owner-review.example.test/reserve-deployment.html";
assert.throws(() => ownerSafeConfiguration(reserveEndpoint, evidence, { role: "RMT-RESERVE" }), /verified canonical Operations/);
for (const override of [{ status: "UNVERIFIED" }, { chainId: 1 }, { hash: txHash }, { safe: "0x" + "0".repeat(40) }, { broadcastAuthorized: true }]) {
  assert.throws(() => ownerSafeConfiguration(reserveEndpoint, evidence, { role: "RMT-RESERVE", operationsVerification: { ...operationsVerification, ...override } }), /verified canonical Operations/);
}
assert.throws(() => ownerSafeConfiguration(reserveEndpoint, evidence, { role: "OTHER" }), /Unknown Safe role/);

for (const role of ["RMT-OPERATIONS", "RMT-RESERVE"]) {
const options = { role, ...(role === "RMT-RESERVE" && { operationsVerification }) };
const endpoint = "https://owner-review.example.test/" + (role === "RMT-RESERVE" ? "reserve-deployment.html" : "owner-deployment.html");
const built = buildOwnerSafeReview(endpoint, evidence, options);
const config = ownerSafeConfiguration(endpoint, evidence, options);
runtimeAt[config.delegate.address.toLowerCase()] = evidence.delegateCode ?? pinRows.find(({ role }) => role === "delegate").code;
assert.equal(config.operation.dataHash, role === "RMT-RESERVE" ? "0x6b13f3d79874ba9b1417f547170acf2e5bcf19fe5bab43f1ab0da6aede826604" : "0x64c42b60490759e71c4777faab3ac157f5c565b6b379629bdaaec7e5352c2250");
assert.equal(config.operation.expectedAddress, role === "RMT-RESERVE" ? "0x8D44078642ce938Fd799b23087BcdD6114A302e5" : operationsVerification.safe);
assert.ok(!built.html.includes(built.accessCode) && !built.html.includes(config.operation.data), "Authentication must seal transaction inputs");
assert.throws(() => ownerSafeConfiguration(endpoint, { ...evidence, delegateCode: "0x6000" }, options), /Runtime differs/);
assert.throws(() => ownerSafeConfiguration(endpoint.replace("https:", "http:"), evidence, options), /HTTPS path/);
assert.throws(() => ownerSafeConfiguration(endpoint.replace(".html", "/other"), evidence, options), /HTTPS path/);
for (const [name, browserType] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await browserType.launch();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const calls = [];
    const unexpectedNetwork = [];
    let account = config.sender;
    let chain = config.chainId;
    let nonce = 476n;
    let baseFee = 20_000_000n;
    let sendMode = "reject";
    let lastWalletRequest;
    let savedTransaction;
    let hasReceipt = false;
    let alteredFee = false;
    let changedCode = false;
    let receiptReorg = false;
    let operationsUnavailable = false;
    let operationsReorg = false;
    let operationsChanged = false;
    const block = (full) => ({ number: "0x100", hash: blockHash, gasLimit: "0x1e84800",
      timestamp: quantity(Math.floor(Date.now() / 1000)),
      ...(full && { transactions: savedTransaction ? [savedTransaction] : [] }) });
    await page.route("**/*", (route) => {
      if (route.request().isNavigationRequest() && route.request().url() === endpoint) {
        return route.fulfill({ contentType: "text/html", body: built.html });
      }
      unexpectedNetwork.push(route.request().url());
      return route.abort();
    });
    await page.exposeFunction("ownerWallet", async ({ method, params = [] }) => {
      calls.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return { value: [account] };
      if (method === "eth_chainId") return { value: chain };
      if (method === "eth_getBlockByNumber") return { value: params[0] === "0x80" ? {
        ...block(false), number: "0x80", hash: operationsReorg ? blockHash : operationsVerification.blockHash,
      } : { ...block(params[1]), ...(receiptReorg && { hash: "0x" + "f".repeat(64) }) } };
      if (method === "eth_getTransactionCount") return { value: params[0].toLowerCase() === config.sender.toLowerCase() ? quantity(nonce) : "0x0" };
      if (method === "eth_getBalance") return { value: "0xde0b6b3a7640000" };
      if (method === "eth_getCode") {
        const address = params[0].toLowerCase();
        if (address === config.sender.toLowerCase()) return { value: config.delegate.designator };
        if (address === config.operation.expectedAddress.toLowerCase()) return { value: hasReceipt ? proxyCode : "0x" };
        if (config.operationsVerification && address === operationsVerification.safe.toLowerCase()) return { value: proxyCode };
        return { value: changedCode ? "0x6000" : runtimeAt[address] };
      }
      if (method === "eth_estimateGas") return { value: quantity(313391) };
      if (method === "eth_maxPriorityFeePerGas") return { value: "0x0" };
      if (method === "eth_gasPrice") return { value: quantity(baseFee) };
      if (method === "eth_call") {
        const request = params[0];
        if (operationsChanged && request.to.toLowerCase() === operationsVerification.safe.toLowerCase()) return { value: "0x" + word(0) };
        if (request.to.toLowerCase() === "0x00000000000000000000000000000000000000c8") {
          return { value: "0x" + [313391n, 0n, baseFee, 0n].map(word).join("") };
        }
        if (request.to.toLowerCase() === config.operation.to.toLowerCase()) return { value: "0x" + config.operation.expectedAddress.slice(2).padStart(64, "0") };
        return { value: config.postState.find(({ data }) => data === request.data)?.expected };
      }
      if (method === "eth_sendTransaction") {
        const [request] = params;
        lastWalletRequest = structuredClone(request);
        assert.deepEqual(Object.keys(request).sort(), ["chainId", "data", "from", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "to", "type", "value"].sort());
        assert.equal(request.data, config.operation.data);
        assert.equal(request.value, "0x0");
        assert.equal(request.type, "0x2");
        if (sendMode === "reject") return { error: { code: 4001, message: "Rejected in synthetic wallet" } };
        savedTransaction = { ...request, hash: txHash, input: request.data, accessList: [], blockNumber: "0x100", blockHash };
        delete savedTransaction.data;
        nonce++;
        return { value: sendMode === "missing-hash" ? undefined : txHash };
      }
      if (method === "eth_getTransactionByHash" && config.operationsVerification && params[0] === operationsVerification.hash) return { value: {
        ...config.operationsVerification.transaction, hash: operationsVerification.hash, blockNumber: "0x80",
        blockHash: operationsVerification.blockHash, chainId: config.chainId,
      } };
      if (method === "eth_getTransactionReceipt" && config.operationsVerification && params[0] === operationsVerification.hash) return { value: operationsUnavailable ? null : {
        transactionHash: operationsVerification.hash, blockNumber: "0x80", blockHash: operationsVerification.blockHash,
        from: config.sender, to: config.operation.to, status: "0x1", logs: [{
          address: config.operation.to, topics: [config.operationsVerification.event.topic, config.operationsVerification.event.proxyTopic],
          data: config.operationsVerification.event.data, logIndex: "0x3", transactionHash: operationsVerification.hash,
          blockNumber: "0x80", blockHash: operationsVerification.blockHash, removed: false,
        }],
      } };
      if (method === "eth_getTransactionByHash") return { value: savedTransaction && { ...savedTransaction,
        ...(alteredFee && { maxFeePerGas: quantity(BigInt(savedTransaction.maxFeePerGas) + 1n) }) } };
      if (method === "eth_getTransactionReceipt") return { value: hasReceipt ? {
        transactionHash: txHash, from: config.sender, to: config.operation.to, blockHash, blockNumber: "0x100", status: "0x1", contractAddress: null,
        logs: [{ address: config.operation.to, transactionHash: txHash, blockHash, blockNumber: "0x100", removed: false,
          topics: [config.creationEvent.topic, config.creationEvent.proxyTopic], data: config.creationEvent.data }],
      } : null };
      throw new Error("Unexpected wallet method " + method);
    });
    await page.addInitScript(() => {
      const listeners = new Map();
      window.ethereum = {
        on: (name, callback) => { const set = listeners.get(name) ?? new Set(); set.add(callback); listeners.set(name, set); },
        request: async (request) => {
          const result = await window.ownerWallet(request);
          if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
          return result.value;
        },
      };
      window.ownerEvent = (name) => { for (const callback of listeners.get(name) ?? []) callback(); };
    });
    const status = (pattern) => page.getByRole("status").filter({ hasText: pattern }).waitFor();
    const approve = async () => {
      await page.locator("#approve").check();
      await page.locator("#send").click();
    };
    await page.goto(endpoint);
    await page.locator("#access-code").fill(built.accessCode);
    await page.locator("#unlock").click();
    await status(/Connect the approved/);
    await page.locator("#connect").click();
    await status(/Wallet connected/);
    assert.equal(calls.filter((method) => method === "eth_sendTransaction").length, 0);
    if (config.operationsVerification) {
      operationsUnavailable = true;
      await page.locator("#refresh").click();
      await status(/Operations receipt is unavailable/);
      operationsUnavailable = false;
      operationsReorg = true;
      await page.locator("#refresh").click();
      await status(/canonical identity changed/);
      operationsReorg = false;
      operationsChanged = true;
      await page.locator("#refresh").click();
      await status(/Operations ownership, approvals or permissions changed/);
      operationsChanged = false;
      assert.equal(calls.filter((method) => method === "eth_sendTransaction").length, 0);
    }
    chain = "0x1";
    await page.locator("#refresh").click();
    await status(/Select Robinhood Chain/);
    chain = config.chainId;
    changedCode = true;
    await page.locator("#refresh").click();
    await status(/runtime bytes differ/);
    changedCode = false;
    await page.locator("#refresh").click();
    await status(/Review the live costs/);
    assert.equal(await page.locator("#send").isDisabled(), true);
    baseFee = 22_000_000n;
    await approve();
    await status(/MetaMask rejected/);
    assert.equal(calls.filter((method) => method === "eth_sendTransaction").length, 1);
    assert.equal(lastWalletRequest.maxFeePerGas, quantity(40_000_000), "Modest fee drift keeps the exact approved maximum");
    baseFee = 20_000_000n;
    await page.locator("#refresh").click();
    await status(/Review the live costs/);
    baseFee = 45_000_000n;
    await approve();
    await status(/required cost exceeds the reviewed bounds/);
    assert.equal(calls.filter((method) => method === "eth_sendTransaction").length, 1);
    assert.equal(await page.locator("#approve").isChecked(), false);
    await approve();
    await status(/MetaMask rejected/);
    assert.equal(calls.filter((method) => method === "eth_sendTransaction").length, 2);
    await page.reload();
    await status(/Connect the approved/);
    assert.equal(await page.locator("#access").isVisible(), false, "Session survives reload without a timed access loop");
    await page.locator("#connect").click();
    await page.locator("#refresh").click();
    await status(/Review the live costs/);
    sendMode = "missing-hash";
    await approve();
    await status(/wallet returned no hash/);
    assert.equal(calls.filter((method) => method === "eth_sendTransaction").length, 3);
    const written = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((key) => key.startsWith("rmt-owner-safe-request-v1:")))));
    assert.equal(written.phase, "requested");
    assert.equal(written.request.nonce, quantity(476));
    await page.reload();
    await status(/original transaction is saved/);
    await page.locator("#connect").click();
    await page.locator("#refresh").click();
    await status(/original transaction is pending or recorded/);
    await page.locator("summary").click();
    await page.locator("#recover").click();
    await status(/receipt is pending/);
    hasReceipt = true;
    alteredFee = true;
    await page.locator("#recover").click();
    await status(/differs from the approved request/);
    alteredFee = false;
    receiptReorg = true;
    await page.locator("#recover").click();
    await status(/was reorganized/);
    receiptReorg = false;
    await page.locator("#recover").click();
    await status(/verified wallet-observed L2 receipt/);
    assert.equal(calls.filter((method) => method === "eth_sendTransaction").length, 3);
    assert.equal(calls.some((method) => /sign|sendRaw|Authorization/i.test(method)), false);
    assert.deepEqual(unexpectedNetwork, []);
    await context.close();
    console.log(role + " transaction-specific mocked-wallet checks passed on " + name + ". No chain transactions were sent.");
  } finally { await browser.close(); }
}
}
