import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Extends the existing real-contract creator fixture. No alternative app,
 * mocked earnings API, privileged browser signer or production connection. */
export async function testEarningsJourney({ page, site, out, pg, rpc, creator, token, project, factory, operations,
  signatures, waitFor, mine, ready, openToken, openTradeWallet, reviewed, executeReviewed, checkSettlement,
  checkPosition, expectedFees, lastReceipt, curveLedger, hideNativeProof, restart }) {
  const started = signatures.length;
  assert.equal(started, 15, "Retain the complete existing lifecycle acceptance before earnings tests");
  const evidence = { chainId: 31337, synthetic: true, factory, token, beneficiary: creator, originalCurveLedger: curveLedger,
    productionExecution: "disabled", receipts: [], checks: {} };
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
  const screenshot = name => page.screenshot({ path: join(out, name + ".png"), fullPage: true });
  const earningsApi = "/api/launchpad/earnings/" + token.toLowerCase();
  const article = () => page.getByRole("article", { name: project.name + " earnings", exact: true });
  const receiptRows = async () => (await pg.query(`SELECT chain_id,factory,deployment_block_hash,token,ledger,account,recipient,block_number::text,block_hash,
    transaction_hash,log_index,payload FROM rmt_curve_fixture_fee_activity ORDER BY block_number,log_index`)).rows;
  const captureSnapshot = async (task) => {
    const response = page.waitForResponse(r => new URL(r.url()).pathname.toLowerCase() === earningsApi && r.request().method() === "GET");
    await task(); const r = await response;
    const body = await r.json();
    assert.equal(r.status(), 200, JSON.stringify(body));
    assert.equal(body.status, "ready"); assert.equal(body.snapshot.status, "ready");
    assert.equal(body.snapshot.token.toLowerCase(), token.toLowerCase());
    assert.equal(body.snapshot.beneficiary.toLowerCase(), creator.toLowerCase());
    assert.equal(body.snapshot.curve.ledger.toLowerCase(), curveLedger.toLowerCase());
    return body.snapshot;
  };
  const lookup = async () => {
    await page.getByLabel("Beneficiary wallet", { exact: true }).fill(creator);
    await button("View earnings").click(); await article().waitFor();
    return captureSnapshot(() => button("Check earnings for " + project.symbol, article()).click());
  };
  const refreshed = () => captureSnapshot(() => button("Refresh contract balances", article()).click());
  const connect = async () => {
    const control = button("Connect test claim wallet", article());
    if (await control.isVisible()) await control.click();
    await article().getByText("Test signer: " + creator.toLowerCase(), { exact: true }).waitFor();
  };
  const select = op => article().getByLabel("Earnings operation", { exact: true }).selectOption(op);
  const review = async () => {
    await button("Review test earnings transaction", article()).click();
    await article().getByRole("heading", { name: /^Review / }).waitFor();
  };
  const confirm = () => button("Confirm test earnings transaction", article()).click();
  const recover = async () => {
    const summary = page.getByText("Recover original earnings transaction", { exact: true });
    const details = page.locator("details").filter({ has: summary });
    if (!await details.evaluate(el => el.open)) await summary.click();
    await button("Recover earnings receipt", details).click();
    await page.getByText("Test claim confirmed onchain. Canonical fee activity indexed.", { exact: true }).first().waitFor();
    assert.equal(await article().getByText("Receipt evidence is unavailable or invalidated. The original request remains recoverable.", { exact: true }).count(), 0,
      "A canonical recovery clears the same transaction's obsolete per-card error");
  };
  const claim = async (operation) => {
    await connect(); await select(operation); await review();
    const before = signatures.length;
    await page.evaluate(() => window.fixtureWallet.setDecision("normal")); await confirm();
    await waitFor(operation + " sent exactly once", async () => signatures.length === before + 1);
    const proof = await lastReceipt(operation); await mine(); await ready();
    await recover();
    evidence.receipts.push(proof); return proof;
  };

  // Real official-router swaps create fresh ETH + token fees. Exact allowances
  // were fully consumed by the preceding lifecycle acceptance.
  await page.evaluate(account => window.fixtureWallet.selectAccount(account), creator);
  await openToken(); await openTradeWallet(); await reviewed("Buy", "0.01");
  const buy = await executeReviewed("test v4 buy", "v4-buy"); await mine(); await ready(); await checkSettlement("v4 buy");
  await reviewed("Sell", "100"); await executeReviewed("exact v4 token approval", "v4-token-approve");
  await mine(); await ready(); await checkSettlement("v4 token approval");
  await reviewed("Sell", "100"); await executeReviewed("exact Permit2 approval", "v4-permit2-approve");
  await mine(); await ready(); await checkSettlement("Permit2 approval");
  await reviewed("Sell", "100"); const sell = await executeReviewed("test v4 sell", "v4-sell");
  await mine(); await ready(); await checkSettlement("v4 sell");
  evidence.feeGeneratingSwaps = { buy, sell };
  await page.goto(site + "/my-launches/earnings");
  const beforeClaims = await lookup(); evidence.beforeClaims = beforeClaims;
  assert.ok(BigInt(beforeClaims.curve.claimableNativeWei) > 0n);
  assert.equal(beforeClaims.lp.status, "ready");
  assert.ok(BigInt(beforeClaims.lp.uncollectedNativeWei) > 0n && BigInt(beforeClaims.lp.uncollectedTokenWei) > 0n);
  assert.equal(beforeClaims.lp.claimableNativeWei, "0"); assert.equal(beforeClaims.lp.claimableTokenWei, "0");
  await screenshot("20-earnings-portrait");
  await connect(); await select("curve-claim"); await review();
  await page.evaluate(() => window.fixtureWallet.setDecision("reject")); await confirm();
  await article().getByText("Wallet request rejected. No new signature will be requested automatically.", { exact: true }).waitFor();
  assert.equal(signatures.length, started + 4);
  await review();
  await page.evaluate(() => window.fixtureWallet.setChain(true));
  await button("Connect test claim wallet", article()).waitFor();
  assert.equal(await button("Confirm test earnings transaction", article()).count(), 0);
  await page.evaluate(() => window.fixtureWallet.setChain(false)); await connect(); await review();
  await page.evaluate(() => window.fixtureWallet.setAccount(true));
  await button("Connect test claim wallet", article()).waitFor();
  assert.equal(await button("Confirm test earnings transaction", article()).count(), 0);
  await page.evaluate(() => window.fixtureWallet.setAccount(false)); await connect(); await review();
  hideNativeProof(true); await page.evaluate(() => window.fixtureWallet.setDecision("lose"));
  await confirm();
  await waitFor("earnings missing-hash transaction sent once", async () => signatures.length === started + 5);
  const curveProof = await lastReceipt("curve-claim");
  await page.reload();
  await button("Recover earnings receipt").waitFor(); await button("Recover earnings receipt").click();
  await page.getByText(/exact payment settlement is still unproven|original transaction is pending|Receipt evidence is unavailable/).first().waitFor();
  assert.equal(signatures.length, started + 5);
  await screenshot("21-earnings-missing-hash-recovery");
  hideNativeProof(false); await mine(); await ready(); await recover();
  evidence.receipts.push(curveProof);
  await lookup();
  const afterCurve = await refreshed(); assert.equal(afterCurve.curve.claimableNativeWei, "0");
  assert.equal(BigInt(afterCurve.curve.claimedNativeWei) - BigInt(beforeClaims.curve.claimedNativeWei), BigInt(beforeClaims.curve.claimableNativeWei));
  const collect = await claim("lp-collect");
  const afterCollection = await refreshed(); evidence.afterCollection = afterCollection;
  const credits = await expectedFees(creator);
  assert.deepEqual([afterCollection.lp.claimableNativeWei, afterCollection.lp.claimableTokenWei], [credits.nativeWei, credits.tokenWei]);
  assert.ok(BigInt(credits.nativeWei) > 0n && BigInt(credits.tokenWei) > 0n);
  assert.deepEqual([afterCollection.lp.uncollectedNativeWei, afterCollection.lp.uncollectedTokenWei], ["0", "0"]);
  await screenshot("22-earnings-collected-portrait");
  await page.setViewportSize({ width: 844, height: 390 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await screenshot("23-earnings-landscape");
  await page.setViewportSize({ width: 1440, height: 900 }); await screenshot("24-earnings-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await claim("lp-claim-native");
  assert.deepEqual(await expectedFees(creator), { nativeWei: "0", tokenWei: credits.tokenWei });
  await refreshed(); await claim("lp-claim-token");
  assert.deepEqual(await expectedFees(creator), { nativeWei: "0", tokenWei: "0" }); await checkPosition();

  // The creation-fee payout is factory-global and is never a creator credit.
  await page.getByText("Operations creation-fee payout", { exact: true }).click();
  await button("Check creation fees").click();
  const factoryPanel = page.locator(".lpEarningsFactory");
  await button("Connect test claim wallet", factoryPanel).click();
  await factoryPanel.getByText("Test signer: " + creator.toLowerCase(), { exact: true }).waitFor();
  await button("Review test earnings transaction", factoryPanel).click();
  await factoryPanel.getByRole("heading", { name: /^Review / }).waitFor();
  const operationsBefore = BigInt(await rpc("eth_getBalance", [operations, "latest"]));
  await page.evaluate(() => window.fixtureWallet.setDecision("normal"));
  await button("Confirm test earnings transaction", factoryPanel).click();
  await waitFor("permissionless creation fee payout", async () => signatures.length === started + 9);
  const factoryProof = await lastReceipt("creation-fees"); await mine(); await ready(); await recover();
  evidence.receipts.push(factoryProof);
  const operationsAfter = BigInt(await rpc("eth_getBalance", [operations, "latest"]));
  assert.equal(operationsAfter - operationsBefore, 400_000_000_000_000n);
  evidence.creationFeePayout = { recipient: operations, nativeWei: (operationsAfter - operationsBefore).toString() };
  const activity = await receiptRows();
  for (const proof of evidence.receipts) {
    const rows = activity.filter(row => row.transaction_hash.toLowerCase() === proof.hash.toLowerCase());
    assert.equal(rows.length, 1, "Exactly one canonical durable fee event for each operation");
    assert.equal(rows[0].block_hash.toLowerCase(), proof.blockHash.toLowerCase());
    assert.equal(rows[0].chain_id, 31337);
    assert.equal(rows[0].factory.toLowerCase(), factory.toLowerCase());
  }
  evidence.postgresFeeRows = activity;
  const settled = await refreshed(); evidence.settled = settled;
  await restart(); await page.goto(site + "/my-launches/earnings");
  const restored = await lookup();
  assert.deepEqual(restored.curve, settled.curve); assert.deepEqual(restored.lp, settled.lp);
  assert.deepEqual(await receiptRows(), activity);
  assert.equal(signatures.length, started + 9, "Refresh and both process restarts cannot request another transaction");
  await screenshot("25-earnings-after-process-restart");
  Object.assign(evidence.checks, { walletRejected: true, accountAndChainInvalidatedReview: true,
    lostHashRecoveredAfterRefresh: true, missingNativeProofStayedPending: true, originalLedgerRetained: true,
    canonicalFeeActivity: true, nativeAndTokenSeparateClaims: true, lockedPrincipalUnchanged: true,
    factoryPayoutOnlyToOperations: true, appAndIndexerRestart: true, syntheticBroadcasts: signatures.length - started });
  await writeFile(join(out, "earnings-journey-evidence.json"), JSON.stringify(evidence, null, 2));
  return evidence;
}
