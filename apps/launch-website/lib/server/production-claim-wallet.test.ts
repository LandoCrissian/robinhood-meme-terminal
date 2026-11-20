import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { claimDelegatePin, claimExecutionIdentity, claimExecutionReviewHash, isClaimExecutionReview, type ClaimExecutionReview } from "../claim-profiles";
import { applyClaimSettlement, assertNoPendingProductionClaim, listClaimJournals, readClaimJournal, submitProductionClaim } from "../claim-recovery";
import { productionCreationAbi, productionCreationFactory, productionCreationJournalKey, submitProductionCreation } from "../production-creation";
import { encodeProductionLifecycleCalldata } from "../production-lifecycle";
import { productionTradeJournalIndex, productionTradeJournalKey } from "../production-trading-wallet";
import { connectProductionFinancialWallet } from "../production-wallet";
import { productionNonceFloorKey } from "../production-nonce";
import { owners } from "./claim-profile-test-fixture";
import { ea, eh } from "./earnings-test-fixture";
import { handleProductionEarningsClaim } from "./production-earnings";
import { productionClaimFixture, syntheticClaimApproval } from "./production-earnings-test-fixture";

const location = { protocol: "https:", hostname: "www.rmtlaunch.fun", port: "" };
const storage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
const request = (body: object) => new Request("https://www.rmtlaunch.fun/api/launchpad/production-earnings", { method: "POST", headers: {
  "content-type": "application/json", host: "www.rmtlaunch.fun", origin: "https://www.rmtlaunch.fun" }, body: JSON.stringify(body) });
async function ready(kind: "eoa" | "metamask-7702" | "safe-1.4.1" = "eoa", graduated = true) {
  const f = productionClaimFixture(kind, graduated), memory = storage();
  let response = await handleProductionEarningsClaim(request(f.prepare()), f.options), body = await response.json();
  if (kind === "safe-1.4.1") {
    assert.equal(body.status, "awaiting-safe-approvals");
    const proposal = body.review as ClaimExecutionReview;
    const signed = await Promise.all(owners.slice(0, 2).map(async owner => ({ address: owner.address, signature: await owner.sign({ hash: proposal.wallet.safe!.transactionHash }) })));
    const safeSignatures = "0x" + signed.sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map(item => item.signature.slice(2)).join("");
    response = await handleProductionEarningsClaim(request({ ...f.prepare(), safeSignatures, prior: proposal }), f.options); body = await response.json();
  }
  assert.equal(response.status, 200, JSON.stringify(body)); assert.ok(isClaimExecutionReview(body.review));
  const review = body.review as ClaimExecutionReview;
  const revalidate = async (prior: ClaimExecutionReview) => {
    const checked = await handleProductionEarningsClaim(request({ action: "revalidate", review: prior, approvalBinding: syntheticClaimApproval }), f.options);
    if (!checked.ok) throw Error("Fresh production revalidation unavailable"); return checked.json();
  };
  return { f, memory, review, revalidate };
}
function wallet(f: Awaited<ReturnType<typeof ready>>, result: () => unknown = () => eh(401)) {
  const calls: string[] = [], sends: unknown[] = [], knobs = { bad: "" };
  const request = async ({ method, params }: { method: string; params?: unknown[] }) => {
    calls.push(method);
    switch (method) {
      case "eth_accounts": return [knobs.bad === "account" ? ea(888881) : f.review.gasPayer];
      case "eth_chainId": return knobs.bad === "chain" ? "0x1" : "0x1237";
      case "eth_getTransactionCount": return knobs.bad === "nonce" ? "0x1" : f.review.outer!.nonce;
      case "eth_getCode": {
        const who = String(params![0]) as Address;
        if (knobs.bad === "runtime" && who.toLowerCase() === f.review.inner.to.toLowerCase()
          || knobs.bad === "delegate" && who.toLowerCase() === claimDelegatePin.address.toLowerCase()) return "0x6002";
        return await f.f.rpc.getCode({ address: who }) ?? "0x";
      }
      case "eth_getBlockByNumber": {
        const number = BigInt(String(params![0])), block = await f.f.rpc.getBlock({ blockNumber: number });
        return { number: "0x" + number.toString(16), hash: knobs.bad === "checkpoint" || knobs.bad === "deployment" && number === BigInt(f.review.inner.deploymentBlockNumber) ? eh(99999) : block.hash };
      }
      case "eth_sendTransaction":
        assert.equal(readClaimJournal(f.memory, f.review)?.stage, "awaiting-wallet", "Recovery record is durable before the only send request");
        sends.push(structuredClone(params![0])); return result();
      default: throw Error("Unexpected synthetic wallet method " + method);
    }
  };
  return { calls, sends, knobs, request };
}
const input = (f: Awaited<ReturnType<typeof ready>>, w: ReturnType<typeof wallet>) => ({ review: f.review, storage: f.memory, wallet: w, location,
  approvalBinding: syntheticClaimApproval, revalidate: f.revalidate, now: () => f.review.inner.reviewTimestamp * 1000 + 1_000 });
