import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  numberToHex,
  padHex,
  parseAbiParameters,
  toBytes,
  type Address,
  type Hex
} from "viem";
import type { AcrossFundingEvidence } from "../server/vnext-across-funding";
import {
  applyAcrossFundingObservation,
  acrossFundsDepositedEventAbi,
  verifyAcrossDestinationReceipt,
  verifyAcrossFundingStatusResponse,
  verifyAcrossRefundReceipt,
  verifyAcrossSourceReceipt,
  verifyAcrossSourceTransaction
} from "../server/vnext-across-funding-status";
import {
  assertCrossChainFundingSessionWrite,
  crossChainFundingOwnerKey,
  crossChainFundingStoragePath,
  serializableCrossChainFundingSession
} from "../server/vnext-cross-chain-funding-store";
import {
  availableCrossChainFundingOutput,
  createCrossChainFundingSession,
  crossChainFundingDisclosure,
  crossChainFundingProofRecord,
  normalizeCrossChainFundingJournal,
  pendingCrossChainFundingOutput,
  readCrossChainFundingJournal,
  registerCrossChainFundingSourceSubmission,
  transitionCrossChainFundingSession,
  unresolvedCrossChainFunding,
  writeCrossChainFundingSession,
  CROSS_CHAIN_FUNDING_STORAGE_KEY,
  type CrossChainFundingStorage
} from "./cross-chain-funding";
import { ACROSS_SPOKE_POOLS } from "../server/vnext-across-funding";
import { BASE_MAINNET_CHAIN_ID, ROBINHOOD_MAINNET_CHAIN_ID, TRUSTED_ASSET_ADDRESSES } from "./trusted-asset-registry";

const now = 1_786_400_000_000;
const wallet = "0x1111111111111111111111111111111111111111";
const sourceTxHash = `0x${"1".repeat(64)}` as const;
const destinationTxHash = `0x${"2".repeat(64)}` as const;
const refundTxHash = `0x${"3".repeat(64)}` as const;
const evidence: AcrossFundingEvidence = {
  schemaVersion: 1,
  provider: "across",
  kind: "cross_chain_funding",
  settlementMode: "asynchronous_fill",
  quoteId: "across-session-test",
  sourceChainId: BASE_MAINNET_CHAIN_ID,
  destinationChainId: ROBINHOOD_MAINNET_CHAIN_ID,
  sourceToken: TRUSTED_ASSET_ADDRESSES.BASE_USDC,
  destinationToken: TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG,
  inputAmountAtomic: "10000000",
  expectedOutputAtomic: "9995000",
  protectedOutputAtomic: "9990000",
  recipient: wallet,
  depositor: wallet,
  sourceSpokePool: ACROSS_SPOKE_POOLS[BASE_MAINNET_CHAIN_ID],
  destinationSpokePool: ACROSS_SPOKE_POOLS[ROBINHOOD_MAINNET_CHAIN_ID],
  sourceSpokePoolRuntimeHash: `0x${"a".repeat(64)}`,
  sourceSpokePoolImplementation: "0x3333333333333333333333333333333333333333",
  sourceSpokePoolImplementationRuntimeHash: `0x${"c".repeat(64)}`,
  destinationSpokePoolRuntimeHash: `0x${"d".repeat(64)}`,
  destinationSpokePoolImplementation: "0x4444444444444444444444444444444444444444",
  destinationSpokePoolImplementationRuntimeHash: `0x${"e".repeat(64)}`,
  approvalSpender: ACROSS_SPOKE_POOLS[BASE_MAINNET_CHAIN_ID],
  exactApprovalAmountAtomic: "10000000",
  exclusiveRelayer: "0x2222222222222222222222222222222222222222",
  quoteTimestamp: Math.floor(now / 1_000),
  fillDeadline: Math.floor(now / 1_000) + 3_600,
  exclusivityParameter: 120,
  message: "0x",
  refundRecipient: wallet,
  refundChainId: BASE_MAINNET_CHAIN_ID,
  refundToken: TRUSTED_ASSET_ADDRESSES.BASE_USDC,
  refundOnOrigin: true,
  partialFillsAllowed: false,
  totalFeeAtomic: "10000",
  totalFeeAsset: TRUSTED_ASSET_ADDRESSES.BASE_USDC,
  originGasAtomic: "1000",
  expectedCompletionSeconds: 2,
  quoteExpiresAtMs: now + 60_000,
  providerSimulationPassed: true,
  depositTarget: ACROSS_SPOKE_POOLS[BASE_MAINNET_CHAIN_ID],
  depositCalldataHash: keccak256("0x1234"),
  depositValueAtomic: "0",
  depositGasLimit: "210000",
  unexpectedDestinationCall: false,
  serverSubmissionEnabled: false
};

