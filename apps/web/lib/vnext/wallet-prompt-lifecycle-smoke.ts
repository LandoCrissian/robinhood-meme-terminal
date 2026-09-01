import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyVNextRevertedExecution,
  findBlockingVNextWalletRequest,
  promoteDiscoveredVNextWalletRequestToSubmitted,
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
import { isVNextUserRejectedRequest } from "./wallet-request-error";
import { acquireVNextWalletRequestLease, withVNextWalletRequestLock } from "./wallet-request-lock";
import {
  discoverExactVNextWalletRequestTransaction,
  findExactVNextWalletRequestTransaction,
  VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY,
  vNextWalletRequestDiscoverySchema,
  type VNextWalletRequestDiscoveryRpc
} from "../server/vnext-wallet-request-discovery";
import { authorizationPayloadHash, type VNextAuthorizationPlan } from "./authorization-plan";
import { DIRECT_SMOKE_RECIPIENT, DIRECT_SMOKE_SWAP_PLAN } from "./direct-no-rmt-fee-smoke-fixture";
import { assessVNextWalletGasReadiness } from "./wallet-submission";

function memoryStorage() {
  const values = new Map<string, string>();
  let writes = 0;
  const storage: VNextExecutionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { writes += 1; values.set(key, value); }
  };
  return { values, storage, get writes() { return writes; } };
}

async function main() {
const now = 1_786_000_000_001;
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const txHash = `0x${"b".repeat(64)}`;
const requestBlockEvidence = { requestBlockNumber: 50_000_000n, requestBlockHash: `0x${"e".repeat(64)}` } as const;
const first = memoryStorage();
const prepared = recordPreparedVNextWalletRequest({
  requestId,
  wallet: DIRECT_SMOKE_RECIPIENT,
  plan: DIRECT_SMOKE_SWAP_PLAN,
  walletNonceBeforeRequest: 7n,
  ...requestBlockEvidence
}, first.storage, now);
assert.equal(prepared?.state, "PREPARED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, first.storage, now), null);
assert.equal(transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", first.storage, now + 1)?.state, "PROMPT_REQUESTED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, first.storage, now + 2)?.requestId, requestId);
assert.equal(recordPreparedVNextWalletRequest({
  requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  wallet: DIRECT_SMOKE_RECIPIENT,
  plan: { ...DIRECT_SMOKE_SWAP_PLAN, planId: "66666666-6666-4666-8666-666666666666" },
  walletNonceBeforeRequest: 7n,
  ...requestBlockEvidence
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
assert.ok(recordPreparedVNextWalletRequest({ requestId: promptOnlyRequestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 9n, ...requestBlockEvidence }, promptOnly.storage, now));
assert.equal(transitionVNextWalletRequest(promptOnlyRequestId, "PROMPT_REQUESTED", promptOnly.storage, now + 1)?.state, "PROMPT_REQUESTED");
const promptOnlyDeadlineMs = Number(BigInt(DIRECT_SMOKE_SWAP_PLAN.deadline) * 1_000n);
assert.equal(reconcileExpiredVNextWalletRequest({
  request: readVNextWalletRequestJournal(promptOnly.storage, promptOnlyDeadlineMs + 1)[0]!,
  latestNonce: 9n,
  pendingNonce: 9n,
  nowMs: promptOnlyDeadlineMs + 1
}, promptOnly.storage).state, "EXPIRED_UNSUBMITTED", "a provider call that never returned still clears only after deadline and unchanged latest/pending nonces");

const advanced = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n, ...requestBlockEvidence }, advanced.storage, now);
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
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n, ...requestBlockEvidence }, unavailable.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", unavailable.storage, now + 1);
transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", unavailable.storage, now + 2);
const unavailableRequest = readVNextWalletRequestJournal(unavailable.storage, now + 3)[0];
const unresolvedAfterUnavailableNonce = reconcileExpiredVNextWalletRequest({
  request: unavailableRequest,
  latestNonce: null,
  pendingNonce: null,
  nowMs: Number(BigInt(unavailableRequest.finalOnchainDeadline) * 1_000n) + 1
}, unavailable.storage);
assert.equal(unresolvedAfterUnavailableNonce.state, "UNRESOLVED", "unavailable nonce evidence fails closed");
assert.equal(reconcileExpiredVNextWalletRequest({
  request: unresolvedAfterUnavailableNonce,
  latestNonce: 7n,
  pendingNonce: 7n,
  nowMs: unresolvedAfterUnavailableNonce.updatedAtMs + 1
}, unavailable.storage).state, "EXPIRED_UNSUBMITTED", "an unresolved swap can be rechecked and cleared only by later unchanged nonce evidence");

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
  walletNonceBeforeRequest: 7n,
  ...requestBlockEvidence
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
const approvalUnresolved = transitionVNextWalletRequest(requestId, "UNRESOLVED", approval.storage, now + 4)!;
assert.equal(reconcileExpiredVNextWalletRequest({
  request: approvalUnresolved,
  latestNonce: 7n,
  pendingNonce: 7n,
  nowMs: Number(BigInt(approvalUnresolved.finalOnchainDeadline) * 1_000n) + 1
}, approval.storage).state, "UNRESOLVED", "an approval without a hash or explicit rejection remains unresolved even when its UI plan expired");

const approvalReload = memoryStorage();
assert.ok(recordPreparedVNextWalletRequest({
  requestId,
  wallet: DIRECT_SMOKE_RECIPIENT,
  plan: approvalPlan,
  walletNonceBeforeRequest: 7n,
  ...requestBlockEvidence
}, approvalReload.storage, now));
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", approvalReload.storage, now + 1);
transitionVNextWalletRequest(requestId, "UNRESOLVED", approvalReload.storage, now + 2);
assert.equal(promoteDiscoveredVNextWalletRequestToSubmitted({ requestId, txHash }, approvalReload.storage, now + 3)?.kind, "erc20_approval");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, approvalReload.storage, now + 4)?.state, "HASH_RECEIVED");
assert.equal(resolveVNextExecution(txHash, "confirmed", approvalReload.storage, now + 5)?.state, "confirmed");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, approvalReload.storage, now + 6), null,
  "an exact approval hash discovered after reload promotes into receipt recovery without a duplicate approval");

