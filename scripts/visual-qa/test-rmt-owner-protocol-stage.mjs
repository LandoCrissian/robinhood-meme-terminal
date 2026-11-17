import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import { chromium, devices, webkit } from "playwright";
import { buildOwnerProtocolStageReview, ownerProtocolStageConfiguration } from "./export-rmt-owner-protocol-stage.mjs";

const { values } = parseArgs({ options: { packet: { type: "string" }, "stage-runtime": { type: "string" }, predecessors: { type: "string" } } });
const supplied = [values.packet, values["stage-runtime"], values.predecessors].filter(Boolean).length;
assert.ok(supplied === 0 || supplied === 3, "Supply the complete packet/runtime/predecessor set, or use the public test-only fixture");
const fixture = JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/mobile-signing/registry-review-test-fixture.json.gz", import.meta.url))));
const packet = values.packet ? JSON.parse(readFileSync(values.packet)) : fixture.packet;
const stageRuntime = values["stage-runtime"] ? JSON.parse(readFileSync(values["stage-runtime"])) : fixture.stageRuntime;
const predecessors = values.predecessors ? JSON.parse(readFileSync(values.predecessors)) : fixture.predecessors;
const options = { allowTestFixture: packet.testOnly === true };
const runtimes = JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/mobile-signing/safe-runtime-4663.json.gz", import.meta.url))));
const endpoint = "https://owner-review.example.test/protocol-registry.html";
const inputs = { id: "registry", packet, runtimes, stageRuntime, predecessors };
assert.throws(() => ownerProtocolStageConfiguration(endpoint, { ...inputs, packet: fixture.packet }), /Test-only inputs/);
const config = ownerProtocolStageConfiguration(endpoint, inputs, options);
const built = buildOwnerProtocolStageReview(endpoint, inputs, options);
const directoryRuntime = stageRuntime;
const quantity = (v) => "0x" + BigInt(v).toString(16);
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
const transactionHash = "0x" + "ad".repeat(32), blockHash = "0x" + "ab".repeat(32);
const runtimeAt = Object.fromEntries(runtimes.contracts.map(({ address, code }) => [address.toLowerCase(), code]));
runtimeAt[config.delegate.address.toLowerCase()] = runtimes.delegateCode;
const proxyCode = runtimes.proxyRuntimeCode;
assert.ok(!built.html.includes(config.operation.data) && !built.html.includes(built.accessCode));
assert.equal(config.mode, "CREATE");
assert.ok(!built.html.includes(String.fromCharCode(65533)));
assert.ok(built.html.includes("Deploy only RMTLaunchProjectRegistryV3"));
assert.ok(!built.html.includes("Protocol DirectoryL2"));
assert.equal(config.operation.to, null);
assert.equal(config.operation.id, "registry");
assert.equal(config.prerequisites.length, 2);
assert.throws(() => ownerProtocolStageConfiguration(endpoint, { ...inputs, predecessors: [] }, options), /Every earlier/);
assert.throws(() => ownerProtocolStageConfiguration(endpoint, { ...inputs, predecessors: [{ ...predecessors[0], proof: { ...predecessors[0].proof, status: "PENDING" } }] }, options), /not canonically verified/);
assert.throws(() => ownerProtocolStageConfiguration(endpoint, { ...inputs, stageRuntime: { ...stageRuntime, runtimeCode: "0x6000" } }, options));
assert.throws(() => ownerProtocolStageConfiguration(endpoint.replace("https:", "http:"), inputs, options));
assert.throws(() => ownerProtocolStageConfiguration(endpoint.replace("registry", "bootstrap"), inputs, options));

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    let nonce = BigInt(config.operation.nonce), hasReceipt = false, sendMode = "reject", tx;
    let currentAccount = config.sender, chain = config.chainId, treasuryMissing = false, badSimulation = false;
    let badRuntime = false, changedNonce = false, badFee = false, receiptAddressWrong = false, reorg = false;
    const calls = [], external = [];
    const block = (full) => ({ number: "0x7000000", hash: reorg ? "0x" + "dc".repeat(32) : blockHash,
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
      const prior = config.protocolPrerequisites.find((p) => p.hash === params[0]);
      if (method === "eth_getBlockByNumber") {
        const p = [...config.prerequisites, ...config.protocolPrerequisites].find((p) => quantity(p.receiptBlock) === params[0]);
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
        const prior = config.protocolPrerequisites.find((p) => p.address.toLowerCase() === address);
        if (prior) return { value: predecessors.find((p) => p.proof.id === prior.id).runtime.runtimeCode };
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
        const p = config.prerequisites.find((p) => p.safe.toLowerCase() === request.to.toLowerCase()) ?? config.protocolPrerequisites.find((p) => p.address.toLowerCase() === request.to.toLowerCase());
        return { value: (p ? p.postState : config.postState).find((s) => s.data === request.data)?.expected };
      }
      if (method === "eth_estimateGas") { assert.equal(Object.hasOwn(params[0], "to"), false); return { value: quantity(2396085) }; }
      if (method === "eth_gasPrice") return { value: quantity(20000000) };
      if (method === "eth_maxPriorityFeePerGas") return { value: "0x0" };
      if (method === "eth_getTransactionByHash" && prior) return { value: { hash: prior.hash, from: config.sender, to: null, input: prior.input,
        nonce: prior.nonce, type: "0x2", chainId: config.chainId, value: "0x0", accessList: [], blockHash: prior.blockHash, blockNumber: quantity(prior.receiptBlock) } };
      if (method === "eth_getTransactionReceipt" && prior) return { value: { transactionHash: prior.hash, from: config.sender, to: null,
        status: "0x1", blockHash: prior.blockHash, blockNumber: quantity(prior.receiptBlock), contractAddress: prior.address, logs: [] } };
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
        tx = { ...request, to: null, input: request.data, hash: transactionHash, accessList: [], blockHash, blockNumber: "0x7000000" };
        delete tx.data; nonce++;
        return { value: sendMode === "missing-hash" ? undefined : transactionHash };
      }
      if (method === "eth_getTransactionByHash") return { value: tx && { ...tx,
        ...(badFee && { maxFeePerGas: quantity(BigInt(tx.maxFeePerGas) + 1n) }) } };
      if (method === "eth_getTransactionReceipt") return { value: hasReceipt ? { from: config.sender, to: null,
        transactionHash, blockHash, blockNumber: "0x7000000", status: "0x1", logs: [],
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
    assert.match(await page.locator("#facts").innerText(), /RMTLaunchProjectRegistryV3/);
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
    await context.close(); console.log("Registry CREATE mocked-wallet checks passed on " + name + ". No chain transactions were sent.");
  } finally { await browser.close(); }
}
