import assert from "node:assert/strict";
import test from "node:test";
import { type Hex } from "viem";
import { isClaimExecutionReview, type ClaimExecutionReview } from "../claim-profiles";
import type { EarningsClaimOperation } from "../earnings-claims";
import { owners } from "./claim-profile-test-fixture";
import { curveProductionDeployment, curveProductionPins } from "./curve-production";
import { createProductionEarningsBudget, handleProductionEarningsClaim, readProductionEarningsBirth } from "./production-earnings";
import { productionClaimFixture, syntheticClaimApproval } from "./production-earnings-test-fixture";

const url = "https://www.rmtlaunch.fun/api/launchpad/production-earnings";
const request = (body: object) => new Request(url, { method: "POST", headers: { host: "www.rmtlaunch.fun", origin: "https://www.rmtlaunch.fun", "content-type": "application/json" }, body: JSON.stringify(body) });
async function prepare(f = productionClaimFixture(), operation: EarningsClaimOperation = "curve-claim") {
  const response = await handleProductionEarningsClaim(request(f.prepare(operation)), f.options), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.status, "prepared");
  assert.equal(body.executionEnabled, true); assert.equal(body.approvalBinding, syntheticClaimApproval);
  assert.ok(isClaimExecutionReview(body.review)); assert.equal(body.review.chainId, 4663);
  assert.equal(body.review.scope, "production-unsigned"); assert.equal(body.review.executionEnabled, false);
  f.knobs.review = body.review; f.f.baseState.request = body.review.inner;
  return body.review as ClaimExecutionReview;
}

test("production claims remain disabled before any HTTP body, indexer or RPC read without separate activation", async () => {
  const response = await handleProductionEarningsClaim(request({ action: "prepare" }), { env: {}, fetch: async () => { throw Error("must not fetch"); } });
  assert.equal(response.status, 404); assert.equal((await response.json()).executionEnabled, false);
});

test("production claim evidence budget caps concurrency and requests before expensive reads", () => {
  const budget = createProductionEarningsBudget(), a = budget.acquire(0), b = budget.acquire(0);
  assert.ok(a); assert.ok(b); assert.equal(budget.acquire(0), null); a(); a(); b();
  for (let index = 2; index < 30; index++) { const release = budget.acquire(0); assert.ok(release); release(); }
  assert.equal(budget.acquire(0), null); assert.ok(budget.acquire(60_000));
});

for (const operation of ["curve-claim", "lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token", "creation-fees"] as const) {
  test(`exact production4663 HTTP ${operation} prepares immutable recipient, original ledger and principal with verified L1/L2 fees`, async () => {
    const f = productionClaimFixture(), review = await prepare(f, operation);
    assert.equal(review.inner.chainId, "0x1237"); assert.equal(review.inner.factory, curveProductionPins.factory[0]);
    assert.equal(review.inner.deploymentBlockHash, curveProductionDeployment.blockHash); assert.equal(review.outer!.value, "0x0");
    assert.equal(review.fees.status, "verified-nitro");
    if (review.fees.status === "verified-nitro") { assert.equal(review.fees.estimatedL1Wei, "20000"); assert.equal(review.fees.estimatedTotalWei, "100000"); }
    assert.equal(review.inner.beneficiary.toLowerCase(), (operation === "creation-fees" ? curveProductionDeployment.operating : operation === "lp-collect" ? f.f.lpLedger : f.f.creator).toLowerCase());
    assert.equal(review.inner.ledger.toLowerCase(), (operation === "creation-fees" ? curveProductionPins.factory[0] : operation.startsWith("lp-") ? f.f.lpLedger : f.f.ledger).toLowerCase());
    if (operation.startsWith("lp-")) { assert.equal(review.inner.positionTokenId, "1"); assert.equal(review.inner.principalLiquidityWei, "1000"); }
    assert.equal(f.knobs.calls.some(method => /send|sign|broadcast/.test(method)), false);
  });
}