const rejected = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n, ...requestBlockEvidence }, rejected.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", rejected.storage, now + 1);
transitionVNextWalletRequest(requestId, "UNRESOLVED", rejected.storage, now + 2);
assert.equal(transitionVNextWalletRequest(requestId, "USER_REJECTED", rejected.storage, now + 3)?.state, "USER_REJECTED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, rejected.storage, now + 4), null);

assert.equal(isVNextUserRejectedRequest({ code: 4001, message: "request failed" }), true);
assert.equal(isVNextUserRejectedRequest({ cause: { name: "UserRejectedRequestError" } }), true);
assert.equal(isVNextUserRejectedRequest(new Error("Transaction rejected by wallet")), false);
assert.equal(isVNextUserRejectedRequest({ code: -32000, message: "RPC rejected request" }), false);
assert.equal(isVNextUserRejectedRequest({ code: -32603, message: "Unknown provider error" }), false);

const activeLocks = new Set<string>();
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    locks: {
      request: async (name: string, _options: unknown, callback: (lock: object | null) => Promise<unknown>) => {
        if (activeLocks.has(name)) return callback(null);
        activeLocks.add(name);
        try { return await callback({ name }); } finally { activeLocks.delete(name); }
      }
    }
  }
});
let releaseFirstLock!: () => void;
const firstLockHeld = new Promise<void>((resolve) => { releaseFirstLock = resolve; });
let providerInvocations = 0;
const tabA = withVNextWalletRequestLock(DIRECT_SMOKE_RECIPIENT, async () => {
  providerInvocations += 1;
  await firstLockHeld;
  return "tab-a";
});
await new Promise((resolve) => setTimeout(resolve, 0));
const tabB = await withVNextWalletRequestLock(DIRECT_SMOKE_RECIPIENT, async () => {
  providerInvocations += 1;
  return "tab-b";
});
assert.deepEqual(tabB, { acquired: false, reason: "contended" });
assert.equal(providerInvocations, 1);
const otherWallet = await withVNextWalletRequestLock("0x4444444444444444444444444444444444444444", async () => "other-wallet");
assert.deepEqual(otherWallet, { acquired: true, value: "other-wallet" }, "different wallets are not serialized together");
releaseFirstLock();
assert.deepEqual(await tabA, { acquired: true, value: "tab-a" });
const leaseA = await acquireVNextWalletRequestLease(DIRECT_SMOKE_RECIPIENT);
assert.equal(leaseA.acquired, true);
const leaseB = await acquireVNextWalletRequestLease(DIRECT_SMOKE_RECIPIENT);
assert.deepEqual(leaseB, { acquired: false, reason: "contended" },
  "a second tab cannot enter the mobile signing boundary while preparation owns the wallet lease");
