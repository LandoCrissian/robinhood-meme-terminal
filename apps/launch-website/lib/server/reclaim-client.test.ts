import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, parseAbi, zeroAddress } from "viem";
import { claimProfileDigest } from "../claim-profiles";
import { reclaimCampaignSignatures, reclaimFactorySignatures } from "../../../../packages/launchpad-common/reclaim-v2-runtime.mjs";
import { isReclaimReview, isReclaimSnapshot, reclaimFieldsDigest, reclaimOperations, reclaimProfile, reclaimReviewHash, reclaimVerificationMatches, validReclaimFields,
  type ReclaimFields, type ReclaimOperation, type ReclaimReview, type ReclaimSnapshot, type ReclaimVerification } from "../reclaim";
import { assertNoPendingHistoricalReclaim, assertNoPendingLifecycleForReclaim, assertNoPendingReclaim, canStartAnotherReclaimCampaign, listReclaimJournals, reclaimCampaignIntentKey, reclaimJournalNamespace,
  startAnotherReclaimCampaign, storeReclaimJournal, validReclaimJournal, reconcileReclaimRecovery, type ReclaimJournal } from "../reclaim-recovery";
import { curveBuySignature, isTestLifecycleRequest, type TestLifecycleRequest } from "../test-lifecycle";

const address = (n: number) => ("0x" + BigInt(n).toString(16).padStart(40, "0")) as `0x${string}`;
const hash = (n: number) => ("0x" + BigInt(n).toString(16).padStart(64, "0")) as `0x${string}`;
const actor = address(0x100001), campaign = address(0x100002), factory = address(0x100003), token = address(0x100004), nft = address(0x100005);
const observed = { blockNumber: "10", blockHash: hash(10), timestamp: "2026-11-18T23:20:00.000Z" };
const canonical = { blockNumber: "11", blockHash: hash(11), timestamp: "2026-11-18T23:20:01.000Z" };
const abi = parseAbi([...reclaimFactorySignatures, ...reclaimCampaignSignatures].filter(line => line.startsWith("function ")).concat([
  "function approve(address spender,uint256 amount) returns(bool)", "function setApprovalForAll(address operator,bool approved)"]));
const calldata = (name: string, args: readonly unknown[] = []) => encodeFunctionData({ abi, functionName: name, args });
function setData(r: ReclaimReview, data: `0x${string}`) { r.innerCall.data = data; if (r.request) r.request.data = data; r.reviewHash = reclaimReviewHash(r); }
function review(): ReclaimReview {
  const data = calldata("redeem", [nft, [1n], [1n], [1n], [[]], 1n, 5000000000000000000n, 0n, 1795044180]);
  const value: ReclaimReview = { schemaVersion: 2, profile: reclaimProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false,
    status: "prepared", operation: "redeem", actor, controller: actor, kind: "eoa", campaign, factory, rewardToken: token,
    factoryRuntimeHash: hash(20), campaignRuntimeHash: hash(21), rewardRuntimeHash: hash(22), targetRuntimeHash: hash(21), actorCodeHash: hash(23),
    controllerEpoch: "1", policyEpoch: "1", fields: { collection: nft, tokenIds: ["1"], quantities: ["1"], permanentConsent: true },
    request: { type: "0x2", chainId: "0x7a69", from: actor, to: campaign, value: "0x0", data, nonce: "0x0", gas: "0x10000", maxFeePerGas: "0x2", maxPriorityFeePerGas: "0x0" },
    innerCall: { from: actor, to: campaign, data, value: "0x0" }, observed, expiresAt: 1795044180, maximumNetworkFeeWei: "131072",
    rewardWei: "5000000000000000000", custody: "permanent-retirement", nft: { collection: nft, tokenIds: ["1"], quantities: ["1"], retirementMode: 1, destination: zeroAddress, policyHash: hash(32) },
    transfer: { asset: token, from: campaign, to: actor, amountWei: "5000000000000000000" }, notices: [], reviewHash: hash(1) };
  value.reviewHash = reclaimReviewHash(value); assert.ok(isReclaimReview(value)); return value;
}
function verification(r = review()): ReclaimVerification {
  return { schemaVersion: 2, profile: reclaimProfile, chainId: 31337, executionEnabled: false, status: "confirmed", reviewHash: r.reviewHash,
    transactionHash: hash(99), canonical, indexed: false, finality: "synthetic-local-not-production",
    settlement: { kind: "permanent-surrender", receiptId: "1", claimant: r.actor, collection: nft, tokenIds: ["1"], quantities: ["1"], rewardToken: token,
      rewardWei: r.rewardWei, custody: "permanent-retirement", retirementMode: 1, destination: zeroAddress, policyHash: hash(32), transactionHash: hash(99), canonical } };
}
function snapshot(): ReclaimSnapshot {
  return { status: "ready", schemaVersion: 2, profile: reclaimProfile, chainId: 31337, scope: "isolated-local", executionEnabled: false,
    factory, factoryRuntimeHash: hash(20), campaign, runtimeHash: hash(21), creator: actor, controller: actor, controllerEpoch: "1", policyEpoch: "1", controllerKind: "eoa",
    rewardToken: token, rewardRuntimeHash: hash(22), rewardDecimals: 18, rewardSymbol: "synthetic RMT", rewardMode: "fixed-token-units", rewardPerUnit: "5", walletCap: "4", paused: false, closed: false,
    reserve: { heldWei: "15", availableWei: "15", fundedWei: "20", paidWei: "5", recoveredWei: "0", unsolicitedWei: "0", liabilityWei: "0" },
    collections: [{ address: nft, standard: 1, runtimeHash: hash(30), eligibilityRoot: hash(31), enabled: false, admission: "candidate", retirementMode: 1, destination: zeroAddress, policyHash: hash(32), collectionCap: "32", walletCap: "4", acceptedUnits: "0", eligibleItems: [] }],
    receipts: [], pending: [], history: { status: "pending", indexed: false }, observed, notices: [] };
}
function memory() { const records = new Map<string, string>(); return { records, get length() { return records.size; }, key: (index: number) => [...records.keys()][index] ?? null,
  getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => { records.set(key, value); }, removeItem: (key: string) => { records.delete(key); } }; }
