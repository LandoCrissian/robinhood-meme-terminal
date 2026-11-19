import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { localFixtureClient, transact } from "../../packages/contracts/scripts/deploy-fixed-supply-fixture.mjs";
import { nftAcquisitionOrderTypes, nftAcquisitionVaultSignatures, nftAcquisitionVenueSignatures } from "../../packages/launchpad-common/nft-acquisition-runtime.mjs";
import { startNftAcquisitionBrowser } from "./browser-integration.mjs";
const require = createRequire(new URL("../../apps/launch-website/package.json", import.meta.url));
const { encodeFunctionData, erc20Abi, keccak256, parseAbi, parseEventLogs, stringToHex, zeroAddress } = require("viem");
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2) + "\n";
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** One loopback chain, the existing authoritative fixture worker and its named
 * PostgreSQL database. Accepted acquisitions use the NEW NFT page. The second
 * same-block fill is a separate direct harness negative, expected to revert. */
export async function testNftAcquisitionJourney({ browserEngine, rpcUrl, rpc, compilation, deployment, creatorAccount, sourceIdentity,
  site, workerOrigin, indexReadKey, out, pg, waitFor, mine, ready, restart, hideReceipt, hideNativeProof }) {
  const client = await localFixtureClient(rpcUrl, 31337), { module: m, send, seller, fee, royalty, safe, owners, signers } = deployment;
  const vaultAbi = parseAbi(nftAcquisitionVaultSignatures), venueAbi = parseAbi(nftAcquisitionVenueSignatures), creator = creatorAccount.address;
  const evidence = { schemaVersion: 1, profile: m.profile, status: "incomplete", chainId: 31337, productionExecution: false,
    scope: "LOCAL_SYNTHETIC_NOT_PRODUCTION_OR_PHYSICAL_PHONE", sourceIdentity, module: m, compiler: compilation.manifest,
    checks: {}, purchases: [], sameBlock: [], withdrawals: [], safeExecutions: [], screenshots: [] };
  const save = () => writeFileSync(join(out, "nft-acquisition-acceptance.json"), json(evidence));
  const read = (fn, args = []) => client.readContract({ address: m.vault, abi: vaultAbi, functionName: fn, args });
  const sync = async () => { await mine(); await ready(); };
  const post = async body => {
    const result = await fetch(new URL("/api/nft-acquisition", site), { method: "POST", headers: { Origin: new URL(site).origin, "Content-Type": "application/json" }, body: json(body) });
    return { http: result.status, body: await result.json() };
  };
  const session = await startNftAcquisitionBrowser({ browserEngine, site, creator, rpc, client, out,
    send: async (from, request) => { const signer = signers.get(from.toLowerCase()); assert.ok(signer); return send(request, "success", signer); },
    signTypedData: async (account, typed) => { const signer = signers.get(account.toLowerCase()); assert.ok(signer && owners.some(owner => same(owner.address, account))); return signer.signTypedData(typed); }, hideReceipt });
  const normalConfig = (currency = zeroAddress, enabled = true) => ({ currency, perNftCap: "10000000000000000", totalBudget: "100000000000000000", periodBudget: "50000000000000000", cooldownSeconds: "1", enabled });
  const collection = (item, enabled = true) => ({ collection: item.address, enabled, anyTokenId: false, ids: "1,2,3,4,5,6,7,8,9,10,11,12", identityConfirmed: true });
  let orderSequence = 0;
  async function order(item, tokenId, { currency = zeroAddress, quantity = item.standard === 721 ? 1n : 2n, price = 1_000_000_000_000_000n, changes = {} } = {}) {
    const head = await client.getBlock();
    const o = { seller: seller.address, vault: m.vault, collection: item.address, standard: item.standard === 721 ? 1 : 2,
      tokenId: BigInt(tokenId), quantity, currency, sellerAmount: price, feeRecipient: fee.address, feeAmount: price * 250n / 10000n,
      royaltyRecipient: royalty.address, royaltyAmount: price * 500n / 10000n, startTime: Number(head.timestamp) - 1,
      endTime: Number(head.timestamp) + 3600, sellerNonce: await client.readContract({ address: m.venue, abi: venueAbi, functionName: "sellerNonces", args: [seller.address] }),
      salt: keccak256(stringToHex("Task081 exact synthetic order " + ++orderSequence)), ...changes };
    const typed = { domain: { name: "RMT Synthetic NFT Listing Venue", version: "1", chainId: 31337, verifyingContract: m.venue }, types: nftAcquisitionOrderTypes, primaryType: "Order", message: o };
    const signature = await seller.signTypedData(typed);
    return { value: o, fields: { order: json(o).trim(), signature, identityConfirmed: true } };
  }
  async function complete(operation, fields = {}, { lose = false, safeMode = false } = {}) {
    const review = await session.action(operation, fields);
    if (safeMode) throw Error("Use actual Safe owner sequence");
    const result = await session.confirm(lose ? "lose" : "normal"); assert.ok(result);
    if (lose) {
      const pending = await post({ action: "verify", review }); assert.ok(["pending", "unavailable"].includes(pending.body.status));
      const before = session.evidence.sends.length;
      hideReceipt(undefined); await sync();await session.reload(); await session.connect();
      const verified = await session.verify(review, undefined, "confirmed"); assert.equal(verified.transactionHash, result.receipt.transactionHash);
      assert.equal(session.evidence.sends.length, before); evidence.checks.missingHashWithoutDuplicate = true;
    } else {await sync();await session.verify(review, result.receipt.transactionHash, "confirmed");}
    return { review, ...result };
  }
  async function safeComplete(operation, fields = {}, lose = false) {
    await session.account(owners[0].address); await session.configureSafe(true, creator, safe);
    const inner = await session.action(operation, fields); assert.equal(inner.status, "needs-safe-approvals");
    const proposal = await session.safePropose(creator);
    const before = session.evidence.sends.length;
    await session.safeApprove();
    const single = await post({ action: "safe-prepare", proposal, approvals: await session.page.evaluate(hash => JSON.parse(localStorage.getItem("rmt.nft-acquisition.safe.v1:"+hash)).approvals, proposal.proposalHash) });
    assert.notEqual(single.body.status, "prepared"); assert.equal(session.evidence.sends.length, before);
    await session.account(owners[1].address); await session.safeApprove();
    await session.account(creator); const outer = await session.safePrepare();
    const sent = await session.safeConfirm(lose ? "lose" : "normal"); assert.ok(sent);
    if (lose) {const unavailable=await post({action:"safe-verify",review:outer});assert.ok(["pending","unavailable"].includes(unavailable.body.status));hideReceipt(undefined);}
    await sync();if(lose){await session.reload(); await session.connect();}
    const verified = await session.safeVerify(outer, lose ? undefined : sent.receipt.transactionHash, "confirmed");
    evidence.safeExecutions.push({ operation, proposal, outer, receipt: sent.receipt, verified }); save(); return { review: inner, outer, ...sent };
  }
  try {
    await session.connect(); assert.equal(await read("purchasesEnabled"), false);
    const outsiders = await post({ action: "prepare", operation: "configure", account: seller.address, fields: normalConfig() });
    assert.equal(outsiders.http,200,json(outsiders)); assert.equal(outsiders.body.status, "unavailable",json(outsiders)); evidence.checks.foreignControllerDenied = true;
    await session.page.getByLabel("OpenSea collection URL or NFT contract address", { exact: true }).fill("https://opensea.io/collection/" + m.collections[0].slug);
    const resolvedResponse = session.page.waitForResponse(r => new URL(r.url()).pathname === "/api/nft-acquisition" && r.request().postDataJSON()?.action === "resolve").then(r => r.json());
    await session.page.getByRole("button", { name: "Verify collection identity", exact: true }).click();
    const resolved = await resolvedResponse; assert.equal(resolved.collectionVerified, true); assert.equal(resolved.listingVerified, false); assert.equal(resolved.executionAvailable, false);
    evidence.collectionResolution = resolved;
    await complete("fund-native", { amountWei: "40000000000000000", source: "0x" + "81".repeat(32) });
    await complete("configure-collection", collection(m.collections[0])); await complete("configure-collection", collection(m.collections[1]));
    await complete("configure", normalConfig());
    const first = await order(m.collections[0], 1);
    const rejected = await session.action("buy", first.fields), count = session.evidence.sends.length;
    await session.confirm("reject"); assert.equal(session.evidence.sends.length, count); evidence.checks.walletRejectionNoSubmission = true;
    const bought = await complete("buy", first.fields, { lose: true }); evidence.purchases.push(bought);
    assert.equal(await client.readContract({ address: m.collections[0].address, abi: deployment.assets.Acquisition721Fixture.abi, functionName: "ownerOf", args: [1n] }), m.vault);
    const duplicate = await post({ action: "prepare", operation: "buy", account: creator, fields: first.fields }); assert.equal(duplicate.body.status, "unavailable");
    await complete("disable");
    const second = await order(m.collections[1], 1), disabled = await post({ action: "prepare", operation: "buy", account: creator, fields: second.fields });
    assert.equal(disabled.body.status, "unavailable"); await complete("configure", normalConfig());
    const secondBuy = await complete("buy", second.fields); evidence.purchases.push(secondBuy);
    // Exact receipt is insufficient when the independent trace facade is down.
    hideNativeProof(true); const unproven = await post({ action: "verify", review: secondBuy.review, transactionHash: secondBuy.receipt.transactionHash });
    assert.equal(unproven.body.status, "pending"); hideNativeProof(false); await session.verify(secondBuy.review, secondBuy.receipt.transactionHash, "confirmed");
    evidence.checks.missingTraceRemainsPending = true;
    await complete("approve-funding", { amountWei: "40000000000000000" }); await complete("fund-token", { amountWei: "40000000000000000", source: "0x" + "82".repeat(32) });
    await complete("configure", normalConfig(m.paymentToken));
    const tokenOrder = await order(m.collections[0], 2, { currency: m.paymentToken }); evidence.purchases.push(await complete("buy", tokenOrder.fields));
    assert.equal(await client.readContract({ address: m.paymentToken, abi: erc20Abi, functionName: "allowance", args: [m.vault, m.venue] }), 0n);
    await complete("disable"); await complete("configure", normalConfig());
    // Two distinct fill attempts share one real block. The enforced one-second
    // cooldown admits the first and atomically rejects the second; its gas is
    // synthetic and no payment/custody/event from the failed fill may survive.
    const firstBatch=await order(m.collections[0],5),secondBatch=await order(m.collections[0],6);
    const batchReview=await session.action("buy",firstBatch.fields),nonceBefore=await client.getTransactionCount({address:creator,blockTag:"pending"});
    let firstBatchSend,secondBatchReceipt;
    await rpc("anvil_setAutomine",[false]);
    try{
      const firstPending=session.confirm();
      await waitFor("First exact NFT transaction pending",async()=>await client.getTransactionCount({address:creator,blockTag:"pending"})>=nonceBefore+1);
      const secondPending=send({...transact(m.vault,vaultAbi,"purchase",[secondBatch.value,secondBatch.fields.signature,await read("policyEpoch"),await read("controllerEpoch"),Number((await client.getBlock()).timestamp)+300]),gas:2_000_000n},"reverted",creatorAccount);
      await waitFor("Two distinct NFT intents pending",async()=>await client.getTransactionCount({address:creator,blockTag:"pending"})>=nonceBefore+2);
      await rpc("evm_mine");[firstBatchSend,secondBatchReceipt]=await Promise.all([firstPending,secondPending]);
    }finally{await rpc("anvil_setAutomine",[true]);}
    assert.ok(firstBatchSend);assert.equal(firstBatchSend.receipt.blockHash,secondBatchReceipt.blockHash);assert.equal(secondBatchReceipt.status,"reverted");
    await sync();const batchVerified=await session.verify(batchReview,firstBatchSend.receipt.transactionHash,"confirmed");
    assert.equal(Number((await pg.query("SELECT count(*)::int AS n FROM rmt_nft_acquisition_fixture_events WHERE transaction_hash=$1 AND payload->>'eventName'='PurchaseExecuted'",[firstBatchSend.receipt.transactionHash.toLowerCase()])).rows[0].n),1);
    assert.equal(Number((await pg.query("SELECT count(*)::int AS n FROM rmt_nft_acquisition_fixture_events WHERE transaction_hash=$1",[secondBatchReceipt.transactionHash.toLowerCase()])).rows[0].n),0);
    evidence.sameBlock={successful:firstBatchSend.receipt,rejected:secondBatchReceipt,successfulVerification:batchVerified,reason:"Per-vault cooldown prevents two successful fills at one block timestamp",noFailedFillPaymentOrCustody:true};save();
    // The pinned designator changes only this local fixture account. No live delegation action.
    const delegate = JSON.parse(gunzipSync(readFileSync(new URL("../../apps/launch-website/lib/server/claim-delegate-runtime.test.json.gz", import.meta.url)))).delegate;
    assert.equal(keccak256(delegate.code), delegate.runtimeHash); await rpc("anvil_setCode", [delegate.address, delegate.code]); await rpc("anvil_setCode", [creator, "0xef0100" + delegate.address.slice(2).toLowerCase()]); await sync();
    await session.reload(); await session.connect();
    const delegated = await order(m.collections[0], 3); evidence.purchases.push(await complete("buy", delegated.fields));
    const changeReview = await session.action("disable", {}); await rpc("anvil_setCode", [creator, "0x"]); await sync();
    assert.equal((await post({ action: "revalidate", review: changeReview })).body.status, "unavailable"); evidence.checks.delegationChangeInvalidatesReview = true;
    await session.reload(); await session.connect();
    // A noticed NFT release is a distinct custody action, never an acquisition side effect.
    const expiry = Number((await client.getBlock()).timestamp) + 3 * 86400;
    await complete("schedule-nft-withdrawal", { collection: m.collections[0].address, tokenId: "1", quantity: "1", recipient: creator, expiresAt: String(expiry) });
    assert.equal((await post({ action: "prepare", operation: "execute-withdrawal", account: creator, fields: { id: "1" } })).body.status, "unavailable");
    await rpc("evm_increaseTime", [2 * 86400]); await sync();
    evidence.withdrawals.push(await complete("execute-withdrawal", { id: "1" }));
    assert.equal(await client.readContract({ address: m.collections[0].address, abi: deployment.assets.Acquisition721Fixture.abi, functionName: "ownerOf", args: [1n] }), creator);
    await complete("schedule-controller", { incoming: safe, expiresAt: String(Number((await client.getBlock()).timestamp) + 3 * 86400) });
    assert.equal((await post({ action: "prepare", operation: "accept-controller", account: safe, fields: {} })).body.status, "unavailable");
    await rpc("evm_increaseTime", [2 * 86400]); await sync(); await safeComplete("accept-controller");
    assert.ok(same(await read("controller"), safe));
    assert.equal((await post({ action: "prepare", operation: "disable", account: creator, fields: {} })).body.status, "unavailable");
    await safeComplete("configure", normalConfig()); const safeOrder = await order(m.collections[1], 2); evidence.purchases.push(await safeComplete("buy", safeOrder.fields, true));
    await safeComplete("disable");
    await session.layouts(); evidence.screenshots = [...session.evidence.screenshots];
    const before = Number((await pg.query("SELECT count(*)::int AS n FROM rmt_nft_acquisition_fixture_events")).rows[0].n);
    await restart(); await session.reload(); await session.connect(); await sync();
    const after = Number((await pg.query("SELECT count(*)::int AS n FROM rmt_nft_acquisition_fixture_events")).rows[0].n); assert.equal(after, before);
    evidence.restart = { before, after, unchanged: true };
    await safeComplete("configure", normalConfig());
    const reorgAssets=async()=>({
      held:String(await read("nftHeld",[m.collections[0].address,4n])),
      owner:await client.readContract({address:m.collections[0].address,abi:deployment.assets.Acquisition721Fixture.abi,functionName:"ownerOf",args:[4n]}),
      accounted:String(await read("accountedHeld",[zeroAddress])),available:String(await read("available",[zeroAddress])),spent:String(await read("totalSpent",[zeroAddress])),
      balances:Object.fromEntries(await Promise.all([m.vault,seller.address,fee.address,royalty.address].map(async address=>[address,String(await client.getBalance({address}))])))
    });
    const snapshot = await rpc("evm_snapshot"), beforeAssets=await reorgAssets();
    const orphanOrder = await order(m.collections[0], 4), orphan = await safeComplete("buy", orphanOrder.fields);
    assert.equal(await rpc("evm_revert", [snapshot]), true); await sync();
    await waitFor("NFT acquisition reorg rollback", async () => Number((await pg.query("SELECT count(*)::int AS n FROM rmt_nft_acquisition_fixture_events WHERE transaction_hash=$1", [orphan.receipt.transactionHash.toLowerCase()])).rows[0].n) === 0);
    const afterAssets=await reorgAssets();assert.deepEqual(afterAssets,beforeAssets,"Reorg must restore NFT ownership, reserve accounting and all payment recipients");
    const failedRecovery = await session.safeVerify(orphan.outer, orphan.receipt.transactionHash, "unavailable");
    evidence.reorg = { transactionHash: orphan.receipt.transactionHash, custodyAndDatabaseRolledBack: true, beforeAssets,afterAssets, paymentRecipientsAndReserveRolledBack:true,recovery: failedRecovery.status, noAutomaticRetry: true };
    for (const headers of [{}, { "x-rmt-fixture-key": "00".repeat(32) }]) {
      const response = await fetch(new URL("/nft-acquisitions?vault=" + m.vault, workerOrigin), { headers }); assert.equal(response.status, 404);
    }
    evidence.database = { events: (await pg.query("SELECT payload FROM rmt_nft_acquisition_fixture_events ORDER BY block_number,log_index")).rows,
      states: (await pg.query("SELECT payload FROM rmt_nft_acquisition_fixture_states ORDER BY block_number DESC LIMIT 1")).rows };
    evidence.checks.productionOff = true; evidence.checks.independentBuybackGateUnchanged = true; evidence.status = "passed"; save(); await session.close(); return evidence;
  } catch (error) { evidence.failure = error?.stack ?? String(error); save(); await session.close({success:false}).catch(() => {}); throw error; }
}