const independentLease = await acquireVNextWalletRequestLease("0x4444444444444444444444444444444444444444");
assert.equal(independentLease.acquired, true, "two different wallets remain independently serialized");
if (independentLease.acquired) {
  independentLease.lease.release();
  await independentLease.lease.released;
}
if (leaseA.acquired) {
  leaseA.lease.release();
  await leaseA.lease.released;
}
Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
assert.deepEqual(await withVNextWalletRequestLock(DIRECT_SMOKE_RECIPIENT, async () => "unsafe"), {
  acquired: false,
  reason: "unavailable"
}, "wallet prompting fails closed when the browser has no safe cross-context serialization primitive");
if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
else delete (globalThis as { navigator?: unknown }).navigator;

(["uniswap-v2", "uniswap-v3", "up-v2", "up-cl"] as const).forEach((provider, index) => {
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
    walletNonceBeforeRequest: BigInt(index),
    ...requestBlockEvidence
  }, providerStorage.storage, now + index)?.provider, provider);
  assert.equal(transitionVNextWalletRequest(providerRequestId, "PROMPT_REQUESTED", providerStorage.storage, now + index + 1)?.state, "PROMPT_REQUESTED");
  assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, providerStorage.storage, now + index + 2)?.provider, provider);
});

const lateHash = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n, ...requestBlockEvidence }, lateHash.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", lateHash.storage, now + 1);
transitionVNextWalletRequest(requestId, "PROVIDER_PENDING", lateHash.storage, now + 2);
assert.equal(promoteVNextWalletRequestToSubmitted({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, txHash }, lateHash.storage, now + 3)?.txHash, txHash);
assert.equal(readVNextExecutionJournal(lateHash.storage, now + 4)[0]?.state, "submitted");
assert.equal(readVNextWalletRequestJournal(lateHash.storage, now + 4)[0]?.state, "HASH_RECEIVED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, lateHash.storage, now + 4)?.state, "HASH_RECEIVED");
const writesBeforeConfirmedReceipt = lateHash.writes;
assert.equal(resolveVNextExecution(txHash, "confirmed", lateHash.storage, now + 5, { outputAmountAtomic: "1" })?.state, "confirmed");
assert.equal(lateHash.writes, writesBeforeConfirmedReceipt + 1,
  "terminal execution and matching wallet request resolve through one combined journal write");
const confirmedRequest = readVNextWalletRequestJournal(lateHash.storage, now + 6)[0]!;
assert.equal(confirmedRequest.state, "RECEIPT_CONFIRMED");
assert.equal(confirmedRequest.requestId, requestId);
assert.equal(confirmedRequest.planId, DIRECT_SMOKE_SWAP_PLAN.planId);
assert.equal(confirmedRequest.payloadHash, DIRECT_SMOKE_SWAP_PLAN.payloadHash);
assert.equal(confirmedRequest.txHash, txHash);
assert.equal(transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", lateHash.storage, now + 7), null,
  "a terminal receipt request cannot return to a blocking state");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, lateHash.storage, now + 6), null,
  "a hash blocks while submitted but not after the exact receipt resolves");
