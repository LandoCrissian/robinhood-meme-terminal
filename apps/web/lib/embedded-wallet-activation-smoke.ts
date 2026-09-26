import assert from "node:assert/strict";
import {
  canPublishEmbeddedWalletAuthority,
  embeddedWalletRecordRecovery,
  embeddedWalletActivationConfirmed,
  resolveAutomaticEmbeddedWalletCandidate,
  resolveConfirmedEmbeddedWalletKey,
  resolveExactEmbeddedWalletCandidate,
  waitForEmbeddedWalletActivation,
  waitForEmbeddedWalletRecord,
  waitForExactWalletConnector,
  type ActionableEmbeddedWalletCandidate,
  type EmbeddedWalletActivationSnapshot
} from "./embedded-wallet-activation";

assert.equal(embeddedWalletRecordRecovery({
  connectedEmbeddedWalletCount: 0,
  linkedEmbeddedWalletCount: 1
}), "reload-session", "A cold local session never attempts to create a second already-linked embedded wallet.");
assert.equal(embeddedWalletRecordRecovery({
  connectedEmbeddedWalletCount: 1,
  linkedEmbeddedWalletCount: 1
}), "activate", "A connected record for the linked embedded wallet follows the exact activation path.");
assert.equal(embeddedWalletRecordRecovery({
  connectedEmbeddedWalletCount: 0,
  linkedEmbeddedWalletCount: 0
}), "reauthenticate", "A failed first-wallet session restarts Privy authentication instead of invoking a competing creation path.");

const expected = {
  address: "0x3333333333333333333333333333333333333333",
  chainId: 4_663,
  connectorId: "privy-fixture.0x3333333333333333333333333333333333333333",
  connectorUid: "embedded-uid"
};
const ready: EmbeddedWalletActivationSnapshot = {
  accounts: [expected.address],
  chainId: expected.chainId,
  connectorId: expected.connectorId,
  connectorUid: "embedded-uid",
  currentConnectorUid: "embedded-uid"
};

assert.equal(embeddedWalletActivationConfirmed(ready, expected), true);
assert.equal(embeddedWalletActivationConfirmed({ ...ready, connectorId: "external" }, expected), false,
  "A same-address wallet on a different connector is never accepted.");
assert.equal(embeddedWalletActivationConfirmed({ ...ready, chainId: 1 }, expected), false,
  "An embedded wallet on the wrong chain is never accepted.");
assert.equal(embeddedWalletActivationConfirmed({ ...ready, currentConnectorUid: "other" }, expected), false,
  "A non-current connector is never accepted.");

const embeddedCandidates: ActionableEmbeddedWalletCandidate[] = [
  { address: expected.address, connectorId: expected.connectorId, connectorUid: expected.connectorUid, key: "embedded-a" },
  { address: expected.address, connectorId: "privy-secondary", connectorUid: "secondary-uid", key: "embedded-same-address-other-connector" },
  { address: "0x4444444444444444444444444444444444444444", connectorId: "privy-imported", connectorUid: "other-uid", key: "embedded-other-address" }
];
assert.equal(resolveConfirmedEmbeddedWalletKey(embeddedCandidates, ready, 4_663), "embedded-a",
  "Active recognition resolves the exact connector and address, not wallet-array order.");
assert.equal(resolveConfirmedEmbeddedWalletKey([
  embeddedCandidates[0],
  { ...embeddedCandidates[0], key: "duplicate-sdk-entry" }
], ready, 4_663), null, "Ambiguous embedded bindings fail closed.");
assert.equal(resolveExactEmbeddedWalletCandidate(embeddedCandidates, "embedded-other-address")?.address,
  "0x4444444444444444444444444444444444444444",
  "Explicit selection resolves the exact embedded wallet key.");