async function settlement(f: Awaited<ReturnType<typeof ready>>, reverted = false) {
  const chain = f.f; chain.knobs.review = f.review; chain.f.baseState.request = f.review.inner;
  chain.f.baseState.head = 32n; chain.f.baseState.mined = true; chain.f.baseState.afterClaim = !reverted; chain.f.baseState.revertReceipt = reverted;
  chain.f.state.payerNonce = 1; chain.f.state.receiptNonce = 1; chain.f.baseState.receiptNative = 75n; chain.f.baseState.receiptToken = 0n;
  const response = await handleProductionEarningsClaim(request({ action: "verify", review: f.review, approvalBinding: syntheticClaimApproval, transactionHash: eh(401) }), chain.options);
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.settlement?.stage, reverted ? "reverted" : "canonical-l2", JSON.stringify(body));
  return body.settlement;
}

for (const kind of ["eoa", "metamask-7702", "safe-1.4.1"] as const) {
  test(`production ${kind} persists exact reviewed intent before one external type2 send and prevents resubmission`, async () => {
    const f = await ready(kind), w = wallet(f), journal = await submitProductionClaim(input(f, w));
    assert.equal(journal.stage, "submitted"); assert.equal(w.sends.length, 1); assert.deepEqual(w.sends[0], f.review.outer);
    assert.equal(listClaimJournals(f.memory).length, 1); assert.equal(journal.transactionHash, eh(401));
    await assert.rejects(submitProductionClaim(input(f, w)), /Recover the original/); assert.equal(w.sends.length, 1);
    assert.equal(w.calls.some(method => /sign|sendRaw|requestAccounts/.test(method)), false);
  });
}

test("production sender rejects preview origins, chain/account/nonce/runtime/checkpoint changes and mismatched current approval without a send", async () => {
  for (const bad of ["account", "chain", "nonce", "runtime", "checkpoint", "deployment"]) {
    const f = await ready(), w = wallet(f); w.knobs.bad = bad;
    await assert.rejects(submitProductionClaim(input(f, w)), /changed/); assert.equal(w.sends.length, 0); assert.equal(listClaimJournals(f.memory).length, 0);
  }
  const f = await ready(), w = wallet(f);
  await assert.rejects(submitProductionClaim({ ...input(f, w), location: { ...location, hostname: "preview.rmtlaunch.fun" } }));
  assert.equal(w.calls.length, 0);
  await assert.rejects(submitProductionClaim({ ...input(f, w), revalidate: async review => ({ status: "revalidated", executionEnabled: true, approvalBinding: "b".repeat(64), review }) }), /approval/);
  assert.equal(w.sends.length, 0);
});

test("delegation replacement and fresh provider fee failure cannot reach a production wallet send", async () => {
  const delegated = await ready("metamask-7702"), d = wallet(delegated); d.knobs.bad = "delegate";
  await assert.rejects(submitProductionClaim(input(delegated, d)), /runtime/); assert.equal(d.sends.length, 0);
  const f = await ready(), w = wallet(f); f.f.knobs.missingNitro = true;
  await assert.rejects(submitProductionClaim(input(f, w)), /revalidation/); assert.equal(w.sends.length, 0);
});

