import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chromium, devices, webkit } from "playwright";
import { buildPublicationAction, publicationActionTypes } from "../../packages/contracts/scripts/prepare-governance-publication.mjs";
import { verifyGovernanceAuthorization } from "../../packages/contracts/scripts/verify-governance-authorization.mjs";
import { buildGovernanceReview, governanceReviewConfiguration, refreshGovernanceReviewArtifact } from "./export-rmt-governance-review.mjs";
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, encodeFunctionResult, keccak256, parseAbi, toHex, zeroHash } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const accounts = [1, 2, 3].map((n) => privateKeyToAccount("0x" + n.toString(16).padStart(64, "0")));
const addresses = Array.from({ length: 8 }, (_, i) => "0x" + (0x10001 + i).toString(16).padStart(40, "0"));
const code = "0x6000", directory = addresses[0], target = addresses[7], now = Math.floor(Date.now() / 1000);
const publication = buildPublicationAction({ action: "publish-factory", directory, target, runtimeHash: keccak256(code), nonce: "0", signerSetEpoch: "1",
  blockTimestamp: now, owners: accounts.map((a) => a.address), testOnly: true }, { allowTestFixture: true });
const abi = parseAbi(["function signerA() view returns(address)", "function signerB() view returns(address)", "function signerC() view returns(address)",
  "function nonce() view returns(uint64)", "function signerSetEpoch() view returns(uint64)", "function latestVersion() view returns(uint32)",
  "function suspended() view returns(bool)", "function pending() view returns(bytes32,uint48,uint48)", "function pendingRotation() view returns(bytes32,uint48,uint48)",
  "function publicationDelay() view returns(uint48)", "function executionWindow() view returns(uint48)",
  "function actionDigest((uint8 kind,uint64 nonce,uint32 version,address factory,bytes32 runtimeHash,uint64 signerSetEpoch,uint48 deadline)) view returns(bytes32)"]);
const states = [["signerA", accounts[0].address], ["signerB", accounts[1].address], ["signerC", accounts[2].address],
  ["nonce", 0n], ["signerSetEpoch", 1n], ["latestVersion", 0], ["suspended", false], ["pending", [zeroHash, 0, 0]], ["pendingRotation", [zeroHash, 0, 0]],
  ["publicationDelay", 172800], ["executionWindow", 604800]];
publication.directoryChecks = states.map(([functionName, result]) => ({ data: encodeFunctionData({ abi, functionName }), expected: encodeFunctionResult({ abi, functionName, result }) }));
publication.directoryChecks.push({ data: encodeFunctionData({ abi, functionName: "actionDigest", args: [{ ...publication.typedData.message,
  nonce: 0n, signerSetEpoch: 1n, deadline: BigInt(publication.typedData.message.deadline) }] }), expected: publication.digest });
publication.compilerInputSha256 = JSON.parse(readFileSync(new URL("../../docs/evidence/fixed-supply-security/4663-profile.json", import.meta.url))).inputSha256;
publication.protocolSender = "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA";
publication.runtimePins = addresses.map((address) => ({ address, byteLength: 2, sha256: createHash("sha256").update(Buffer.from("6000", "hex")).digest("hex"), runtimeHash: keccak256(code) }));
publication.protocolReceipts = ["directory", "registry", "successor-v2", "successor-v3", "bootstrap"].map((id, i) => ({ id, hash: "0x" + (i + 1).toString(16).padStart(64, "0"),
  address: addresses[i], blockHash: "0x" + (i + 11).toString(16).padStart(64, "0"), blockNumber: String(100 + i), input: "0x6000", nonce: toHex(i), value: "0x0" }));