let session = createCrossChainFundingSession({
  sessionId: "11111111-1111-4111-8111-111111111111",
  evidence,
  nowMs: now
});
assert.equal(session.state, "quote_ready");
assert.equal(session.sourceSpokePool, ACROSS_SPOKE_POOLS[BASE_MAINNET_CHAIN_ID]);
assert.equal(session.depositCalldataHash, evidence.depositCalldataHash);
assert.equal(session.totalFeeAtomic, evidence.totalFeeAtomic);
assert.equal(session.totalFeeAsset, evidence.totalFeeAsset);
assert.equal(session.expectedCompletionSeconds, evidence.expectedCompletionSeconds);
assert.equal(session.exactApprovalAmountAtomic, evidence.inputAmountAtomic);
assert.equal(session.refundOnOrigin, true);
assert.equal(session.partialFillsAllowed, false);
const quoteDisclosure = crossChainFundingDisclosure(session);
const quoteProof = crossChainFundingProofRecord(session);
assert.equal(quoteDisclosure.inputAmountAtomic, evidence.inputAmountAtomic);
assert.equal(quoteDisclosure.protectedOutputAtomic, evidence.protectedOutputAtomic);
assert.equal(quoteDisclosure.recipient, wallet);
assert.equal(quoteDisclosure.refundRecipient, wallet);
assert.equal(quoteDisclosure.asynchronousSettlement, true);
assert.equal(quoteDisclosure.availableOutputAtomic, "0");
assert.doesNotMatch(JSON.stringify(quoteDisclosure), /calldata|privateKey|apiKey/);
assert.equal(quoteProof.proofStatus, "incomplete");
assert.equal(quoteProof.source.transactionHash, null);
assert.equal(quoteProof.destination.realizedOutputAtomic, null);
assert.equal(quoteProof.availability.availableOutputAtomic, "0");
assert.equal(quoteProof.serverSubmittedFunds, false);
assert.doesNotMatch(JSON.stringify(quoteProof), /privateKey|apiKey|rawProviderQuote|encodedOrder/);
assert.throws(
  () => serializableCrossChainFundingSession({
    ...session,
    sourceToken: "0x5555555555555555555555555555555555555555",
    totalFeeAsset: "0x5555555555555555555555555555555555555555"
  }),
  /invalid funding session document/
);

const lateRegistration = registerCrossChainFundingSourceSubmission(
  createCrossChainFundingSession({
    sessionId: "44444444-4444-4444-8444-444444444444",
    evidence,
    nowMs: now
  }),
  sourceTxHash,
  evidence.quoteExpiresAtMs + 60_000
);
assert.equal(lateRegistration.state, "source_submitted", "an exact transaction remains recoverable after the API quote expires");
assert.equal(lateRegistration.sourceTxHash, sourceTxHash);
assert.deepEqual(
  registerCrossChainFundingSourceSubmission(lateRegistration, sourceTxHash, lateRegistration.updatedAtMs + 1),
  lateRegistration,
  "duplicate source registration is idempotent"
);
assert.throws(
  () => registerCrossChainFundingSourceSubmission(lateRegistration, `0x${"9".repeat(64)}`, lateRegistration.updatedAtMs + 1),
  /cannot be replaced/
);
assert.equal(availableCrossChainFundingOutput(session), "0");
assert.equal(pendingCrossChainFundingOutput(session), "0");