const storedEnvelope = JSON.parse(lateHash.values.get(VNEXT_EXECUTION_STORAGE_KEY) ?? "null") as { executions?: unknown[]; walletRequests?: unknown[] };
assert.equal(storedEnvelope.executions?.length, 1, "hash promotion writes the submitted execution in the same journal replacement");
assert.equal(storedEnvelope.walletRequests?.length, 1);
const sevenDaysMs = 7 * 24 * 60 * 60 * 1_000;
const eightDaysMs = 8 * 24 * 60 * 60 * 1_000;
assert.equal(readVNextWalletRequestJournal(lateHash.storage, now + 5 + sevenDaysMs)[0]?.state, "RECEIPT_CONFIRMED",
  "confirmed request audit history remains bounded through seven days");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, lateHash.storage, now + 5 + sevenDaysMs), null);
assert.equal(readVNextExecutionJournal(lateHash.storage, now + 5 + eightDaysMs).length, 0);
assert.equal(readVNextWalletRequestJournal(lateHash.storage, now + 5 + eightDaysMs).length, 0);
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, lateHash.storage, now + 5 + eightDaysMs), null,
  "expired terminal execution history cannot resurrect a confirmed wallet-request block");

const exactDiscoveryRequest = readVNextWalletRequestJournal(lateHash.storage, now + 4)[0]!;
const exactDiscoveryAuthority = vNextWalletRequestDiscoverySchema.parse({
  requestId: exactDiscoveryRequest.requestId,
  chainId: exactDiscoveryRequest.chainId,
  wallet: exactDiscoveryRequest.wallet,
  walletNonceBeforeRequest: exactDiscoveryRequest.walletNonceBeforeRequest,
  target: exactDiscoveryRequest.target,
  value: exactDiscoveryRequest.value,
  calldataHash: exactDiscoveryRequest.calldataHash,
  requestBlockNumber: exactDiscoveryRequest.requestBlockNumber,
  ...(exactDiscoveryRequest.requestBlockHash ? { requestBlockHash: exactDiscoveryRequest.requestBlockHash } : {}),
  requestedAtMs: exactDiscoveryRequest.requestedAtMs
});
const exactIndexedTransaction = {
  hash: txHash,
  from: { hash: DIRECT_SMOKE_RECIPIENT },
  to: { hash: exactDiscoveryRequest.target },
  block_number: Number(exactDiscoveryRequest.requestBlockNumber) + 3,
  nonce: exactDiscoveryRequest.walletNonceBeforeRequest,
  raw_input: DIRECT_SMOKE_SWAP_PLAN.data,
  value: exactDiscoveryRequest.value,
  timestamp: new Date(exactDiscoveryRequest.requestedAtMs + 2_000).toISOString()
};
assert.equal(findExactVNextWalletRequestTransaction(exactDiscoveryAuthority, { items: [exactIndexedTransaction], next_page_params: null })?.txHash, txHash);
assert.equal(findExactVNextWalletRequestTransaction(exactDiscoveryAuthority, { items: [{ ...exactIndexedTransaction, nonce: "8" }], next_page_params: null }), null);
assert.equal(VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY.chainId, 4_663);
assert.equal(VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY.maximumResults, 50);
let discoveryRequests = 0;
const liveShapeDiscovery = await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 3_000,
  rpc: null,
  fetch: async (_url, init) => {
    discoveryRequests += 1;
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-only-blockscout-key");
    return new Response(JSON.stringify({ items: [exactIndexedTransaction], next_page_params: null }), { status: 200 });
  }
});
assert.deepEqual(liveShapeDiscovery, { status: "found", txHash });
assert.equal(discoveryRequests, 1, "late-hash discovery is one bounded Blockscout page");

