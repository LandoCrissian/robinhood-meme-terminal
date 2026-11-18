import assert from "node:assert/strict";
import test from "node:test";
import { assertNoUnresolvedFinancialRequests, treasuryVerificationMatches } from "../../app/_components/treasury-wallet-controls";
import { isProjectTreasuryReview, projectTreasuryProfile, projectTreasuryReviewHash, type ProjectTreasuryReview, type ProjectTreasuryVerification } from "../project-treasury";
import { ea, eh } from "./earnings-test-fixture";
import { earningsTestFixture } from "./earnings-test-fixture";
import { prepareClaimExecutionReview } from "./claim-profiles";
import { isClaimExecutionReview } from "../claim-profiles";
import { storeClaimJournal } from "../claim-recovery";

function fixture() {
  const actor = ea(100001), treasury = ea(100002), factory = ea(100003), core = ea(100004), point = { blockNumber: "10", blockHash: eh(10), timestamp: "2026-11-18T12:00:00.000Z" };
  const review: ProjectTreasuryReview = { schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false,
    status: "prepared", operation: "create-treasury", actor, creator: actor, controller: actor, kind: "eoa", intentId: eh(77), treasury, treasuryFactory: factory,
    coreFactory: core, targetRuntimeHash: eh(81), actorCodeHash: eh(82), args: { treasuryShareBps: 2250 },
    innerCall: { from: actor, to: factory, data: "0x12345678", value: "0x0" }, request: { type: "0x2", chainId: "0x7a69", from: actor, to: factory, data: "0x12345678", value: "0x0", nonce: "0x0", gas: "0x10000", maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x0" },
    observed: point, expiresAt: Date.parse(point.timestamp) / 1000 + 180, maximumNetworkFeeWei: "131072", reviewHash: eh(1), notices: [] };
  review.reviewHash = projectTreasuryReviewHash(review); assert.ok(isProjectTreasuryReview(review));
  const canonical = { blockNumber: "11", blockHash: eh(11), timestamp: "2026-11-18T12:00:01.000Z" };
  const result: ProjectTreasuryVerification = { schemaVersion: 1, profile: projectTreasuryProfile, status: "confirmed", chainId: 31337, executionEnabled: false,
    reviewHash: review.reviewHash, transactionHash: eh(90), canonical, indexed: false, finality: "synthetic-local-not-production",
    proof: { schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337, creator: actor, controller: actor, intentId: review.intentId, treasuryShareBps: 2250,
      treasury, treasuryFactory: factory, coreFactory: core, factoryRuntimeHash: review.targetRuntimeHash, runtimeHash: eh(83),
      deployment: { ...canonical, transactionHash: eh(90), logIndex: 0 } } };
  return { review, result };
}
test("treasury recovery shape binds the exact reviewed creation and canonical proof without claiming indexing", () => {
  const { review, result } = fixture(); assert.equal(treasuryVerificationMatches(review, result), true); assert.equal(result.indexed, false);
  assert.equal(treasuryVerificationMatches(review, result, eh(90)), true);
  assert.equal(treasuryVerificationMatches(review, result, eh(91)), false);
});
test("cross-project, source, controller, share, receipt and indexing mutations cannot become creation success", () => {
  const { review, result } = fixture();
  for (const mutate of [
    (v: ProjectTreasuryVerification) => { v.reviewHash = eh(3); }, (v: ProjectTreasuryVerification) => { v.proof!.intentId = eh(3); },
    (v: ProjectTreasuryVerification) => { v.proof!.treasury = ea(120000); }, (v: ProjectTreasuryVerification) => { v.proof!.creator = ea(120000); },
    (v: ProjectTreasuryVerification) => { v.proof!.controller = ea(120000); }, (v: ProjectTreasuryVerification) => { v.proof!.coreFactory = ea(120000); },
    (v: ProjectTreasuryVerification) => { v.proof!.treasuryFactory = ea(120000); }, (v: ProjectTreasuryVerification) => { v.proof!.factoryRuntimeHash = eh(3); },
    (v: ProjectTreasuryVerification) => { v.proof!.treasuryShareBps = 4500; }, (v: ProjectTreasuryVerification) => { v.proof!.deployment.blockHash = eh(3); },
    (v: ProjectTreasuryVerification) => { v.proof!.deployment.transactionHash = eh(3); }, (v: ProjectTreasuryVerification) => { v.canonical!.blockNumber = "9"; },
    (v: ProjectTreasuryVerification) => { v.indexed = "true" as never; },
  ]) { const changed = structuredClone(result); mutate(changed); assert.equal(treasuryVerificationMatches(review, changed), false); }
});
test("unavailable or pending evidence remains explicitly incomplete, never a fabricated confirmed treasury", () => {
  const { review } = fixture();
  const base = { schemaVersion: 1, profile: projectTreasuryProfile, chainId: 31337, executionEnabled: false, reviewHash: review.reviewHash, finality: "synthetic-local-not-production" };
  assert.equal(treasuryVerificationMatches(review, { ...base, status: "pending" }), true);
  assert.equal(treasuryVerificationMatches(review, { ...base, status: "unavailable" }), true);
  assert.equal(treasuryVerificationMatches(review, { ...base, status: "confirmed" }), false);
  assert.equal(treasuryVerificationMatches(review, { ...base, chainId: 4663, status: "confirmed" }), false);
});
function memory() {
  const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
}
test("token creation cannot pass a same-wallet unresolved treasury outcome or silently discard malformed recovery", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), storage = memory();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    const { review, result } = fixture(), key = "rmt.project-treasury.pending.v1:" + review.reviewHash;
    const journal = { schemaVersion: 1, review, stage: "hash-missing", transactionHash: null, result: null, createdAt: 1, updatedAt: 1 };
    storage.setItem("rmt.project-treasury.pending.v1:index", JSON.stringify([key])); storage.setItem(key, JSON.stringify(journal));
    assert.throws(() => assertNoUnresolvedFinancialRequests(review.actor), /earlier treasury/);
    assert.doesNotThrow(() => assertNoUnresolvedFinancialRequests(ea(120000)));
    storage.setItem(key, JSON.stringify({ ...journal, stage: "wallet-rejected" }));
    assert.doesNotThrow(() => assertNoUnresolvedFinancialRequests(review.actor), "A definite rejection is not an unknown broadcast");
    storage.setItem(key, JSON.stringify({ ...journal, stage: "confirmed", transactionHash: result.transactionHash, result }));
    assert.doesNotThrow(() => assertNoUnresolvedFinancialRequests(review.actor), "Canonical history stays available without blocking unrelated future nonce use");
    storage.setItem(key, "corrupted-original-recovery"); assert.throws(() => assertNoUnresolvedFinancialRequests(review.actor));
  } finally { if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage"); }
});
test("token creation also preserves an unresolved Task075 claim from the same wallet", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage"), storage = memory();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    const f = earningsTestFixture();
    const review = await prepareClaimExecutionReview({ context: f.context, registration: f.registration, account: f.creator, beneficiary: f.creator, operation: "curve-claim", kind: "eoa" });
    assert.ok(isClaimExecutionReview(review));
    storeClaimJournal(storage, { schemaVersion: 1, profile: "rmt-claim-recovery-v1", review, stage: "hash-missing", transactionHash: null, verification: null, createdAt: 1, updatedAt: 1 });
    assert.throws(() => assertNoUnresolvedFinancialRequests(f.creator), /earlier profiled claim/);
    assert.doesNotThrow(() => assertNoUnresolvedFinancialRequests(ea(120000)));
  } finally { if (original) Object.defineProperty(globalThis, "localStorage", original); else Reflect.deleteProperty(globalThis, "localStorage"); }
});
