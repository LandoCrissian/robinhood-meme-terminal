import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyVNextRevertedExecution,
  findBlockingVNextWalletRequest,
  promoteVNextWalletRequestToSubmitted,
  readVNextExecutionJournal,
  readVNextWalletRequestJournal,
  reconcileExpiredVNextWalletRequest,
  recordPreparedVNextWalletRequest,
  resolveVNextExecution,
  transitionVNextWalletRequest,
  VNEXT_EXECUTION_STORAGE_KEY,
  type VNextExecutionStorage
} from "./execution-recovery";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import { DIRECT_SMOKE_RECIPIENT, DIRECT_SMOKE_SWAP_PLAN } from "./direct-no-rmt-fee-smoke-fixture";
import { assessVNextWalletGasReadiness } from "./wallet-submission";

function memoryStorage() {
  const values = new Map<string, string>();
  const storage: VNextExecutionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); }
  };
  return { values, storage };
}

const now = 1_786_000_000_001;
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const txHash = `0x${"b".repeat(64)}`;
const first = memoryStorage();
const prepared = recordPreparedVNextWalletRequest({
  requestId,
  wallet: DIRECT_SMOKE_RECIPIENT,
  plan: DIRECT_SMOKE_SWAP_PLAN,
  walletNonceBeforeRequest: 7n
}, first.storage, now);
assert.equal(prepared?.state, "PREPARED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, first.storage, now), null);
assert.equal(transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", first.storage, now + 1)?.state, "PROMPT_REQUESTED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, first.storage, now + 2)?.requestId, requestId);
assert.equal(recordPreparedVNextWalletRequest({
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  wallet: DIRECT_SMOKE_RECIPIENT,
  plan: { ...DIRECT_SMOKE_SWAP_PLAN, planId: "66666666-6666-4666-8666-666666666666" },
  walletNonceBeforeRequest: 7n
}, first.storage, now + 2), null, "a different plan ID cannot bypass the wallet-level pre-hash guard");
assert.equal(transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", first.storage, now + 3)?.state, "PROVIDER_PENDING");
const reloaded = readVNextWalletRequestJournal(first.storage, now + 4)[0];
assert.equal(reloaded.state, "PROVIDER_PENDING", "the prompt journal survives page reload and deployment changes");
const expired = reconcileExpiredVNextWalletRequest({
  request: reloaded,
  latestNonce: 7n,
  pendingNonce: 7n,
  nowMs: Number(BigInt(reloaded.finalOnchainDeadline) * 1_000n) + 1
}, first.storage);
assert.equal(expired.state, "EXPIRED_UNSUBMITTED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, first.storage, expired.updatedAtMs), null);

const promptOnly = memoryStorage();
const promptOnlyRequestId = "12121212-1212-4212-8212-121212121212";
assert.ok(recordPreparedVNextWalletRequest({ requestId: promptOnlyRequestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 9n }, promptOnly.storage, now));
assert.equal(transitionVNextWalletRequest(promptOnlyRequestId, "PROMPT_REQUESTED", promptOnly.storage, now + 1)?.state, "PROMPT_REQUESTED");
const promptOnlyDeadlineMs = Number(BigInt(DIRECT_SMOKE_SWAP_PLAN.deadline) * 1_000n);
assert.equal(reconcileExpiredVNextWalletRequest({
  request: readVNextWalletRequestJournal(promptOnly.storage, promptOnlyDeadlineMs + 1)[0]!,
  latestNonce: 9n,
  pendingNonce: 9n,
  nowMs: promptOnlyDeadlineMs + 1
}, promptOnly.storage).state, "EXPIRED_UNSUBMITTED", "a provider call that never returned still clears only after deadline and unchanged latest/pending nonces");

const advanced = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n }, advanced.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", advanced.storage, now + 1);
transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", advanced.storage, now + 2);
const advancedRequest = readVNextWalletRequestJournal(advanced.storage, now + 3)[0];
assert.equal(reconcileExpiredVNextWalletRequest({
  request: advancedRequest,
  latestNonce: 8n,
  pendingNonce: 8n,
  nowMs: Number(BigInt(advancedRequest.finalOnchainDeadline) * 1_000n) + 1
}, advanced.storage).state, "UNRESOLVED", "an advanced nonce fails closed");

const unavailable = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n }, unavailable.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", unavailable.storage, now + 1);
transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", unavailable.storage, now + 2);
const unavailableRequest = readVNextWalletRequestJournal(unavailable.storage, now + 3)[0];
assert.equal(reconcileExpiredVNextWalletRequest({
  request: unavailableRequest,
  latestNonce: null,
  pendingNonce: null,
  nowMs: Number(BigInt(unavailableRequest.finalOnchainDeadline) * 1_000n) + 1
}, unavailable.storage).state, "UNRESOLVED", "unavailable nonce evidence fails closed");

