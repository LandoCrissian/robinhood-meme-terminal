import assert from "node:assert/strict";
import test from "node:test";
import { concatHex, encodeFunctionData, hashTypedData, keccak256, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { isReclaimReview, reclaimProfile, reclaimReviewHash, type ReclaimReview } from "../reclaim";
import { assertNoPendingReclaim } from "../reclaim-recovery";
import { canonicalSafeApprovals, canonicalSafeTypedData, isReclaimSafeOuterReview, isReclaimSafeProposal, reclaimSafeExecutionAbi, reclaimSafeOuterReviewHash,
  reclaimSafeProposalHash, reclaimSafeVerificationMatches, verifyReclaimSafeApproval, verifyReclaimSafeApprovals,
  type ReclaimSafeApproval, type ReclaimSafeOuterReview, type ReclaimSafeProposal, type ReclaimSafeVerification } from "../reclaim-safe";
import { listReclaimSafeJournals, reclaimSafeJournalNamespace, storeReclaimSafeJournal, reconcileReclaimSafeRecovery, type ReclaimSafeJournal } from "../reclaim-safe-recovery";

const address = (n: number) => ("0x" + n.toString(16).padStart(40, "0")) as Address;
const hash = (n: number) => ("0x" + n.toString(16).padStart(64, "0")) as Hex;
const campaign = address(0x100001), factory = address(0x100002), safe = address(0x100003), payer = address(0x100004), reward = address(0x100005), nft = address(0x100006);
const observed = { blockNumber: "100", blockHash: hash(100), timestamp: "2026-11-19T01:00:00.000Z" };
const owners = Array.from({ length: 3 }, () => privateKeyToAccount(generatePrivateKey()));
function inner(): ReclaimReview {
  const data = encodeFunctionData({ abi: parseAbi(["function redeem(address,uint256[],uint256[],uint256[],bytes32[][],uint64,uint256,uint64,uint48)"]), functionName: "redeem",
    args: [nft, [1n], [1n], [1n], [[]], 1n, 5n, 0n, 1800000000] });
  const r: ReclaimReview = { schemaVersion: 2, profile: reclaimProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false, status: "needs-safe-approvals",
    operation: "redeem", actor: safe, controller: safe, kind: "safe-inner", campaign, factory, rewardToken: reward, factoryRuntimeHash: hash(1), campaignRuntimeHash: hash(2),
    rewardRuntimeHash: hash(3), targetRuntimeHash: hash(2), actorCodeHash: hash(4), controllerEpoch: "1", policyEpoch: "1", fields: { collection: nft, tokenIds: ["1"], quantities: ["1"], permanentConsent: true },
    request: null, innerCall: { from: safe, to: campaign, data, value: "0x0" }, observed, expiresAt: 1800000000, maximumNetworkFeeWei: "0", rewardWei: "5", custody: "permanent-retirement",
    nft: { collection: nft, tokenIds: ["1"], quantities: ["1"], retirementMode: 1, destination: zeroAddress, policyHash: hash(5) }, transfer: { asset: reward, from: campaign, to: safe, amountWei: "5" }, notices: [], reviewHash: hash(6) };
  r.reviewHash = reclaimReviewHash(r); assert.ok(isReclaimReview(r)); return r;
}
function proposal(): ReclaimSafeProposal {
  const r = inner(), p: ReclaimSafeProposal = { schemaVersion: 1, profile: reclaimProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false, status: "awaiting-safe-approvals",
    innerReview: r, safe, gasPayer: payer, owners: owners.map(a => a.address), threshold: 2, safeNonce: "7", gasPayerNonce: "2",
    safeTx: { to: campaign, value: "0", data: r.innerCall.data, operation: 0, safeTxGas: "0", baseGas: "0", gasPrice: "0", gasToken: zeroAddress, refundReceiver: zeroAddress, nonce: "7" },
    digest: hash(7), observed, expiresAt: r.expiresAt, proposalHash: hash(8) };
  p.digest = hashTypedData(canonicalSafeTypedData(p) as never); p.proposalHash = reclaimSafeProposalHash(p); assert.ok(isReclaimSafeProposal(p)); return p;
}
async function approvals(p: ReclaimSafeProposal): Promise<ReclaimSafeApproval[]> {
  return canonicalSafeApprovals(await Promise.all(owners.slice(0, 2).map(async owner => ({ signer: owner.address, signature: await owner.signTypedData(canonicalSafeTypedData(p) as never) }))));
}
async function outer(): Promise<ReclaimSafeOuterReview> {
  const p = proposal(), signed = await approvals(p);
  const data = encodeFunctionData({ abi: reclaimSafeExecutionAbi, functionName: "execTransaction", args: [p.safeTx.to, 0n, p.safeTx.data, 0, 0n, 0n, 0n, zeroAddress, zeroAddress, concatHex(signed.map(a => a.signature))] });
  const r: ReclaimSafeOuterReview = { schemaVersion: 1, profile: reclaimProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false, status: "prepared", proposal: p, approvals: signed,
    request: { type: "0x2", chainId: "0x7a69", from: payer, to: safe, data, value: "0x0", nonce: "0x2", gas: "0x10000", maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x0" },
    observed, expiresAt: p.expiresAt, maximumNetworkFeeWei: "131072", gasPayerCodeHash: keccak256("0x"), reviewHash: hash(8) };
  r.reviewHash = reclaimSafeOuterReviewHash(r); assert.ok(isReclaimSafeOuterReview(r)); return r;
}
function memory() { const values = new Map<string, string>(); return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } }; }

