import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, keccak256, parseAbi, zeroAddress, type Hex } from "viem";
import { claimDelegatePin, claimExecutionIdentity, claimExecutionReviewHash, isClaimExecutionReview, type ClaimExecutionReview } from "../claim-profiles";
import { applyClaimSettlement, claimResourceLocks, listClaimJournals, readClaimJournal, storeClaimJournal, submitIsolatedClaim } from "../claim-recovery";
import { storeEarningsClaimJournal } from "../earnings-claims";
import { claimFinality, claimSettlementProfile, type ClaimSettlementResult } from "../production-claims";
import { prepareClaimExecutionReview } from "./claim-profiles";
import { ea, eh, earningsTestFixture, fixtureCode } from "./earnings-test-fixture";
import { fixture as profileFixture, owners, delegateArchive, safeArchive } from "./claim-profile-test-fixture";

const location = { protocol: "http:", hostname: "127.0.0.1", port: "3555" };
const storage = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null,
  setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } }; };
async function fixture() {
  const f = earningsTestFixture();
  const r = await prepareClaimExecutionReview({ context: f.context, registration: f.registration, operation: "curve-claim",
    account: f.creator, beneficiary: f.creator, kind: "eoa" });
  assert.equal(isClaimExecutionReview(r), true, JSON.stringify(r));
  return { f, review: r as ClaimExecutionReview, memory: storage() };
}
function rehash(r: ClaimExecutionReview) { r.intentHash = claimExecutionIdentity(r); r.reviewHash = claimExecutionReviewHash(r); assert.equal(isClaimExecutionReview(r), true); return r; }
function wallet(review: ClaimExecutionReview, memory: ReturnType<typeof storage>, result: () => unknown = () => eh(401)) {
  const calls: string[] = [], sends: object[] = [];
  return { calls, sends, request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    calls.push(method);
    switch (method) {
      case "eth_accounts": return [review.gasPayer]; case "eth_chainId": return "0x7a69";
      case "eth_getTransactionCount": return review.outer!.nonce;
      case "eth_getCode": {
        const address = String(params?.[0]).toLowerCase();
        if (address === review.inner.to.toLowerCase()) return fixtureCode;
        if (address === claimDelegatePin.address.toLowerCase()) return delegateArchive.delegate.code;
        if (review.wallet.safe && address === review.actor.toLowerCase()) return safeArchive.proxyRuntimeCode;
        if (review.kind === "metamask-7702" && address === review.actor.toLowerCase()
          || review.gasPayerEvidence.kind === "metamask-7702" && address === review.gasPayer.toLowerCase()) return claimDelegatePin.designator;
        return "0x";
      }
      case "eth_getBlockByNumber": return { number: "0x" + BigInt(review.observed.blockNumber).toString(16), hash: review.observed.blockHash };
      case "eth_sendTransaction": assert.equal(readClaimJournal(memory, review)?.stage, "awaiting-wallet"); sends.push(params![0] as object); return result();
      default: throw Error("Unsupported mock wallet method");
    }
  } };
}
const now = (r: ClaimExecutionReview) => () => r.inner.reviewTimestamp * 1000 + 1000;
const unchanged = (r: ClaimExecutionReview) => async () => ({ status: "unchanged", reviewHash: r.reviewHash });
function pending(review: ClaimExecutionReview, hash = eh(401)): ClaimSettlementResult {
  return { schemaVersion: 1, profile: claimSettlementProfile, chainId: review.chainId,
    scope: review.chainId === 31337 ? "synthetic-local" : "production-read-only", stage: "submitted", executionEnabled: false,
    intentHash: review.intentHash, reviewHash: review.reviewHash, transactionHash: hash, receiptObserved: false,
    providers: { status: "agree", ids: ["synthetic-a", "synthetic-b"] }, finality: claimFinality(review.chainId, undefined, undefined) };
}
async function safeReview() {
  const f = profileFixture("safe-1.4.1");
  const proposal = await prepareClaimExecutionReview(f.input); assert.ok(isClaimExecutionReview(proposal) && proposal.wallet.safe);
  const signed = await Promise.all(owners.slice(0, 2).map(async owner => ({ address: owner.address, signature: await owner.sign({ hash: proposal.wallet.safe!.transactionHash }) })));
  f.input.safeSignatures = ("0x" + signed.sort((a, b) => BigInt(a.address) < BigInt(b.address) ? -1 : 1).map(x => x.signature.slice(2)).join("")) as Hex;
  const review = await prepareClaimExecutionReview(f.input); assert.ok(isClaimExecutionReview(review) && review.status === "review-only");
  return { f, review, memory: storage() };
}
function canonical(review: ClaimExecutionReview): ClaimSettlementResult {
  const at = { blockNumber: "11", blockHash: eh(11), timestamp: new Date(1700000011 * 1000).toISOString() };
  const amounts = { nativeWei: review.inner.expectedNativeWei, tokenWei: review.inner.expectedTokenWei };
  return { ...pending(review), stage: "settled", receiptObserved: true, canonicalAt: at, outerReceiptStatus: "success", innerExecution: "success", indexed: true,
    amounts, finality: claimFinality(31337, at, { kind: "synthetic-local-v1", chainId: 31337, checkpointBlockHash: at.blockHash }),
    activity: { schemaVersion: 1, chainId: 31337, factory: review.inner.factory, manager: ea(100010), registry: ea(100002),
      deploymentBlockHash: review.inner.deploymentBlockHash, token: review.inner.operation === "creation-fees" ? null : review.inner.token,
      ledger: review.inner.ledger, actor: review.actor, gasPayer: review.gasPayer, beneficiary: review.beneficiary,
      operation: review.inner.operation, transactionHash: eh(401), blockNumber: "11", blockHash: eh(11), logIndex: 1,
      ...amounts, outerNonce: review.gasPayerEvidence.nonce, innerNonce: BigInt(review.inner.nonce).toString(), intentHash: review.intentHash, pool: null } };
}
test("profile submission persists the immutable intent before one explicit synthetic wallet request", async () => {
  const { review, memory } = await fixture(), w = wallet(review, memory);
  const journal = await submitIsolatedClaim({ review, storage: memory, wallet: w, location, revalidate: unchanged(review), now: now(review) });
  assert.equal(journal.stage, "submitted"); assert.equal(w.sends.length, 1); assert.deepEqual(w.sends[0], review.outer);
  assert.equal(listClaimJournals(memory).length, 1); assert.equal(readClaimJournal(memory, review)?.transactionHash, eh(401));
  await assert.rejects(submitIsolatedClaim({ review, storage: memory, wallet: w, location, revalidate: unchanged(review), now: now(review) }), /Recover the original/);
  assert.equal(w.sends.length, 1);
});
test("unknown wallet outcome and missing hash survive refresh without another signature", async () => {
  for (const result of [() => undefined, () => { throw Error("connection lost after submission"); }]) {
    const { review, memory } = await fixture(), w = wallet(review, memory, result);
    await submitIsolatedClaim({ review, storage: memory, wallet: w, location, revalidate: unchanged(review), now: now(review) }).catch(() => undefined);
    const original = readClaimJournal(memory, review)!; assert.equal(original.stage, "hash-missing"); assert.equal(original.transactionHash, null);
    const restored = listClaimJournals(memory)[0]; assert.deepEqual(restored, original);
    const recovered = applyClaimSettlement(memory, restored, pending(review), now(review)());
    assert.equal(recovered.transactionHash, eh(401)); assert.equal(recovered.stage, "submitted");
    assert.equal(w.sends.length, 1);
  }
});
test("wrapped rejection permits only a fresh explicit retry of the same unsubmitted intent", async () => {
  const { review, memory } = await fixture();
  const w = wallet(review, memory, () => { throw { cause: { code: 4001 } }; });
  await assert.rejects(submitIsolatedClaim({ review, storage: memory, wallet: w, location, revalidate: unchanged(review), now: now(review) }));
  assert.equal(readClaimJournal(memory, review)?.stage, "wallet-rejected"); assert.equal(w.sends.length, 1);
  const retry = wallet(review, memory);
  await submitIsolatedClaim({ review, storage: memory, wallet: retry, location, revalidate: unchanged(review), now: now(review) });
  assert.equal(retry.sends.length, 1);
});
test("production, hosted origins, unavailable fees and expired reviews issue zero wallet calls", async () => {
  const { review, memory } = await fixture();
  for (const destination of [{ protocol: "https:", hostname: "www.rmtlaunch.fun", port: "" }, { protocol: "http:", hostname: "localhost", port: "3555" }]) {
    const w = wallet(review, memory);
    await assert.rejects(submitIsolatedClaim({ review, storage: memory, wallet: w, location: destination, revalidate: unchanged(review), now: now(review) }));
    assert.equal(w.calls.length, 0);
  }
  const w = wallet(review, memory);
  await assert.rejects(submitIsolatedClaim({ review, storage: memory, wallet: w, location, revalidate: unchanged(review), now: () => review.expiresAt * 1000 }));
  assert.equal(w.calls.length, 0);
  const blocked = rehash({ ...review, status: "fee-unavailable", fees: { status: "unavailable", reason: "No verified L1 fee" } });
  await assert.rejects(submitIsolatedClaim({ review: blocked, storage: memory, wallet: w, location, revalidate: unchanged(blocked), now: now(blocked) }));
  assert.equal(w.calls.length, 0);
});
test("account, network, nonce, code and canonical checkpoint changes invalidate review before send", async () => {
  for (const [method, changed] of [["eth_accounts", [ea(999999)]], ["eth_chainId", "0x1237"], ["eth_getTransactionCount", "0x1"],
    ["eth_getCode", "0x6000"], ["eth_getBlockByNumber", { hash: eh(999) }]] as const) {
    const { review, memory } = await fixture(), w = wallet(review, memory);
    const wrapped = { request: (args: Parameters<typeof w.request>[0]) => args.method === method ? Promise.resolve(changed) : w.request(args) };
    await assert.rejects(submitIsolatedClaim({ review, storage: memory, wallet: wrapped, location, revalidate: unchanged(review), now: now(review) }), /changed/);
    assert.equal(w.sends.length, 0); assert.equal(readClaimJournal(memory, review), null);
  }
});
test("revalidation cannot silently replace reviewed fees, policy or request hash", async () => {
  const { review, memory } = await fixture(), w = wallet(review, memory);
  await assert.rejects(submitIsolatedClaim({ review, storage: memory, wallet: w, location,
    revalidate: async () => ({ status: "unchanged", reviewHash: eh(999) }), now: now(review) }), /preflight changed/);
  assert.equal(w.sends.length, 0);
});
test("multi-project nonce collision is blocked while independent payer journals remain intact", async () => {
  const { review, memory } = await fixture(), w = wallet(review, memory, () => undefined);
  await submitIsolatedClaim({ review, storage: memory, wallet: w, location, revalidate: unchanged(review), now: now(review) });
  const other = rehash({ ...structuredClone(review), inner: { ...review.inner, token: ea(777777) } });
  const w2 = wallet(other, memory);
  await assert.rejects(submitIsolatedClaim({ review: other, storage: memory, wallet: w2, location, revalidate: unchanged(other), now: now(other) }), /wallet nonce/);
  assert.equal(w2.sends.length, 0); assert.equal(listClaimJournals(memory).length, 1);
  const account = ea(888888);
  const independent = rehash({ ...structuredClone(review), actor: account, beneficiary: account, gasPayer: account,
    inner: { ...review.inner, from: account, beneficiary: account, discoveryRecipient: account }, outer: { ...review.outer!, from: account } });
  await submitIsolatedClaim({ review: independent, storage: memory, wallet: wallet(independent, memory), location, revalidate: unchanged(independent), now: now(independent) });
  assert.equal(listClaimJournals(memory).length, 2); assert.equal(readClaimJournal(memory, review)?.stage, "hash-missing");
});
test("storage failure and legacy pending intents block before wallet confirmation", async () => {
  const { review, memory } = await fixture(), w = wallet(review, memory);
  const failing = { ...memory, setItem: () => { throw Error("storage unavailable"); } };
  await assert.rejects(submitIsolatedClaim({ review, storage: failing, wallet: w, location, revalidate: unchanged(review), now: now(review) })); assert.equal(w.sends.length, 0);
  storeEarningsClaimJournal(memory, { schemaVersion: 1, request: review.inner, state: "hash-missing", transactionHash: null, createdAt: 1, updatedAt: 1 });
  await assert.rejects(submitIsolatedClaim({ review, storage: memory, wallet: w, location, revalidate: unchanged(review), now: now(review) }), /earlier earnings/);
  assert.equal(w.sends.length, 0);
});
test("cross-intent, cross-chain, replaced hashes and unproven canonical success cannot alter a journal", async () => {
  const { review, memory } = await fixture();
  const j = await submitIsolatedClaim({ review, storage: memory, wallet: wallet(review, memory), location, revalidate: unchanged(review), now: now(review) });
  for (const wrong of [{ ...pending(review), intentHash: eh(99) }, { ...pending(review), chainId: 4663 as const },
    { ...pending(review), transactionHash: eh(98) }, { ...pending(review), stage: "settled" as const }]) {
    assert.throws(() => applyClaimSettlement(memory, j, wrong, now(review)()));
    assert.equal(readClaimJournal(memory, review)?.stage, "submitted");
  }
  const reorg = applyClaimSettlement(memory, j, { ...pending(review), stage: "unavailable", reason: "Canonical receipt invalidated" }, now(review)());
  assert.equal(reorg.transactionHash, j.transactionHash); assert.equal(reorg.stage, "unavailable");
});
test("bounded journal refuses new records rather than evicting unknown broadcasts", async () => {
  const { review, memory } = await fixture();
  for (let i = 0; i < 64; i++) {
    const r = rehash({ ...structuredClone(review), gasPayerEvidence: { ...review.gasPayerEvidence, nonce: String(i) },
      wallet: { ...review.wallet, actorNonce: String(i) }, inner: { ...review.inner, nonce: `0x${i.toString(16)}` as Hex },
      outer: { ...review.outer!, nonce: `0x${i.toString(16)}` as Hex } });
    storeClaimJournal(memory, { schemaVersion: 1, profile: "rmt-claim-recovery-v1", review: r, stage: "hash-missing", transactionHash: null,
      verification: null, createdAt: 1000 + i, updatedAt: 1000 + i });
  }
  assert.equal(listClaimJournals(memory).length, 64);
  const r = rehash({ ...structuredClone(review), gasPayerEvidence: { ...review.gasPayerEvidence, nonce: "65" },
    wallet: { ...review.wallet, actorNonce: "65" }, inner: { ...review.inner, nonce: "0x41" }, outer: { ...review.outer!, nonce: "0x41" } });
  assert.throws(() => storeClaimJournal(memory, { schemaVersion: 1, profile: "rmt-claim-recovery-v1", review: r, stage: "hash-missing", transactionHash: null,
    verification: null, createdAt: 1065, updatedAt: 1065 }), /journal is full/);
  assert.equal(listClaimJournals(memory).length, 64);
  assert.equal(keccak256("0x"), review.wallet.actorCodeHash);
});
test("wallet target runtime and delegated implementation are corroborated independently of actor code", async () => {
  for (const mode of ["target", "delegate"] as const) {
    const f = mode === "target" ? await fixture() : await (async () => {
      const f = profileFixture("metamask-7702"), review = await prepareClaimExecutionReview(f.input);
      assert.ok(isClaimExecutionReview(review)); return { review, memory: storage() };
    })();
    const w = wallet(f.review, f.memory);
    const wrapped = { request: (args: Parameters<typeof w.request>[0]) => args.method === "eth_getCode"
      && String(args.params?.[0]).toLowerCase() === (mode === "target" ? f.review.inner.to : claimDelegatePin.address).toLowerCase()
      ? Promise.resolve("0x6000") : w.request(args) };
    await assert.rejects(submitIsolatedClaim({ review: f.review, storage: f.memory, wallet: wrapped, location,
      revalidate: unchanged(f.review), now: now(f.review) }), /changed/);
    assert.equal(w.sends.length, 0); assert.equal(readClaimJournal(f.memory, f.review), null);
  }
});
test("Safe nonce reservation spans gas payers and resource locks cover both authorities", async () => {
  const { review, memory } = await safeReview();
  await submitIsolatedClaim({ review, storage: memory, wallet: wallet(review, memory, () => undefined), location, revalidate: unchanged(review), now: now(review) });
  const payer = ea(888888), next = rehash({ ...structuredClone(review), gasPayer: payer, outer: { ...review.outer!, from: payer } });
  const w = wallet(next, memory);
  assert.notEqual(claimResourceLocks(review)[0], claimResourceLocks(next)[0]);
  assert.equal(claimResourceLocks(review).filter(resource => claimResourceLocks(next).includes(resource)).length, 1);
  await assert.rejects(submitIsolatedClaim({ review: next, storage: memory, wallet: w, location, revalidate: unchanged(next), now: now(next) }), /Safe nonce/);
  assert.equal(w.calls.length, 0); assert.equal(listClaimJournals(memory).length, 1);
});
test("a nonce claimed during asynchronous preflight is rechecked before durable write and send", async () => {
  const { review, memory } = await fixture(), first = wallet(review, memory);
  let entered!: () => void, release!: () => void;
  const atPreflight = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  const attempt = submitIsolatedClaim({ review, storage: memory, wallet: first, location, now: now(review), revalidate: async () => {
    entered(); await gate; return { status: "unchanged", reviewHash: review.reviewHash };
  } });
  await atPreflight;
  const other = rehash({ ...structuredClone(review), inner: { ...review.inner, token: ea(777777) } }), second = wallet(other, memory, () => undefined);
  await submitIsolatedClaim({ review: other, storage: memory, wallet: second, location, revalidate: unchanged(other), now: now(other) });
  release(); await assert.rejects(attempt, /wallet nonce/);
  assert.equal(first.sends.length, 0); assert.equal(second.sends.length, 1); assert.equal(listClaimJournals(memory).length, 1);
});
test("Safe outer-revert retry needs fresh proof, the same proposal and a new payer nonce", async () => {
  const { review, memory } = await safeReview();
  const original = await submitIsolatedClaim({ review, storage: memory, wallet: wallet(review, memory), location, revalidate: unchanged(review), now: now(review) });
  const reverted: ClaimSettlementResult = { ...pending(review), stage: "reverted", receiptObserved: true, outerReceiptStatus: "reverted", innerExecution: "reverted",
    canonicalAt: { blockNumber: "11", blockHash: eh(11), timestamp: new Date(1700000011 * 1000).toISOString() } };
  applyClaimSettlement(memory, original, reverted, now(review)());
  const retry = rehash({ ...structuredClone(review), gasPayerEvidence: { ...review.gasPayerEvidence, nonce: "1" }, outer: { ...review.outer!, nonce: "0x1" } });
  const w = wallet(retry, memory);
  await assert.rejects(submitIsolatedClaim({ review: retry, storage: memory, wallet: w, location, revalidate: unchanged(retry), now: now(retry) }), /Safe nonce/);
  assert.equal(w.sends.length, 0);
  const altered = structuredClone(retry); altered.inner.to = ea(777777); altered.inner.ledger = altered.inner.to; altered.wallet.safe!.transaction.to = altered.inner.to;
  altered.wallet.safe!.transactionHash = eh(777);
  altered.outer!.data = encodeFunctionData({ abi: parseAbi(["function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes) payable returns(bool)"]),
    functionName: "execTransaction", args: [altered.inner.to, 0n, altered.inner.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, altered.wallet.safe!.signatures!] });
  rehash(altered);
  await assert.rejects(submitIsolatedClaim({ review: altered, storage: memory, wallet: wallet(altered, memory), location,
    revalidate: unchanged(altered), reconcilePrior: async () => reverted, now: now(altered) }), /Safe nonce/);
  await assert.rejects(submitIsolatedClaim({ review: retry, storage: memory, wallet: w, location, revalidate: unchanged(retry),
    reconcilePrior: async () => ({ ...reverted, stage: "unavailable", reason: "Receipt reorged" }), now: now(retry) }), /Safe nonce/);
  // Restore the original record through an explicit fresh canonical recovery.
  applyClaimSettlement(memory, readClaimJournal(memory, review)!, reverted, now(review)());
  await submitIsolatedClaim({ review: retry, storage: memory, wallet: w, location, revalidate: unchanged(retry), reconcilePrior: async () => reverted, now: now(retry) });
  assert.equal(w.sends.length, 1); assert.equal(listClaimJournals(memory).length, 2);
});
test("canonical activity identity and amounts cannot be changed by a matching top-level request hash", async () => {
  const { review, memory } = await fixture(), j = await submitIsolatedClaim({ review, storage: memory, wallet: wallet(review, memory), location, revalidate: unchanged(review), now: now(review) });
  const good = canonical(review);
  for (const alter of [(r: ClaimSettlementResult) => { r.activity!.token = ea(777777); },
    (r: ClaimSettlementResult) => { r.activity!.deploymentBlockHash = eh(777); },
    (r: ClaimSettlementResult) => { r.activity!.innerNonce = "1"; },
    (r: ClaimSettlementResult) => { r.activity!.logIndex = -1; },
    (r: ClaimSettlementResult) => { r.amounts!.nativeWei = "1"; },
    (r: ClaimSettlementResult) => { r.activity!.tokenWei = "1"; r.amounts!.tokenWei = "1"; },
    (r: ClaimSettlementResult) => { r.providers.status = "conflict"; },
    (r: ClaimSettlementResult) => { r.indexed = false; },
    (r: ClaimSettlementResult) => { r.activity!.blockNumber = "9"; },
    (r: ClaimSettlementResult) => { r.activity!.pool = {} as never; }]) {
    const bad = structuredClone(good); alter(bad); assert.throws(() => applyClaimSettlement(memory, j, bad, now(review)()));
    assert.equal(readClaimJournal(memory, review)?.stage, "submitted");
  }
  const verified = applyClaimSettlement(memory, j, good, now(review)()); assert.equal(verified.stage, "settled");
  assert.throws(() => storeClaimJournal(memory, { ...verified, verification: null }), /Invalid claim recovery/);
  assert.throws(() => storeClaimJournal(memory, { ...verified, stage: "submitted" }), /Invalid claim recovery/);
});
test("a malformed legacy recovery record cannot be silently replaced by the new controller", async () => {
  const { review, memory } = await fixture(), w = wallet(review, memory);
  memory.setItem(`rmt.earnings.pending.v1:${review.inner.chainId}:${review.inner.factory.toLowerCase()}:${review.gasPayer.toLowerCase()}`, "malformed-original-record");
  await assert.rejects(submitIsolatedClaim({ review, storage: memory, wallet: w, location, revalidate: unchanged(review), now: now(review) }), /identity is invalid/);
  assert.equal(w.calls.length, 0); assert.equal(listClaimJournals(memory).length, 0);
});