test("only an explicit4001 rejection permits the same reviewed production request to be retried", async () => {
  for (const kind of ["eoa", "safe-1.4.1"] as const) {
    const f = await ready(kind); let reject = true;
    const w = wallet(f, () => { if (reject) throw { cause: { code: 4001 } }; return eh(401); });
    await assert.rejects(submitProductionClaim(input(f, w))); assert.equal(readClaimJournal(f.memory, f.review)?.stage, "wallet-rejected");
    assert.equal(f.memory.getItem(productionNonceFloorKey), null);
    if (kind === "eoa") assert.doesNotThrow(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, "0x0"));
    else assert.throws(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, "0x0"), /original production claim/);
    reject = false; const retried = await submitProductionClaim(input(f, w)); assert.equal(retried.stage, "submitted"); assert.equal(w.sends.length, 2);
  }
});

test("production lost-hash and ambiguous wallet outcomes survive reload and never trigger another send", async () => {
  for (const outcome of [() => undefined, () => { throw Error("synthetic wallet transport lost after send"); }]) {
    const f = await ready(), w = wallet(f, outcome);
    await submitProductionClaim(input(f, w)).catch(() => undefined);
    assert.equal(listClaimJournals(f.memory)[0].stage, "hash-missing"); assert.equal(readClaimJournal(f.memory, f.review)?.transactionHash, null);
    await assert.rejects(submitProductionClaim(input(f, w)), /Recover the original/); assert.equal(w.sends.length, 1);
  }
});

test("production Safe authorization nonce stays locked across different gas payers after an uncertain send", async () => {
  const f = await ready("safe-1.4.1"), w = wallet(f, () => undefined); await submitProductionClaim(input(f, w));
  const other = structuredClone(f.review); other.gasPayer = ea(888883); other.outer!.from = other.gasPayer;
  other.intentHash = claimExecutionIdentity(other); other.reviewHash = claimExecutionReviewHash(other); assert.ok(isClaimExecutionReview(other));
  await assert.rejects(submitProductionClaim({ ...input(f, w), review: other }), /Safe nonce/); assert.equal(w.sends.length, 1);
});

test("an uncertain production claim blocks another intent even when its proposed payer nonce is newer", async () => {
  const f = await ready(), w = wallet(f, () => undefined); await submitProductionClaim(input(f, w));
  const next = structuredClone(f.review); next.outer!.nonce = "0x1"; next.inner.nonce = "0x1";
  next.wallet.actorNonce = "1"; next.gasPayerEvidence.nonce = "1";
  next.intentHash = claimExecutionIdentity(next); next.reviewHash = claimExecutionReviewHash(next); assert.ok(isClaimExecutionReview(next));
  const count = w.calls.length;
  await assert.rejects(submitProductionClaim({ ...input(f, w), review: next }), /original production claim/);
  assert.equal(w.calls.length, count); assert.equal(w.sends.length, 1);
});

test("a genuine pending production claim blocks the creator sender before any wallet method", async () => {
  const f = await ready(), w = wallet(f, () => undefined); await submitProductionClaim(input(f, w));
  const r = f.review.inner, data = encodeFunctionData({ abi: productionCreationAbi, functionName: "create", args: ["Synthetic", "SYN", "", zeroAddress, 0, eh(778), BigInt(r.reviewExpiresAt)] });
  const creation: Parameters<typeof submitProductionCreation>[1] = { from: f.review.gasPayer, to: productionCreationFactory, data, value: "0x16bcc41e90000" as Hex, chainId: "0x1237" as const,
    intentId: eh(778), deadline: String(r.reviewExpiresAt), blockNumber: r.deploymentBlockNumber, blockHash: r.deploymentBlockHash, nonce: "0x1" as Hex };
  let calls = 0; const provider = { request: async () => { calls++; throw Error("A blocked creator sender must not reach its wallet"); } };
  await assert.rejects(submitProductionCreation({ account: f.review.gasPayer, provider, request: provider.request }, creation, f.memory, () => {}), /original production claim/);
  assert.equal(calls, 0); assert.equal(readClaimJournal(f.memory, f.review)?.stage, "hash-missing");
});