const approval = memoryStorage();
const approvalPlan: VNextAuthorizationPlan = {
  ...DIRECT_SMOKE_SWAP_PLAN,
  kind: "erc20_approval",
  data: "0x095ea7b3",
  payloadHash: DIRECT_SMOKE_SWAP_PLAN.payloadHash
};
approvalPlan.payloadHash = authorizationPayloadHash(approvalPlan);
assert.notEqual(approvalPlan.payloadHash, DIRECT_SMOKE_SWAP_PLAN.payloadHash,
  "the exact approval payload must be independently journaled rather than compared with later swap calldata");
assert.ok(recordPreparedVNextWalletRequest({
  requestId,
  wallet: DIRECT_SMOKE_RECIPIENT,
  plan: approvalPlan,
  walletNonceBeforeRequest: 7n
}, approval.storage, now));
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", approval.storage, now + 1);
transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", approval.storage, now + 2);
const approvalRequest = readVNextWalletRequestJournal(approval.storage, now + 3)[0];
assert.equal(reconcileExpiredVNextWalletRequest({
  request: approvalRequest,
  latestNonce: 7n,
  pendingNonce: 7n,
  nowMs: Number(BigInt(approvalRequest.finalOnchainDeadline) * 1_000n) + 1
}, approval.storage).state, "PROVIDER_PENDING", "a standard approval is never auto-cleared solely because the UI plan expired");

const rejected = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n }, rejected.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", rejected.storage, now + 1);
assert.equal(transitionVNextWalletRequest(requestId, "USER_REJECTED", rejected.storage, now + 2)?.state, "USER_REJECTED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, rejected.storage, now + 3), null);

(["uniswap-v2", "uniswap-v3", "uniswap-v4", "up-v2", "up-cl"] as const).forEach((provider, index) => {
  const providerStorage = memoryStorage();
  const providerPlan = {
    ...DIRECT_SMOKE_SWAP_PLAN,
    provider,
    planId: `${index + 3}${index + 3}${index + 3}${index + 3}${index + 3}${index + 3}${index + 3}${index + 3}-3333-4333-8333-333333333333`,
    directAuthorization: { ...DIRECT_SMOKE_SWAP_PLAN.directAuthorization!, provider }
  };
  const providerRequestId = `${index + 4}${index + 4}${index + 4}${index + 4}${index + 4}${index + 4}${index + 4}${index + 4}-4444-4444-8444-444444444444`;
  assert.equal(recordPreparedVNextWalletRequest({
    requestId: providerRequestId,
    wallet: DIRECT_SMOKE_RECIPIENT,
    plan: providerPlan,
    walletNonceBeforeRequest: BigInt(index)
  }, providerStorage.storage, now + index)?.provider, provider);
  assert.equal(transitionVNextWalletRequest(providerRequestId, "PROMPT_REQUESTED", providerStorage.storage, now + index + 1)?.state, "PROMPT_REQUESTED");
  assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, providerStorage.storage, now + index + 2)?.provider, provider);
});