test("authenticated discovery requires its actual credential, ready directory and independently canonical twenty-block checkpoint", async () => {
  const f = productionClaimFixture(); f.options.env!.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN = "wrong-local";
  await assert.rejects(readProductionEarningsBirth(f.f.token, f.f.creator, f.contexts(), f.options));
  f.options.env!.RMT_LAUNCH_HISTORY_INDEXER_READ_TOKEN = "local-only"; f.knobs.stale = true;
  await assert.rejects(readProductionEarningsBirth(f.f.token, f.f.creator, f.contexts(), f.options));
  f.knobs.stale = false;
  const registration = await readProductionEarningsBirth(f.f.token, f.f.creator, f.contexts(), f.options);
  assert.equal(registration!.chainId, 4663); assert.equal(registration!.revenueLedger, f.f.ledger);
});

test("production delegated direct claims preserve the exact owner-controlled type2 envelope", async () => {
  const f = productionClaimFixture("metamask-7702"), review = await prepare(f);
  assert.equal(review.kind, "metamask-7702"); assert.equal(review.outer!.type, "0x2");
  assert.equal(Object.hasOwn(review.outer!, "authorizationList"), false); assert.equal(review.wallet.delegation?.designator.startsWith("0xef0100"), true);
});

test("production Safe claim prepares a genuine two-of-three CALL and separately simulates the external payer after exact approvals", async () => {
  const f = productionClaimFixture("safe-1.4.1");
  const response = await handleProductionEarningsClaim(request(f.prepare()), f.options), body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.status, "awaiting-safe-approvals"); assert.equal(body.executionEnabled, false);
  const proposal = body.review as ClaimExecutionReview; assert.ok(isClaimExecutionReview(proposal)); assert.equal(proposal.outer, null);
  const signed = await Promise.all(owners.slice(0, 2).map(async owner => ({ address: owner.address, signature: await owner.sign({ hash: proposal.wallet.safe!.transactionHash }) })));
  const safeSignatures = ("0x" + signed.sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map(item => item.signature.slice(2)).join("")) as Hex;
  const accepted = await handleProductionEarningsClaim(request({ ...f.prepare(), safeSignatures, prior: proposal }), f.options), ready = await accepted.json();
  assert.equal(accepted.status, 200, JSON.stringify(ready)); assert.equal(ready.status, "prepared"); assert.equal(ready.executionEnabled, true);
  assert.equal(ready.review.authorizations.ownerApprovalsCollected, 2); assert.equal(ready.review.outer.to.toLowerCase(), f.f.creator.toLowerCase());
  assert.equal(ready.review.wallet.safe.transaction.operation, 0); assert.equal(ready.review.wallet.safe.transaction.value, "0");
});

test("fresh revalidation preserves the original envelope and refuses stale discovery, changed approval, fees or independent-provider loss", async () => {
  const f = productionClaimFixture(), review = await prepare(f), payload = { action: "revalidate", review, approvalBinding: syntheticClaimApproval };
  const valid = await handleProductionEarningsClaim(request(payload), f.options), body = await valid.json();
  assert.equal(valid.status, 200, JSON.stringify(body)); assert.equal(body.status, "revalidated"); assert.deepEqual(body.review, review);
  assert.equal((await handleProductionEarningsClaim(request({ ...payload, approvalBinding: "b".repeat(64) }), f.options)).status, 409);
  for (const knob of ["stale", "missingNitro", "offline", "wrongRuntime", "reorg"] as const) {
    f.knobs[knob] = true; const rejected = await handleProductionEarningsClaim(request(payload), f.options);
    assert.equal(rejected.status, 503, knob); assert.equal((await rejected.json()).executionEnabled, false); f.knobs[knob] = false;
  }
});

test("production HTTP refuses arbitrary ledger, Safe authorization on a direct payer and unbounded bodies without leaking credentials", async () => {
  const f = productionClaimFixture();
  for (const payload of [{ ...f.prepare(), ledger: f.f.lpLedger }, { ...f.prepare(), safeAddress: f.f.creator }, { ...f.prepare(), kind: "safe-create" }]) {
    const response = await handleProductionEarningsClaim(request(payload), f.options); assert.equal(response.status, 400); assert.equal(f.knobs.calls.length, 0);
    assert.equal((await response.text()).includes("local-only"), false);
  }
  assert.equal((await handleProductionEarningsClaim(request({ ...f.prepare(), padding: "a".repeat(33_000) }), f.options)).status, 503);
});

