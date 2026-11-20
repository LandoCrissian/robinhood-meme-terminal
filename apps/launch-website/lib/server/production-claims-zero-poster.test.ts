import assert from "node:assert/strict";
import test from "node:test";
import { type Address, type Hex } from "viem";
import { claimExecutionIdentity, claimExecutionReviewHash, isClaimExecutionReview, productionClaimFeePolicy, type ClaimExecutionReview } from "../claim-profiles";
import { readClaimJournal, submitIsolatedClaim, submitProductionClaim } from "../claim-recovery";
import type { EarningsClaimOperation } from "../earnings-claims";
import { owners } from "./claim-profile-test-fixture";
import { prepareClaimExecutionReview } from "./claim-profiles";
import { eh } from "./earnings-test-fixture";
import { handleProductionEarningsClaim } from "./production-earnings";
import { productionClaimFixture, syntheticClaimApproval } from "./production-earnings-test-fixture";

const request = (body: object) => new Request("https://www.rmtlaunch.fun/api/launchpad/production-earnings", { method: "POST",
  headers: { "content-type": "application/json", host: "www.rmtlaunch.fun", origin: "https://www.rmtlaunch.fun" }, body: JSON.stringify(body) });
const zero = (kind: "eoa" | "metamask-7702" | "safe-1.4.1" = "eoa", graduated = true) => {
  const f = productionClaimFixture(kind, graduated); f.knobs.poster = 0n; f.knobs.l1Base = 0n; return f;
};
async function prepared(f = zero(), operation: EarningsClaimOperation = "curve-claim") {
  let response = await handleProductionEarningsClaim(request(f.prepare(operation)), f.options), data = await response.json();
  if (data.status === "awaiting-safe-approvals") {
    const prior = data.review as ClaimExecutionReview;
    const signed = await Promise.all(owners.slice(0, 2).map(async owner => ({ address: owner.address, signature: await owner.sign({ hash: prior.wallet.safe!.transactionHash }) })));
    const safeSignatures = "0x" + signed.sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map(item => item.signature.slice(2)).join("");
    response = await handleProductionEarningsClaim(request({ ...f.prepare(operation), safeSignatures, prior }), f.options); data = await response.json();
  }
  assert.equal(response.status, 200, JSON.stringify(data)); assert.equal(data.status, "prepared"); assert.equal(data.executionEnabled, true);
  assert.equal(data.approvalBinding, syntheticClaimApproval); assert.ok(isClaimExecutionReview(data.review));
  const review = data.review as ClaimExecutionReview; assert.equal(review.fees.status, "verified-nitro-zero-poster");
  return review;
}

test("the historical positive-only production helper still refuses zero components without the server compatibility policy", async () => {
  const f = zero(), context = f.contexts()[0].context;
  assert.equal(context.feePolicy, undefined);
  const review = await prepareClaimExecutionReview({ context, registration: f.registration, operation: "curve-claim", beneficiary: f.f.creator, account: f.f.creator, kind: "eoa" });
  assert.ok(isClaimExecutionReview(review)); assert.equal(review.status, "fee-unavailable"); assert.equal(review.fees.status, "unavailable");
});

for (const operation of ["curve-claim", "lp-collect", "lp-claim", "lp-claim-native", "lp-claim-token", "creation-fees"] as const) {
  test(`gated production ${operation} distinguishes measured native zero posting from unavailable fees`, async () => {
    const f = zero(), review = await prepared(f, operation), fees = review.fees;
    assert.equal(review.chainId, 4663); assert.equal(review.executionEnabled, false); assert.equal(fees.status, "verified-nitro-zero-poster");
    if (fees.status !== "verified-nitro-zero-poster") return;
    assert.equal(fees.l1PosterGasUnits, "0"); assert.equal(fees.l1BaseFeeWei, "0"); assert.equal(fees.estimatedL1Wei, "0");
    assert.equal(fees.estimatedL2Wei, "100000"); assert.equal(fees.estimatedTotalWei, "100000"); assert.equal(fees.includesL1Data, true);
    assert.equal(fees.zeroPosterPolicy.l2BaseFeeWei, fees.baseFeeWei); assert.equal(fees.zeroPosterPolicy.nativeL2BaseFeeWei, "2");
    assert.equal(fees.zeroPosterPolicy.blockHash, review.observed.blockHash); assert.ok(BigInt(fees.proposedMaximumWei) > 0n);
    const checked = await handleProductionEarningsClaim(request({ action: "revalidate", review, approvalBinding: syntheticClaimApproval }), f.options);
    assert.equal(checked.status, 200); assert.deepEqual((await checked.json()).review, review);
  });
}