test("durability failure and pending production creation/trade journals block claims before wallet access", async () => {
  const failed = await ready(), broken = wallet(failed);
  await assert.rejects(submitProductionClaim({ ...input(failed, broken), storage: { ...failed.memory, setItem() { throw Error("storage unavailable"); } } }));
  assert.equal(broken.sends.length, 0);
  for (const scope of ["creation", "trading"] as const) {
    const f = await ready(), w = wallet(f), r = f.review.inner;
    if (scope === "creation") {
      const data = encodeFunctionData({ abi: productionCreationAbi, functionName: "create", args: ["Synthetic", "SYN", "", zeroAddress, 0, eh(787), BigInt(r.reviewExpiresAt)] });
      f.memory.setItem(productionCreationJournalKey, JSON.stringify({ request: { from: f.review.gasPayer, to: productionCreationFactory, data, value: "0x16bcc41e90000",
        chainId: "0x1237", intentId: eh(787), deadline: String(r.reviewExpiresAt), blockNumber: r.deploymentBlockNumber, blockHash: r.deploymentBlockHash, nonce: "0x0" } }));
    } else {
      const key = productionTradeJournalKey(f.review.gasPayer, r.token), amount = 10n ** 15n;
      const data = await encodeProductionLifecycleCalldata("buy", r.token, r.originCurve, amount, 1n, BigInt(r.reviewExpiresAt));
      const pending = { operation: "buy", token: r.token, curve: r.originCurve, factory: r.factory, from: f.review.gasPayer, to: r.originCurve,
        data, value: "0x" + amount.toString(16), chainId: "0x1237", nonce: "0x0", blockNumber: r.deploymentBlockNumber, blockHash: r.deploymentBlockHash,
        reviewBlockNumber: r.reviewBlockNumber, reviewBlockHash: r.reviewBlockHash, deadline: String(r.reviewExpiresAt), amountWei: String(amount), minimumOutputWei: "1",
        slippageBps: 100, approvalBinding: syntheticClaimApproval, walletCodeHash: f.review.wallet.actorCodeHash };
      f.memory.setItem(key, JSON.stringify({ schemaVersion: 1, request: pending, quote: { inputWei: String(amount), outputWei: "2", minimumOutputWei: "1", feeWei: "1", refundWei: "0",
        gasUnits: "50000", gasPriceWei: "5", feeEvidence: "verified-nitro", l1PosterGasUnits: "10000", maxPriorityFeePerGasWei: "1" }, createdAt: Date.now() }));
      f.memory.setItem(productionTradeJournalIndex, JSON.stringify([key]));
    }
    await assert.rejects(submitProductionClaim(input(f, w)), /recover|original/i); assert.equal(w.calls.length, 0, scope);
  }
});

test("disabled production capability never requests wallet connection", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window"), priorFetch = globalThis.fetch; let walletCalls = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location, ethereum: { request: async () => { walletCalls++; return []; } } } });
  globalThis.fetch = async () => Response.json({ status: "production-read-only", chainId: 4663, claims: "disabled" });
  try { await assert.rejects(connectProductionFinancialWallet("claims"), /not activated/); assert.equal(walletCalls, 0); }
  finally { globalThis.fetch = priorFetch; if (descriptor) Object.defineProperty(globalThis, "window", descriptor); else Reflect.deleteProperty(globalThis, "window"); }
});

