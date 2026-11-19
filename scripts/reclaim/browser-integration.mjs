import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { devices } from "playwright";

const api = "/api/launchpad/test-reclaim", readApi = "/api/launchpad/reclaim";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
const reads = new Set(["eth_getCode", "eth_getBlockByNumber", "eth_getTransactionCount"]);

/** Uses the real Reclaim form, API and isolated signer. This module does not
 * mock a successful server response, oracle, reserve or wallet settlement. */
export async function createReclaimBrowserSession({ browserEngine, site, out, rpc, client, creator, send, mine, ready, hideReceipt }) {
  assert.equal(new URL(site).hostname, "127.0.0.1"); assert.equal(new URL(site).protocol, "http:");
  assert.equal(await client.getChainId(), 31337);
  const context = await browserEngine.newContext({ ...devices["iPhone 13"], serviceWorkers: "block" }), page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const evidence = { schemaVersion: 1, profile: "rmt-reclaim-browser-v1", chainId: 31337,
    scope: "SYNTHETIC_BROWSER_NOT_PHYSICAL_IPHONE_OR_PRODUCTION", status: "incomplete", sends: [], reviews: [], recoveries: [],
    screenshots: [], layouts: [], walletMethods: [], pageErrors: [], externalRequests: [], forbiddenRequests: [], checks: {} };
  const save = () => writeFileSync(join(out, "reclaim-browser-evidence.json"), json(evidence));
  let currentReview;
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
  page.on("pageerror", error => { evidence.pageErrors.push(error.message); save(); });
  await context.route("**/*", route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== new URL(site).origin) { evidence.externalRequests.push(url.origin); save(); return route.abort(); }
    if (/^\/(?:preview-rpc|mcp|admin)(?:\/|$)/.test(url.pathname)
      || request.method() !== "GET" && url.pathname.startsWith("/api/") && url.pathname !== api) {
      evidence.forbiddenRequests.push(`${request.method()} ${url.pathname}`); save(); return route.abort();
    }
    return route.continue();
  });
  await context.exposeBinding("syntheticReclaimRead", async (_source, method, params = []) => {
    assert.ok(reads.has(method) && Array.isArray(params) && params.length <= 2);
    evidence.walletMethods.push(method); return rpc(method, params);
  });
  await context.exposeBinding("syntheticReclaimMethod", (_source, method) => { evidence.walletMethods.push(method); });
  await context.exposeBinding("syntheticReclaimSend", async (_source, request, decision) => {
    assert.ok(currentReview && currentReview.status === "prepared" && currentReview.request, "A real prepared server review must precede submission");
    assert.equal(currentReview.profile, "rmt-reclaim-v1"); assert.equal(currentReview.chainId, 31337); assert.equal(request.chainId, "0x7a69");
    assert.ok(same(request.from, creator)); assert.deepEqual(request, currentReview.request, "Every wallet field must match the exact reviewed envelope");
    assert.equal(request.value, "0x0"); assert.equal(evidence.sends.some(item => item.review.reviewHash === currentReview.reviewHash), false, "A reviewed request cannot submit twice");
    const receipt = await send(creator, request); assert.equal(receipt.status, "success");
    assert.equal((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash);
    const entry = { review: structuredClone(currentReview), request, receipt: { transactionHash: receipt.transactionHash, blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), logs: receipt.logs } };
    evidence.sends.push(entry); save();
    if (decision === "lose") hideReceipt?.(receipt.transactionHash);
    return receipt.transactionHash;
  });
  await context.addInitScript(({ creator }) => {
    let chain = "0x7a69", decision = "normal"; const listeners = new Map();
    window.reclaimFixtureWallet = { decision(value) { decision = value; }, chain(wrong) { chain = wrong ? "0x1" : "0x7a69"; for (const listener of listeners.get("chainChanged") ?? []) listener(chain); } };
    window.ethereum = { on(name, listener) { const list = listeners.get(name) ?? new Set(); list.add(listener); listeners.set(name, list); },
      removeListener(name, listener) { listeners.get(name)?.delete(listener); }, async request({ method, params = [] }) {
        if (method === "eth_accounts" || method === "eth_requestAccounts") { await window.syntheticReclaimMethod(method); return [creator.toLowerCase()]; }
        if (method === "eth_chainId") { await window.syntheticReclaimMethod(method); return chain; }
        if (["eth_getCode", "eth_getBlockByNumber", "eth_getTransactionCount"].includes(method)) return window.syntheticReclaimRead(method, params);
        if (method !== "eth_sendTransaction" || chain !== "0x7a69" || params.length !== 1 || params[0]?.from?.toLowerCase() !== creator.toLowerCase()) throw Error("Unsupported synthetic Reclaim wallet request");
        await window.syntheticReclaimMethod(method); const selected = decision; decision = "normal";
        if (selected === "reject") throw Object.assign(Error("Synthetic owner rejection"), { code: 4001 });
        const hash = await window.syntheticReclaimSend(params[0], selected); return selected === "lose" ? undefined : hash;
      } };
  }, { creator });
  async function response(action, task, expectedHttp = 200) {
    // Consume the real response as soon as it arrives. WebKit/CDP may discard a
    // body if a long action completes before its response is consumed.
    const observed = page.waitForResponse(result => new URL(result.url()).pathname === api && result.request().method() === "POST"
      && result.request().postDataJSON()?.action === action).then(async result => ({ httpStatus: result.status(), payload: await result.json() }));
    await task(); const result = await observed; assert.equal(result.httpStatus, expectedHttp, json(result.payload)); return result.payload;
  }
  async function openDetail(text) {
    const details = page.locator("details").filter({ has: page.locator("summary").filter({ hasText: text }) }).filter({ has: page.locator(":scope > summary").filter({ hasText: text }) });
    assert.equal(await details.count(), 1, text); if (!await details.evaluate(element => element.open)) await details.locator(":scope > summary").click();
  }
  async function ownerOpen() { await openDetail("Campaign owner dashboard"); }
  async function connect() { await button("Connect test wallet").click(); await page.getByText(/Test wallet connected on isolated chain 31337/).waitFor(); }
  async function lookup(campaign) {
    await page.getByLabel("Campaign address", { exact: true }).fill(campaign);
    const observed = page.waitForResponse(result => new URL(result.url()).pathname === readApi).then(async result => ({ status: result.status(), body: await result.json() }));
    await button("View campaign").click(); const result = await observed; assert.equal(result.status, 200); assert.equal(result.body.status, "ready", json(result.body));
    assert.ok(same(result.body.campaign, campaign)); return result.body;
  }
  async function review(name, expectedOperation, scope = page) {
    currentReview = undefined;
    const result = await response("prepare", () => button(name, scope).click());
    assert.ok(["prepared", "needs-safe-approvals"].includes(result.status), json(result));
    if (expectedOperation) assert.equal(result.operation, expectedOperation);
    assert.equal(result.chainId, 31337); assert.equal(result.scope, "isolated-local"); assert.equal(result.executionEnabled, false);
    assert.equal(result.custody, "reversible-escrow"); currentReview = result; evidence.reviews.push(result); save(); return result;
  }
  async function reviewRejected(name, expectedHttp, expectedStatus, scope = page) {
    currentReview = undefined; const before = evidence.sends.length;
    const payload = await response("prepare", () => button(name, scope).click(), expectedHttp);
    assert.equal(payload.status, expectedStatus); assert.equal(evidence.sends.length, before);
    evidence.rejectedReviews ??= []; evidence.rejectedReviews.push({ name, httpStatus: expectedHttp, status: payload.status, noSubmission: true }); save(); return payload;
  }
  const humanUnits = value => {
    const n = BigInt(value); const decimal = (n % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
    return (n / 10n ** 18n).toString() + (decimal ? "." + decimal : "");
  };
  async function action(operation, fields = {}, decision) {
    const participant = ["approve-721", "approve-1155", "revoke-1155", "redeem", "approve-return", "return"].includes(operation);
    if (!participant) await ownerOpen();
    if (fields.collection) await page.getByLabel("Collection", { exact: true }).selectOption(fields.collection);
    if (fields.controller) await page.getByLabel("Controller address", { exact: true }).fill(fields.controller);
    if (fields.rewardPerUnit) await page.getByLabel("Fixed reward per NFT (synthetic RMT)", { exact: true }).fill(humanUnits(fields.rewardPerUnit));
    if (fields.walletCap) await page.getByLabel("Campaign units per wallet", { exact: true }).fill(fields.walletCap);
    if (fields.amountWei) await page.getByLabel("Amount (synthetic RMT)", { exact: true }).fill(humanUnits(fields.amountWei));
    if (fields.collectionCap) await page.getByLabel("Collection unit cap", { exact: true }).fill(fields.collectionCap);
    if (fields.collectionWalletCap) await page.getByLabel("Collection units per wallet", { exact: true }).fill(fields.collectionWalletCap);
    if (fields.tokenIds) await page.getByLabel("Exact token IDs", { exact: true }).fill(fields.tokenIds.join(", "));
    if (fields.tokenId !== undefined) await page.getByLabel("Exact token IDs", { exact: true }).fill(fields.tokenId);
    if (fields.quantities) await page.getByLabel("Quantities in matching order", { exact: true }).fill(fields.quantities.join(", "));
    if (fields.next) await page.getByLabel("Incoming controller", { exact: true }).fill(fields.next);
    const names = { "create-campaign": "Review campaign creation", "approve-funding": "Review exact funding approval", fund: "Review manual funding",
      "propose-collection": "Review collection notice", "execute-collection": "Review collection admission", "cancel-collection": "cancel collection", "disable-collection": "disable collection",
      "approve-721": "Review NFT approval", "approve-1155": "Review NFT approval", "revoke-1155": "Review ERC-1155 approval revocation", redeem: "Review NFT trade-in",
      "approve-return": "Review reward repayment approval", return: "Review NFT return", pause: "pause", resume: "resume", "propose-rate": "Review future reward notice",
      "execute-rate": "execute rate", "cancel-rate": "cancel rate", "propose-close": "propose close", "execute-close": "execute close", "cancel-close": "cancel close",
      "propose-recovery": "Review uncommitted reserve recovery", "execute-recovery": "execute recovery", "cancel-recovery": "cancel recovery",
      "propose-controller": "propose controller", "accept-controller": "accept controller", "cancel-controller": "cancel controller" };
    assert.ok(names[operation], "Known explicit Reclaim operation"); let scope = page;
    if (operation === "return" || operation === "approve-return") {
      await openDetail("Escrow receipts and returns");
      scope = page.locator("li").filter({ has: page.getByText(new RegExp(`^Receipt ${fields.receiptId} ·`)) }); assert.equal(await scope.count(), 1);
    }
    const prepared = await review(names[operation], operation, scope);
    for (const [key, value] of Object.entries(fields)) {
      if (key === "expiresAt" || key === "intentId") continue; // The UI generates these technical values; the returned exact review preserves them.
      if (typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)) assert.ok(same(prepared.fields[key], value));
      else assert.deepEqual(prepared.fields[key], value);
    }
    return { review: prepared, ...(decision !== undefined && prepared.status === "prepared" && { submission: await confirm(decision) }) };
  }
  async function confirm(decision = "normal") {
    assert.ok(currentReview?.request); assert.equal(currentReview.status, "prepared");
    const original = structuredClone(currentReview), before = evidence.sends.length;
    await page.evaluate(value => window.reclaimFixtureWallet.decision(value), decision);
    await button("Confirm test Reclaim transaction").click();
    const expected = decision === "reject" ? "wallet-rejected" : decision === "lose" ? "hash-missing" : "pending";
    await page.waitForFunction(({ reviewHash, expected }) => {
      const raw = localStorage.getItem("rmt.reclaim.pending.v1:" + reviewHash); return raw && JSON.parse(raw).stage === expected;
    }, { reviewHash: original.reviewHash, expected });
    assert.equal(evidence.sends.length, before + (decision === "reject" ? 0 : 1));
    if (decision === "reject") { evidence.rejectedWallet = { reviewHash: original.reviewHash, noSubmission: true }; save(); return { review: original, rejected: true }; }
    return evidence.sends.at(-1);
  }
  async function verify({ review: original = currentReview, hash, status = "confirmed", indexed } = {}) {
    assert.ok(original); await openDetail("Recover original Reclaim transaction");
    await page.getByLabel("Original Reclaim request", { exact: true }).selectOption(original.reviewHash);
    if (hash) await page.getByLabel("Original transaction hash (if available)", { exact: true }).fill(hash);
    const before = evidence.sends.length, walletBefore = evidence.walletMethods.filter(method => method === "eth_sendTransaction").length;
    const result = await response("verify", () => button("Verify original Reclaim transaction").click());
    assert.equal(result.status, status, json(result)); assert.equal(result.reviewHash, original.reviewHash);
    if (indexed !== undefined) assert.equal(result.indexed, indexed);
    assert.equal(evidence.sends.length, before); assert.equal(evidence.walletMethods.filter(method => method === "eth_sendTransaction").length, walletBefore);
    evidence.recoveries.push({ reviewHash: original.reviewHash, hashEntered: hash ?? null, result, noSubmission: true }); save(); return result;
  }
  async function capture(name) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal overflow");
    const state = () => page.evaluate(() => ({ touch: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches }));
    const before = await state(), file = `${name}.png`; await page.screenshot({ path: join(out, file) }); assert.deepEqual(await state(), before);
    evidence.screenshots.push(file); save();
  }
  async function layouts(name) {
    for (const [layout, width, height] of [["portrait", 390, 844], ["landscape", 844, 390], ["desktop-viewport", 1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height && matchMedia("(max-width:900px)").matches === (width <= 900), { width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const fields = await page.getByRole("main").locator("input:visible, select:visible, button:visible, summary:visible").evaluateAll(items => items.map(element => ({ id: element.id || element.tagName,
        height: element.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(element).fontSize), field: ["INPUT", "SELECT"].includes(element.tagName) })));
      assert.ok(fields.every(field => field.height >= 44 && (!field.field || width > 900 || field.fontSize >= 16)), json(fields));
      const media = await page.evaluate(() => ({ touch: navigator.maxTouchPoints, coarse: matchMedia("(pointer: coarse)").matches, width: innerWidth, height: innerHeight }));
      assert.equal(media.coarse, true); evidence.layouts.push({ name, layout, width, height, fields, media });
      await capture(name + "-" + layout);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  async function desktopRead(campaign) {
    const desktop = await browserEngine.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" }), desktopPage = await desktop.newPage();
    const wallet = [], errors = [];
    try {
      await desktop.exposeBinding("unexpectedReclaimDesktopWallet", (_source, method) => wallet.push(method));
      await desktop.addInitScript(() => Object.defineProperty(window, "ethereum", { get() { void window.unexpectedReclaimDesktopWallet("provider-read"); return undefined; } }));
      desktopPage.on("pageerror", error => errors.push(error.message));
      const response = desktopPage.waitForResponse(result => new URL(result.url()).pathname === readApi).then(async result => ({ status: result.status(), body: await result.json() }));
      await desktopPage.goto(site + "/reclaim?campaign=" + campaign); const result = await response;
      assert.equal(result.status, 200); assert.equal(result.body.status, "ready"); assert.ok(same(result.body.campaign, campaign));
      await desktopPage.getByRole("heading", { name: "Verified campaign", exact: true }).waitFor();
      assert.equal(await desktopPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(wallet, []); assert.deepEqual(errors, []);
      await desktopPage.screenshot({ path: join(out, "reclaim-standard-desktop.png") });
      evidence.desktopRead = { campaign, status: result.body.status, indexed: result.body.history.indexed, walletInjected: false, walletRequests: wallet.length, errors };
      evidence.layouts.push({ name: "reclaim-standard-desktop", layout: "standard-desktop-context", walletInjected: false, walletRequests: wallet.length, noOverflow: true }); save(); return result.body;
    } finally { await desktop.close(); }
  }
  try { await page.goto(site + "/reclaim"); await page.locator('[data-reclaim-ready="true"]').waitFor(); save(); }
  catch (error) { evidence.failure = error instanceof Error ? error.stack : String(error); save(); await context.close(); throw error; }
  return { page, context, evidence, connect, lookup, ownerOpen, review, reviewRejected, action, confirm, verify, capture, layouts, desktopRead,
    fill: async (name, value) => page.getByLabel(name, { exact: true }).fill(value),
    selectCollection: async address => page.getByLabel("Collection", { exact: true }).selectOption(address),
    async refresh(campaign) { if (campaign) await lookup(campaign); else await button("Refresh campaign evidence").click(); },
    async mineReady() { await mine(); await ready(); },
    async close() { assert.deepEqual(evidence.pageErrors, []); assert.deepEqual(evidence.externalRequests, []); assert.deepEqual(evidence.forbiddenRequests, []); evidence.status = "passed"; save(); await context.close(); },
  };
}
