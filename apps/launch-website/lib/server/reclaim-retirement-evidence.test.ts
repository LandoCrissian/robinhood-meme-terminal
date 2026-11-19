import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { isReclaimReview, reclaimProfile, reclaimReviewHash, type ReclaimReview } from "../reclaim";
import { reclaimRetirementEvidenceMatches, type ReclaimRetirementEvidenceV2 } from "./reclaim-retirement-evidence";

// Deliberately corrupted read-evidence fixtures, not substitutes for canonical
// synthetic-chain receipts in the separately executed browser/PG harness.
const address = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Address;
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const abi = parseAbi(["function redeem(address,uint256[],uint256[],uint256[],bytes32[][],uint64,uint256,uint64,uint48) returns(uint64)"]);
function fixture(standard: 1 | 2 = 1, mode: 1 | 2 = 1, safe = false) {
  const actor = address(0x100001), campaign = address(0x100002), collection = address(0x100003), factory = address(0x100004), token = address(0x100005);
  const ids = standard === 1 ? [1n, 2n] : [101n, 102n], quantities = standard === 1 ? [1n, 1n] : [2n, 3n];
  const destination = mode === 1 ? zeroAddress : address(0x100006), units = quantities.reduce((n, q) => n + q, 0n), reward = units * 5n * 10n ** 18n;
  const data = encodeFunctionData({ abi, functionName: "redeem", args: [collection, ids, quantities, quantities, [[], []], 3n, reward, 7n, 1795044180] });
  const review: ReclaimReview = {
    schemaVersion: 2, profile: reclaimProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false,
    status: safe ? "needs-safe-approvals" : "prepared", operation: "redeem", actor, controller: actor, kind: safe ? "safe-inner" : "eoa", campaign, factory, rewardToken: token,
    factoryRuntimeHash: hash(20), campaignRuntimeHash: hash(21), rewardRuntimeHash: hash(22), targetRuntimeHash: hash(21), actorCodeHash: hash(23),
    controllerEpoch: "1", policyEpoch: "3", fields: { collection, tokenIds: ids.map(String), quantities: quantities.map(String), permanentConsent: true },
    request: safe ? null : { type: "0x2", chainId: "0x7a69", from: actor, to: campaign, value: "0x0", data, nonce: "0x0", gas: "0x10000", maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x0" },
    innerCall: { from: actor, to: campaign, data, value: "0x0" }, observed: { blockNumber: "10", blockHash: hash(10), timestamp: "2026-11-18T23:20:00.000Z" },
    expiresAt: 1795044180, maximumNetworkFeeWei: safe ? "0" : "131072", rewardWei: reward.toString(), custody: "permanent-retirement",
    nft: { collection, tokenIds: ids.map(String), quantities: quantities.map(String), retirementMode: mode, destination, policyHash: hash(24) },
    transfer: { asset: token, from: campaign, to: actor, amountWei: reward.toString() }, notices: [], reviewHash: hash(25),
  };
  review.reviewHash = reclaimReviewHash(review); assert.ok(isReclaimReview(review));
  const evidence: ReclaimRetirementEvidenceV2 = {
    accepted: { receiptId: 22n, claimant: actor, collection, standard, ids, quantities, reward, policyEpoch: 3n, claimantNonce: 7n, retirementMode: mode, destination },
    retired: { receiptId: 22n, collection, standard, ids, quantities, retirementMode: mode, destination },
    stored: [actor, collection, standard, 3n, reward, Number(units), 1, mode, destination], items: [ids, quantities], standard, retirementMode: mode, destination,
    claimantNonceBefore: 7n, claimantNonceAfter: 8n, tradeInNonceBefore: 21n, tradeInNonceAfter: 22n,
  };
  return { review, evidence };
}

test("binds every V2 event, nine-field receipt, reviewed call and historical nonce for EOA and Safe in all four retirement profiles", () => {
  for (const standard of [1, 2] as const) for (const mode of [1, 2] as const) for (const safe of [false, true]) {
    const { review, evidence } = fixture(standard, mode, safe); assert.equal(reclaimRetirementEvidenceMatches(review, evidence), true);
  }
});

test("rejects each contradictory TradeInAccepted field instead of relying only on the paired retirement event", () => {
  const changes: { name: string; change: (e: ReclaimRetirementEvidenceV2) => void }[] = [
    { name: "receiptId", change: e => { e.accepted.receiptId++; } }, { name: "claimant", change: e => { e.accepted.claimant = address(99); } },
    { name: "collection", change: e => { e.accepted.collection = address(99); } }, { name: "standard", change: e => { e.accepted.standard = 2; } },
    { name: "ids", change: e => { e.accepted.ids = [2n, 1n]; } }, { name: "quantities", change: e => { e.accepted.quantities = [1n]; } },
    { name: "reward", change: e => { e.accepted.reward++; } }, { name: "policyEpoch", change: e => { e.accepted.policyEpoch++; } },
    { name: "claimantNonce", change: e => { e.accepted.claimantNonce++; } }, { name: "retirementMode", change: e => { e.accepted.retirementMode = 2; } },
    { name: "destination", change: e => { e.accepted.destination = address(99); } },
  ];
  for (const { name, change } of changes) { const { review, evidence } = fixture(); change(evidence); assert.equal(reclaimRetirementEvidenceMatches(review, evidence), false, name); }
});

test("rejects each contradictory stored receipt field, old seven-field tuples and unbound item arrays", () => {
  for (let i = 0; i < 9; i++) {
    const { review, evidence } = fixture(); const stored = [...evidence.stored];
    stored[i] = typeof stored[i] === "string" ? address(99) : typeof stored[i] === "bigint" ? BigInt(stored[i]) + 1n : Number(stored[i]) + 1;
    evidence.stored = stored as unknown as ReclaimRetirementEvidenceV2["stored"];
    assert.equal(reclaimRetirementEvidenceMatches(review, evidence), false, `stored field ${i}`);
  }
  for (const change of [
    (e: ReclaimRetirementEvidenceV2) => { e.stored = e.stored.slice(0, 7) as unknown as typeof e.stored; },
    (e: ReclaimRetirementEvidenceV2) => { e.items = [[999n], e.items[1]]; },
    (e: ReclaimRetirementEvidenceV2) => { e.items = [e.items[0], [999n]]; },
  ]) { const { review, evidence } = fixture(); change(evidence); assert.equal(reclaimRetirementEvidenceMatches(review, evidence), false); }
});

test("rejects each contradictory permanent-retirement identity or nonce transition", () => {
  for (const change of [
    (e: ReclaimRetirementEvidenceV2) => { e.retired.receiptId++; }, (e: ReclaimRetirementEvidenceV2) => { e.retired.collection = address(99); },
    (e: ReclaimRetirementEvidenceV2) => { e.retired.standard = 2; }, (e: ReclaimRetirementEvidenceV2) => { e.retired.ids = [99n]; },
    (e: ReclaimRetirementEvidenceV2) => { e.retired.quantities = [99n]; }, (e: ReclaimRetirementEvidenceV2) => { e.retired.retirementMode = 2; },
    (e: ReclaimRetirementEvidenceV2) => { e.retired.destination = address(99); },
    (e: ReclaimRetirementEvidenceV2) => { e.claimantNonceBefore++; }, (e: ReclaimRetirementEvidenceV2) => { e.claimantNonceAfter++; },
    (e: ReclaimRetirementEvidenceV2) => { e.tradeInNonceBefore++; }, (e: ReclaimRetirementEvidenceV2) => { e.tradeInNonceAfter++; },
  ]) { const { review, evidence } = fixture(); change(evidence); assert.equal(reclaimRetirementEvidenceMatches(review, evidence), false); }
});

test("correlated event tampering cannot override the reviewed calldata nonce, amounts, recipient or fixed profile", () => {
  const { review, evidence } = fixture(2, 2, true);
  evidence.accepted.claimantNonce = 8n; evidence.claimantNonceBefore = 8n; evidence.claimantNonceAfter = 9n;
  assert.equal(reclaimRetirementEvidenceMatches(review, evidence), false);
  const malformed = fixture(); malformed.review.innerCall.data = "0x12345678";
  assert.equal(reclaimRetirementEvidenceMatches(malformed.review, malformed.evidence), false);
  assert.equal(reclaimRetirementEvidenceMatches(null as never, undefined as never), false);
});
