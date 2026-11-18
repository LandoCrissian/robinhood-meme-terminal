import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { devices } from "playwright";

const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
const api = "/api/launchpad/test-project-treasury", creationApi = "/api/launchpad/test-creation";
const permittedReads = new Set(["eth_getCode", "eth_getBlockByNumber", "eth_getTransactionCount"]);

/** The real creator components and server review are used. Only the already
 * reviewed envelope is forwarded to an isolated signer held in Node memory. */
export async function createTreasuryProjectsFromForm({ browserEngine, site, out, rpc, client, creator, treasuryDeployment,
  factoryAbi, treasuryAbi, send, event, mine, ready, waitFor, hideReceipt }) {
  assert.equal(new URL(site).hostname, "127.0.0.1");
  const context = await browserEngine.newContext(devices["iPhone 13"]), page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const evidence = { schemaVersion: 1, profile: "rmt-project-treasury-browser-v1", chainId: 31337,
    scope: "SYNTHETIC_BROWSER_NOT_PHYSICAL_IPHONE_OR_PRODUCTION", status: "incomplete", sends: [], reviews: [],
    recoveries: [], screenshots: [], layouts: [], pageErrors: [], externalRequests: [], walletMethods: [] };
  const save = () => writeFileSync(join(out, "project-treasury-browser-evidence.json"), json(evidence));
  let currentReview;
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
  page.on("pageerror", error => evidence.pageErrors.push(error.message));
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== new URL(site).origin) { evidence.externalRequests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await context.exposeBinding("syntheticTreasuryRead", async (_source, method, params = []) => {
    assert.ok(permittedReads.has(method) && Array.isArray(params) && params.length <= 2);
    evidence.walletMethods.push(method); return rpc(method, params);
  });
  await context.exposeBinding("syntheticTreasurySend", async (_source, request, decision) => {
    assert.ok(currentReview, "A server-verified review must precede wallet submission");
    assert.equal(request.chainId, "0x7a69"); assert.ok(same(request.from, creator));
    const prepared = currentReview.request; assert.ok(prepared);
    for (const field of ["from", "to", "data"]) assert.ok(same(request[field], prepared[field]), "Wallet envelope must match reviewed " + field);
    assert.equal(BigInt(request.value), BigInt(prepared.value));
    if (currentReview.profile === "rmt-project-treasury-v1") assert.deepEqual(request, prepared);
    else assert.ok(same(request.to, treasuryDeployment.coreFactory));
    const reviewKey = currentReview.reviewHash ?? currentReview.request.intentId;
    assert.equal(evidence.sends.some(row => (row.review.reviewHash ?? row.review.request.intentId) === reviewKey), false,
      "A reviewed intent cannot be submitted twice");
    const receipt = await send(creator, request), reviewed = structuredClone(currentReview);
    const entry = { review: reviewed, request, receipt: { transactionHash: receipt.transactionHash, blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber.toString(), status: receipt.status, gasUsed: receipt.gasUsed.toString(), logs: receipt.logs } };
    evidence.sends.push(entry); save();
    if (decision === "lose") hideReceipt(receipt.transactionHash);
    return receipt.transactionHash;
  });
  await context.addInitScript(({ creator }) => {
    let chain = "0x7a69", decision = "normal"; const listeners = new Map();
    window.treasuryFixtureWallet = { decision(value) { decision = value; }, chain(wrong) { chain = wrong ? "0x1" : "0x7a69";
      for (const fn of listeners.get("chainChanged") ?? []) fn(chain); } };
    window.ethereum = { on(name, fn) { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); },
      removeListener(name, fn) { listeners.get(name)?.delete(fn); }, async request({ method, params = [] }) {
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [creator.toLowerCase()];
        if (method === "eth_chainId") return chain;
        if (["eth_getCode", "eth_getBlockByNumber", "eth_getTransactionCount"].includes(method)) return window.syntheticTreasuryRead(method, params);
        if (method !== "eth_sendTransaction" || chain !== "0x7a69" || params.length !== 1 || params[0]?.from?.toLowerCase() !== creator.toLowerCase()) throw Error("Unsupported synthetic wallet request");
        const choice = decision; decision = "normal";
        if (choice === "reject") throw Object.assign(Error("Synthetic owner rejection"), { code: 4001 });
        const hash = await window.syntheticTreasurySend(params[0], choice); return choice === "lose" ? undefined : hash;
      } };
  }, { creator });
  async function response(path, action, task) {
    const promise = page.waitForResponse(result => new URL(result.url()).pathname === path && result.request().method() === "POST"
      && result.request().postDataJSON()?.action === action);
    await task(); const result = await promise, payload = await result.json();
    assert.equal(result.status(), 200, json(payload)); return payload;
  }
  async function capture(name) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal overflow");
    const file = join(out, name + ".png"); await page.screenshot({ path: file, fullPage: true }); evidence.screenshots.push(file); save();
  }
  async function layouts(name) {
    for (const [label, width, height] of [["portrait", 390, 844], ["landscape", 844, 390], ["desktop-viewport", 1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height
        && matchMedia("(max-width:900px)").matches === (width <= 900), { width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const fields = await page.locator("main input:visible:not([type=radio]):not([type=checkbox]):not([type=range]), main select:visible").evaluateAll(items =>
        items.map(el => ({ label: el.getAttribute("aria-label") ?? el.id, height: el.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(el).fontSize) })));
      assert.ok(fields.every(field => field.height >= 44 && (width > 900 || field.fontSize >= 16)), json(fields));
      evidence.layouts.push({ name, label, width, height, fields }); await capture(name + "-" + label);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  async function fill(name, symbol) {
    await page.goto(site + "/create-token");
    const edit = button("Edit draft"); if (await edit.isVisible()) await edit.click();
    await page.getByLabel("Token name", { exact: true }).fill(name); await page.getByLabel("Ticker", { exact: true }).fill(symbol);
    const details = page.locator("details.lpCreatorMetadata"); if (!await details.evaluate(el => el.open)) await details.locator("summary").click();
    await page.getByLabel("Project or metadata URL", { exact: true }).fill("https://example.test/" + symbol.toLowerCase());
    const settings = page.locator("details.lpDraftTreasury"); if (!await settings.evaluate(el => el.open)) await settings.locator("summary").click();
    return { name, symbol, projectURI: "https://example.test/" + symbol.toLowerCase() };
  }
  async function createCore(fields, treasury, intentId) {
    await button("Review draft").click(); await page.getByRole("heading", { name: "Review token draft", exact: true }).waitFor();
    await button("Connect test wallet").click();
    currentReview = await response(creationApi, "prepare", () => button("Review test creation").click());
    assert.equal(currentReview.status, "prepared", json(currentReview));
    assert.ok(same(currentReview.request.from, creator) && same(currentReview.request.to, treasuryDeployment.coreFactory));
    if (intentId) assert.ok(same(currentReview.request.intentId, intentId));
    const acknowledgment = page.getByRole("checkbox", { name: "I verified that the treasury controls this address and can submit fee claims.", exact: true });
    if (treasury) { await acknowledgment.waitFor(); await acknowledgment.check(); }
    const before = evidence.sends.length;
    const verified = await response(creationApi, "verify", () => button("Confirm test creation").click());
    assert.ok(["confirmed", "pending"].includes(verified.status), json(verified));
    assert.equal(evidence.sends.length, before + 1);
    const sent = evidence.sends.at(-1), receipt = await client.getTransactionReceipt({ hash: sent.receipt.transactionHash });
    const birth = event(receipt, treasuryDeployment.coreFactory, factoryAbi, "CurveCreated");
    assert.equal(birth.name, fields.name); assert.equal(birth.symbol, fields.symbol); assert.ok(same(birth.creator, creator));
    assert.ok(same(birth.treasury, treasury ?? "0x0000000000000000000000000000000000000000"));
    assert.equal(birth.treasuryShareBps, treasury ? 2250 : 0); assert.equal(birth.supply, 1_000_000_000n * 10n ** 18n);
    await mine(); await ready();
    if (verified.status !== "confirmed" || !verified.indexed) {
      const indexed = await response(creationApi, "verify", () => button("Check creation transaction").click());
      assert.equal(indexed.status, "confirmed"); assert.equal(indexed.indexed, true);
    }
    return { token: birth.token, curve: birth.curve, revenueLedger: birth.revenueLedger,
      treasury: treasury ?? "0x0000000000000000000000000000000000000000", intentId: sent.review.request.intentId,
      creation: sent.receipt, fields, reviewed: sent.review.request };
  }
  try {
    const outFields = await fill("Treasury opt-out 076", "OUT076");
    await page.getByRole("radio", { name: /Pay the creator directly/ }).check();
    const optedOut = await createCore(outFields);
    const fields = await fill("Treasury creator 076", "SIDE076");
    await page.getByRole("radio", { name: /Create a project treasury/ }).check();
    await page.getByLabel("Project treasury controller", { exact: true }).fill(creator);
    await page.getByLabel("Contract treasury share of project fees", { exact: true }).fill("25");
    await button("Review draft").click();
    await page.getByText("Verify the optional treasury deployment first, or choose creator-only fees. A predicted address is not a deployed beneficiary.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Review token draft", exact: true }).count(), 0);
    await button("Connect synthetic treasury creator").click();
    const preview = await response(api, "preview", () => button("Preview project treasury address").click());
    assert.equal(preview.status, "preview", json(preview)); assert.equal(preview.deployed, false);
    assert.equal(preview.treasuryShareBps, 2250); assert.equal(await client.getCode({ address: preview.treasury }), undefined);
    currentReview = await response(api, "prepare", () => button("Review synthetic treasury deployment").click());
    assert.equal(currentReview.status, "prepared"); assert.equal(currentReview.operation, "create-treasury");
    assert.ok(same(currentReview.treasury, preview.treasury)); evidence.reviews.push(currentReview); save();
    await layouts("project-treasury-two-step-review");
    const beforeCancellation = evidence.sends.length;
    await button("Cancel treasury review").click();
    assert.equal(await button("Confirm synthetic treasury transaction").count(), 0); assert.equal(evidence.sends.length, beforeCancellation);
    currentReview = await response(api, "prepare", () => button("Review synthetic treasury deployment").click());
    assert.equal(currentReview.status, "prepared");
    await page.evaluate(() => window.treasuryFixtureWallet.decision("reject"));
    const before = evidence.sends.length; await button("Confirm synthetic treasury transaction").click();
    await page.getByText("Wallet request rejected. The exact request is retained for an explicit retry; nothing is resent automatically.", { exact: true }).waitFor();
    assert.equal(evidence.sends.length, before);
    await page.evaluate(() => window.treasuryFixtureWallet.decision("lose"));
    const pending = await response(api, "verify", () => button("Confirm synthetic treasury transaction").click());
    assert.ok(["pending", "unavailable"].includes(pending.status), json(pending)); assert.equal(evidence.sends.length, before + 1);
    await page.reload(); await button("Connect synthetic treasury creator").click();
    hideReceipt(undefined); await mine(); await ready();
    const recovered = await response(api, "verify", () => button("Recover treasury receipt").click());
    assert.equal(recovered.status, "confirmed", json(recovered)); assert.equal(recovered.indexed, true);
    assert.ok(same(recovered.proof.treasury, preview.treasury)); assert.equal(evidence.sends.length, before + 1);
    evidence.recoveries.push(recovered); await capture("project-treasury-deployment-recovered");
    const optedIn = await createCore(fields, preview.treasury, preview.intentId);
    assert.ok(same(await client.readContract({ address: preview.treasury, abi: treasuryAbi, functionName: "creator" }), creator));
    evidence.status = "created-and-indexed"; save();
    return { context, page, evidence, optedOut, optedIn, capture, layouts, response, button,
      setReview: review => { currentReview = review; }, close: () => context.close(), save };
  } catch (error) { evidence.failure = error instanceof Error ? error.stack : String(error); evidence.failurePage = await page.locator("body").innerText();
    await capture("project-treasury-browser-failure"); save(); throw error; }
}

export async function exerciseTreasuryPage({ session, project, treasury, safe, site, evidence, mine, ready, save }) {
  const { page, button, layouts } = session;
  await mine(); await ready(); await page.goto(site + "/my-launches/treasury");
  await page.getByLabel("Project treasury address", { exact: true }).fill(treasury);
  const observed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/launchpad/project-treasury");
  await button("View treasury").click(); const response = await observed, snapshot = await response.json();
  assert.equal(response.status(), 200); assert.equal(snapshot.status, "ready", json(snapshot));
  assert.ok(same(snapshot.treasury, treasury) && same(snapshot.controller, safe));
  assert.ok(same(snapshot.project.token, project.token)); assert.equal(snapshot.purchases.available, false);
  await button("Connect synthetic treasury controller").click();
  const reviewed = await session.response(api, "prepare", () => button("Review LP token claim").click());
  assert.equal(reviewed.status, "needs-safe-approvals", json(reviewed)); assert.equal(reviewed.request, null);
  assert.ok(same(reviewed.actor, safe) && same(reviewed.treasury, treasury));
  assert.equal(await button("Confirm synthetic treasury transaction").count(), 0, "An EOA cannot impersonate its controller Safe");
  await layouts("project-treasury-safe-dashboard");
  evidence.dashboard = snapshot; session.evidence.checks = { realFormTwoStep: true, missingHashNoDuplicate: true, safeInnerCallNotDirectEoa: true };
  session.evidence.status = "passed"; session.save(); save();
}
