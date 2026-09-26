import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bindNativeTransferSigner,
  createNativeTransferPrompt,
  nativeTransferBlocksAnother,
  nativeTransferStorageKey,
  parseNativeTransferSession,
  prepareNativeTransfer,
  resolveNativeTransferRevertedReceipt,
  resolveNativeTransferSettlement,
  safeTransferMessage,
  transitionNativeTransfer,
  type NativeTransferSettlementEvidence
} from "./wallet-transfer";
import { walletGatewayKey, type RmtActiveSignerAuthority } from "./wallet-gateway";

const sender = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";

assert.deepEqual(prepareNativeTransfer({ recipient, amount: "0.01", sender, balance: 20_000_000_000_000_000n }), {
  recipient,
  value: 10_000_000_000_000_000n
});
assert.throws(() => prepareNativeTransfer({ recipient: "not-an-address", amount: "1", sender }), /valid EVM wallet/);
assert.throws(() => prepareNativeTransfer({ recipient: sender, amount: "1", sender }), /other than the active wallet/);
assert.throws(() => prepareNativeTransfer({ recipient: "0x0000000000000000000000000000000000000000", amount: "1", sender }), /zero address/);
assert.throws(() => prepareNativeTransfer({ recipient, amount: "0", sender }), /greater than zero/);
assert.throws(() => prepareNativeTransfer({ recipient, amount: "1.1234567890123456789", sender }), /18 decimal places/);
assert.throws(() => prepareNativeTransfer({ recipient, amount: "0.01", sender, balance: 10_000_000_000_000_000n }), /network fee/);
assert.match(safeTransferMessage("User cancelled an unknown provider window"), /Check wallet activity/i,
  "An arbitrary cancellation string cannot claim that funds did not move.");
assert.match(safeTransferMessage(Object.assign(new Error("User rejected"), { code: 4001 })), /rejected before a transaction hash/i);

const wallet = { address: sender, connectorType: "injected", walletClientType: "browser", meta: { id: "io.fixture" }, type: "ethereum" as const };
const walletKey = walletGatewayKey(wallet);
const authority: RmtActiveSignerAuthority = {
  adapter: "direct", connectorId: "io.fixture", connectorType: "injected", connectorUid: "connector-a",
  originConnectorType: "injected", walletClientType: "browser", walletKey, walletKind: "external"
};
const bound = bindNativeTransferSigner({
  selectedWalletKey: walletKey, selectedWalletKind: "external", selectedSignerAuthority: authority,
  connectedAddress: sender, connectedChainId: 4_663, connectorId: "io.fixture", connectorType: "injected",
  connectorUid: "connector-a", walletClientAddress: sender, walletClientChainId: 4_663, requiredChainId: 4_663
});
assert.equal(bound.connectorUid, "connector-a");
assert.throws(() => bindNativeTransferSigner({
  selectedWalletKey: walletKey, selectedWalletKind: "external", selectedSignerAuthority: authority,
  connectedAddress: sender, connectedChainId: 4_663, connectorId: "io.fixture", connectorType: "injected",
  connectorUid: "connector-b", walletClientAddress: sender, walletClientChainId: 4_663, requiredChainId: 4_663
}), /exact active signer connector changed/, "A same-address connector substitution invalidates transfer review.");

const prompt = createNativeTransferPrompt({
  requestId: "transfer-fixture", sender, recipient, value: 1n, chainId: 4_663,
  walletKey, connectorUid: "connector-a", now: 1
});
assert.equal(nativeTransferBlocksAnother(prompt), true);
const hash = `0x${"a".repeat(64)}` as const;
const submitted = transitionNativeTransfer(prompt, "SUBMITTED", { txHash: hash, now: 2 });
assert.equal(nativeTransferBlocksAnother(submitted), true, "A returned hash remains blocking while its receipt is pending.");
assert.equal(parseNativeTransferSession(JSON.stringify(submitted), sender, 4_663)?.txHash, hash,
  "A reload restores the exact pending transfer hash.");