const replacementHash = `0x${"c".repeat(64)}` as `0x${string}`;
const requestBlock = BigInt(exactDiscoveryAuthority.requestBlockNumber);
const transactionBlock = requestBlock + 3n;
const rpcTransaction = {
  hash: txHash as `0x${string}`,
  from: DIRECT_SMOKE_RECIPIENT,
  to: exactDiscoveryAuthority.target,
  blockNumber: transactionBlock,
  nonce: Number(exactDiscoveryAuthority.walletNonceBeforeRequest),
  input: DIRECT_SMOKE_SWAP_PLAN.data,
  value: BigInt(exactDiscoveryAuthority.value)
} as const;
const makeRpc = (transactions: readonly (typeof rpcTransaction)[] = [rpcTransaction], requestHash = requestBlockEvidence.requestBlockHash): VNextWalletRequestDiscoveryRpc => ({
  getChainId: async () => 4_663,
  getBlockNumber: async () => transactionBlock,
  getBlock: async ({ blockNumber }) => ({
    number: blockNumber,
    hash: blockNumber === requestBlock ? requestHash : `0x${"d".repeat(64)}`,
    transactions: blockNumber === transactionBlock ? transactions : []
  })
});
const rpcDiscovery = await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 3_000,
  apiKey: "",
  rpc: makeRpc()
});
assert.deepEqual(rpcDiscovery, { status: "found", txHash },
  "canonical RPC recovers the exact transaction when the Blockscout credential is unavailable");
assert.deepEqual(await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 24 * 60 * 60_000,
  apiKey: "",
  rpc: makeRpc()
}), { status: "found", txHash }, "a later browser restart can recover the exact historical request-block transaction");
assert.deepEqual(await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 8 * 24 * 60 * 60_000,
  apiKey: "",
  rpc: makeRpc()
}), { status: "not_found" }, "discovery cannot outlive the durable journal history boundary");

for (const [label, mutation] of [
  ["wallet", { from: "0x9999999999999999999999999999999999999999" }],
  ["nonce", { nonce: rpcTransaction.nonce + 1 }],
  ["target", { to: "0x9999999999999999999999999999999999999999" }],
  ["value", { value: rpcTransaction.value + 1n }],
  ["calldata", { input: "0x00" }]
] as const) {
  const result = await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
    nowMs: exactDiscoveryRequest.requestedAtMs + 3_000,
    apiKey: "",
    rpc: makeRpc([{ ...rpcTransaction, ...mutation }] as readonly (typeof rpcTransaction)[])
  });
  assert.deepEqual(result, { status: "not_found" }, `${label} mismatch must never be promoted`);
}
assert.deepEqual(await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 3_000,
  apiKey: "",
  rpc: makeRpc([{ ...rpcTransaction, hash: replacementHash, input: "0x00" }] as readonly (typeof rpcTransaction)[])
}), { status: "not_found" }, "a same-nonce replacement with different calldata is not the authorized request");
assert.deepEqual(await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 3_000,
  apiKey: "",
  rpc: makeRpc([rpcTransaction], `0x${"f".repeat(64)}`)
}), { status: "unavailable" }, "request-block reorg inconsistency fails closed");
assert.deepEqual(await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 3_000,
  apiKey: "",
  rpc: makeRpc([rpcTransaction, { ...rpcTransaction, hash: replacementHash }] as readonly (typeof rpcTransaction)[])
}), { status: "unavailable" }, "multiple exact transaction matches are ambiguous and fail closed");
assert.deepEqual(await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 3_000,
  apiKey: "configured",
  fetch: async () => new Response(JSON.stringify({ items: [exactIndexedTransaction], next_page_params: null }), { status: 200 }),
  rpc: makeRpc([{ ...rpcTransaction, hash: replacementHash }] as readonly (typeof rpcTransaction)[])
}), { status: "unavailable" }, "conflicting exact source hashes are ambiguous and fail closed");
assert.deepEqual(await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 3_000,
  apiKey: "",
  rpc: { ...makeRpc(), getChainId: async () => 1 }
}), { status: "unavailable" }, "a non-Robinhood RPC cannot become recovery authority");
assert.deepEqual(await discoverExactVNextWalletRequestTransaction(exactDiscoveryAuthority, {
  nowMs: exactDiscoveryRequest.requestedAtMs + 3_000,
  apiKey: "",
  rpc: { ...makeRpc(), getBlockNumber: async () => { throw new Error("unavailable"); } }
}), { status: "unavailable" }, "discovery unavailability never fabricates a transaction hash");
assert.equal(VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY.maximumRpcBlocks, 256);
assert.equal(VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY.maximumRecordAgeMs, 7 * 24 * 60 * 60_000);
assert.equal(VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY.maximumTransactionDelayMs, 15 * 60_000);
assert.equal(VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY.discoveryTimeoutMs, 8_000);
assert.equal(VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY.blockscoutCredentialRequired, false);
assert.equal(VNEXT_WALLET_REQUEST_DISCOVERY_BOUNDARY.canonicalRpcFallback, true);

