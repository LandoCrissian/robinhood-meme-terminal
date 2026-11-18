import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { devices } from "playwright";

const api = "/api/launchpad/test-claim-profiles";
const same = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const stringify = value => JSON.stringify(value, (_, v) => typeof v === "bigint" ? v.toString() : v, 2) + "\n";
const readMethods = new Set(["eth_getBlockByNumber", "eth_getCode", "eth_getTransactionCount"]);

/** Exercise the actual website's EarningsProfileWallet, not a second app or a
 * mocked financial API. The injected provider exposes only public reads and a
 * tightly bound synthetic-transaction bridge. Test keys remain in the existing
 * Node fixture; the browser never receives keys or production wallet access. */
export async function testClaimProfilesBrowser({ browserEngine, site, out, rpc, acceptance,
  waitFor, mine, ready, restart, hideReceipt, hideNativeProof }) {
  const origin = new URL(site);
  assert.equal(origin.protocol, "http:"); assert.equal(origin.hostname, "127.0.0.1");
  assert.equal(typeof browserEngine.newContext, "function", "Supply an already launched Playwright browser");
  const { delegated, relayer, safe, owners } = acceptance.actors;
  const project = acceptance.projects[0];
  assert.ok(project?.token && delegated && relayer && safe && owners.length === 3);
  for (const operation of [rpc, waitFor, mine, ready, restart, hideReceipt, hideNativeProof,
    acceptance.signSafeReview, acceptance.sendReviewedTransaction]) assert.equal(typeof operation, "function");
  const evidence = { schemaVersion: 1, profile: "rmt-claim-wallet-browser-v1", chainId: 31337,
    scope: "LOCAL_SYNTHETIC_BROWSER_NOT_PHYSICAL_IPHONE_OR_PRODUCTION", executionEnabled: false,
    actors: acceptance.actors, token: project.token, status: "incomplete", sends: [], reviews: [], recoveries: [],
    screenshots: [], checks: {}, pageErrors: [], externalRequests: [], walletMethods: [] };
  const save = () => writeFile(join(out, "claim-wallet-browser-evidence.json"), stringify(evidence));
  const context = await browserEngine.newContext(devices["iPhone 13"]);
  const page = await context.newPage(); page.setDefaultTimeout(30_000);
  let currentReview, preparingReview, decisions = 0;
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
  const article = () => page.locator("article.lpEarningsProject").filter({ has: page.locator(`a[href="/launches/${project.token}" i]`) });
  const profile = () => article().getByRole("region", { name: "Wallet execution profile", exact: true });
  const recovery = () => page.getByRole("region", { name: "Claim profile recovery", exact: true });
  const snapshotPath = "/api/launchpad/earnings/" + project.token.toLowerCase();
  page.on("pageerror", error => { evidence.pageErrors.push(error.message); });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin !== origin.origin) {
      evidence.externalRequests.push(route.request().url()); return route.abort();
    }
    return route.continue();
  });
  await context.exposeBinding("syntheticClaimRead", async (_source, method, params = []) => {
    assert.ok(readMethods.has(method), "Browser wallet can only read approved local state");
    assert.ok(Array.isArray(params) && params.length <= 2); evidence.walletMethods.push(method);
    return rpc(method, params);
  });
  await context.exposeBinding("syntheticClaimSend", async (_source, envelope, decision) => {
    assert.ok(currentReview && currentReview.status === "review-only" && currentReview.outer);
    assert.equal(currentReview.chainId, 31337); assert.equal(currentReview.scope, "isolated-local");
    assert.deepEqual(envelope, currentReview.outer, "The browser must send exactly the displayed unsigned outer envelope");
    assert.ok([delegated, relayer].some(a => same(a, envelope.from)), "Only fixture-controlled synthetic payers can send");
    assert.ok(["normal", "lose"].includes(decision));
    assert.equal(evidence.sends.some(s => s.review.intentHash === currentReview.intentHash), false, "No duplicate intent submission");
    const review = structuredClone(currentReview);
    const receipt = await acceptance.sendReviewedTransaction(envelope);
    assert.equal(receipt.status, "success"); assert.match(receipt.transactionHash, /^0x[0-9a-f]{64}$/i);
    const sent = { review, outer: envelope, receipt: { transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash, status: receipt.status,
      gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), logs: receipt.logs }, decision };
    evidence.sends.push(sent); await save();
    // Pause only proof visibility, after the real synthetic transaction mined,
    // before the provider returns. No fake receipt or success is introduced.
    if (decision === "lose") hideReceipt(receipt.transactionHash);
    return receipt.transactionHash;
  });
  await context.addInitScript(({ delegated, relayer }) => {
    let account = delegated.toLowerCase(), chain = "0x7a69", decision = "normal";
    const listeners = new Map();
    const emit = name => { for (const listener of listeners.get(name) ?? []) listener(); };
    const controls = {
      selectAccount(next) {
        if (![delegated, relayer].some(a => a.toLowerCase() === next.toLowerCase())) throw Error("Only this fixture's public test accounts are supported");
        const normalized = next.toLowerCase(); if (account !== normalized) { account = normalized; emit("accountsChanged"); }
      },
      setChain(wrong) { const next = wrong ? "0x1" : "0x7a69"; if (next !== chain) { chain = next; emit("chainChanged"); } },
      setDecision(next) { if (!["normal", "reject", "lose"].includes(next)) throw Error("Invalid synthetic wallet decision"); decision = next; },
    };
    Object.defineProperty(window, "fixtureClaimWallet", { value: controls });
    Object.defineProperty(window, "ethereum", { value: {
      on(name, listener) { const set = listeners.get(name) ?? new Set(); set.add(listener); listeners.set(name, set); },
      removeListener(name, listener) { listeners.get(name)?.delete(listener); },
      async request({ method, params = [] }) {
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
        if (method === "eth_chainId") return chain;
        if (["eth_getBlockByNumber", "eth_getCode", "eth_getTransactionCount"].includes(method)) return window.syntheticClaimRead(method, params);
        if (method === "eth_sendTransaction") {
          if (chain !== "0x7a69" || params.length !== 1 || params[0]?.from?.toLowerCase() !== account) throw Error("Synthetic wallet binding changed");
          const choice = decision; decision = "normal";
          if (choice === "reject") { const error = Error("Synthetic wallet explicitly rejected the transaction"); error.code = 4001; throw error; }
          const hash = await window.syntheticClaimSend(params[0], choice);
          return choice === "lose" ? undefined : hash;
        }
        throw Error("This synthetic fixture does not sign messages, approve assets, change delegation or use other wallet methods: " + method);
      },
    } });
  }, { delegated, relayer });
  async function responseFor(action, task) {
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === api && r.request().method() === "POST"
      && r.request().postDataJSON()?.action === action);
    await task(); const response = await pending, body = await response.json();
    assert.equal(response.status(), 200, stringify(body)); return body;
  }
  async function capture(name) {
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No horizontal viewport overflow");
    const path = join(out, name + ".png"); await page.screenshot({ path, fullPage: true }); evidence.screenshots.push(path); await save();
  }
  async function layouts(name) {
    const inputs = await profile().locator("input:visible,select:visible").evaluateAll(items => items.map(el => ({
      fontSize: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height,
    })));
    assert.ok(inputs.every(v => v.fontSize >= 16 && v.height >= 44), "Visible phone form controls retain 16px text and 44px height");
    for (const [suffix, width, height] of [["portrait", 390, 844], ["landscape", 844, 390], ["desktop-viewport", 1440, 900]]) {
      await page.setViewportSize({ width, height }); await capture(name + "-" + suffix);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  async function lookup(beneficiary) {
    await page.getByLabel("Beneficiary wallet", { exact: true }).fill(beneficiary);
    await button("View earnings").click(); await article().waitFor();
    const response = page.waitForResponse(r => new URL(r.url()).pathname.toLowerCase() === snapshotPath && r.request().method() === "GET");
    await article().getByRole("button", { name: /^Check earnings for / }).click();
    const reply = await response, data = await reply.json(); assert.equal(reply.status(), 200, stringify(data));
    assert.equal(data.status, "ready"); assert.equal(data.snapshot.status, "ready");
    assert.ok(same(data.snapshot.beneficiary, beneficiary)); assert.ok(same(data.snapshot.token, project.token));
    await button("Connect synthetic claim wallet", profile()).waitFor(); return data.snapshot;
  }
  async function connect(account) {
    await page.evaluate(a => window.fixtureClaimWallet.selectAccount(a), account);
    const control = button("Connect synthetic claim wallet", profile());
    if (await control.isVisible()) await control.click();
    await profile().getByText("Gas payer: " + account.toLowerCase(), { exact: true }).waitFor();
  }
  const select = operation => profile().getByLabel("Claim profile operation", { exact: true }).selectOption(operation);
  async function review(approved) {
    preparingReview = await responseFor("prepare", () => button(approved ? "Validate synthetic Safe approvals" : "Review claim wallet profile", profile()).click());
    assert.equal(preparingReview.schemaVersion, 1); assert.ok(same(preparingReview.inner.token, project.token));
    assert.equal(preparingReview.chainId, 31337); assert.equal(preparingReview.scope, "isolated-local");
    assert.equal(preparingReview.executionEnabled, false); currentReview = preparingReview;
    evidence.reviews.push(structuredClone(currentReview)); await save();
    await profile().getByRole("heading", { name: /^Review / }).waitFor(); return currentReview;
  }
  async function recover(review, expected) {
    const region = recovery(), details = region.locator("details.lpRecovery");
    const summary = region.getByText("Recover original profiled claim", { exact: true }); await summary.waitFor();
    if (!await details.evaluate(el => el.open)) await summary.click();
    await region.getByLabel("Original claim intent", { exact: true }).selectOption(review.intentHash);
    const result = await responseFor("verify", () => button("Recover profiled claim receipt", region).click());
    assert.equal(result.profile, "rmt-claim-settlement-v1"); assert.equal(result.intentHash, review.intentHash);
    assert.equal(result.reviewHash, review.reviewHash);
    assert.ok(expected.includes(result.stage), stringify(result));
    if (result.stage === "canonical-l2") {
      assert.equal(result.indexed, true); assert.equal(result.providers.status, "agree");
      assert.equal(result.finality.status, "unverified"); assert.equal(result.finality.l1Finality, "not-applicable");
      assert.ok(same(result.activity.actor, review.actor) && same(result.activity.gasPayer, review.gasPayer));
      assert.equal(result.activity.transactionHash, result.transactionHash);
    }
    evidence.recoveries.push(result); await save(); return result;
  }
  async function confirm(decision = "normal") {
    assert.ok(currentReview); const original = currentReview;
    await page.evaluate(value => window.fixtureClaimWallet.setDecision(value), decision); decisions++;
    if (decision === "reject") {
      const before = evidence.sends.length; await button("Confirm synthetic claim transaction", profile()).click();
      await profile().getByText("Wallet request rejected. No retry or signature will be requested automatically.", { exact: true }).waitFor();
      assert.equal(evidence.sends.length, before); return null;
    }
    const result = await responseFor("verify", () => button("Confirm synthetic claim transaction", profile()).click());
    await waitFor("one exact original synthetic claim submission", async () => evidence.sends.some(s => s.review.intentHash === original.intentHash));
    assert.equal(result.intentHash, original.intentHash); evidence.recoveries.push(result); await save(); return result;
  }
  async function approvedSafe(operation) {
    await select(operation); assert.equal(await profile().getByLabel("Claim wallet profile", { exact: true }).inputValue(), "safe-1.4.1");
    const proposal = await review();
    assert.equal(proposal.status, "awaiting-safe-approvals"); assert.equal(proposal.outer, null);
    assert.equal(proposal.actor.toLowerCase(), safe.toLowerCase()); assert.equal(proposal.gasPayer.toLowerCase(), relayer.toLowerCase());
    const input = profile().getByLabel("Safe test approvals", { exact: true });
    await input.fill(await acceptance.signSafeReview(proposal, 1));
    assert.equal(await button("Validate synthetic Safe approvals", profile()).isDisabled(), true, "One owner approval cannot enable Safe execution");
    await input.fill(await acceptance.signSafeReview(proposal, 2));
    assert.equal(await button("Validate synthetic Safe approvals", profile()).isEnabled(), true);
    const readyReview = await review(true); assert.equal(readyReview.status, "review-only");
    assert.equal(readyReview.wallet.safe.transactionHash, proposal.wallet.safe.transactionHash);
    assert.equal(readyReview.authorizations.ownerApprovalsCollected, 2);
    assert.equal(readyReview.outer.from.toLowerCase(), relayer.toLowerCase()); assert.equal(readyReview.outer.to.toLowerCase(), safe.toLowerCase());
    assert.equal(readyReview.inner.from.toLowerCase(), safe.toLowerCase());
    assert.equal(readyReview.inner.beneficiary.toLowerCase(), safe.toLowerCase()); return readyReview;
  }
  try {
    await page.goto(site + "/my-launches/earnings");
    const delegatedSnapshot = await lookup(delegated);
    assert.equal(delegatedSnapshot.lp.status, "ready"); assert.equal(delegatedSnapshot.lp.claimableNativeWei, "0");
    assert.ok(BigInt(delegatedSnapshot.lp.claimableTokenWei) > 0n);
    await connect(delegated); await select("lp-claim-token");
    assert.equal(await profile().getByLabel("Claim wallet profile", { exact: true }).inputValue(), "metamask-7702");
    await review();
    await page.evaluate(() => window.fixtureClaimWallet.setChain(true));
    await button("Connect synthetic claim wallet", profile()).waitFor();
    assert.equal(await button("Confirm synthetic claim transaction", profile()).count(), 0);
    await page.evaluate(() => window.fixtureClaimWallet.setChain(false)); await connect(delegated); await review();
    await page.evaluate(a => window.fixtureClaimWallet.selectAccount(a), relayer);
    await button("Connect synthetic claim wallet", profile()).waitFor();
    assert.equal(await button("Confirm synthetic claim transaction", profile()).count(), 0);
    await connect(delegated); await review(); await layouts("claim-wallet-delegated-review");
    await confirm("reject"); await review();
    const delegatedReview = structuredClone(currentReview); await confirm("lose");
    assert.equal(evidence.sends.length, 1); await page.reload();
    await recover(delegatedReview, ["submitted", "unavailable"]);
    assert.equal(evidence.sends.length, 1, "Refreshing missing-hash recovery never resubmits");
    await capture("claim-wallet-missing-hash-pending");
    hideReceipt(undefined); await mine(); await ready();
    const delegatedResult = await recover(delegatedReview, ["canonical-l2"]);
    assert.equal(delegatedResult.transactionHash, evidence.sends[0].receipt.transactionHash);
    evidence.checks.delegatedAccountChainInvalidationRejectionAndMissingHash = true;

    const safeSnapshot = await lookup(safe); assert.equal(safeSnapshot.lp.status, "ready");
    assert.ok(BigInt(safeSnapshot.lp.claimableNativeWei) > 0n && BigInt(safeSnapshot.lp.claimableTokenWei) > 0n);
    await connect(relayer); const nativeReview = await approvedSafe("lp-claim-native");
    await layouts("claim-wallet-safe-native-review");
    hideNativeProof(true); const nativeObserved = await confirm();
    assert.equal(evidence.sends.length, 2); assert.notEqual(nativeObserved.stage, "canonical-l2"); assert.notEqual(nativeObserved.stage, "settled");
    await page.reload(); const pendingNative = await recover(nativeReview, ["receipt-observed"]);
    assert.equal(pendingNative.receiptObserved, true); assert.equal(pendingNative.activity, undefined); assert.equal(pendingNative.amounts, undefined);
    assert.equal(evidence.sends.length, 2); await capture("claim-wallet-safe-native-proof-pending");
    hideNativeProof(false); await mine(); await ready(); await recover(nativeReview, ["canonical-l2"]);
    evidence.checks.safeNativeRequiresIndependentPaymentEvidence = true;

    const afterNative = await lookup(safe); assert.equal(afterNative.lp.status, "ready");
    assert.equal(afterNative.lp.claimableNativeWei, "0"); assert.equal(afterNative.lp.claimableTokenWei, safeSnapshot.lp.claimableTokenWei);
    await connect(relayer); const tokenReview = await approvedSafe("lp-claim-token");
    assert.equal(BigInt(tokenReview.wallet.safe.nonce), BigInt(nativeReview.wallet.safe.nonce) + 1n);
    assert.notEqual(tokenReview.wallet.safe.transactionHash, nativeReview.wallet.safe.transactionHash);
    await layouts("claim-wallet-safe-token-review"); await confirm();
    assert.equal(evidence.sends.length, 3); await mine(); await ready(); await recover(tokenReview, ["canonical-l2"]);
    const afterToken = await lookup(safe); assert.equal(afterToken.lp.status, "ready");
    assert.equal(afterToken.lp.claimableNativeWei, "0"); assert.equal(afterToken.lp.claimableTokenWei, "0");
    assert.equal(afterToken.lp.liquidityWei, safeSnapshot.lp.liquidityWei);
    assert.equal(afterToken.lp.positionTokenId, safeSnapshot.lp.positionTokenId);
    if (acceptance.checkPositionCustody) await acceptance.checkPositionCustody();
    evidence.checks.safeSeparateNativeTokenClaimsAndPrincipal = true;
    await restart(); await page.reload();
    for (const original of [delegatedReview, nativeReview, tokenReview]) await recover(original, ["canonical-l2"]);
    assert.equal(evidence.sends.length, 3, "App/indexer restart must not submit any original intent again");
    const finalSnapshot = await lookup(safe); assert.equal(finalSnapshot.lp.status, "ready");
    assert.equal(finalSnapshot.lp.claimableNativeWei, "0"); assert.equal(finalSnapshot.lp.claimableTokenWei, "0");
    assert.equal(finalSnapshot.lp.liquidityWei, safeSnapshot.lp.liquidityWei);
    evidence.checks.restartRecoveryDurableIndexedOriginals = true;
    evidence.checks.publicProfileSigningRequested = false; evidence.checks.syntheticTransactionsOnly = true;
    evidence.checks.walletConfirmationAttempts = decisions;
    assert.equal(decisions, 4, "One explicit rejection and exactly three explicit synthetic sends");
    assert.deepEqual(evidence.pageErrors, []); assert.deepEqual(evidence.externalRequests, []);
    evidence.status = "passed"; await save(); return evidence;
  } catch (error) {
    evidence.failure = error instanceof Error ? error.stack : String(error);
    await page.screenshot({ path: join(out, "claim-wallet-browser-failure.png"), fullPage: true }).catch(() => undefined);
    evidence.failurePage = await page.locator("body").innerText().catch(() => "Page unavailable");
    await save(); throw error;
  } finally {
    hideReceipt(undefined); hideNativeProof(false); await context.close();
  }
}
