import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { pinnedSafeCreationRows, safeProxyRuntimeHash } from "../../packages/contracts/scripts/mobile-review-plan.mjs";
import { MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../production-readiness/mobile-sender.mjs";
import { buildPrivatePhoneReview } from "./export-rmt-private-phone-review.mjs";

const url = "https://rmt-private-review.example.test/";
const observed = Math.floor((Date.now() - 15_000) / 1000) * 1000;
const anchor = { number: "100", hash: "0x" + "a".repeat(64), blockTimeUtc: new Date(observed).toISOString() };
const delegate = { address: MOBILE_DELEGATE_POLICY.address, designator: MOBILE_DELEGATE_POLICY.designator,
  runtimeHash: MOBILE_DELEGATE_POLICY.runtimeHash };
const account = MOBILE_DEPLOYMENT_PAYER;
const alternative = "0x" + "1".repeat(40);
const tip = { number: "0x65", hash: "0x" + "b".repeat(64), timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16) };
const chosenAnchor = { number: "0x64", hash: anchor.hash, timestamp: "0x" + Math.floor(observed / 1000).toString(16) };
const [operations, reserve] = pinnedSafeCreationRows();
const { safeProfile, owners, threshold, saltNonce, initializerHash } = operations.details;
const packet = {
  schemaVersion: 2, scope: "RMT_4663_OPERATIONS_SAFE_UNSIGNED_REVIEW", status: "BLOCKED_NO_BROADCAST",
  broadcastAuthorized: false, chainId: 4663, sender: account, observedAt: new Date(observed).toISOString(),
  expiresAt: new Date(observed + 120_000).toISOString(), anchor, pendingNonce: "50", confirmedNonce: "50",
  balanceWei: "5000000000000000", delegation: delegate, planId: "0x" + "c".repeat(64),
  operation: {
    id: operations.id, label: "Review fixture Operations", dependsOn: [], sender: account, nonce: "50",
    destination: operations.to, predictedAddress: operations.expectedAddress, valueWei: "0", inputHash: operations.dataHash,
    action: "createProxyWithNonce(address,bytes,uint256)", status: "UNSIGNED_OPERATIONS_APPROVAL_REQUIRED",
    expectedRuntimeHash: safeProxyRuntimeHash, owners, threshold, safeVersion: safeProfile, saltNonce, initializerHash,
    gas: { gasUnits: "313391", l2GasUnits: "313390", l1PosterGasUnits: "1", estimatedFeeWei: "6267820000000",
      estimatedL2FeeWei: "6267800000000", estimatedL1FeeWei: "20000000", provenance: "CURRENT_4663_READ_ONLY_NITRO_GAS_COMPONENTS" },
    checks: ["Confirm the expected Safe and its canonical receipt before advancing"],
  },
  terms: {
    fixedSupplyTokens: "1000000000", decimals: 18, curveTokens: "600000000", liquidityTokens: "400000000",
    projectShareBps: 9000, operationsShareBps: 500, reserveShareBps: 500, creationFeeWei: "400000000000000",
    graduationBackingWei: "2000000000000000000", curveFeeBps: 100, v4PoolFeeBps: 30,
  },
  firstProject: { name: "RMT", symbol: "RMT", projectURI: "", creator: account, treasuryShareBpsOfEligibleFees: 0 },
};
const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const { html, accessCode } = buildPrivatePhoneReview(url, packet, expiry, { runtimeBytesForTest: Buffer.from("6000", "hex") });
assert.ok(!html.includes(accessCode) && !html.includes(packet.planId) && !html.includes(packet.operation.inputHash),
  "Review contents and the access code cannot appear in the exported source");
assert.throws(() => buildPrivatePhoneReview(url, { ...packet, broadcastAuthorized: true }, expiry), /blocked Operations/);
assert.throws(() => buildPrivatePhoneReview(url, { ...packet, rows: [packet.operation, reserve] }, expiry), /Unexpected review fields/);
for (const unexpected of [{ calldata: "0x1234" }, { receiptHash: "0x" + "e".repeat(64) }]) {
  const operation = { ...packet.operation, ...unexpected };
  assert.throws(() => buildPrivatePhoneReview(url, { ...packet, operation }, expiry), /Unexpected review fields/);
}
for (const mutation of [{ id: reserve.id }, { inputHash: reserve.dataHash }, { destination: alternative }, { valueWei: "1" }, { nonce: "51" }]) {
  assert.throws(() => buildPrivatePhoneReview(url, { ...packet, operation: { ...packet.operation, ...mutation } }, expiry),
    /Unexpected Operations Safe transaction identity/);
}
assert.throws(() => buildPrivatePhoneReview(url, { ...packet, firstProject: { ...packet.firstProject, projectURI: "https://example.test" } }, expiry),
  /approved first project/);