test("no HTTP field, fixture activation or default raw context can opt in to the new policy", async () => {
  const f = zero();
  assert.equal((await handleProductionEarningsClaim(request({ ...f.prepare(), feePolicy: productionClaimFeePolicy }), f.options)).status, 400);
  const resolve = f.options.resolve!;
  f.options.resolve = (async (...args) => { const { feePolicy: _omitted, ...rest } = await resolve(...args); return rest; }) as typeof resolve;
  assert.equal((await handleProductionEarningsClaim(request(f.prepare()), f.options)).status, 503);
  assert.equal((await handleProductionEarningsClaim(request(f.prepare()), { env: { RMT_CURVE_FIXTURE: "local", RMT_CURVE_PRODUCTION_CLAIMS: "owner-claims-approved" } })).status, 404);
});

test("partial zero values, absent native evidence, changed pricing and witness disagreement remain unavailable", async () => {
  for (const mutate of [
    (f: ReturnType<typeof zero>) => { f.knobs.l1Base = 10n; },
    (f: ReturnType<typeof zero>) => { f.knobs.poster = 1n; },
    (f: ReturnType<typeof zero>) => { f.knobs.missingNative = true; },
    (f: ReturnType<typeof zero>) => { f.knobs.nativeL1Base = 1n; },
    (f: ReturnType<typeof zero>) => { f.knobs.nativeCalldata = 1n; },
    (f: ReturnType<typeof zero>) => { f.knobs.nativeL2Base = 0n; },
    (f: ReturnType<typeof zero>) => { f.knobs.nativeConflict = true; },
    (f: ReturnType<typeof zero>) => { f.knobs.offline = true; },
  ]) { const f = zero(); mutate(f); assert.equal((await handleProductionEarningsClaim(request(f.prepare()), f.options)).status, 503); }
});

test("the zero-poster grammar is separate, production-only and binds all native policy fields and the canonical point", async () => {
  const review = await prepared();
  for (const mutate of [
    (r: any) => { r.fees.status = "verified-nitro"; delete r.fees.zeroPosterPolicy; },
    (r: any) => { delete r.fees.zeroPosterPolicy; },
    (r: any) => { r.fees.zeroPosterPolicy.extra = true; },
    (r: any) => { r.fees.zeroPosterPolicy.l1BaseFeeWei = "1"; },
    (r: any) => { r.fees.zeroPosterPolicy.nativeL2BaseFeeWei = "0"; },
    (r: any) => { r.fees.zeroPosterPolicy.blockHash = eh(999); },
    (r: any) => { r.fees.estimatedL1Wei = "1"; },
    (r: any) => { r.fees.includesL1Data = false; },
    (r: any) => { r.fees.gasPriceWei = "99"; },
    (r: any) => { r.chainId = 31337; r.scope = "isolated-local"; r.inner.chainId = "0x7a69"; r.outer.chainId = "0x7a69"; },
  ]) { const changed = structuredClone(review); mutate(changed); changed.intentHash = claimExecutionIdentity(changed); changed.reviewHash = claimExecutionReviewHash(changed); assert.equal(isClaimExecutionReview(changed), false); }
});

test("different measured C8/header/native/RPC prices are preserved and the fee ceiling covers the largest twice plus tip", async () => {
  const f = zero(); f.knobs.componentBase = 7n; f.knobs.headerBase = 5n; f.knobs.nativeL2Base = 3n; f.knobs.gasPrice = 11n;
  const review = await prepared(f); assert.equal(review.fees.status, "verified-nitro-zero-poster");
  if (review.fees.status !== "verified-nitro-zero-poster") return;
  assert.equal(review.fees.baseFeeWei, "7"); assert.equal(review.fees.zeroPosterPolicy.l2BaseFeeWei, "5");
  assert.equal(review.fees.zeroPosterPolicy.nativeL2BaseFeeWei, "3"); assert.equal(review.fees.gasPriceWei, "11");
  assert.equal(review.fees.maxFeePerGasWei, "23"); assert.equal(review.fees.estimatedL2Wei, "350000");
  f.knobs.gasPrice = 12n;
  const checked = await handleProductionEarningsClaim(request({ action: "revalidate", review, approvalBinding: syntheticClaimApproval }), f.options);
  assert.equal(checked.status, 503, "A current fee floor above the reviewed ceiling requires a fresh review");
});