session = transitionCrossChainFundingSession(session, { type: "source_submission_requested" }, now + 1);
session = transitionCrossChainFundingSession(session, { type: "source_submitted", sourceTxHash }, now + 2);
assert.equal(session.sourceTxHash, sourceTxHash);
assert.equal(pendingCrossChainFundingOutput(session), "9990000");
assert.equal(availableCrossChainFundingOutput(session), "0");
session = transitionCrossChainFundingSession(session, { type: "deposit_confirmed", depositId: "42" }, now + 3);
session = transitionCrossChainFundingSession(session, { type: "bridging" }, now + 4);
session = transitionCrossChainFundingSession(session, { type: "fill_pending" }, now + 5);
session = transitionCrossChainFundingSession(session, {
  type: "destination_confirmed",
  destinationTxHash,
  destinationOutputAtomic: "9991000"
}, now + 6);
assert.equal(availableCrossChainFundingOutput(session), "0", "confirmed destination funds remain unavailable until balance reconciliation completes");
session = transitionCrossChainFundingSession(session, { type: "completed" }, now + 7);
assert.equal(availableCrossChainFundingOutput(session), "9991000");
assert.equal(pendingCrossChainFundingOutput(session), "0");
const completedProof = crossChainFundingProofRecord(session);
assert.equal(completedProof.proofStatus, "completed");
assert.equal(completedProof.source.transactionHash, sourceTxHash);
assert.equal(completedProof.source.depositId, "42");
assert.equal(completedProof.destination.transactionHash, destinationTxHash);
assert.equal(completedProof.destination.realizedOutputAtomic, "9991000");
assert.equal(completedProof.timing.realizedCompletionMs, 5);
assert.equal(completedProof.availability.availableOutputAtomic, "9991000");
assert.deepEqual(transitionCrossChainFundingSession(session, { type: "completed" }, now + 8), session, "duplicate terminal delivery is idempotent");
assert.throws(() => transitionCrossChainFundingSession(session, { type: "bridging" }, now + 9), /invalid funding transition/);

let refund = createCrossChainFundingSession({
  sessionId: "22222222-2222-4222-8222-222222222222",
  evidence,
  nowMs: now
});
refund = transitionCrossChainFundingSession(refund, { type: "source_submission_requested" }, now + 1);
refund = transitionCrossChainFundingSession(refund, { type: "source_submitted", sourceTxHash }, now + 2);
refund = transitionCrossChainFundingSession(refund, { type: "deposit_confirmed", depositId: "43" }, now + 3);
refund = transitionCrossChainFundingSession(refund, { type: "expired" }, now + 4);
refund = transitionCrossChainFundingSession(refund, { type: "refund_eligible" }, now + 5);
refund = transitionCrossChainFundingSession(refund, { type: "refund_pending" }, now + 6);
refund = transitionCrossChainFundingSession(refund, { type: "refunded", refundTxHash }, now + 7);
assert.equal(refund.state, "refunded");
assert.equal(refund.refundTxHash, refundTxHash);
assert.equal(availableCrossChainFundingOutput(refund), "0");
const refundProof = crossChainFundingProofRecord(refund);
assert.equal(refundProof.proofStatus, "refunded");
assert.equal(refundProof.refund.transactionHash, refundTxHash);
assert.equal(refundProof.availability.availableOutputAtomic, "0");

const values = new Map<string, string>();
const storage: CrossChainFundingStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); }
};
assert.equal(writeCrossChainFundingSession(refund, storage, now + 8), true);
assert.equal(writeCrossChainFundingSession(session, storage, now + 8), true);
assert.equal(readCrossChainFundingJournal(storage, now + 9).length, 2);
assert.equal(unresolvedCrossChainFunding(wallet, storage, now + 9).length, 0);
assert.doesNotMatch(values.get(CROSS_CHAIN_FUNDING_STORAGE_KEY) ?? "", /calldata|apiKey|privateKey/);
assert.deepEqual(normalizeCrossChainFundingJournal([{ bad: true }], now), []);