const rpcRecovered = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n, ...requestBlockEvidence }, rpcRecovered.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", rpcRecovered.storage, now + 1);
transitionVNextWalletRequest(requestId, "UNRESOLVED", rpcRecovered.storage, now + 2);
assert.equal(promoteDiscoveredVNextWalletRequestToSubmitted({ requestId, txHash: rpcDiscovery.status === "found" ? rpcDiscovery.txHash : txHash }, rpcRecovered.storage, now + 3)?.state, "submitted");
assert.equal(resolveVNextExecution(txHash, "confirmed", rpcRecovered.storage, now + 4)?.state, "confirmed");
assert.equal(readVNextWalletRequestJournal(rpcRecovered.storage, now + 5)[0]?.state, "RECEIPT_CONFIRMED",
  "an exact RPC-discovered transaction follows the canonical receipt reconciliation path");

const discovered = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n, ...requestBlockEvidence }, discovered.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", discovered.storage, now + 1);
transitionVNextWalletRequest(requestId, "UNRESOLVED", discovered.storage, now + 2);
assert.equal(promoteDiscoveredVNextWalletRequestToSubmitted({ requestId, txHash }, discovered.storage, now + 3)?.txHash, txHash);
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, discovered.storage, now + 4)?.state, "HASH_RECEIVED");