function journal(r = review()): ReclaimJournal { return { schemaVersion: 2, review: r, stage: "awaiting-wallet", transactionHash: null, result: null, createdAt: 1, updatedAt: 1 }; }
test("Reclaim fields are operation-specific with bounded sorted NFT quantities, no arbitrary calldata or decimal rounding", () => {
  assert.ok(validReclaimFields("create-campaign", { intentId: hash(77), controller: actor, rewardPerUnit: "5000000000000000000", walletCap: "4" }));
  assert.ok(validReclaimFields("redeem", { collection: nft, tokenIds: ["0", "2"], quantities: ["1", "19"], permanentConsent: true }));
  assert.equal(validReclaimFields("redeem", { collection: nft, tokenIds: ["1"], quantities: ["1"] }), false, "wallet connection is not irreversible-loss consent");
  for (const fields of [{ collection: nft, tokenIds: ["1", "1"], quantities: ["1", "1"] }, { collection: nft, tokenIds: ["2", "1"], quantities: ["1", "1"] },
    { collection: nft, tokenIds: ["1"], quantities: ["21"] }, { collection: nft, tokenIds: ["1"], quantities: ["0"] }, { collection: nft, tokenIds: ["1.0"], quantities: ["1"] },
    { collection: nft, tokenIds: Array(9).fill("1"), quantities: Array(9).fill("1") }, { collection: nft, tokenIds: ["1"], quantities: [] }, { collection: nft, tokenIds: ["1"], quantities: ["1"], data: "0x12345678" }]) assert.equal(validReclaimFields("redeem", fields), false);
  assert.equal(validReclaimFields("fund", { amountWei: "0" }), false); assert.equal(validReclaimFields("pause", { account: actor }), false);
  assert.equal(validReclaimFields("propose-rate", { rewardPerUnit: (2n ** 128n).toString(), expiresAt: "12" }), false);
});
test("Reclaim field digest ignores property order/hex case while retaining every economic and NFT term", () => {
  assert.equal(reclaimFieldsDigest("approve-721", { collection: nft, tokenId: "1" }), reclaimFieldsDigest("approve-721", { tokenId: "1", collection: nft.toUpperCase().replace("0X", "0x") }));
  assert.notEqual(reclaimFieldsDigest("fund", { amountWei: "1" }), reclaimFieldsDigest("fund", { amountWei: "2" }));
});
test("every supported operation matches canonical contract calldata and exact reviewed fields", () => {
  const expiry = "1795044180", reward = "5000000000000000000";
  const cases: [ReclaimOperation, ReclaimFields, string, readonly unknown[]][] = [
    ["create-campaign", { intentId: hash(77), controller: actor, rewardPerUnit: reward, walletCap: "4" }, "create", [hash(77), actor, BigInt(reward), 4]],
    ["approve-funding", { amountWei: reward }, "approve", [campaign, BigInt(reward)]], ["fund", { amountWei: reward }, "fund", [BigInt(reward)]],
    ["propose-collection", { collection: nft, collectionCap: "32", collectionWalletCap: "4", expiresAt: expiry }, "proposeCollection", [nft, 1, hash(30), hash(31), 32, 4, 1, hash(32), Number(expiry)]],
    ["disable-collection", { collection: nft }, "disableCollection", [nft]], ["approve-721", { collection: nft, tokenId: "1" }, "approve", [campaign, 1n]],
    ["approve-1155", { collection: nft }, "setApprovalForAll", [campaign, true]], ["revoke-1155", { collection: nft }, "setApprovalForAll", [campaign, false]],
    ["redeem", { collection: nft, tokenIds: ["1"], quantities: ["1"], permanentConsent: true }, "redeem", [nft, [1n], [1n], [1n], [[]], 1n, BigInt(reward), 0n, Number(expiry)]],
    ["propose-rate", { rewardPerUnit: reward, expiresAt: expiry }, "proposeRate", [BigInt(reward), Number(expiry)]],
    ["propose-close", { expiresAt: expiry }, "proposeClose", [Number(expiry)]],
    ["propose-recovery", { amountWei: reward, expiresAt: expiry }, "proposeRecovery", [BigInt(reward), Number(expiry)]],
    ["propose-controller", { next: factory, expiresAt: expiry }, "proposeController", [factory, Number(expiry)]],
  ];
  const noArguments: Partial<Record<ReclaimOperation, string>> = { "execute-collection": "executeCollection", "cancel-collection": "cancelCollection", pause: "pause", resume: "resume",
    "execute-rate": "executeRate", "cancel-rate": "cancelRate", "execute-close": "executeClose", "cancel-close": "cancelClose", "execute-recovery": "executeRecovery",
    "cancel-recovery": "cancelRecovery", "accept-controller": "acceptController", "cancel-controller": "cancelController" };
  for (const [operation, name] of Object.entries(noArguments)) cases.push([operation as ReclaimOperation, {}, name, []]);
  assert.equal(new Set(cases.map(([operation]) => operation)).size, reclaimOperations.length);
  for (const [operation, fields, name, args] of cases) {
    const r = review(); r.operation = operation; r.fields = fields;
    if (operation !== "redeem") delete r.nft;
    if (operation === "fund") r.transfer = { asset: token, from: actor, to: campaign, amountWei: reward };
    else if (operation === "execute-recovery") r.transfer = { asset: token, from: campaign, to: r.controller, amountWei: reward };
    else if (operation !== "redeem") delete r.transfer;
    const target = operation === "create-campaign" ? factory : operation === "approve-funding" ? token
      : ["approve-721", "approve-1155", "revoke-1155"].includes(operation) ? nft : campaign;
    r.innerCall.to = target; r.request!.to = target;
    r.targetRuntimeHash = target === factory ? r.factoryRuntimeHash : target === token ? r.rewardRuntimeHash : target === nft ? hash(30) : r.campaignRuntimeHash;
    setData(r, calldata(name, args)); assert.ok(isReclaimReview(r), operation);
    const original = r.innerCall.data; setData(r, `${original}00`); assert.equal(isReclaimReview(r), false, `${operation}: trailing bytes are not a canonical request`);
    setData(r, calldata("approve", [factory, 7n])); assert.equal(isReclaimReview(r), false, `${operation}: unrelated target/amount or selector cannot inherit the label`);
  }
});
test("exact review rejects wrong chain, actor, target, fee envelope, custody, NFT context and changed digest", () => {
  for (const mutate of [
    (r: ReclaimReview) => { r.chainId = 4663 as never; }, (r: ReclaimReview) => { r.executionEnabled = true as never; }, (r: ReclaimReview) => { r.innerCall.to = nft; },
    (r: ReclaimReview) => { r.request!.from = factory; }, (r: ReclaimReview) => { r.request!.value = "0x1" as never; }, (r: ReclaimReview) => { r.maximumNetworkFeeWei = "131073"; },
    (r: ReclaimReview) => { r.custody = "reversible-escrow" as never; }, (r: ReclaimReview) => { r.nft!.tokenIds = ["2"]; }, (r: ReclaimReview) => { delete r.nft; },
    (r: ReclaimReview) => { delete r.fields.permanentConsent; }, (r: ReclaimReview) => { r.nft!.destination = factory; },
    (r: ReclaimReview) => { r.targetRuntimeHash = hash(50); },
  ]) { const r = review(); mutate(r); r.reviewHash = reclaimReviewHash(r); assert.equal(isReclaimReview(r), false); }
  const tampered = review(); tampered.rewardWei = "1"; assert.equal(isReclaimReview(tampered), false);
});
test("Safe review is unsigned inner CALL only and cannot become an EOA wallet submission", () => {
  const r = review(); r.status = "needs-safe-approvals"; r.kind = "safe-inner"; r.request = null; r.maximumNetworkFeeWei = "0"; r.reviewHash = reclaimReviewHash(r); assert.ok(isReclaimReview(r));
  r.status = "prepared"; r.reviewHash = reclaimReviewHash(r); assert.equal(isReclaimReview(r), false);
});
test("campaign reads reject fake liabilities/reserves and candidate collection eligibility", () => {
  assert.ok(isReclaimSnapshot(snapshot()));
  const gift = snapshot(); gift.reserve.heldWei = "20"; assert.ok(isReclaimSnapshot(gift), "unreconciled direct gifts are held separately from spendable reserves");
  for (const mutate of [(s: ReclaimSnapshot) => { s.reserve.heldWei = "14"; }, (s: ReclaimSnapshot) => { s.reserve.availableWei = "16"; },
    (s: ReclaimSnapshot) => { s.reserve.liabilityWei = "1" as never; }, (s: ReclaimSnapshot) => { s.collections[0].enabled = true; },
    (s: ReclaimSnapshot) => { s.collections[0].eligibleItems = [{ tokenId: "1", maxQuantity: "1", remainingQuantity: "1" }]; },
    (s: ReclaimSnapshot) => { s.chainId = 4663 as never; }, (s: ReclaimSnapshot) => { s.rewardMode = "usd-oracle" as never; }]) { const s = snapshot(); mutate(s); assert.equal(isReclaimSnapshot(s), false); }
});
test("canonical settlement binds original NFT IDs, claimant, reward, receipt and custody separately from indexing", () => {
  const r = review(), result = verification(r); assert.ok(reclaimVerificationMatches(r, result)); assert.equal(result.indexed, false);
  for (const mutate of [(v: ReclaimVerification) => { v.settlement!.claimant = factory; }, (v: ReclaimVerification) => { v.settlement!.collection = factory; },
    (v: ReclaimVerification) => { v.settlement!.tokenIds = ["2"]; }, (v: ReclaimVerification) => { v.settlement!.quantities = ["2"]; },
    (v: ReclaimVerification) => { v.settlement!.rewardWei = "1"; }, (v: ReclaimVerification) => { v.settlement!.custody = "returned" as never; },
    (v: ReclaimVerification) => { v.settlement!.retirementMode = 2; v.settlement!.destination = factory; }, (v: ReclaimVerification) => { v.settlement!.policyHash = hash(91); },
    (v: ReclaimVerification) => { v.canonical!.blockNumber = "10"; }, (v: ReclaimVerification) => { v.transactionHash = hash(98); },
    (v: ReclaimVerification) => { delete v.settlement; }]) { const v = structuredClone(result); mutate(v); assert.equal(reclaimVerificationMatches(r, v, hash(99)), false); }
});
test("old repayment/return operations and selectors are never admitted by the permanent candidate", () => {
  for (const operation of ["approve-return", "return"]) assert.equal(validReclaimFields(operation as ReclaimOperation, { receiptId: "1" }), false);
  const r = review(), old = parseAbi(["function returnTradeIn(uint64 receiptId,uint48 deadline)"]);
  setData(r, encodeFunctionData({ abi: old, functionName: "returnTradeIn", args: [1n, r.expiresAt] })); assert.equal(isReclaimReview(r), false);
  const s = snapshot(); (s.reserve as unknown as Record<string, string>).repaidWei = "0"; assert.equal(isReclaimSnapshot(s), false);
});
test("pending, unavailable and reorged recovery preserve original identity without inventing success", () => {
  const r = review();
  for (const status of ["pending", "unavailable", "reorged"] as const) assert.ok(reclaimVerificationMatches(r, { schemaVersion: 2, profile: reclaimProfile, chainId: 31337,
    executionEnabled: false, status, reviewHash: r.reviewHash, transactionHash: hash(99), finality: "synthetic-local-not-production" }, hash(99)));
  assert.equal(reclaimVerificationMatches(r, { ...verification(r), canonical: undefined }), false);
});
test("recovery retains original request/hash, blocks new submissions and never evicts completed history", () => {
  const storage = memory(), entry = journal(); storeReclaimJournal(storage, entry); assert.equal(listReclaimJournals(storage).length, 1);
  assert.throws(() => assertNoPendingReclaim(storage, actor), /Recover the earlier/); assert.doesNotThrow(() => assertNoPendingReclaim(storage, factory));
  const pending: ReclaimJournal = { ...entry, stage: "pending", transactionHash: hash(99), updatedAt: 2 }; storeReclaimJournal(storage, pending);
  assert.throws(() => storeReclaimJournal(storage, { ...pending, transactionHash: hash(98), updatedAt: 3 }), /cannot be replaced/);
  assert.throws(() => storeReclaimJournal(storage, { ...pending, updatedAt: 1 }), /cannot be replaced/);
  const complete: ReclaimJournal = { ...pending, stage: "confirmed", result: verification(entry.review), updatedAt: 3 }; storeReclaimJournal(storage, complete);
  assert.doesNotThrow(() => assertNoPendingReclaim(storage, actor)); assert.equal(listReclaimJournals(storage)[0].transactionHash, hash(99));
  storeReclaimJournal(storage, { ...complete, stage: "reorged", result: { ...complete.result!, status: "reorged" }, updatedAt: 4 });
  assert.throws(() => assertNoPendingReclaim(storage, actor), /Recover the earlier/);
});
test("wallet rejection is distinct from ambiguous hash loss and malformed storage fails closed", () => {
  const storage = memory(), entry = journal(); storeReclaimJournal(storage, { ...entry, stage: "wallet-rejected" }); assert.doesNotThrow(() => assertNoPendingReclaim(storage, actor));
  storeReclaimJournal(storage, { ...entry, stage: "hash-missing", updatedAt: 2 }); assert.throws(() => assertNoPendingReclaim(storage, actor));
  const key = reclaimJournalNamespace + ":" + entry.review.reviewHash; storage.setItem(key, "corrupted-original"); assert.throws(() => listReclaimJournals(storage), /malformed/);
  assert.equal(validReclaimJournal({ ...entry, stage: "confirmed" }), false);
});
test("an unverified manual recovery hash cannot strand the original request and a canonical hash remains immutable", () => {
  for (const status of ["pending", "unavailable", "reorged"] as const) {
    const storage = memory(), original = { ...journal(), stage: "hash-missing" as const };
    storeReclaimJournal(storage, original);
    const hint: ReclaimVerification = { schemaVersion: 2, profile: reclaimProfile, chainId: 31337, executionEnabled: false,
      reviewHash: original.review.reviewHash, status, transactionHash: hash(98), finality: "synthetic-local-not-production" };
    const unresolved = reconcileReclaimRecovery(original, hint, 2, hash(98)); storeReclaimJournal(storage, unresolved);
    assert.equal(unresolved.transactionHash, null); assert.equal(unresolved.result?.transactionHash, undefined);
    assert.equal(listReclaimJournals(storage).length, 1); assert.throws(() => assertNoPendingReclaim(storage, actor));
    const correct = verification(original.review), completed = reconcileReclaimRecovery(unresolved, correct, 3, hash(99));
    storeReclaimJournal(storage, completed); assert.equal(completed.transactionHash, hash(99));
    assert.throws(() => reconcileReclaimRecovery(completed, hint, 4, hash(98)), /original Reclaim/);
    assert.throws(() => storeReclaimJournal(storage, { ...completed, transactionHash: hash(98), updatedAt: 4 }));
    assert.equal(listReclaimJournals(storage)[0].transactionHash, hash(99));
    assert.throws(() => reconcileReclaimRecovery(unresolved, { ...correct, canonical: undefined }, 4, hash(99)), /original Reclaim/);
  }
  const original = { ...journal(), stage: "pending" as const, transactionHash: hash(99) };
  const unavailable = { ...verification(original.review), status: "unavailable" as const };
  assert.equal(reconcileReclaimRecovery(original, unavailable, 2).transactionHash, hash(99), "Wallet-returned hash survives an outage");
});
test("a separate campaign requires explicit intent release after canonical indexed creation and retains every original journal", () => {
  const r = review(); r.operation = "create-campaign"; r.fields = { intentId: hash(77), controller: actor, rewardPerUnit: r.rewardWei, walletCap: "4" };
  delete r.nft; delete r.transfer; r.innerCall.to = factory; r.request!.to = factory; r.targetRuntimeHash = r.factoryRuntimeHash;
  setData(r, calldata("create", [hash(77), actor, BigInt(r.rewardWei), 4])); assert.ok(isReclaimReview(r));
  const s = snapshot(); s.observed = canonical; s.history = { status: "ready", indexed: true, checkpoint: canonical };
  const result = verification(r); delete result.settlement; result.indexed = true; result.snapshot = s;
  const completed: ReclaimJournal = { ...journal(r), stage: "confirmed", transactionHash: result.transactionHash!, result, updatedAt: 2 };
  assert.ok(canStartAnotherReclaimCampaign(completed));
  assert.equal(canStartAnotherReclaimCampaign({ ...completed, result: { ...result, indexed: false } }), false);
  assert.equal(canStartAnotherReclaimCampaign({ ...completed, stage: "pending", result: null }), false);
  const storage = memory(), intentKey = reclaimCampaignIntentKey(actor); storage.setItem(intentKey, hash(77)); storeReclaimJournal(storage, completed);
  assert.equal(storage.getItem(intentKey), hash(77), "receipt verification does not clear an intent automatically");
  const originals = JSON.stringify(listReclaimJournals(storage));
  assert.throws(() => startAnotherReclaimCampaign(storage, completed, factory), /original campaign/);
  const unresolved = journal(); storeReclaimJournal(storage, unresolved);
  assert.throws(() => startAnotherReclaimCampaign(storage, completed, actor), /Recover the earlier/);
  storeReclaimJournal(storage, { ...unresolved, stage: "wallet-rejected", updatedAt: 2 });
  const retained = JSON.stringify(listReclaimJournals(storage));
  startAnotherReclaimCampaign(storage, completed, actor); assert.equal(storage.getItem(intentKey), null);
  assert.equal(JSON.stringify(listReclaimJournals(storage)), retained); assert.ok(retained.includes(result.transactionHash!));
  assert.ok(originals.includes(result.transactionHash!));
  storage.setItem(intentKey, hash(78)); assert.throws(() => startAnotherReclaimCampaign(storage, completed, actor), /no longer matches/);
  assert.equal(storage.getItem(intentKey), hash(78), "an old receipt cannot erase a new campaign intent");
});
test("Reclaim submission respects the original lifecycle request and bounds storage inspection", () => {
  const storage = memory(), key = `rmt:test-trades:31337:v1:${hash(44)}`;
  const request: TestLifecycleRequest = { operation: "buy", token, curve: campaign, factory, from: actor, to: campaign,
    data: encodeFunctionData({ abi: parseAbi([curveBuySignature]), functionName: "buy", args: [10n, 100n] }),
    chainId: "0x7a69", value: "0x14", nonce: "0x1", blockNumber: "0x2", blockHash: hash(2), reviewBlockNumber: "0x3", reviewBlockHash: hash(3),
    deadline: "100", amountWei: "20", minimumOutputWei: "10", slippageBps: 0 };
  assert.ok(isTestLifecycleRequest(request)); assert.doesNotThrow(() => assertNoPendingLifecycleForReclaim(storage, actor));
  storage.setItem(key, JSON.stringify({ pending: { request }, history: [] }));
  assert.throws(() => assertNoPendingLifecycleForReclaim(storage, actor), /Recover the earlier lifecycle/);
  assert.doesNotThrow(() => assertNoPendingLifecycleForReclaim(storage, factory));
  storage.setItem(key, JSON.stringify({ history: [{ request, transactionHash: hash(77) }] }));
  assert.doesNotThrow(() => assertNoPendingLifecycleForReclaim(storage, actor));
  storage.setItem(key, "original-malformed-record"); assert.throws(() => assertNoPendingLifecycleForReclaim(storage, actor), /malformed/);
  assert.equal(storage.getItem(key), "original-malformed-record");
  storage.setItem(key, " ".repeat(65537)); assert.throws(() => assertNoPendingLifecycleForReclaim(storage, actor), /bound/);
  const many = memory(); for (let i = 0; i < 257; i++) many.setItem(`preference-${i}`, "true");
  assert.throws(() => assertNoPendingLifecycleForReclaim(many, actor), /inspection bound/);
});
test("journal enforces 32 records and 64KiB without dropping original transactions", () => {
  const storage = memory();
  for (let i = 0; i < 32; i++) { const r = review(); r.request!.nonce = ("0x" + i.toString(16)) as `0x${string}`; r.reviewHash = reclaimReviewHash(r); storeReclaimJournal(storage, journal(r)); }
  assert.equal(listReclaimJournals(storage).length, 32); const extra = review(); extra.request!.nonce = "0x20"; extra.reviewHash = reclaimReviewHash(extra);
  assert.throws(() => storeReclaimJournal(storage, journal(extra)), /full/); assert.equal(listReclaimJournals(storage).length, 32);
  const large = review(), ids = Array.from({ length: 8 }, (_, i) => String(i + 1));
  large.fields = { collection: nft, tokenIds: ids, quantities: ids.map(() => "1"), permanentConsent: true }; large.nft = { collection: nft, tokenIds: ids, quantities: ids.map(() => "1"), retirementMode: 1, destination: zeroAddress, policyHash: hash(32) };
  large.notices = Array(16).fill("界".repeat(1000));
  setData(large, calldata("redeem", [nft, ids.map(BigInt), ids.map(() => 1n), ids.map(() => 1n), ids.map(() => Array(32).fill(hash(88))), 1n, BigInt(large.rewardWei), 0n, large.expiresAt]));
  assert.ok(isReclaimReview(large));
  assert.throws(() => storeReclaimJournal(memory(), journal(large)), /64 KiB/);
});