let pending = createCrossChainFundingSession({
  sessionId: "33333333-3333-4333-8333-333333333333",
  evidence,
  nowMs: now
});
pending = transitionCrossChainFundingSession(pending, { type: "source_submission_requested" }, now + 1);
pending = transitionCrossChainFundingSession(pending, { type: "source_submitted", sourceTxHash }, now + 2);
assert.equal(writeCrossChainFundingSession(pending, storage, now + 3), true);
assert.equal(unresolvedCrossChainFunding(wallet, storage, now + 4)[0]?.sessionId, pending.sessionId);
assert.equal(unresolvedCrossChainFunding("0x4444444444444444444444444444444444444444", storage, now + 4).length, 0);
assert.match(crossChainFundingOwnerKey(wallet), /^[0-9a-f]{64}$/);
assert.doesNotMatch(crossChainFundingStoragePath(wallet, session.sessionId), new RegExp(wallet.slice(2), "i"));
assert.doesNotMatch(JSON.stringify(serializableCrossChainFundingSession(session)), /calldata|apiKey|privateKey/);
assert.deepEqual(assertCrossChainFundingSessionWrite(session, session), session);
const advancedPending = transitionCrossChainFundingSession(
  pending,
  { type: "deposit_confirmed", depositId: "45" },
  pending.updatedAtMs + 1
);
assert.throws(
  () => assertCrossChainFundingSessionWrite(pending, {
    ...advancedPending,
    inputAmountAtomic: "10000001",
    exactApprovalAmountAtomic: "10000001"
  }),
  /verified funding intent/
);
assert.throws(
  () => assertCrossChainFundingSessionWrite(pending, { ...advancedPending, sourceTxHash: `0x${"9".repeat(64)}` }),
  /anchored funding lifecycle evidence/
);
assert.throws(
  () => assertCrossChainFundingSessionWrite(pending, {
    ...pending,
    state: "quote_ready",
    updatedAtMs: pending.updatedAtMs + 1,
    events: [{ ...pending.events[0], observedAtMs: pending.updatedAtMs + 1 }]
  }),
  /invalid funding session document|lifecycle history rewrite/
);

const malformedHistory = {
  ...pending,
  state: "completed" as const,
  destinationTxHash,
  destinationOutputAtomic: evidence.protectedOutputAtomic,
  updatedAtMs: pending.updatedAtMs + 1,
  events: [...pending.events, {
    state: "completed" as const,
    source: "destination_chain" as const,
    detail: "Fabricated completion.",
    observedAtMs: pending.updatedAtMs + 1
  }]
};
assert.throws(() => serializableCrossChainFundingSession(malformedHistory), /invalid funding session document/);

const sourceTransaction = {
  transactionHash: sourceTxHash,
  from: wallet as Address,
  to: ACROSS_SPOKE_POOLS[BASE_MAINNET_CHAIN_ID],
  input: "0x1234" as const,
  valueAtomic: "0"
};
assert.equal(verifyAcrossSourceTransaction({ session: pending, expectedTransactionHash: sourceTxHash, transaction: sourceTransaction }), true);
for (const mutation of [
  { transactionHash: `0x${"8".repeat(64)}` },
  { from: "0x4444444444444444444444444444444444444444" },
  { to: "0x4444444444444444444444444444444444444444" },
  { input: "0x1235" },
  { valueAtomic: "1" }
]) {
  assert.throws(
    () => verifyAcrossSourceTransaction({
      session: pending,
      expectedTransactionHash: sourceTxHash,
      transaction: { ...sourceTransaction, ...mutation } as typeof sourceTransaction
    }),
    /could not prove/
  );
}

const directDeposit = {
  depositAddress: null,
  depositRefundAddress: wallet,
  actionsTargetRecipient: null,
  actionsTargetToken: null,
  actionsTargetAmount: null,
  actionsTargetTxnRef: null,
  actionsTargetBlockTimestamp: null,
  actionsTargetChainId: null,
  depositId: "44",
  originChainId: BASE_MAINNET_CHAIN_ID,
  destinationChainId: ROBINHOOD_MAINNET_CHAIN_ID,
  depositor: wallet,
  recipient: wallet,
  inputToken: TRUSTED_ASSET_ADDRESSES.BASE_USDC,
  inputAmount: evidence.inputAmountAtomic,
  outputToken: TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG,
  outputAmount: evidence.protectedOutputAtomic,
  quoteTimestamp: evidence.quoteTimestamp,
  fillDeadline: evidence.fillDeadline,
  exclusiveRelayer: evidence.exclusiveRelayer,
  message: "0x",
  depositTxHash: sourceTxHash,
  depositTxnRef: sourceTxHash,
  status: "filled",
  depositRefundTxHash: null,
  depositRefundTxnRef: null,
  fillTx: destinationTxHash,
  fillTxnRef: destinationTxHash,
  swapOutputToken: null,
  swapOutputTokenAmount: null,
  swapTransactionHash: null,
  swapToken: null,
  swapTokenAmount: null
};