const hashFailClosed = memoryStorage();
recordPreparedVNextWalletRequest({ requestId, wallet: DIRECT_SMOKE_RECIPIENT, plan: DIRECT_SMOKE_SWAP_PLAN, walletNonceBeforeRequest: 7n, ...requestBlockEvidence }, hashFailClosed.storage, now);
transitionVNextWalletRequest(requestId, "PROMPT_REQUESTED", hashFailClosed.storage, now + 1);
transitionVNextWalletRequest(requestId, "UNRESOLVED", hashFailClosed.storage, now + 2);
promoteDiscoveredVNextWalletRequestToSubmitted({ requestId, txHash }, hashFailClosed.storage, now + 3);
const hashEnvelope = JSON.parse(hashFailClosed.values.get(VNEXT_EXECUTION_STORAGE_KEY)!) as { schemaVersion: number; executions: unknown[]; walletRequests: unknown[] };
hashFailClosed.values.set(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify({ ...hashEnvelope, executions: [] }));
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, hashFailClosed.storage, now + 4)?.state, "HASH_RECEIVED", "a known hash blocks when the execution record is missing");
hashFailClosed.values.set(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify({ ...hashEnvelope, executions: [{ malformed: true }] }));
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, hashFailClosed.storage, now + 5)?.state, "HASH_RECEIVED", "a known hash blocks when the execution record is malformed");
hashFailClosed.values.set(VNEXT_EXECUTION_STORAGE_KEY, JSON.stringify(hashEnvelope));
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, hashFailClosed.storage, now + 6)?.state, "HASH_RECEIVED", "a known hash blocks while submitted");
resolveVNextExecution(txHash, "reverted", hashFailClosed.storage, now + 7);
assert.equal(readVNextWalletRequestJournal(hashFailClosed.storage, now + 8)[0]?.state, "RECEIPT_REVERTED");
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, hashFailClosed.storage, now + 8), null, "a matching terminal reverted execution clears the known-hash block");
assert.equal(readVNextExecutionJournal(hashFailClosed.storage, now + 7 + eightDaysMs).length, 0);
assert.equal(readVNextWalletRequestJournal(hashFailClosed.storage, now + 7 + eightDaysMs).length, 0);
assert.equal(findBlockingVNextWalletRequest(DIRECT_SMOKE_RECIPIENT, hashFailClosed.storage, now + 7 + eightDaysMs), null,
  "expired terminal execution history cannot resurrect a reverted wallet-request block");

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
const recoveryHook = readFileSync(new URL("../../app/vnext/use-vnext-execution-recovery.ts", import.meta.url), "utf8");
const recoveryBanner = readFileSync(new URL("../../app/vnext/vnext-execution-recovery-banner.tsx", import.meta.url), "utf8");
const discoveryServer = readFileSync(new URL("../server/vnext-wallet-request-discovery.ts", import.meta.url), "utf8");
assert.ok(walletReview.indexOf("recordPreparedVNextWalletRequest") < walletReview.lastIndexOf("invokeVNextExternalWalletRequest"));
assert.ok(walletReview.indexOf('"PROMPT_REQUESTED"') < walletReview.lastIndexOf("invokeVNextExternalWalletRequest"));
assert.ok(walletReview.indexOf("acquireVNextWalletRequestLease") < walletReview.lastIndexOf("invokeVNextExternalWalletRequest"));
assert.match(walletReview, /A wallet request is already active\./);
assert.match(walletReview, /isVNextUserRejectedRequest/);
assert.doesNotMatch(walletReview, /rejected\|denied\|cancelled\|canceled/);
assert.match(walletReview, /Wallet request is still unresolved\. Check the selected wallet and do not retry\./);
assert.match(walletReview, /Wallet request was rejected by the owner\. Nothing was broadcast\./);
assert.match(walletReview, /Review verified swap in/);
assert.match(walletReview, /Refresh verified request/);
const explicitOpenBoundary = walletReview.slice(walletReview.indexOf("function openPreparedWalletRequest"), walletReview.indexOf("const prepareWalletReview"));
assert.doesNotMatch(explicitOpenBoundary, /\bawait\b/);
assert.match(explicitOpenBoundary, /method: "eth_sendTransaction"/);
assert.doesNotMatch(explicitOpenBoundary, /sendTransaction\(/);
assert.doesNotMatch(walletReview, /autoRequest/);
assert.doesNotMatch(composer, /<VNextWalletReview[\s\S]{0,80}autoRequest/);
assert.ok(composer.indexOf("<VNextWalletReview") < composer.indexOf('<details className="vnRouteCard">'),
  "the explicit wallet-review action becomes visible on the primary surface without invoking the provider");
assert.doesNotMatch(composer, /vnRouteCard" open=/, "Advanced details must not become a nested mobile scroll trap");
assert.match(composer, /<dt>Network<\/dt><dd>Robinhood Chain · 4663<\/dd>/);
assert.match(composer, /<dt>Protected minimum<\/dt>/);
assert.match(recoveryHook, /wallet-request-recovery/);
assert.match(recoveryHook, /"UNRESOLVED"/);
assert.match(recoveryBanner, /Recheck unresolved wallet request/);
assert.match(discoveryServer, /process\.env\.RMT_BLOCKSCOUT_PRO_API_KEY/);
assert.match(discoveryServer, /robinhoodChain/);
for (const clientSource of [walletReview, composer, recoveryHook, recoveryBanner]) {
  assert.doesNotMatch(clientSource, /RMT_BLOCKSCOUT_PRO_API_KEY/, "the server-only Blockscout credential must not enter the client bundle");
  assert.doesNotMatch(clientSource, /RMT_MAINNET_RPC_URL|ROBINHOOD_MAINNET_RPC_URL/, "server-only RPC configuration must not enter the client bundle");
}

console.log("RMT pre-hash wallet prompt journal, deadline expiry, duplicate guard, nonce reconciliation, and late-hash recovery smoke checks passed.");
}

void main().catch((cause) => {
  console.error(cause);
  process.exitCode = 1;
});