test("production claim receipt/lost-hash recovery distinguishes exact durable activity, provider failure and canonical reorg without resubmission", async () => {
  const f = productionClaimFixture("eoa", false), review = await prepare(f);
  f.f.baseState.head = 32n; f.f.baseState.mined = true; f.f.baseState.afterClaim = true;
  f.f.state.payerNonce = 1; f.f.state.receiptNonce = 1; f.f.baseState.receiptNative = 75n; f.f.baseState.receiptToken = 0n;
  const payload = { action: "verify", review, approvalBinding: syntheticClaimApproval, transactionHash: f.f.txHash };
  const first = await handleProductionEarningsClaim(request(payload), f.options), result = await first.json();
  assert.equal(first.status, 200, JSON.stringify(result)); assert.equal(result.settlement.stage, "canonical-l2", JSON.stringify(result));
  assert.equal(result.settlement.indexed, true); assert.equal(result.settlement.finality.l1Finality, "unverified");
  assert.equal(result.settlement.finality.productionPolicySupported, false);
  const lost = await handleProductionEarningsClaim(request({ action: "verify", review, approvalBinding: syntheticClaimApproval }), f.options), recovered = await lost.json();
  assert.equal(recovered.settlement.stage, "canonical-l2", JSON.stringify(recovered)); assert.equal(recovered.settlement.transactionHash, f.f.txHash);
  f.knobs.wrongIndex = true; const wrongIndex = await (await handleProductionEarningsClaim(request(payload), f.options)).json();
  assert.equal(wrongIndex.settlement.stage, "indexing-pending"); f.knobs.wrongIndex = false;
  f.knobs.traceFailure = true; const missingTrace = await (await handleProductionEarningsClaim(request(payload), f.options)).json();
  assert.notEqual(missingTrace.settlement.stage, "canonical-l2"); f.knobs.traceFailure = false;
  f.knobs.reorg = true; const reorged = await (await handleProductionEarningsClaim(request(payload), f.options)).json();
  assert.notEqual(reorged.settlement?.stage, "canonical-l2");
  assert.equal(f.knobs.calls.some(method => /send|sign|broadcast/.test(method)), false);
});

for (const operation of ["curve-claim", "lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token", "creation-fees"] as const) {
  test(`production4663 ${operation} receipt proof requires original rights, exact payout and raw canonical indexed event`, async () => {
    const f = productionClaimFixture("eoa", operation.startsWith("lp-")), review = await prepare(f, operation);
    f.f.baseState.head = 32n; f.f.baseState.mined = true; f.f.state.payerNonce = 1; f.f.state.receiptNonce = 1;
    f.f.baseState.afterClaim = operation !== "lp-collect" && operation !== "creation-fees"; f.f.baseState.afterCollection = operation === "lp-collect";
    f.f.baseState.receiptNative = operation === "creation-fees" ? curveProductionDeployment.creationFeeWei : operation === "lp-claim-token" ? 0n : operation === "lp-collect" ? 4n : operation.startsWith("lp-") ? 70n : 75n;
    f.f.baseState.receiptToken = operation === "lp-collect" ? 7n : ["lp-claim", "lp-claim-token"].includes(operation) ? 150n : 0n;
    const response = await handleProductionEarningsClaim(request({ action: "verify", review, approvalBinding: syntheticClaimApproval, transactionHash: f.f.txHash }), f.options);
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.settlement.stage, "canonical-l2", JSON.stringify(result)); assert.equal(result.settlement.indexed, true);
    assert.equal(result.settlement.amounts.nativeWei, f.f.baseState.receiptNative.toString()); assert.equal(result.settlement.amounts.tokenWei, f.f.baseState.receiptToken.toString());
    if (operation.startsWith("lp-")) assert.equal(result.settlement.activity.pool.principalLiquidityWei, "1000");
    assert.equal(result.settlement.finality.l1Finality, "unverified");
  });
}