const lateHash = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n }, lateHash.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", lateHash.storage, now + 1);
transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", lateHash.storage, now + 2);
assert.equal(promoteVNextWalletRequestToSubmitted({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, txHash }, lateHash.storage, now + 3)?.txHash, txHash);
assert.equal(readVNextExecutionJournal(lateHash.storage, now + 4)[0]?.state, "submitted");
assert.equal(readVNextWalletRequestJournal(lateHash.storage, now + 4)[0]?.state, "HASH_RECEIVED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, lateHash.storage, now + 4)?.state, "HASH_RECEIVED");
assert.equal(resolveVNextExecution(txHash, "confirmed", lateHash.storage, now + 5, { outputAmountAtomic: "1" })?.state, "confirmed");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, lateHash.storage, now + 6), null,
  "a hash blocks while submitted but not after the exact receipt resolves");
const storedEnvelope = JSON.parse(lateHash.values.get(VNEXT_EXECUTION_STORAGE_KEY) ?? "null") as { executions?: unknown[]; walletRequests?: unknown[] };
assert.equal(storedEnvelope.executions?.length, 1, "hash promotion writes the submitted execution in the same journal replacement");
assert.equal(storedEnvelope.walletRequests?.length, 1);

const knownFailure = {
  transactionHash: "0x3bc8e1b1b6c725a288b9a95a9bb1aa1d77dd55c12ed81e34085766dfec9f299d",
  from: "0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA",
  target: "0xCaf681a66D020601342297493863E78C959E5cb2",
  method: "multicall(uint256 deadline, bytes[] data)",
  valueWei: 100_000_000_000_000n,
  deadline: "1788101461",
  transactionTimestamp: 1_788_101_470n,
  gasUsed: 24_460n,
  gasPaidWei: 4_027_290_080_000n,
  tokenTransfers: 0
} as const;
assert.equal(knownFailure.transactionTimestamp - BigInt(knownFailure.deadline), 9n);
assert.equal(classifyVNextRevertedExecution({
  transactionDeadline: knownFailure.deadline,
  receiptBlockTimestamp: knownFailure.transactionTimestamp
}), "EXPIRED_ONCHAIN_DEADLINE");
assert.equal(classifyVNextRevertedExecution({ decodedRevertReason: "Transaction too old" }), "EXPIRED_ONCHAIN_DEADLINE");
assert.equal(knownFailure.tokenTransfers, 0);

const gas = assessVNextWalletGasReadiness({
  nativeBalanceWei: 10_431_980_709_950_428n,
  currentGasPriceWei: 164_648_000n,
  evidenceFeeCeilingWei: "480000000",
  gasLimitUnits: "205686",
  transactionValueAtomic: "100000000000000"
});
assert.equal(gas.ready, true, "the known event passed gas readiness; it was not a reserve rejection");
assert.equal(knownFailure.gasPaidWei, 4_027_290_080_000n);

const walletReview = readFileSync(new URL("../../app/vnext/vnext-wallet-review.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../../app/vnext/trade-intent-composer.tsx", import.meta.url), "utf8");
assert.ok(walletReview.indexOf("recordPreparedVNextWalletRequest") < walletReview.indexOf("submission.sendTransactionAsync"));
assert.ok(walletReview.indexOf('"PROMPT_REQUESTED"') < walletReview.indexOf("submission.sendTransactionAsync"));
assert.match(walletReview, /Wallet request is still unresolved\. Check the wallet and do not retry\./);
assert.match(walletReview, /Wallet request was rejected by the owner\. Nothing was broadcast\./);
assert.match(walletReview, /Review verified swap in wallet/);
assert.match(walletReview, /Refresh verified request/);
assert.doesNotMatch(walletReview, /autoRequest/);
assert.doesNotMatch(composer, /<VNextWalletReview[\s\S]{0,80}autoRequest/);
assert.match(composer, /open=\{authorizationState\.state === "ready" \|\| undefined\}/,
  "the explicit wallet-review action becomes visible when authorization completes without invoking the provider");
assert.match(composer, /<dt>Network<\/dt><dd>Robinhood Chain · 4663<\/dd>/);
assert.match(composer, /<dt>Protected minimum<\/dt>/);

console.log("RMT pre-hash wallet prompt journal, deadline expiry, duplicate guard, nonce reconciliation, and late-hash recovery smoke checks passed.");