assert.throws(() => transitionNativeTransfer(submitted, "CONFIRMED", { now: 3 }), /independently matched mined transaction evidence/,
  "Receipt status alone cannot mark a native transfer confirmed.");
const blockHash = `0x${"b".repeat(64)}` as const;
const exactSettlementEvidence: NativeTransferSettlementEvidence = {
  contextChainId: 4_663,
  receipt: { blockHash, blockNumber: 101n, transactionHash: hash },
  transaction: {
    blockHash,
    blockNumber: 101n,
    chainId: 4_663,
    from: sender,
    hash,
    input: "0x",
    to: recipient,
    value: 1n
  }
};
const exactSettlement = resolveNativeTransferSettlement(submitted, exactSettlementEvidence, 3);
assert.equal(exactSettlement.outcome, "EXACT_MATCH");
assert.equal(exactSettlement.session.state, "CONFIRMED");
assert.equal(exactSettlement.session.txHash, hash);
assert.equal(nativeTransferBlocksAnother(exactSettlement.session), false);
assert.throws(() => transitionNativeTransfer(submitted, "REVERTED", { now: 3 }), /matched receipt hash and chain context/,
  "Receipt status alone cannot release duplicate protection as reverted.");
const exactReverted = resolveNativeTransferRevertedReceipt(submitted, {
  contextChainId: 4_663,
  transactionHash: hash
}, 3);
assert.equal(exactReverted.outcome, "EXACT_MATCH");
assert.equal(exactReverted.session.state, "REVERTED");
assert.equal(exactReverted.session.txHash, hash);
assert.equal(nativeTransferBlocksAnother(exactReverted.session), false,
  "Only an exact reverted receipt may release duplicate protection.");

const otherHash = `0x${"c".repeat(64)}` as const;
for (const [label, evidence] of [
  ["receipt hash", { contextChainId: 4_663, transactionHash: otherHash }],
  ["RPC chain context", { contextChainId: 4_662, transactionHash: hash }],
  ["zero receipt hash", { contextChainId: 4_663, transactionHash: `0x${"0".repeat(64)}` as const }]
] as const) {
  const unresolvedRevert = resolveNativeTransferRevertedReceipt(submitted, evidence, 4);
  assert.equal(unresolvedRevert.outcome, "EVIDENCE_MISMATCH", `${label} cannot prove a revert`);
  assert.equal(unresolvedRevert.session.state, "UNKNOWN", `${label} must remain unresolved`);
  assert.equal(unresolvedRevert.session.txHash, hash, `${label} must preserve the tracked hash`);
  assert.equal(nativeTransferBlocksAnother(unresolvedRevert.session), true, `${label} must keep duplicate protection active`);
}
const unavailableRevert = resolveNativeTransferRevertedReceipt(submitted, undefined, 4);
assert.equal(unavailableRevert.outcome, "EVIDENCE_UNAVAILABLE");
assert.equal(unavailableRevert.session.state, "UNKNOWN");
assert.equal(unavailableRevert.session.txHash, hash);
assert.equal(nativeTransferBlocksAnother(unavailableRevert.session), true,
  "Unavailable reverted-receipt evidence must remain duplicate-blocking.");

