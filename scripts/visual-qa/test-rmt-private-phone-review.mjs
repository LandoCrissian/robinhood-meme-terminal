import assert from "node:assert/strict";
import { join } from "node:path";
import { chromium, devices, webkit } from "playwright";
import { MOBILE_DELEGATE_POLICY, MOBILE_DEPLOYMENT_PAYER } from "../production-readiness/mobile-sender.mjs";
import { buildPrivatePhoneReview } from "./export-rmt-private-phone-review.mjs";

const url = "https://rmt-private-review.example.test/";
const observed = Date.now() - 180_000;
const anchor = { number: "100", hash: "0x" + "a".repeat(64), blockTimeUtc: new Date(observed).toISOString() };
const delegate = { address: MOBILE_DELEGATE_POLICY.address, designator: MOBILE_DELEGATE_POLICY.designator,
  runtimeHash: MOBILE_DELEGATE_POLICY.runtimeHash };
const account = MOBILE_DEPLOYMENT_PAYER;
const alternative = "0x" + "1".repeat(40);
const tip = { number: "0x65", hash: "0x" + "b".repeat(64), timestamp: "0x" + Math.floor(Date.now() / 1000).toString(16) };
const chosenAnchor = { number: "0x64", hash: anchor.hash, timestamp: "0x" + Math.floor(observed / 1000).toString(16) };
const stages = [
  "operations-safe", "reserve-safe", "directory", "registry", "successor-v2", "successor-v3", "bootstrap",
  "schedule-factory", "execute-factory", "schedule-migration-template", "execute-migration-template", "first-rmt",
];
const packet = {
  schemaVersion: 1, scope: "RMT_4663_UNSIGNED_PRIVATE_REVIEW", status: "BLOCKED_NO_BROADCAST",
  broadcastAuthorized: false, chainId: 4663, sender: account, observedAt: new Date(observed).toISOString(),
  expiresAt: new Date(observed + 120_000).toISOString(), anchor, pendingNonce: "50", confirmedNonce: "50",
  balanceWei: "5000000000000000", delegation: delegate, planId: "0x" + "c".repeat(64),
  rows: stages.map((id, index) => ({
    id, label: "Review fixture " + id, dependsOn: index ? [stages[index - 1]] : [],
    sender: index < 7 ? account : null, nonce: index < 7 ? String(50 + index) : null,
    destination: index < 2 ? alternative : null, predictedAddress: index < 7 ? alternative : null,
    valueWei: "0", inputHash: index < 7 ? "0x" + "d".repeat(64) : null,
    action: "Fixture action", status: "BLOCKED", expectedRuntimeHash: null,
    gas: { gasUnits: null, l2GasUnits: null, l1PosterGasUnits: null, estimatedFeeWei: null, provenance: "Fixture evidence" },
    checks: ["Wait for verified prerequisites"],
  })),
  terms: {
    fixedSupplyTokens: "1000000000", decimals: 18, curveTokens: "600000000", liquidityTokens: "400000000",
    projectShareBps: 9000, operationsShareBps: 500, reserveShareBps: 500, creationFeeWei: "400000000000000",
    graduationBackingWei: "2000000000000000000", curveFeeBps: 100,
  },
  approvals: [{ id: "safe-creation", label: "Owner review for Safe creation", status: "UNASSIGNED" }],
};
const expiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const { html, accessCode } = buildPrivatePhoneReview(url, packet, expiry, { runtimeBytesForTest: Buffer.from("6000", "hex") });
assert.ok(!html.includes(accessCode) && !html.includes(packet.planId) && !html.includes(packet.rows[0].label),
  "Review contents and the access code cannot appear in the exported source");
assert.throws(() => buildPrivatePhoneReview(url, { ...packet, broadcastAuthorized: true }, expiry), /blocked sanitized/);
for (const unexpected of [{ calldata: "0x1234" }, { receiptHash: "0x" + "e".repeat(64) }]) {
  const rows = [{ ...packet.rows[0], ...unexpected }, ...packet.rows.slice(1)];
  assert.throws(() => buildPrivatePhoneReview(url, { ...packet, rows }, expiry), /Unexpected review fields/);
}
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
    const unexpectedNetwork = [];
    const calls = [];
    let selected = account;
    let chain = "0x1237";
    let pending = "0x32";
    let designator = delegate.designator;
    let runtime = "0x6000";
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
          assert.equal(params[0], account);
          if (params[1] === "pending") {
            pendingReads++;
            return { value: driftAtFinalNonceRead && pendingReads > 1 ? "0x33" : pending };
          }
          assert.equal(params[1], tip.number);
          return { value: "0x32" };
        case "eth_getCode":
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
    const review = page.getByRole("region", { name: "Unsigned deployment sequence" });
    assert.equal(await unlock.isEnabled(), false, "Moving this file must disable the UI");
    await page.goto(url);
    assert.equal(await page.evaluate(() => window.isSecureContext), true);
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
    await status(/pending nonce verified/);
    assert.equal(calls.filter((method) => method === "eth_requestAccounts").length, priorRequests + 1);
    assert.equal(await review.locator("details").count(), 12);
    assert.match(await review.innerText(), /fee snapshot has expired/);
    await review.locator("summary").first().click();
    assert.match(await review.locator("details").first().innerText(), /Calldata hash/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
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