const endpoint = "https://gov-review.example.test/governance-factory.html", options = { allowTestFixture: true };
assert.throws(() => buildGovernanceReview(endpoint, publication), /Test-only/);
assert.throws(() => governanceReviewConfiguration(endpoint, { ...publication, protocolReceipts: [] }, options));
assert.throws(() => governanceReviewConfiguration(endpoint, { ...publication, directoryChecks: [] }, options));
const built = buildGovernanceReview(endpoint, publication, options);
assert.ok(!built.html.includes(built.accessCode) && !built.html.includes(publication.digest));
assert.ok(!built.html.includes("eth_sendTransaction") && !built.html.includes("eth_sendRawTransaction"));
const envelope = (html) => { const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].trim(); return JSON.parse(script.slice(script.lastIndexOf(")({") + 2, -2)); };
const refreshed = refreshGovernanceReviewArtifact(built.html, built.accessCode, options);
assert.deepEqual(envelope(refreshed.html), envelope(built.html)); assert.equal(refreshed.accessCode, built.accessCode);
assert.equal(refreshed.manifest.digest, built.manifest.digest); assert.equal(refreshed.manifest.currentAuthorityRechecked, false);
assert.notEqual(buildGovernanceReview(endpoint, publication, options).accessCode, built.accessCode);
assert.throws(() => refreshGovernanceReviewArtifact(built.html, "A".repeat(43), options));
const changedEnvelope = (patch) => built.html.replace(JSON.stringify(envelope(built.html)), JSON.stringify({ ...envelope(built.html), ...patch }));
assert.throws(() => refreshGovernanceReviewArtifact(changedEnvelope({ endpoint: "https://other.example.test/governance-factory.html" }), built.accessCode, options));
assert.throws(() => refreshGovernanceReviewArtifact(changedEnvelope({ payload: Buffer.from(envelope(built.html).payload, "base64").map((b, i) => i ? b : b ^ 1).toString("base64") }), built.accessCode, options));
assert.throws(() => refreshGovernanceReviewArtifact(changedEnvelope({ iv: Array.from(Buffer.from(envelope(built.html).iv, "base64")) }), built.accessCode, options));

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch();
  try {
    const context = await browser.newContext({ ...devices["iPhone 13"], acceptDownloads: true, serviceWorkers: "block" });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const calls = [], external = []; let selected = 0, reject = true, unavailable = false, changedAuthority = false, servedHtml = built.html;
    const head = { number: "0x100", hash: "0x" + "ab".repeat(32), timestamp: toHex(Math.floor(Date.now() / 1000)) };
    await page.route("**/*", (route) => {
      if (route.request().isNavigationRequest() && route.request().url() === endpoint) return route.fulfill({ contentType: "text/html", body: servedHtml });
      external.push(route.request().url()); return route.abort();
    });
    await page.exposeFunction("govWallet", async ({ method, params = [] }) => {
      calls.push(method);
      if (method === "eth_accounts" || method === "eth_requestAccounts") return { value: [accounts[selected].address] };
      if (method === "eth_chainId") return { value: "0x1237" };
      if (method === "eth_getBlockByNumber") { const proof = publication.protocolReceipts.find((p) => toHex(BigInt(p.blockNumber)) === params[0]);
        return { value: proof ? { ...head, number: params[0], hash: proof.blockHash } : head }; }
      if (method === "eth_getCode") return { value: accounts.some((a) => a.address.toLowerCase() === params[0].toLowerCase()) ? "0x" : code };
      if (method === "eth_call") { const check = publication.directoryChecks.find((c) => c.data === params[0].data);
        return { value: changedAuthority ? zeroHash : check?.expected }; }
      const proof = publication.protocolReceipts.find((p) => p.hash === params[0]);
      if (method === "eth_getTransactionReceipt") return { value: unavailable ? null : { transactionHash: proof.hash, to: null, from: publication.protocolSender,
        status: "0x1", contractAddress: proof.address, blockHash: proof.blockHash, blockNumber: toHex(BigInt(proof.blockNumber)) } };
      if (method === "eth_getTransactionByHash") return { value: { hash: proof.hash, to: null, from: publication.protocolSender, type: "0x2", chainId: "0x1237",
        value: "0x0", nonce: proof.nonce, input: proof.input, blockHash: proof.blockHash, blockNumber: toHex(BigInt(proof.blockNumber)), accessList: [] } };
      if (method === "eth_signTypedData_v4") {
        assert.equal(params[0], accounts[selected].address); const typed = JSON.parse(params[1]); assert.deepEqual(typed, publication.typedData);
        if (reject) return { error: { code: 4001, message: "Synthetic owner rejection" } };
        return { value: await accounts[selected].signTypedData({ ...typed, types: publicationActionTypes }) };
      }
      throw new Error("Unexpected governance wallet method " + method);
    });
    await page.addInitScript(() => { const handlers = new Map(); window.ethereum = { on: (name, handler) => { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
      request: async (request) => { const result = await window.govWallet(request); if (result.error) throw Object.assign(new Error(result.error.message), result.error); return result.value; } };
      window.govChanged = (name) => { for (const h of handlers.get(name) ?? []) h(); }; });
    const status = (pattern) => page.getByRole("status").filter({ hasText: pattern }).waitFor();
    const review = async () => { await page.locator("#review").click(); await status(/Review the exact publication/); };
    const sign = async () => { await page.locator("#approve").check(); await page.locator("#sign").click(); };
    await page.goto(endpoint); assert.equal(calls.length, 0);
    await page.locator("#access-code").fill(built.accessCode); await page.locator("#unlock").click(); await status(/Connect one/);
    await page.locator("#connect").click(); await status(/Governance wallet connected/); assert.equal(calls.includes("eth_signTypedData_v4"), false);
    await review(); await sign(); await status(/rejected/); reject = false;
    await review(); await sign(); await status(/First response saved/);
    const sealed = await page.evaluate(() => localStorage.getItem(Object.keys(localStorage)[0])); assert.ok(!sealed.includes("signatureResponses"));
    unavailable = true; await page.locator("#review").click(); await status(/receipt is unavailable/); unavailable = false;
    selected = 1; await page.evaluate(() => window.govChanged("accountsChanged")); await status(/Saved responses/);
    await page.locator("#connect").click(); await status(/Governance wallet connected/); await review();
    assert.match(await page.locator("#facts").innerText(), /1 of 2/); await sign(); await status(/Two wallet responses/);
    const responseKey = "rmt-gov-responses:" + endpoint;
    const savedCipher = await page.evaluate((key) => localStorage.getItem(key), responseKey);
    servedHtml = refreshed.html; await page.reload(); await status(/Two wallet responses are already saved/);
    await page.evaluate(() => { window.ethereum = undefined; });
    const callsBeforeExport = calls.length;
    assert.equal(await page.locator("#download").isDisabled(), true); assert.equal(await page.locator("#sign").isDisabled(), true);
    await page.locator("#show-saved").click(); await status(/Saved responses only; validity is unverified/);
    const savedText = await page.locator("#saved-authorization").inputValue(), savedAuthorization = JSON.parse(savedText);
    assert.equal(savedAuthorization.signatureResponses.length, 2);
    for (const response of savedAuthorization.signatureResponses) assert.match(response.signature, /^0x[0-9a-f]{130}$/i);
    assert.equal((await verifyGovernanceAuthorization(publication, savedAuthorization, options)).signers.length, 2);
    await page.evaluate(() => { window.copiedJson = null; Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText(text) { window.copiedJson = text; return Promise.resolve(); } } }); });
    await page.locator("#copy-json").click(); await status(/Copied the complete saved authorization JSON/);
    assert.equal(await page.evaluate(() => window.copiedJson), savedText);
    for (const clipboard of ["absent", "rejected"]) {
      await page.evaluate((mode) => Object.defineProperty(navigator, "clipboard", { configurable: true, value: mode === "absent" ? undefined : { writeText() { return Promise.reject(new DOMException("Synthetic clipboard denial", "NotAllowedError")); } } }), clipboard);
      await page.locator("#copy-json").click(); await status(/The full JSON is selected/);
      assert.deepEqual(await page.locator("#saved-authorization").evaluate((area) => [area.selectionStart, area.selectionEnd]), [0, savedText.length]);
      assert.doesNotMatch(await page.getByRole("status").innerText(), /Copied the complete/);
    }
    await page.locator("#select-json").click(); await status(/The full JSON is selected/);
    assert.equal(calls.length, callsBeforeExport); assert.equal(await page.evaluate((key) => localStorage.getItem(key), responseKey), savedCipher);
    await page.locator("#logout").click(); await status(/locked/i);
    assert.equal(await page.locator("#saved-authorization").inputValue(), ""); assert.equal(await page.locator("#saved-export").isHidden(), true);
    assert.equal(await page.locator("#copy-json").isDisabled(), true); assert.equal(await page.locator("#select-json").isDisabled(), true);
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), responseKey), savedCipher);
    await page.locator("#access-code").fill(built.accessCode); await page.locator("#unlock").click(); await status(/Two wallet responses are already saved/);
    await page.locator("#show-saved").click(); await status(/Saved responses only/); assert.equal(await page.locator("#saved-authorization").inputValue(), savedText);
    assert.equal(calls.length, callsBeforeExport);
    await page.reload(); await status(/Two wallet responses are already saved/); await page.locator("#connect").click(); await status(/Governance wallet connected/); await review();
    assert.match(await page.locator("#facts").innerText(), /2 of 2/); assert.equal(await page.locator("#sign").isDisabled(), true);
    const downloaded = page.waitForEvent("download"); await page.locator("#download").click(); const download = await downloaded;
    const authorization = JSON.parse(await readFile(await download.path(), "utf8"));
    const verified = await verifyGovernanceAuthorization(publication, authorization, { allowTestFixture: true }); assert.equal(verified.signers.length, 2);
    assert.equal(calls.filter((m) => m === "eth_signTypedData_v4").length, 3);
    assert.equal(calls.some((m) => /sendTransaction|sendRaw|personal_sign|^eth_sign$|Authorization/.test(m)), false);
    changedAuthority = true; await page.locator("#review").click(); await status(/All collected responses are invalidated/);
    assert.equal(await page.locator("#download").isDisabled(), true); assert.equal(await page.locator("#sign").isDisabled(), true);
    assert.equal(await page.locator("#saved-authorization").inputValue(), ""); assert.equal(await page.locator("#saved-export").isHidden(), true);
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) { await page.setViewportSize(size); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
    assert.deepEqual(external, []); await context.close(); console.log("Offchain governance collection and preserved-key saved-response export passed on " + name + "; synthetic signatures only, zero transaction methods. Physical Rabby clipboard acceptance remains unverified.");
  } finally { await browser.close(); }
}
