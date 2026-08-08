import assert from "node:assert/strict";
import {
  assertAuthorizationPlan,
  assertCandidateMatchesIntent,
  assertTradeIntent,
  assetKey,
  candidateCanAuthorize,
  evmAsset,
  evmChain,
  solanaAsset,
  spendableAtomic,
  transitionExecutionSession,
  type AssetBalanceSnapshot,
  type AuthorizationPlan,
  type ExecutionCandidate,
  type ExecutionSession,
  type SettlementRecord,
  type TradeIntent,
  type WalletAccount
} from "./execution-domain";

const now = 1_800_000_000_000;
const wallet: WalletAccount = {
  accountId: "wallet:robinhood:test",
  chain: evmChain(4_663),
  address: "0x1111111111111111111111111111111111111111",
  custody: "self_custody"
};
const usdg = evmAsset(4_663, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const token = evmAsset(4_663, "0x2222222222222222222222222222222222222222");

assert.notEqual(assetKey(usdg), assetKey(evmAsset(8_453, "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168")));
assert.notEqual(assetKey(usdg), assetKey(token));
assert.match(assetKey(solanaAsset("So11111111111111111111111111111111111111112")), /^solana:mainnet\/mint:/);

const balance: AssetBalanceSnapshot = {
  schemaVersion: 1,
  account: wallet,
  asset: { id: usdg, symbol: "USDG", name: "Global Dollar", decimals: 6, metadataState: "verified" },
  settledAtomic: "500000000",
  pendingIncomingAtomic: "100000000",
  pendingOutgoingAtomic: "25000000",
  reservedAtomic: "50000000",
  routeState: "tradeable",
  observedAtMs: now,
  blockReference: "12345"
};
assert.equal(spendableAtomic(balance), "425000000", "pending incoming value must not become spendable");

const intent: TradeIntent = {
  schemaVersion: 1,
  intentId: "intent-1",
  sourceAccount: wallet,
  inputAsset: usdg,
  outputAsset: token,
  amountAtomic: "100000000",
  tradeType: "exact_input",
  recipient: wallet,
  preference: "recommended",
  requestedAtMs: now
};

const candidate: ExecutionCandidate = {
  schemaVersion: 1,
  candidateId: "candidate-1",
  intentId: intent.intentId,
  provider: "Test intent provider",
  providerFamily: "future",
  adapterVersion: 1,
  capabilities: ["rfq", "dutch_auction", "gasless"],
  inputAsset: usdg,
  outputAsset: token,
  recipient: wallet,
  inputAmountAtomic: intent.amountAtomic,
  maximumInputAtomic: null,
  expectedOutputAtomic: "25000000000000000000000",
  protectedOutputAtomic: "24500000000000000000000",
  fees: [{ kind: "rmt", asset: token, amountAtomic: "0", payer: "user", disclosure: "RMT fee disabled." }],
  authorization: {
    kind: "evm_typed_data",
    approvalRequired: true,
    approvalSpender: "0x3333333333333333333333333333333333333333",
    permitContract: "0x4444444444444444444444444444444444444444",
    settlementTarget: "0x5555555555555555555555555555555555555555",
    userPaysGas: false
  },
  verification: {
    verifierId: "test-intent-v1",
    verifierVersion: 1,
    expectedSourceChain: evmChain(4_663),
    expectedDestinationChain: evmChain(4_663),
    expectedTargets: ["0x5555555555555555555555555555555555555555"],
    unknownFields: "reject"
  },
  quotedAtMs: now,
  expiresAtMs: now + 60_000,
  expectedSettlementSeconds: 8,
  settlementMode: "asynchronous_fill",
  policy: {
    eligibility: "permitted",
    warnings: [{ code: "thin_liquidity", title: "Thin liquidity", detail: "Market-risk warning only." }],
    blockers: []
  },
  routeDescription: "Provider chooses verified liquidity beneath the RMT execution boundary.",
  providerQuoteRef: "server:quote:test-1"
};

assert.equal(assertCandidateMatchesIntent(candidate, intent, now + 1), true);
assert.equal(assertTradeIntent(intent), true);
assert.equal(candidateCanAuthorize(candidate, now + 1), true, "warnings must not become transaction-integrity blockers");
assert.equal(candidateCanAuthorize({ ...candidate, policy: { ...candidate.policy, blockers: [{ code: "recipient", title: "Recipient changed", detail: "Hard blocker." }] } }, now + 1), false);
assert.throws(() => assertCandidateMatchesIntent({ ...candidate, outputAsset: usdg }, intent, now + 1), /output asset changed/);
assert.throws(() => assertCandidateMatchesIntent({ ...candidate, recipient: { ...wallet, address: "0x9999999999999999999999999999999999999999" } }, intent, now + 1), /recipient changed/);
assert.throws(() => assertCandidateMatchesIntent({ ...candidate, protectedOutputAtomic: "26000000000000000000000" }, intent, now + 1), /protected output/);
assert.throws(() => assertCandidateMatchesIntent({ ...candidate, capabilities: ["rfq", "rfq"] }, intent, now + 1), /duplicated/);

const plan: AuthorizationPlan = {
  schemaVersion: 1,
  planId: "plan-1",
  intentId: intent.intentId,
  candidateId: candidate.candidateId,
  providerFamily: candidate.providerFamily,
  kind: candidate.authorization.kind,
  payloadRef: "server:authorization:test-1",
  payloadHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  verifiedAtMs: now + 2,
  expiresAtMs: now + 50_000,
  verifierId: candidate.verification.verifierId,
  verifierVersion: candidate.verification.verifierVersion
};
assert.equal(assertAuthorizationPlan(plan, candidate, now + 3), true);
assert.throws(() => assertAuthorizationPlan({ ...plan, providerFamily: "uniswapx" }, candidate, now + 3), /provider changed/);

let session: ExecutionSession = { state: "draft", intent };
session = transitionExecutionSession(session, { type: "REQUEST_QUOTES", nowMs: now });
session = transitionExecutionSession(session, { type: "QUOTES_READY", candidates: [candidate], selectedCandidateId: candidate.candidateId });
session = transitionExecutionSession(session, { type: "VERIFY_SELECTED" });
session = transitionExecutionSession(session, { type: "VERIFICATION_PASSED", plan, nowMs: now + 3 });
session = transitionExecutionSession(session, { type: "REQUEST_AUTHORIZATION", nowMs: now + 4 });

const pending: SettlementRecord = {
  schemaVersion: 1,
  settlementId: "settlement-1",
  intentId: intent.intentId,
  candidateId: candidate.candidateId,
  chain: evmChain(4_663),
  status: "open",
  transactionIds: [],
  submittedAtMs: now + 5,
  confirmedAtMs: null,
  inputAmountAtomic: intent.amountAtomic,
  outputAmountAtomic: null
};
session = transitionExecutionSession(session, { type: "SUBMITTED", settlement: pending });
assert.equal(session.state, "pending_settlement");
assert.throws(() => transitionExecutionSession(session, {
  type: "SETTLEMENT_CONFIRMED",
  settlement: { ...pending, status: "confirmed", outputAmountAtomic: "24500000000000000000000" }
}), /not confirmed/);
session = transitionExecutionSession(session, {
  type: "SETTLEMENT_CONFIRMED",
  settlement: {
    ...pending,
    status: "confirmed",
    transactionIds: ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    confirmedAtMs: now + 10_000,
    outputAmountAtomic: "24500000000000000000000"
  }
});
assert.equal(session.state, "settled");
assert.throws(() => transitionExecutionSession(session, { type: "REQUEST_QUOTES", nowMs: now + 11_000 }), /not allowed/);

console.info("RMT Terminal VNext execution-domain smoke test passed");