const submitted = pending;
const sourceBlockTimestamp = Math.floor(now / 1_000);
const sourceDepositTopics = encodeEventTopics({
  abi: acrossFundsDepositedEventAbi,
  eventName: "FundsDeposited",
  args: {
    destinationChainId: BigInt(ROBINHOOD_MAINNET_CHAIN_ID),
    depositId: 44n,
    depositor: padHex(wallet as Hex, { size: 32 })
  }
});
const sourceDepositData = encodeAbiParameters(parseAbiParameters(
  "bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 recipient, bytes32 exclusiveRelayer, bytes message"
), [
  padHex(TRUSTED_ASSET_ADDRESSES.BASE_USDC, { size: 32 }),
  padHex(TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG, { size: 32 }),
  BigInt(evidence.inputAmountAtomic),
  BigInt(evidence.protectedOutputAtomic),
  evidence.quoteTimestamp,
  evidence.fillDeadline,
  sourceBlockTimestamp + evidence.exclusivityParameter,
  padHex(wallet as Hex, { size: 32 }),
  padHex(evidence.exclusiveRelayer, { size: 32 }),
  "0x"
]);
const sourceReceipt = {
  transactionHash: sourceTxHash,
  status: "success" as const,
  to: ACROSS_SPOKE_POOLS[BASE_MAINNET_CHAIN_ID],
  blockTimestamp: sourceBlockTimestamp,
  logs: [{
    address: ACROSS_SPOKE_POOLS[BASE_MAINNET_CHAIN_ID],
    topics: sourceDepositTopics as Hex[],
    data: sourceDepositData
  }]
};
const sourceDepositProof = verifyAcrossSourceReceipt({ session: submitted, receipt: sourceReceipt });
assert.equal(sourceDepositProof.depositId, "44");
assert.throws(
  () => verifyAcrossSourceReceipt({ session: submitted, receipt: { ...sourceReceipt, logs: [] } }),
  /one exact/
);
assert.throws(
  () => verifyAcrossSourceReceipt({ session: submitted, receipt: { ...sourceReceipt, logs: [...sourceReceipt.logs, ...sourceReceipt.logs] } }),
  /one exact/
);
assert.throws(
  () => verifyAcrossSourceReceipt({ session: submitted, receipt: { ...sourceReceipt, status: "reverted" } }),
  /could not prove/
);
assert.throws(
  () => verifyAcrossSourceReceipt({ session: submitted, receipt: { ...sourceReceipt, blockTimestamp: sourceBlockTimestamp + 1 } }),
  /changed the verified intent/
);
const sourceConfirmed = transitionCrossChainFundingSession(
  submitted,
  { type: "deposit_confirmed", depositId: sourceDepositProof.depositId },
  now + 8
);
const observation = verifyAcrossFundingStatusResponse({ body: { deposit: directDeposit }, session: submitted });
assert.equal(observation.providerStatus, "filled");
assert.throws(
  () => applyAcrossFundingObservation(submitted, observation, now + 9, true),
  /cannot establish the source deposit identity/
);
const transferTopic = keccak256(toBytes("Transfer(address,address,uint256)"));
const destinationReceipt = {
  transactionHash: destinationTxHash,
  status: "success" as const,
  to: ACROSS_SPOKE_POOLS[ROBINHOOD_MAINNET_CHAIN_ID],
  blockTimestamp: sourceBlockTimestamp + 2,
  logs: [{
    address: TRUSTED_ASSET_ADDRESSES.ROBINHOOD_USDG,
    topics: [transferTopic, padHex(wallet as Hex, { size: 32 }), padHex(wallet as Hex, { size: 32 })],
    data: padHex(numberToHex(BigInt(evidence.protectedOutputAtomic)), { size: 32 })
  }]
};
assert.equal(verifyAcrossDestinationReceipt({ session: sourceConfirmed, observation, receipt: destinationReceipt }), true);
const completedFromStatus = applyAcrossFundingObservation(sourceConfirmed, observation, now + 10, true);
assert.equal(completedFromStatus.state, "completed");
assert.equal(availableCrossChainFundingOutput(completedFromStatus), evidence.protectedOutputAtomic);
assert.deepEqual(applyAcrossFundingObservation(completedFromStatus, observation, now + 20, true), completedFromStatus);
const destinationPendingReceipt = applyAcrossFundingObservation(sourceConfirmed, observation, now + 30, false);
assert.equal(destinationPendingReceipt.state, "destination_confirmed");
assert.equal(availableCrossChainFundingOutput(destinationPendingReceipt), "0");

