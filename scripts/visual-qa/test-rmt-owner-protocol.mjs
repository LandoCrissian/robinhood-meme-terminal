import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { chromium, devices, webkit } from "playwright";
import { buildOwnerProtocolReview, ownerProtocolConfiguration } from "./export-rmt-owner-protocol.mjs";

const { values } = parseArgs({ options: { packet: { type: "string" }, "directory-runtime": { type: "string" } } });
assert.equal(Boolean(values.packet), Boolean(values["directory-runtime"]), "Supply both the packet and materialized runtime");
const fixture = JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/mobile-signing/directory-review-test-fixture.json.gz", import.meta.url))));
const packet = values.packet ? JSON.parse(readFileSync(values.packet)) : fixture.packet;
const directoryRuntime = values["directory-runtime"] ? JSON.parse(readFileSync(values["directory-runtime"])) : fixture.directoryRuntime;
const options = { allowTestFixture: packet.testOnly === true };
const runtimes = JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/mobile-signing/safe-runtime-4663.json.gz", import.meta.url))));
const endpoint = "https://owner-review.example.test/protocol-deployment.html";
assert.throws(() => ownerProtocolConfiguration(endpoint, { ...fixture.packet, testOnly: true }, runtimes, fixture.directoryRuntime), /Test-only inputs/);
const config = ownerProtocolConfiguration(endpoint, packet, runtimes, directoryRuntime, options);
const built = buildOwnerProtocolReview(endpoint, packet, runtimes, directoryRuntime, options);
const quantity = (v) => "0x" + BigInt(v).toString(16);
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
const transactionHash = "0x" + "ad".repeat(32), blockHash = "0x" + "ab".repeat(32);
const runtimeAt = Object.fromEntries(runtimes.contracts.map(({ address, code }) => [address.toLowerCase(), code]));
runtimeAt[config.delegate.address.toLowerCase()] = runtimes.delegateCode;
const proxyCode = runtimes.proxyRuntimeCode;
assert.ok(!built.html.includes(config.operation.data) && !built.html.includes(built.accessCode));
assert.equal(config.mode, "CREATE");
assert.ok(!built.html.includes(String.fromCharCode(65533)));
assert.ok(built.html.includes("Deploy only RMTLaunchCurveDirectoryV2"));
assert.ok(!built.html.includes("Protocol DirectoryL2"));
assert.equal(config.operation.to, null);
assert.equal(config.operation.id, "directory");
assert.equal(config.prerequisites.length, 2);
for (const mutate of [
  (p) => { p.plan.tokenCreation = {}; }, (p) => { p.plan.chainId = 31337; },
  (p) => { p.plan.safeReceipts[1].hash = p.plan.safeReceipts[0].hash; },
  (p) => { p.plan.constructors[0].initcode += "00"; },
]) { const altered = structuredClone(packet); mutate(altered); assert.throws(() => ownerProtocolConfiguration(endpoint, altered, runtimes, directoryRuntime, options)); }
assert.throws(() => ownerProtocolConfiguration(endpoint.replace("https:", "http:"), packet, runtimes, directoryRuntime));
assert.throws(() => ownerProtocolConfiguration(endpoint, packet, runtimes, { ...directoryRuntime, runtimeCode: "0x6000" }));

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    let nonce = BigInt(config.operation.nonce), hasReceipt = false, sendMode = "reject", tx;
    let currentAccount = config.sender, chain = config.chainId, treasuryMissing = false, badSimulation = false;
    let badRuntime = false, changedNonce = false, badFee = false, receiptAddressWrong = false, reorg = false;
    const calls = [], external = [];
    const block = (full) => ({ number: "0x100", hash: reorg ? "0x" + "dc".repeat(32) : blockHash,
      timestamp: quantity(Math.floor(Date.now() / 1000)), gasLimit: "0x1e84800", ...(full && { transactions: tx ? [tx] : [] }) });
    await page.route("**/*", (route) => {
      if (route.request().isNavigationRequest() && route.request().url() === endpoint) return route.fulfill({ contentType: "text/html", body: built.html });
      external.push(route.request().url()); return route.abort();
    });
    await page.exposeFunction("ownerWallet", async ({ method, params = [] }) => {
      calls.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return { value: [currentAccount] };
      if (method === "eth_chainId") return { value: chain };
      const proof = config.prerequisites.find((p) => p.hash === params[0]);
      if (method === "eth_getBlockByNumber") {
        const p = config.prerequisites.find((p) => quantity(p.receiptBlock) === params[0]);
        return { value: p ? { ...block(false), number: params[0], hash: p.blockHash } : block(params[1]) };
      }
      if (method === "eth_getTransactionCount") return { value: params[0].toLowerCase() === config.sender.toLowerCase() ? quantity(nonce + (changedNonce ? 1n : 0n)) : "0x0" };
      if (method === "eth_getBalance") return { value: "0xde0b6b3a7640000" };
      if (method === "eth_getCode") {
        const address = params[0].toLowerCase();
        if (address === config.sender.toLowerCase()) return { value: config.delegate.designator };
        if (address === config.operation.expectedAddress.toLowerCase()) return { value: hasReceipt ? (badRuntime ? "0x6000" : directoryRuntime.runtimeCode) : "0x" };
        if (config.operation.owners.some((o) => o.toLowerCase() === address)) return { value: "0x" };
        if (config.prerequisites.some((p) => p.safe.toLowerCase() === address)) return { value: proxyCode };
        return { value: runtimeAt[address] };
      }
      if (method === "eth_call") {
        const request = params[0];
        if (!Object.hasOwn(request, "to")) {
          assert.equal(request.data, config.operation.data); assert.equal(request.nonce, config.operation.nonce);
          return { value: badSimulation ? "0x6000" : directoryRuntime.runtimeCode };
        }
        if (request.to.toLowerCase() === "0x00000000000000000000000000000000000000c8") {
          assert.equal(request.data, config.nitroData);
          return { value: "0x" + [2396085n, 0n, 20000000n, 0n].map(word).join("") };
        }
        const p = config.prerequisites.find((p) => p.safe.toLowerCase() === request.to.toLowerCase());
        return { value: (p ? p.postState : config.postState).find((s) => s.data === request.data)?.expected };
      }
      if (method === "eth_estimateGas") { assert.equal(Object.hasOwn(params[0], "to"), false); return { value: quantity(2396085) }; }
      if (method === "eth_gasPrice") return { value: quantity(20000000) };
      if (method === "eth_maxPriorityFeePerGas") return { value: "0x0" };
      if (method === "eth_getTransactionByHash" && proof) return { value: { ...proof.transaction, hash: proof.hash,
        blockNumber: quantity(proof.receiptBlock), blockHash: proof.blockHash, chainId: config.chainId } };
      if (method === "eth_getTransactionReceipt" && proof) return { value: treasuryMissing ? null : {
        from: proof.transaction.from, to: proof.transaction.to, transactionHash: proof.hash, blockHash: proof.blockHash,
        blockNumber: quantity(proof.receiptBlock), status: "0x1", logs: [{ address: proof.transaction.to,
          topics: [proof.event.topic, proof.event.proxyTopic], data: proof.event.data, logIndex: quantity(proof.logIndex),
          transactionHash: proof.hash, blockHash: proof.blockHash, blockNumber: quantity(proof.receiptBlock), removed: false }],
      } };
      if (method === "eth_sendTransaction") {
        const request = params[0]; assert.equal(Object.hasOwn(request, "to"), false);
        assert.deepEqual(Object.keys(request).sort(), ["chainId", "data", "from", "gas", "maxFeePerGas", "maxPriorityFeePerGas", "nonce", "type", "value"].sort());
        assert.equal(request.data, config.operation.data); assert.equal(request.nonce, config.operation.nonce);
        if (sendMode === "reject") return { error: { code: 4001, message: "Synthetic owner rejection" } };
        tx = { ...request, to: null, input: request.data, hash: transactionHash, accessList: [], blockHash, blockNumber: "0x100" };
        delete tx.data; nonce++;
        return { value: sendMode === "missing-hash" ? undefined : transactionHash };
      }
      if (method === "eth_getTransactionByHash") return { value: tx && { ...tx,
        ...(badFee && { maxFeePerGas: quantity(BigInt(tx.maxFeePerGas) + 1n) }) } };
      if (method === "eth_getTransactionReceipt") return { value: hasReceipt ? { from: config.sender, to: null,
        transactionHash, blockHash, blockNumber: "0x100", status: "0x1", logs: [],
        contractAddress: receiptAddressWrong ? config.sender : config.operation.expectedAddress } : null };
      throw new Error("Unexpected mocked wallet read " + method);
    });
    await page.addInitScript(() => { window.ethereum = { on() {}, request: async (request) => {
      const result = await window.ownerWallet(request);
      if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
      return result.value;
    } }; });
    const status = (pattern) => page.getByRole("status").filter({ hasText: pattern }).waitFor();
    const refresh = async () => { await page.locator("#refresh").click(); };
    const send = async () => { await page.locator("#approve").check(); await page.locator("#send").click(); };
    await page.goto(endpoint); assert.equal(calls.length, 0);
    await page.locator("#access-code").fill(built.accessCode); await page.locator("#unlock").click(); await status(/Connect the approved/);
    assert.equal(await page.locator("#approval-label").isVisible(), false);
    await page.locator("#connect").click(); await status(/Wallet connected/);
    treasuryMissing = true; await refresh(); await status(/receipt is unavailable/); treasuryMissing = false;
    changedNonce = true; await refresh(); await status(/prepared deployment nonce changed/); changedNonce = false;
    badSimulation = true; await refresh(); await status(/runtime bytes differ/); badSimulation = false;
    await refresh(); await status(/Review the live costs/);
    assert.match(await page.locator("#facts").innerText(), /RMTLaunchCurveDirectoryV2/);
    await send(); await status(/rejected the request/);
    sendMode = "missing-hash"; await refresh(); await status(/Review the live costs/); await send(); await status(/returned no hash/);
    await page.reload(); await status(/original transaction is saved/);
    await page.locator("#connect").click(); await status(/Wallet connected/);
    await page.locator("details summary").click();
    await page.locator("#recover").click(); await status(/receipt is pending/);
    assert.equal(calls.filter((m) => m === "eth_sendTransaction").length, 2);
    hasReceipt = true; receiptAddressWrong = true; await page.locator("#recover").click(); await status(/unexpected contract address/); receiptAddressWrong = false;
    badRuntime = true; await page.locator("#recover").click(); await status(/runtime bytes differ/); badRuntime = false;
    badFee = true; await page.locator("#recover").click(); await status(/including its fee fields/); badFee = false;
    reorg = true; await page.locator("#recover").click(); await status(/was reorganized/); reorg = false;
    await page.locator("#recover").click(); await status(/verified wallet-observed L2 receipt/);
    assert.equal(calls.filter((m) => m === "eth_sendTransaction").length, 2);
    assert.equal(calls.some((m) => /sign|sendRaw|Authorization/i.test(m)), false);
    assert.deepEqual(external, []);
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await context.close(); console.log("Directory CREATE mocked-wallet checks passed on " + name + ". No chain transactions were sent.");
  } finally { await browser.close(); }
}