test("Safe proposal independently binds native-zero CALL, beneficiary, distinct nonces, domain and permanent surrender", () => {
  const p = proposal(); assert.equal(canonicalSafeTypedData(p).domain.chainId, 31337); assert.equal(canonicalSafeTypedData(p).domain.verifyingContract, safe);
  for (const change of [(p: ReclaimSafeProposal) => { p.safeTx.to = factory; }, (p: ReclaimSafeProposal) => { p.safeTx.operation = 1 as never; },
    (p: ReclaimSafeProposal) => { p.safeTx.gasPrice = "1" as never; }, (p: ReclaimSafeProposal) => { p.safeNonce = "8"; },
    (p: ReclaimSafeProposal) => { p.owners[1] = p.owners[0]; }, (p: ReclaimSafeProposal) => { p.innerReview.fields.permanentConsent = undefined; },
    (p: ReclaimSafeProposal) => { p.chainId = 4663 as never; }, (p: ReclaimSafeProposal) => { p.safeTx.data += "00"; },
  ]) { const value = structuredClone(p); change(value); value.proposalHash = reclaimSafeProposalHash(value); assert.equal(isReclaimSafeProposal(value), false); }
});
test("genuine two-owner typed signatures reject duplicates, wrong domain, forged owner identity and high-S", async () => {
  const p = proposal(), signed = await approvals(p); assert.ok(await verifyReclaimSafeApprovals(p, signed));
  assert.equal(await verifyReclaimSafeApprovals(p, [signed[0]]), false); assert.equal(await verifyReclaimSafeApprovals(p, [signed[0], signed[0]]), false);
  assert.equal(await verifyReclaimSafeApproval(p, { signer: owners[2].address, signature: signed[0].signature }), false);
  const other = structuredClone(p); other.safe = address(0x100099); assert.equal(await verifyReclaimSafeApproval(other, signed[0]), false);
  const high = { ...signed[0], signature: (signed[0].signature.slice(0, 66) + "f".repeat(64) + signed[0].signature.slice(-2)) as Hex };
  assert.equal(await verifyReclaimSafeApproval(p, high), false);
});
test("Safe outer calldata and gas envelope cannot change the approved action or impersonate an owner EOA", async () => {
  const r = await outer();
  for (const change of [(r: ReclaimSafeOuterReview) => { r.request.to = campaign; }, (r: ReclaimSafeOuterReview) => { r.request.from = owners[0].address; },
    (r: ReclaimSafeOuterReview) => { r.request.nonce = "0x3"; }, (r: ReclaimSafeOuterReview) => { r.request.value = "0x1" as never; },
    (r: ReclaimSafeOuterReview) => { r.request.data += "00"; }, (r: ReclaimSafeOuterReview) => { r.maximumNetworkFeeWei = "0"; },
    (r: ReclaimSafeOuterReview) => { r.approvals.reverse(); }, (r: ReclaimSafeOuterReview) => { r.request.gas = "0x0"; },
  ]) { const value = structuredClone(r); change(value); value.reviewHash = reclaimSafeOuterReviewHash(value); assert.equal(isReclaimSafeOuterReview(value), false); }
});
test("Safe original journal preserves outer hash, blocks both Safe and gas payer, survives restoration and never resubmits", async () => {
  const r = await outer(), storage = memory(), e: ReclaimSafeJournal = { schemaVersion: 1, proposal: r.proposal, approvals: r.approvals, outerReview: r, stage: "awaiting-wallet", transactionHash: null, result: null, createdAt: 1, updatedAt: 1 };
  storeReclaimSafeJournal(storage, e); assert.equal(listReclaimSafeJournals(storage).length, 1);
  assert.throws(() => assertNoPendingReclaim(storage, safe), /original Safe/); assert.throws(() => assertNoPendingReclaim(storage, payer), /original Safe/);
  const pending = { ...e, stage: "hash-missing" as const, updatedAt: 2 }; storeReclaimSafeJournal(storage, pending);
  assert.equal(listReclaimSafeJournals(storage)[0].outerReview?.reviewHash, r.reviewHash);
  const unavailable = { schemaVersion: 2 as const, profile: reclaimProfile, chainId: 31337 as const, executionEnabled: false as const, reviewHash: r.reviewHash, proposalHash: r.proposal.proposalHash,
    safe, gasPayer: payer, safeNonce: "7", operation: r.proposal.innerReview.operation, status: "unavailable" as const, finality: "synthetic-local-not-production" as const, transactionHash: hash(90) };
  assert.ok(reclaimSafeVerificationMatches(r, unavailable)); storeReclaimSafeJournal(storage, { ...pending, transactionHash: hash(90), stage: "unavailable", result: unavailable, updatedAt: 3 });
  assert.throws(() => storeReclaimSafeJournal(storage, { ...pending, transactionHash: hash(91), updatedAt: 4 }), /cannot be replaced/);
  const raw = storage.getItem(reclaimSafeJournalNamespace + ":" + r.proposal.proposalHash); assert.ok(raw?.includes(hash(90)));
});
test("wrong manual Safe hashes remain hints until canonical exact settlement and cannot poison later recovery", async () => {
  const r = await outer(), point = { blockNumber: "101", blockHash: hash(101), timestamp: "2026-11-19T01:00:01.000Z" };
  for (const status of ["pending", "unavailable", "reorged"] as const) {
    const storage = memory(), original: ReclaimSafeJournal = { schemaVersion: 1, proposal: r.proposal, approvals: r.approvals, outerReview: r,
      stage: "hash-missing", transactionHash: null, result: null, createdAt: 1, updatedAt: 1 };
    storeReclaimSafeJournal(storage, original);
    const hint: ReclaimSafeVerification = { schemaVersion: 2, profile: reclaimProfile, chainId: 31337, executionEnabled: false, reviewHash: r.reviewHash,
      proposalHash: r.proposal.proposalHash, safe, gasPayer: payer, safeNonce: "7", operation: "redeem", status, transactionHash: hash(98), finality: "synthetic-local-not-production" };
    const unresolved = reconcileReclaimSafeRecovery(original, hint, 2, hash(98)); storeReclaimSafeJournal(storage, unresolved);
    assert.equal(unresolved.transactionHash, null); assert.equal(unresolved.result?.transactionHash, undefined);
    assert.throws(() => assertNoPendingReclaim(storage, safe)); assert.throws(() => assertNoPendingReclaim(storage, payer));
    for (const terminal of ["confirmed", "reverted"] as const) {
      const correct: ReclaimSafeVerification = { ...hint, status: terminal, transactionHash: hash(99), canonical: point,
        ...(terminal === "confirmed" && { settlement: { ...r.proposal.innerReview.nft!, kind: "permanent-surrender", receiptId: "1", claimant: safe,
          rewardToken: reward, rewardWei: "5", custody: "permanent-retirement", transactionHash: hash(99), canonical: point } }) };
      const completed = reconcileReclaimSafeRecovery(unresolved, correct, 3, hash(99));
      assert.equal(completed.transactionHash, hash(99)); assert.ok(reclaimSafeVerificationMatches(r, completed.result));
      assert.throws(() => reconcileReclaimSafeRecovery(completed, hint, 4, hash(98)), /original Safe/);
      assert.throws(() => reconcileReclaimSafeRecovery(unresolved, { ...correct, canonical: undefined }, 4, hash(99)), /original Safe/);
    }
    const correct = { ...hint, status: "reverted" as const, transactionHash: hash(99), canonical: point };
    storeReclaimSafeJournal(storage, reconcileReclaimSafeRecovery(unresolved, correct, 3, hash(99)));
    assert.equal(listReclaimSafeJournals(storage).length, 1); assert.equal(listReclaimSafeJournals(storage)[0].transactionHash, hash(99));
  }
});