assert.throws(() => buildPrivatePhoneReview(url, { ...packet, operation: { ...packet.operation,
  gas: { ...packet.operation.gas, estimatedL1FeeWei: "0" } } }, expiry), /Invalid Operations Safe fee evidence/);
assert.throws(() => buildPrivatePhoneReview(url, { ...packet, expiresAt: expiry }, expiry), /quote window/);
assert.throws(() => buildPrivatePhoneReview("http://review.example.test/", packet, expiry), /approved HTTPS/);
assert.throws(() => buildPrivatePhoneReview("https://review.example.test/?copy=1", packet, expiry), /approved HTTPS/);
assert.throws(() => buildPrivatePhoneReview("https://review.example.com/", packet, expiry, {
  runtimeBytesForTest: Buffer.from("6000", "hex"),
}), /test-only/);

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ ...devices["iPhone 13"], serviceWorkers: "block" });
    page.setDefaultTimeout(8_000);
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const unexpectedNetwork = [];
    const calls = [];
    let selected = account;
    let chain = "0x1237";
    let pending = "0x32";
    let designator = delegate.designator;
    let runtime = "0x6000";
    let safeCode = "0x";
    let safeNonce = "0x0";
    let canonicalAnchor = anchor.hash;
    let reject = false;
    let driftAtFinalNonceRead = false;
    let pendingReads = 0;
    await page.route("**/*", (route) => {
      if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: html });
      unexpectedNetwork.push(route.request().url());
      return route.abort();
    });
    await page.exposeFunction("simulateWallet", ({ method, params }) => {
      calls.push(method);
      switch (method) {
        case "eth_requestAccounts": return reject ? { rejected: true } : { value: [selected] };
        case "eth_accounts": return { value: [selected] };
        case "eth_chainId": return { value: chain };
        case "eth_getBlockByNumber":
          assert.equal(params[1], false);
          assert.ok(["latest", tip.number, chosenAnchor.number].includes(params[0]));
          return { value: params[0] === chosenAnchor.number ? { ...chosenAnchor, hash: canonicalAnchor } : tip };
        case "eth_getTransactionCount":
          if (params[0] === operations.expectedAddress) {
            assert.equal(params[1], "pending");
            return { value: safeNonce };
          }
          assert.equal(params[0], account);
          if (params[1] === "pending") {
            pendingReads++;
            return { value: driftAtFinalNonceRead && pendingReads > 1 ? "0x33" : pending };
          }
          assert.equal(params[1], tip.number);
          return { value: "0x32" };
        case "eth_getCode":
          if (params[0] === operations.expectedAddress) {
            assert.equal(params[1], "pending");
            return { value: safeCode };
          }
          assert.ok([tip.number, "latest"].includes(params[1]));
          if (params[0] === account) return { value: designator };
          assert.equal(params[0], delegate.address);
          assert.equal(params[1], tip.number);
          return { value: runtime };
        default: throw new Error("Unexpected wallet method: " + method);
      }
    });
    await page.addInitScript(() => {
      const listeners = new Map();
      window.ethereum = {
        on(event, callback) { listeners.set(event, callback); },
        async request(intent) {
          const reply = await window.simulateWallet(intent);
          if (reply.rejected) throw Object.assign(new Error("Declined"), { code: 4001 });
          return reply.value;
        },
      };
      window.simulateSelectionChange = () => listeners.get("accountsChanged")();
    });
    await page.goto(new URL("/moved.html", url).href);
    const code = page.getByLabel("Review access code");
    const unlock = page.getByRole("button", { name: "Unlock review" });
    const connect = page.getByRole("button", { name: "Connect wallet and check nonce" });
    const status = (text) => page.getByRole("status").filter({ hasText: text }).waitFor();
    const review = page.getByRole("region", { name: "Unsigned Operations Safe creation" });
    assert.equal(await unlock.isEnabled(), false, "Moving this file must disable the UI");
    await page.goto(url);
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
    assert.deepEqual(pageErrors, []);
    assert.equal(await page.getByRole("status").innerText(), "Enter the access code supplied separately for this review.");
    assert.deepEqual(calls, []);
    const otherCode = accessCode[0] === "A" ? "B" + accessCode.slice(1) : "A" + accessCode.slice(1);
    await code.fill(otherCode);
    await unlock.click();
    await status(/could not be unlocked/);
    assert.equal(await connect.isVisible(), false);
    assert.deepEqual(calls, [], "No wallet permission on failed private access");
    await code.fill(accessCode);
    await unlock.click();
    await status(/Review unlocked/);
    assert.equal(await review.isVisible(), false);
    assert.deepEqual(calls, [], "Unlocking doesn't request wallet access");

    reject = true;
    await connect.click();
    await status(/connection was declined/);
    reject = false;
    selected = alternative;
    await connect.click();
    await status(/Select the proposed deployment account/);
    selected = account;
    chain = "0x1";
    await connect.click();
    await status(/Select Robinhood Chain 4663/);
    assert.deepEqual(calls, ["eth_requestAccounts", "eth_requestAccounts", "eth_accounts",
      "eth_requestAccounts", "eth_accounts", "eth_chainId"], "Wrong wallet or chain cannot start onchain reads");
    chain = "0x1237";
    canonicalAnchor = "0x" + "9".repeat(64);
    await connect.click();
    await status(/observation block did not match/);
    canonicalAnchor = anchor.hash;
    pending = "0x33";
    await connect.click();
    await status(/wallet nonce changed/);
    pending = "0x32";
    designator = "0x";
    await connect.click();
    await status(/wallet delegation changed/);
    designator = delegate.designator;
    runtime = "0x6100";
    await connect.click();
    await status(/runtime did not match/);
    runtime = "0x6000";
    safeCode = "0x6000";
    await connect.click();
    await status(/Safe vacancy could not be verified/);
    safeCode = "0x";
    safeNonce = "0x1";
    await connect.click();
    await status(/Safe vacancy could not be verified/);
    safeNonce = "0x0";
    pendingReads = 0;
    driftAtFinalNonceRead = true;
    await connect.click();
    await status(/wallet nonce changed/);
    driftAtFinalNonceRead = false;
    assert.equal(await review.isVisible(), false);

    const priorRequests = calls.filter((method) => method === "eth_requestAccounts").length;
    await page.evaluate(() => {
      const button = document.getElementById("connect");
      button.onclick();
      button.onclick();
    });
    await status(/pending nonce and Safe vacancy verified/);
    assert.equal(calls.filter((method) => method === "eth_requestAccounts").length, priorRequests + 1);
    assert.equal(await review.locator("details").count(), 3);
    assert.match(await review.innerText(), /0\.00000626782 ETH/);
    assert.match(await review.innerText(), /0 ETH/);
    assert.match(await review.innerText(), /SafeL2 1\.4\.1 · 2 of 3/);
    assert.equal((await review.innerText()).includes(reserve.expectedAddress), false);
    assert.equal(await review.getByRole("button").count(), 0);
    const safeDetails = review.locator("details").first();
    await safeDetails.locator("summary").click();
    assert.match(await safeDetails.innerText(), /Calldata hash/);
    assert.ok((await safeDetails.innerText()).includes(operations.dataHash));
    for (const owner of owners) assert.ok((await safeDetails.innerText()).includes(owner));
    await safeDetails.locator("summary").click();
    const project = review.locator("details").last();
    await project.locator("summary").click();
    assert.match(await project.innerText(), /v4 pool fee\s+0\.30%/);
    assert.match(await project.innerText(), /Project URI\s+Empty/);
    assert.match(await project.innerText(), /Separate project treasury\s+0%/);
    await project.locator("summary").click();
    await page.evaluate((millis) => { Date.now = () => millis; }, Date.parse(packet.expiresAt) + 1);
    await page.getByText("Fee quote expired. Get a fresh quote before transaction approval.").waitFor();
    assert.equal(await page.locator("#fee-value").textContent(), "Expired · see recorded estimate");
    const evidence = review.locator("details").nth(1);
    await evidence.locator("summary").click();
    assert.match(await evidence.innerText(), /Recorded L1 posting cost\s+0\.00000000002 ETH/);
    await evidence.locator("summary").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const summaryBox = await review.boundingBox();
    assert.ok(summaryBox.y + summaryBox.height <= 844, "Portrait summary fits on one screen");
    const artifacts = process.env.RMT_WEBSITE_PREVIEW_ARTIFACTS;
    if (artifacts) await page.screenshot({ path: join(artifacts, "private-review-" + name + "-portrait.png"), fullPage: true });
    await page.setViewportSize({ width: 844, height: 390 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (artifacts) await page.screenshot({ path: join(artifacts, "private-review-" + name + "-landscape.png"), fullPage: true });
    assert.deepEqual(unexpectedNetwork, []);
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    await page.evaluate(() => window.simulateSelectionChange());
    await status(/Wallet selection changed/);
    assert.equal(await review.isVisible(), false);
    await page.evaluate((millis) => { Date.now = () => millis; }, Date.parse(expiry) + 1);
    await connect.click();
    await status(/private review copy has expired/);
    assert.equal(await connect.isEnabled(), false);
  } finally {
    await browser.close();
  }
  console.log("Private unsigned phone review passed on " + name + " iPhone emulation");
}