const settlementMismatches: Array<[string, NativeTransferSettlementEvidence]> = [
  ["receipt hash", { ...exactSettlementEvidence, receipt: { ...exactSettlementEvidence.receipt, transactionHash: otherHash } }],
  ["transaction hash", { ...exactSettlementEvidence, transaction: { ...exactSettlementEvidence.transaction, hash: otherHash } }],
  ["RPC chain context", { ...exactSettlementEvidence, contextChainId: 4_662 }],
  ["transaction chain", { ...exactSettlementEvidence, transaction: { ...exactSettlementEvidence.transaction, chainId: 4_662 } }],
  ["sender", { ...exactSettlementEvidence, transaction: { ...exactSettlementEvidence.transaction, from: recipient } }],
  ["recipient", { ...exactSettlementEvidence, transaction: { ...exactSettlementEvidence.transaction, to: sender } }],
  ["value", { ...exactSettlementEvidence, transaction: { ...exactSettlementEvidence.transaction, value: 2n } }],
  ["calldata", { ...exactSettlementEvidence, transaction: { ...exactSettlementEvidence.transaction, input: "0x01" } }]
];
for (const [label, evidence] of settlementMismatches) {
  const mismatch = resolveNativeTransferSettlement(submitted, evidence, 4);
  assert.equal(mismatch.outcome, "EVIDENCE_MISMATCH", `${label} mismatch must fail closed`);
  assert.equal(mismatch.session.state, "UNKNOWN", `${label} mismatch must remain unresolved`);
  assert.equal(mismatch.session.txHash, hash, `${label} mismatch must preserve the provider hash`);
  assert.equal(nativeTransferBlocksAnother(mismatch.session), true, `${label} mismatch must block resubmission`);
}
const unavailableSettlement = resolveNativeTransferSettlement(submitted, undefined, 4);
assert.equal(unavailableSettlement.outcome, "EVIDENCE_UNAVAILABLE");
assert.equal(unavailableSettlement.session.state, "UNKNOWN");
assert.equal(unavailableSettlement.session.txHash, hash);
assert.equal(nativeTransferBlocksAnother(unavailableSettlement.session), true,
  "Unavailable mined-transaction evidence must remain duplicate-blocking.");
assert.equal(nativeTransferBlocksAnother(transitionNativeTransfer(prompt, "UNKNOWN", { now: 3 })), true,
  "An unknown provider result remains blocked across recovery.");
const unknownWithHash = transitionNativeTransfer(prompt, "UNKNOWN", { txHash: hash, now: 4 });
assert.equal(unknownWithHash.txHash, hash,
  "A provider hash survives recovery-persistence failure so the exact receipt can still reconcile.");
assert.equal(nativeTransferBlocksAnother(unknownWithHash), true,
  "A hash-backed unknown result remains duplicate-blocking until its exact receipt resolves.");
assert.notEqual(nativeTransferStorageKey(sender, 4_663), nativeTransferStorageKey(recipient, 4_663),
  "Different senders have independent durable transfer journals across account switches.");
assert.throws(() => transitionNativeTransfer(prompt, "UNKNOWN", { txHash: "0x1234" as `0x${string}` }), /hash must be exact and nonzero/);
const zeroHash = `0x${"0".repeat(64)}` as const;
assert.throws(() => transitionNativeTransfer(prompt, "SUBMITTED", { txHash: zeroHash }), /hash must be exact and nonzero/,
  "The zero transaction hash cannot enter recovery state.");
assert.equal(parseNativeTransferSession(JSON.stringify({ ...submitted, txHash: zeroHash }), sender, 4_663), undefined,
  "The zero transaction hash cannot be restored from storage.");

const dialog = readFileSync(new URL("../app/wallet-transfer-dialog.tsx", import.meta.url), "utf8");
assert.match(dialog, /Review transfer/);
assert.match(dialog, /Confirm in wallet/);
assert.doesNotMatch(dialog, /useSendTransaction/);
assert.match(dialog, /useWalletClient\(\{ connector: account\.connector \}\)/);
assert.match(dialog, /usePublicClient\(\{ chainId: targetChain\.id \}\)/);
assert.match(dialog, /walletClient\.sendTransaction/);
assert.match(dialog, /publicClient\.getChainId\(\)/,
  "Settlement must bind the independently observed RPC chain context.");
assert.match(dialog, /publicClient\.getTransaction\(\{ hash: session\.txHash! \}\)/,
  "A successful receipt must be reconciled against the independently fetched mined transaction.");