test("canonical indexed L2 evidence releases only the next financial nonce while retaining the production L1 hold", async () => {
  const f = await ready("eoa", false), w = wallet(f), journal = await submitProductionClaim(input(f, w));
  assert.throws(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer), /original production claim/);
  assert.throws(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, "99"), /original production claim/);
  const canonical = applyClaimSettlement(f.memory, journal, await settlement(f));
  assert.doesNotThrow(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, "0x1"));
  for (const nonce of [undefined, "0", "0x0"]) assert.throws(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, nonce), /nonce/);
  assert.ok(f.memory.getItem(productionNonceFloorKey));
  f.memory.removeItem(productionNonceFloorKey); // A pre-upgrade receipt still supplies its consumed floor.
  assert.throws(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, "0"), /nonce/);
  assert.doesNotThrow(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, "1"));
  assert.equal(canonical.verification!.finality.l1Finality, "unverified");
  assert.equal(canonical.verification!.finality.productionPolicySupported, false); assert.equal(w.sends.length, 1);
});

test("a canonically consumed claim blocks the real creator sender after a nonce rewind before any wallet method", async () => {
  const f = await ready("eoa", false), w = wallet(f), journal = await submitProductionClaim(input(f, w));
  applyClaimSettlement(f.memory, journal, await settlement(f));
  const r = f.review.inner, data = encodeFunctionData({ abi: productionCreationAbi, functionName: "create", args: ["Synthetic", "SYN", "", zeroAddress, 0, eh(779), BigInt(r.reviewExpiresAt)] });
  const creation: Parameters<typeof submitProductionCreation>[1] = { from: f.review.gasPayer, to: productionCreationFactory, data, value: "0x16bcc41e90000", chainId: "0x1237",
    intentId: eh(779), deadline: String(r.reviewExpiresAt), blockNumber: r.deploymentBlockNumber, blockHash: r.deploymentBlockHash, nonce: "0x0" };
  let calls = 0; const provider = { request: async () => { calls++; throw Error("Rewound nonce must be blocked before wallet access"); } };
  await assert.rejects(submitProductionCreation({ account: f.review.gasPayer, provider, request: provider.request }, creation, f.memory, () => {}), /nonce/);
  assert.equal(calls, 0); assert.equal(readClaimJournal(f.memory, f.review)?.transactionHash, eh(401));
});

test("a terminal reverted claim reserves its consumed payer nonce across another claim operation", async () => {
  const f = await ready("eoa", false), w = wallet(f), journal = await submitProductionClaim(input(f, w));
  const reverted = applyClaimSettlement(f.memory, journal, await settlement(f, true)); assert.equal(reverted.stage, "reverted");
  assert.throws(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, "0x0"), /nonce/);
  assert.doesNotThrow(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, "1"));
  f.f.f.baseState.head = 10n; f.f.f.baseState.mined = false; f.f.f.baseState.revertReceipt = false; f.f.f.state.payerNonce = 0;
  const response = await handleProductionEarningsClaim(request(f.f.prepare("creation-fees")), f.f.options), body = await response.json();
  assert.equal(response.status, 200); assert.ok(isClaimExecutionReview(body.review)); assert.equal(body.review.gasPayerEvidence.nonce, "0");
  const count = w.calls.length;
  await assert.rejects(submitProductionClaim({ ...input(f, w), review: body.review }), /nonce/); assert.equal(w.calls.length, count); assert.equal(w.sends.length, 1);
});

test("failed or dropped shared-floor writes preserve the original claim journal and keep financial execution blocked", async () => {
  for (const drop of [false, true]) {
    const f = await ready("eoa", false), w = wallet(f), original = await submitProductionClaim(input(f, w)), proof = await settlement(f);
    const broken = { ...f.memory, setItem(key: string, value: string) { if (key === productionNonceFloorKey) { if (drop) return; throw Error("Floor storage unavailable"); } f.memory.setItem(key, value); } };
    assert.throws(() => applyClaimSettlement(broken, original, proof)); assert.deepEqual(readClaimJournal(f.memory, f.review), original);
    assert.throws(() => assertNoPendingProductionClaim(f.memory, f.review.gasPayer, "1"), /original production claim/); assert.equal(w.sends.length, 1);
  }
});
