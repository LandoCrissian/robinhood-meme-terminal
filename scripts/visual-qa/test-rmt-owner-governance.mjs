import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { chromium, devices, webkit } from "playwright";
import { makeGovernanceTransactionFixture } from "../../packages/contracts/scripts/governance-transaction.fixture.mjs";
import { prepareGovernanceTransaction } from "../../packages/contracts/scripts/prepare-governance-transaction.mjs";
import { buildOwnerTransactionReview, ownerSafeConfiguration } from "./export-rmt-owner-safe.mjs";
import { ownerGovernanceTransactionConfiguration } from "./export-rmt-owner-governance.mjs";
import { pinnedSafeCreationRows } from "../../packages/contracts/scripts/mobile-review-plan.mjs";
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, parseAbi, toHex } = require("viem");
const evidence = JSON.parse(gunzipSync(readFileSync(new URL("../../docs/evidence/mobile-signing/safe-runtime-4663.json.gz", import.meta.url))));
const nonceData = encodeFunctionData({ abi: parseAbi(["function nonce() view returns(uint256)"]), functionName: "nonce" });
const safeRows = pinnedSafeCreationRows({ includePrivateCalldata: true });
const runtimeAt = Object.fromEntries(evidence.contracts.map((p) => [p.address.toLowerCase(), p.code]));
const operationsProof = { status: "L2_CREATION_VERIFIED", chainId: 4663, role: "RMT-OPERATIONS", safe: safeRows[0].expectedAddress,
  hash: "0x7306d15f2ffcab498bd2063615ddaa862b6ff956415e39e4d278f75de84cdad6", receiptBlock: "64", blockHash: "0x" + "44".repeat(32), logIndex: "3", broadcastAuthorized: false };
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
for (const phase of ["schedule", "execute"]) for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const f = await makeGovernanceTransactionFixture();
  if (phase === "execute") { f.clock.phase = "execute"; f.clock.time = Number(f.executeAfter); f.clock.nonce = 484n; }
  const review = await prepareGovernanceTransaction({ publication: f.publication, phase, verifiedAuthorization: f.verifiedAuthorization,
    scheduleHash: phase === "execute" ? f.scheduleHash : undefined, readers: f.readers, costReaders: f.costReaders, now: f.now, allowTestFixture: true });
  assert.throws(() => ownerGovernanceTransactionConfiguration("https://gov.example.test/governance-" + phase + "-factory.html", { review }), /Test-only/);
  const endpoint = "https://gov.example.test/governance-" + phase + "-factory.html";
  const base = ownerSafeConfiguration("https://gov.example.test/reserve-deployment.html", evidence, { role: "RMT-RESERVE", operationsVerification: operationsProof });
  const prerequisites = [base.operationsVerification, { ...operationsProof, role: "RMT-RESERVE", safe: safeRows[1].expectedAddress,
    hash: "0x3daa6a602b7b2f556c03e9ddf5c142b96111b4bbfd38345c8e1769d7b0611091", receiptBlock: "65", blockHash: "0x" + "55".repeat(32),
    transaction: { from: base.sender, to: safeRows[1].to, input: safeRows[1].calldata, value: "0x0" }, event: base.creationEvent }]
    .map((p) => ({ ...p, proxy: base.proxy, postState: base.postState.filter((s) => s.data !== nonceData) }));
  const config = { ...base, endpoint, mode: "GOVERNANCE_CALL", task: phase === "schedule" ? "OWNER_CONTROLLED_GOVERNANCE_SCHEDULE" : "OWNER_CONTROLLED_GOVERNANCE_EXECUTE",
    role: "GOVERNANCE-" + phase.toUpperCase(), operationsVerification: null, prerequisites, safeNonceGetterData: nonceData,
    protocolPrerequisites: f.publication.protocolReceipts.map((p) => ({ ...p, receiptBlock: p.blockNumber,
      runtime: f.publication.runtimePins.find((pin) => pin.address === p.address), postState: [] })),
    preflightContracts: f.publication.runtimePins.map((pin) => ({ address: pin.address, runtime: pin,
      postState: pin.address === f.publication.directory ? review.beforeChecks : [] })),
    operation: { id: phase + "-factory", label: phase + " publish-factory", reviewTitle: phase + " publication", summary: "Synthetic local wallet regression only; no chain transaction.",
      to: f.publication.directory, expectedAddress: f.publication.directory, data: review.data, dataHash: review.dataHash, owners: f.publication.owners },
    directoryRuntime: f.publication.runtimePins[0], governance: { ...review.governance, kind: 0, version: 1 }, governancePredecessor: review.governancePredecessor,
    postState: review.afterChecks, nitroData: review.nitroData, childVacancies: [], createdChildren: [], earlierFeeCeilingWei: null };
  const built = buildOwnerTransactionReview(config), browser = await engine.launch();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" }); const page = await context.newPage(); page.setDefaultTimeout(10000);
    const calls = [], external = []; let walletMode = "reject", saved, hasReceipt = false, badGuard = false, badEvent = false, receiptReorg = false;
    const hash = "0x" + "99".repeat(32), blockHash = f.headHash, startTime = f.clock.time;
    await page.addInitScript((time) => { const NativeDate = Date; window.fakeGovernanceTime = time; window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : [window.fakeGovernanceTime])); } static now() { return window.fakeGovernanceTime; } };
    }, f.clock.time * 1000);
    await page.route("**/*", (route) => { if (route.request().isNavigationRequest() && route.request().url() === endpoint)
      return route.fulfill({ contentType: "text/html", body: built.html }); external.push(route.request().url()); return route.abort(); });
    await page.exposeFunction("govTransactionWallet", async ({ method, params = [] }) => {
      calls.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return { value: [config.sender] };
      if (method === "eth_chainId") return { value: "0x1237" };
      if (method === "eth_getCode") {
        const address = params[0].toLowerCase();
        if (address === config.sender.toLowerCase()) return { value: config.delegate.designator };
        if (address === config.delegate.address.toLowerCase()) return { value: evidence.delegateCode };
        if (prerequisites.some((p) => p.safe.toLowerCase() === address)) return { value: evidence.proxyRuntimeCode };
        if (runtimeAt[address]) return { value: runtimeAt[address] };
        if (config.operation.owners.some((owner) => owner.toLowerCase() === address)) return { value: "0x" };
        return { value: f.code };
      }
      const safeProof = prerequisites.find((p) => p.hash === params[0]);
      if (method === "eth_getTransactionByHash" && safeProof) return { value: { ...safeProof.transaction, hash: safeProof.hash, chainId: config.chainId,
        blockNumber: toHex(BigInt(safeProof.receiptBlock)), blockHash: safeProof.blockHash } };
      if (method === "eth_getTransactionReceipt" && safeProof) return { value: { transactionHash: safeProof.hash, from: config.sender, to: safeProof.transaction.to, status: "0x1",
        blockHash: safeProof.blockHash, blockNumber: toHex(BigInt(safeProof.receiptBlock)), logs: [{ address: safeProof.transaction.to, topics: [safeProof.event.topic, safeProof.event.proxyTopic], data: safeProof.event.data,
          logIndex: "0x3", transactionHash: safeProof.hash, blockHash: safeProof.blockHash, blockNumber: toHex(BigInt(safeProof.receiptBlock)), removed: false }] } };
      if (method === "eth_getBlockByNumber") {
        const p = prerequisites.find((p) => toHex(BigInt(p.receiptBlock)) === params[0]);
        if (p) return { value: { number: params[0], hash: p.blockHash, timestamp: toHex(f.clock.time), gasLimit: toHex(30000000) } };
        const value = await f.rawReader(method, params);
        if (params[0] === "latest" || params[0] === "0x100") return { value: { ...value, ...(receiptReorg && { hash: "0x" + "ee".repeat(32) }), ...(params[1] && { transactions: saved ? [saved] : [] }) } };
        return { value };
      }
      if (method === "eth_call") {
        const request = params[0], p = prerequisites.find((p) => p.safe.toLowerCase() === request.to.toLowerCase());
        if (p) {
          if (request.data === nonceData) return { value: "0x" + word(params[1] === "pending" ? 4 : 3) }; // Legitimate prior Safe claims do not change its authority.
          return { value: badGuard && request.data === p.postState.at(-1).data ? "0x" + word(1) : p.postState.find((s) => s.data === request.data)?.expected };
        }
        if (hasReceipt && request.to.toLowerCase() === config.operation.to.toLowerCase() && request.data !== config.operation.data) {
          if (phase === "schedule" && request.data === config.governance.pendingGetterData) return { value: f.publication.digest + word(BigInt(startTime) + 172800n) + word(BigInt(startTime) + 777600n) };
          return { value: config.postState.find((s) => s.data === request.data)?.expected };
        }
        return { value: await f.rawReader(method, params) };
      }
      if (method === "eth_getTransactionByHash" && params[0] === hash) return { value: saved };
      if (method === "eth_getTransactionReceipt" && params[0] === hash) {
        const logs = phase === "schedule" ? [{ topics: config.governance.scheduleEventTopics,
          data: "0x" + word(BigInt(startTime) + 172800n + (badEvent ? 1n : 0n)) + word(BigInt(startTime) + 777600n) }] : config.governance.executionEvents;
        return { value: hasReceipt ? { transactionHash: hash, from: config.sender, to: config.operation.to, contractAddress: null,
          status: "0x1", blockHash, blockNumber: "0x100", logs: logs.map((log) => ({ ...log, address: config.operation.to,
            transactionHash: hash, blockHash, blockNumber: "0x100", removed: false })) } : null };
      }
      if (method === "eth_estimateGas") return { value: toHex(150000) };
      if (method === "eth_maxPriorityFeePerGas") return { value: "0x0" };
      if (method === "eth_sendTransaction") {
        const request = params[0]; assert.equal(request.to, config.operation.to); assert.equal(request.data, review.data); assert.equal(request.value, "0x0");
        assert.equal(request.type, "0x2"); assert.equal(Object.hasOwn(request, "authorizationList"), false);
        if (walletMode === "reject") return { error: { code: 4001, message: "Synthetic wallet rejection" } };
        saved = { ...request, input: request.data, hash, blockHash, blockNumber: "0x100", accessList: [] }; delete saved.data; f.clock.nonce++;
        return { value: undefined };
      }
      return { value: await f.rawReader(method, params) };
    });
    await page.addInitScript(() => { window.ethereum = { on() {}, request: async (request) => { const result = await window.govTransactionWallet(request);
      if (result.error) throw Object.assign(new Error(result.error.message), result.error); return result.value; } }; });
    const status = (p) => page.getByRole("status").filter({ hasText: p }).waitFor();
    const refresh = async () => { await page.locator("#refresh").click(); };
    const send = async () => { await page.locator("#approve").check(); await page.locator("#send").click(); };
    await page.goto(endpoint); assert.equal(calls.length, 0); await page.locator("#access-code").fill(built.accessCode); await page.locator("#unlock").click(); await status(/Connect the approved/);
    await page.locator("#connect").click(); await status(/Wallet connected/); assert.equal(calls.includes("eth_sendTransaction"), false);
    if (phase === "execute") {
      f.clock.time = Number(f.executeAfter) - 1; await page.evaluate((time) => { window.fakeGovernanceTime = time; }, f.clock.time * 1000);
      await refresh(); await status(/real governance notice is not mature/); assert.equal(calls.includes("eth_sendTransaction"), false);
      f.clock.time = Number(f.executeAfter); await page.evaluate((time) => { window.fakeGovernanceTime = time; }, f.clock.time * 1000);
    }
    badGuard = true; await refresh(); await status(/ownership, approvals or permissions changed/); badGuard = false;
    await refresh(); await status(/Review the live costs/); await send(); await status(/rejected/);
    walletMode = "missing-hash"; await refresh(); await status(/Review the live costs/); await send(); await status(/returned no hash/);
    await page.reload(); await status(/original transaction is saved/); await page.locator("#connect").click(); await status(/Wallet connected/);
    await page.locator("details summary").click(); await page.locator("#recover").click(); await status(/receipt is pending/);
    hasReceipt = true;
    if (phase === "schedule") { badEvent = true; await page.locator("#recover").click(); await status(/ActionScheduled digest, nonce or real notice timestamps differ/); badEvent = false; }
    receiptReorg = true; await page.locator("#recover").click(); await status(/was reorganized/); receiptReorg = false;
    await page.locator("#recover").click(); await status(/verified wallet-observed L2 receipt/);
    assert.equal(calls.filter((m) => m === "eth_sendTransaction").length, 2); assert.equal(calls.some((m) => /signTyped|personal_sign|sendRaw/.test(m)), false);
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) { await page.setViewportSize(size); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
    assert.deepEqual(external, []); await context.close(); console.log("Synthetic " + phase + " governance wallet/recovery checks passed on " + engineName + "; zero chain transactions.");
  } finally { await browser.close(); }
}