test("fresh revalidation requires the same fee-policy variant and rejects native parent-price or canonical drift", async () => {
  const f = zero(), review = await prepared(f), payload = { action: "revalidate", review, approvalBinding: syntheticClaimApproval };
  f.knobs.nativeL1Base = 1n; assert.equal((await handleProductionEarningsClaim(request(payload), f.options)).status, 503); f.knobs.nativeL1Base = 0n;
  f.knobs.poster = 10000n; f.knobs.l1Base = 10n;
  assert.equal((await handleProductionEarningsClaim(request(payload), f.options)).status, 503, "A different fee model needs a fresh explicit review");
  f.knobs.poster = 0n; f.knobs.l1Base = 0n; f.knobs.reorg = true;
  assert.equal((await handleProductionEarningsClaim(request(payload), f.options)).status, 503);
});

test("measured-zero fee reviews retain exact receipt, durable index, lost-hash and reorg recovery with no L1 finality claim", async () => {
  const f = zero("eoa", false), review = await prepared(f);
  f.knobs.review = review; f.f.baseState.request = review.inner; f.f.baseState.head = 32n; f.f.baseState.mined = true;
  f.f.baseState.afterClaim = true; f.f.state.payerNonce = 1; f.f.state.receiptNonce = 1;
  f.f.baseState.receiptNative = 75n; f.f.baseState.receiptToken = 0n;
  const payload = { action: "verify", review, approvalBinding: syntheticClaimApproval };
  const data = await (await handleProductionEarningsClaim(request(payload), f.options)).json();
  assert.equal(data.settlement.stage, "canonical-l2", JSON.stringify(data)); assert.equal(data.settlement.indexed, true);
  assert.equal(data.settlement.transactionHash, f.f.txHash); assert.equal(data.settlement.finality.l1Finality, "unverified");
  f.knobs.reorg = true;
  const reorged = await (await handleProductionEarningsClaim(request(payload), f.options)).json();
  assert.notEqual(reorged.settlement?.stage, "canonical-l2"); assert.equal(f.knobs.calls.some(method => /send|sign|broadcast/.test(method)), false);
});

for (const kind of ["eoa", "metamask-7702", "safe-1.4.1"] as const) {
  test(`the ${kind} sender accepts a measured-zero review only through current approved production revalidation`, async () => {
    const f = zero(kind), review = await prepared(f), values = new Map<string, string>(); let sends = 0, wrongHeader = false;
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const wallet = { request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_accounts") return [review.gasPayer]; if (method === "eth_chainId") return "0x1237";
      if (method === "eth_getTransactionCount") return review.outer!.nonce;
      if (method === "eth_getCode") return await f.rpc.getCode({ address: params![0] as Address }) ?? "0x";
      if (method === "eth_getBlockByNumber") { const number = BigInt(params![0] as string), block = await f.rpc.getBlock({ blockNumber: number }); return {
        number: "0x" + number.toString(16), hash: block.hash, baseFeePerGas: "0x" + (block.baseFeePerGas! + (wrongHeader ? 1n : 0n)).toString(16) }; }
      assert.equal(method, "eth_sendTransaction"); assert.equal(readClaimJournal(storage, review)?.stage, "awaiting-wallet"); assert.deepEqual(params![0], review.outer); sends++; return eh(401);
    } };
    const revalidate = async (prior: ClaimExecutionReview) => { const response = await handleProductionEarningsClaim(request({ action: "revalidate", review: prior, approvalBinding: syntheticClaimApproval }), f.options); assert.equal(response.status, 200); return response.json(); };
    const input = { review, storage, wallet, approvalBinding: syntheticClaimApproval, location: { protocol: "https:", hostname: "www.rmtlaunch.fun", port: "" }, revalidate };
    await assert.rejects(submitIsolatedClaim({ ...input, revalidate: async () => ({ status: "unchanged", reviewHash: review.reviewHash }) })); assert.equal(sends, 0);
    await assert.rejects(submitProductionClaim({ ...input, revalidate: async prior => ({ status: "revalidated", executionEnabled: false, approvalBinding: syntheticClaimApproval, review: prior }) })); assert.equal(sends, 0);
    wrongHeader = true; await assert.rejects(submitProductionClaim(input), /native fee policy checkpoint/); assert.equal(sends, 0); wrongHeader = false;
    assert.equal((await submitProductionClaim(input)).stage, "submitted"); assert.equal(sends, 1);
  });
}