assert.equal(resolveExactEmbeddedWalletCandidate([
  embeddedCandidates[0],
  { ...embeddedCandidates[0] }
], "embedded-a"), undefined, "Duplicate exact keys are ambiguous rather than array-order selected.");
assert.equal(resolveAutomaticEmbeddedWalletCandidate(embeddedCandidates, {
  preferredWalletKey: "embedded-other-address",
  hasCurrentExternalBinding: true
})?.key, "embedded-other-address", "A durable exact embedded preference remains authoritative.");
assert.equal(resolveAutomaticEmbeddedWalletCandidate([embeddedCandidates[0]], {
  preferredWalletKey: null,
  hasCurrentExternalBinding: true
}), undefined, "A reconnected external signer is never silently replaced by the embedded default.");
assert.equal(resolveAutomaticEmbeddedWalletCandidate([embeddedCandidates[0]], {
  preferredWalletKey: "remembered-external-wallet",
  hasCurrentExternalBinding: false
}), undefined, "A durable external preference cannot silently fall through to the embedded wallet.");
assert.equal(resolveAutomaticEmbeddedWalletCandidate([embeddedCandidates[0]], {
  preferredWalletKey: null,
  hasCurrentExternalBinding: false
})?.key, "embedded-a", "One embedded wallet remains the default when no external signer is active.");
assert.equal(canPublishEmbeddedWalletAuthority({
  confirmedWalletKey: "embedded-a",
  confirmedWalletLinkedToCurrentUser: true,
  embeddedWalletCandidateCount: 1,
  hasLinkedExternalWallet: false,
  preferredWalletKey: null,
  walletPreferenceLoaded: false
}), false, "A rehydrated embedded connector cannot become signer authority before preference hydration.");
assert.equal(canPublishEmbeddedWalletAuthority({
  confirmedWalletKey: "embedded-a",
  confirmedWalletLinkedToCurrentUser: true,
  embeddedWalletCandidateCount: 1,
  hasLinkedExternalWallet: true,
  preferredWalletKey: "remembered-external-wallet",
  walletPreferenceLoaded: true
}), false, "A stored external preference prevents silent embedded signer substitution.");
assert.equal(canPublishEmbeddedWalletAuthority({
  confirmedWalletKey: "embedded-a",
  confirmedWalletLinkedToCurrentUser: true,
  embeddedWalletCandidateCount: 1,
  hasLinkedExternalWallet: true,
  preferredWalletKey: null,
  walletPreferenceLoaded: true
}), false, "A linked external wallet with no explicit replacement choice remains reconnect-required.");
assert.equal(canPublishEmbeddedWalletAuthority({
  confirmedWalletKey: "embedded-a",
  confirmedWalletLinkedToCurrentUser: true,
  embeddedWalletCandidateCount: 1,
  hasLinkedExternalWallet: true,
  preferredWalletKey: "embedded-a",
  walletPreferenceLoaded: true
}), true, "An explicit durable embedded choice may publish only its exact confirmed connector.");
assert.equal(canPublishEmbeddedWalletAuthority({
  confirmedWalletKey: "embedded-a",
  confirmedWalletLinkedToCurrentUser: false,
  embeddedWalletCandidateCount: 1,
  hasLinkedExternalWallet: false,
  preferredWalletKey: null,
  walletPreferenceLoaded: true
}), false, "A stale embedded connector from another authenticated user can never publish signer authority.");
assert.equal(canPublishEmbeddedWalletAuthority({
  confirmedWalletKey: "embedded-a",
  confirmedWalletLinkedToCurrentUser: true,
  embeddedWalletCandidateCount: 2,
  hasLinkedExternalWallet: false,
  preferredWalletKey: null,
  walletPreferenceLoaded: true
}), false, "One rehydrated connector cannot silently choose between multiple embedded wallets.");
assert.equal(canPublishEmbeddedWalletAuthority({
  confirmedWalletKey: "embedded-other-address",
  confirmedWalletLinkedToCurrentUser: true,
  embeddedWalletCandidateCount: 2,
  hasLinkedExternalWallet: false,
  preferredWalletKey: "embedded-other-address",
  walletPreferenceLoaded: true
}), true, "An explicit exact preference may publish its confirmed embedded connector when multiple exist.");

async function main() {
  let clock = 0;
  let reads = 0;
  assert.equal(await waitForEmbeddedWalletActivation(
    () => (++reads === 2 ? ready : { ...ready, currentConnectorUid: "external-uid" }),
    expected,
    { isCurrent: () => true, now: () => clock, pause: async (milliseconds) => { clock += milliseconds; }, timeoutMs: 500 }
  ), true, "Activation waits for the exact connector/account/chain postcondition.");

  clock = 0;
  assert.equal(await waitForEmbeddedWalletActivation(
    () => ({ ...ready, connectorId: "wrong" }),
    expected,
    { isCurrent: () => true, now: () => clock, pause: async (milliseconds) => { clock += milliseconds; }, timeoutMs: 250 }
  ), false, "A resolved SDK call without the exact postcondition times out safely.");

  clock = 0;
  assert.equal(await waitForEmbeddedWalletActivation(
    () => ({ ...ready, connectorUid: "replacement-uid", currentConnectorUid: "replacement-uid" }),
    expected,
    { isCurrent: () => true, now: () => clock, pause: async (milliseconds) => { clock += milliseconds; }, timeoutMs: 250 }
  ), false, "A same-ID connector replacement cannot satisfy the selected connector UID postcondition.");

  clock = 0;
  let connectorReads = 0;
  assert.deepEqual(await waitForExactWalletConnector(
    () => ++connectorReads >= 2 ? [{ id: expected.connectorId, uid: "exact" }] : [],
    expected.connectorId,
    { isCurrent: () => true, now: () => clock, pause: async (milliseconds) => { clock += milliseconds; }, timeoutMs: 500 }
  ), { id: expected.connectorId, uid: "exact" }, "A wallet record may arrive before its exact Wagmi connector without becoming a dead end.");

  clock = 0;
  assert.equal(await waitForExactWalletConnector(
    () => [{ id: expected.connectorId }, { id: expected.connectorId }],
    expected.connectorId,
    { isCurrent: () => true, now: () => clock, pause: async (milliseconds) => { clock += milliseconds; }, timeoutMs: 500 }
  ), undefined, "Duplicate signer connectors fail closed instead of selecting by array order.");

  clock = 0;
  assert.equal(await waitForExactWalletConnector(
    () => [], expected.connectorId,
    { isCurrent: () => true, now: () => clock, pause: async (milliseconds) => { clock += milliseconds; }, timeoutMs: 250 }
  ), undefined, "A missing connector reaches a bounded retryable failure.");

  clock = 0;
  let walletRecordReads = 0;
  assert.equal(await waitForEmbeddedWalletRecord(
    () => ++walletRecordReads >= 3,
    { isCurrent: () => true, now: () => clock, pause: async milliseconds => { clock += milliseconds; }, timeoutMs: 500 }
  ), true, "Provisioning waits for the connected embedded-wallet record instead of declaring a callback complete.");

  clock = 0;
  assert.equal(await waitForEmbeddedWalletRecord(
    () => false,
    { isCurrent: () => true, now: () => clock, pause: async milliseconds => { clock += milliseconds; }, timeoutMs: 200 }
  ), false, "A missing embedded-wallet record reaches a bounded visible recovery state.");

  console.log("Embedded-wallet activation postcondition smoke checks passed.");
}

void main();