assert.match(dialog, /resolveNativeTransferSettlement\(session/,
  "The dialog must use the exact mined-transaction settlement resolver before confirmation.");
assert.match(dialog, /balance\.status === "success"[\s\S]*exactBalance === undefined[\s\S]*Balance unavailable[\s\S]*disabled=\{!prepared \|\| exactBalance === undefined/,
  "An unavailable native balance must never be rendered as zero or permit transfer review.");
assert.match(dialog, /receipt\.data\.status === "reverted"[\s\S]*resolveNativeTransferRevertedReceipt\(session, \{[\s\S]*contextChainId: await publicClient\.getChainId\(\)[\s\S]*transactionHash: receipt\.data\.transactionHash/,
  "A reverted receipt must bind its exact tracked hash and independently observed RPC chain before releasing duplicate protection.");
assert.doesNotMatch(dialog, /receipt\.data\.status === "success" \? "CONFIRMED"/,
  "Receipt status alone must never claim transfer confirmation.");
assert.doesNotMatch(dialog, /transitionNativeTransfer\(session, "REVERTED"\)/,
  "Receipt status alone must never mark a tracked transfer reverted.");
assert.match(dialog, /nativeTransferBlocksAnother/);
assert.match(dialog, /navigator\.locks\.request/);
assert.match(dialog, /\["SUBMITTED", "UNKNOWN"\]\.includes\(session\.state\)/,
  "Both submitted and hash-backed unknown requests remain eligible for exact receipt reconciliation.");
assert.match(dialog, /setSession\(next\)/,
  "A terminal receipt remains truthful in memory even when durable final-state persistence fails.");
assert.match(dialog, /nextStorageKey = nativeTransferStorageKey\(next\.sender, next\.chainId\)/,
  "A delayed result persists under the session sender rather than the currently rendered account.");
assert.match(dialog, /nextStorageKey === activeStorageKey\.current\) setSession\(next\)/,
  "A delayed result from another account cannot overwrite the current account's visible recovery state.");
assert.match(dialog, /const isCurrentRequest = \(\) => activeStorageKey\.current === requestStorageKey/,
  "Every asynchronous wallet-result publication remains scoped to the account that opened the request.");
assert.match(dialog, /nativeTransferStorageKey\(session\.sender, session\.chainId\) !== storageKey/,
  "Receipt reconciliation is scoped to the current account journal.");
assert.match(dialog, /stepPanel\.current\?\.focus/,
  "Review and submitted transitions move focus into the newly rendered transfer state.");
assert.match(dialog, /focusable\.length === 0[\s\S]*event\.preventDefault\(\)[\s\S]*stepPanel\.current\?\.focus/,
  "The wallet-pending transfer state must keep keyboard focus inside the modal even when every action is disabled.");
assert.match(dialog, /transitionNativeTransfer\(prompt, "UNKNOWN", \{ txHash: hash \}\)/,
  "A real provider hash is never discarded when SUBMITTED persistence fails.");
assert.match(dialog, /could not independently load the mined transaction details[\s\S]*do not resubmit/,
  "Unavailable settlement evidence must present an unresolved, duplicate-blocking outcome.");
assert.match(dialog, /mined transaction did not match the reviewed network, sender, recipient, amount, or empty calldata[\s\S]*do not resubmit/,
  "Mismatched settlement evidence must not claim transfer success or invite a retry.");
assert.match(dialog, /could not independently verify its Robinhood Chain context[\s\S]*do not resubmit/,
  "Unavailable reverted-receipt authority must remain unresolved and duplicate-blocking.");
assert.match(dialog, /transaction hash or network did not match the tracked transfer[\s\S]*duplicate protection active[\s\S]*do not resubmit/,
  "Mismatched reverted-receipt authority must retain the tracked hash and duplicate protection.");
assert.match(dialog, /session\.state === "REVERTED"[\s\S]*The onchain transaction reverted\. No transfer was completed\./,
  "A reverted receipt must never be presented as transfer success.");
assert.match(dialog, /returnFocus\.current\?\.focus/);
assert.match(dialog, /RMT never changes the destination/);
assert.doesNotMatch(dialog, /privateKey|authorizationPrivateKey|appSecret|useSigners|useSessionSigners/);

console.log("Wallet transfers remain exact, user-reviewed, and wallet-confirmed.");