for (const mutation of [
  { depositTxHash: `0x${"8".repeat(64)}` },
  { fillTx: `0x${"8".repeat(64)}` },
  { recipient: "0x4444444444444444444444444444444444444444" },
  { destinationChainId: 8453 },
  { inputToken: "0x5555555555555555555555555555555555555555" },
  { outputToken: "0x6666666666666666666666666666666666666666" },
  { outputAmount: "9989999" },
  { fillDeadline: evidence.fillDeadline + 1 },
  { exclusiveRelayer: "0x4444444444444444444444444444444444444444" },
  { message: "0x01" },
  { actionsTargetRecipient: wallet },
  { depositRefundAddress: "0x4444444444444444444444444444444444444444" }
]) {
  assert.throws(
    () => verifyAcrossFundingStatusResponse({ body: { deposit: { ...directDeposit, ...mutation } }, session: submitted }),
    /does not match|reported a fill/
  );
}
assert.throws(
  () => verifyAcrossDestinationReceipt({
    session: submitted,
    observation,
    receipt: { ...destinationReceipt, logs: [] }
  }),
  /could not prove/
);

const refundedDeposit = {
  ...directDeposit,
  status: "refunded",
  fillTx: null,
  fillTxnRef: null,
  depositRefundTxHash: refundTxHash,
  depositRefundTxnRef: refundTxHash
};
const refundObservation = verifyAcrossFundingStatusResponse({ body: { deposit: refundedDeposit }, session: submitted });
const refundReceipt = {
  transactionHash: refundTxHash,
  status: "success" as const,
  to: ACROSS_SPOKE_POOLS[BASE_MAINNET_CHAIN_ID],
  blockTimestamp: sourceBlockTimestamp + 7_200,
  logs: [{
    address: TRUSTED_ASSET_ADDRESSES.BASE_USDC,
    topics: [transferTopic, padHex(wallet as Hex, { size: 32 }), padHex(wallet as Hex, { size: 32 })],
    data: padHex(numberToHex(9_900_000n), { size: 32 })
  }]
};
assert.equal(verifyAcrossRefundReceipt({ session: submitted, observation: refundObservation, receipt: refundReceipt }), true);
assert.equal(applyAcrossFundingObservation(sourceConfirmed, refundObservation, now + 20, true).state, "refunded");

const quoteRoute = readFileSync(new URL("../../app/api/vnext/funding/across/quote/route.ts", import.meta.url), "utf8");
const sessionsRoute = readFileSync(new URL("../../app/api/vnext/funding/sessions/route.ts", import.meta.url), "utf8");
assert.match(quoteRoute, /if \(!operational\.authorizationEnabled\)/);
assert.match(quoteRoute, /requireAuthenticatedTradeWallet\(request, recipient\)/);
assert.match(quoteRoute, /fundingReadiness\.fundedPreflightReady/);
assert.match(quoteRoute, /userAuthorizationRequired: true/);
assert.match(quoteRoute, /serverSubmissionEnabled: false/);
assert.doesNotMatch(quoteRoute, /sendTransaction|writeContract|privateKey/);
assert.match(sessionsRoute, /requireAuthenticatedTradeWallet\(request, wallet\)/);
assert.match(sessionsRoute, /verifyAcrossSourceTransaction/);
assert.match(sessionsRoute, /refreshAcrossFundingSession/);
assert.doesNotMatch(sessionsRoute, /sendTransaction|writeContract|privateKey/);

console.log("RMT cross-chain funding lifecycle and local recovery smoke checks passed.");