test("historical V1 records are preserved, block unresolved actors, and cannot become active reviews", () => {
  const current = review(), { reviewHash: _ignored, ...base } = current;
  const oldBody = { ...base, schemaVersion: 1, profile: "rmt-reclaim-v1", custody: "reversible-escrow" };
  const oldReview = { ...oldBody, reviewHash: claimProfileDigest(oldBody) }, oldKey = "rmt.reclaim.pending.v1:" + oldReview.reviewHash;
  const storage = memory(); storage.setItem("rmt.reclaim.pending.v1:index", JSON.stringify([oldKey]));
  const old = { schemaVersion: 1, review: oldReview, stage: "pending", transactionHash: hash(90), result: null };
  const raw = JSON.stringify(old); storage.setItem(oldKey, raw);
  assert.equal(isReclaimReview(oldReview), false); assert.throws(() => assertNoPendingReclaim(storage, actor), /Historical V1/);
  assert.doesNotThrow(() => assertNoPendingHistoricalReclaim(storage, factory)); assert.equal(storage.getItem(oldKey), raw);
  storage.setItem(oldKey, JSON.stringify({ ...old, stage: "confirmed", result: { status: "confirmed", reviewHash: oldReview.reviewHash, transactionHash: hash(90) } }));
  assert.doesNotThrow(() => assertNoPendingReclaim(storage, actor));
  storage.setItem(oldKey, "broken-original"); assert.throws(() => assertNoPendingReclaim(storage, actor), /Historical Reclaim record/);
  assert.equal(storage.getItem(oldKey), "broken-original");
});
