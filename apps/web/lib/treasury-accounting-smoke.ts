import assert from "node:assert/strict";
import { createProtocolTreasuryAllocation } from "./token-fee-economics";
import {
  createTreasuryAllocationProposal,
  createTreasuryLedgerEntry,
  summarizeTreasuryLedger,
  validateTreasuryLedger
} from "./treasury-accounting";

const policy = createProtocolTreasuryAllocation({
  policyName: "Test-only source allocation",
  allocation: {
    platformGrowthBps: 3_000,
    projectSupportBps: 2_500,
    holderIncentivesBps: 2_000,
    governedTokenActionsBps: 1_500,
    safetyReserveBps: 1_000
  },
  disclosure: "Test-only policy for deterministic accounting. Governance is required, program eligibility is undefined, and no holder payment, return, or execution is promised.",
  governanceRequired: true,
  status: "draft"
});

const sourcePolicyHash = "0x1111111111111111111111111111111111111111111111111111111111111111" as const;
const curveEntry = createTreasuryLedgerEntry({
  source: "token_curve_protocol_fee",
  asset: { chainId: 4_663, address: "native", symbol: "ETH", decimals: 18 },
  amountAtomic: "1001",
  evidence: {
    kind: "onchain_event",
    chainId: 4_663,
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 4,
    blockNumber: "123"
  },
  receivedAt: "2026-07-28T12:00:00.000Z",
  disclosure: "Confirmed V6 curve protocol-fee receipt attributed only to RMT's protocol-owned share.",
  sourcePolicyHash
});
const secondCurveEntry = createTreasuryLedgerEntry({
  source: "token_curve_protocol_fee",
  asset: { chainId: 4_663, address: "native", symbol: "ETH", decimals: 18 },
  amountAtomic: "999",
  evidence: {
    kind: "onchain_event",
    chainId: 4_663,
    transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    logIndex: 7,
    blockNumber: "124"
  },
  receivedAt: "2026-07-28T12:01:00.000Z",
  disclosure: "Second confirmed V6 curve protocol-fee receipt used to test aggregation and reservations.",
  sourcePolicyHash
});

assert.equal(validateTreasuryLedger([curveEntry, secondCurveEntry]), true);
assert.equal(curveEntry.accountingDomain, "v6_token_market");
assert.equal(secondCurveEntry.accountingDomain, "v6_token_market");
assert.deepEqual(summarizeTreasuryLedger([curveEntry, secondCurveEntry]), [{
  asset: { chainId: 4_663, address: "native", symbol: "ETH", decimals: 18 },
  totalAmountAtomic: "2000",
  sources: [{ source: "token_curve_protocol_fee", amountAtomic: "2000" }]
}]);

assert.throws(() => validateTreasuryLedger([
  curveEntry,
  createTreasuryLedgerEntry({
    ...curveEntry,
    source: "listing_or_advertising_revenue",
    evidence: {
      kind: "onchain_event",
      chainId: 4_663,
      transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      logIndex: 4,
      blockNumber: "999"
    }
  })
]), /counted twice/);
assert.throws(() => createTreasuryLedgerEntry({
  ...curveEntry,
  sourcePolicyHash: undefined
}), /source-policy hash/);

const firstProposal = createTreasuryAllocationProposal({
  policy,
  title: "Test ecosystem allocation",
  rationale: "Reserve a test-only portion of separately evidenced protocol receipts for policy allocation without creating transaction data or execution authority.",
  asset: curveEntry.asset,
  ledger: [curveEntry, secondCurveEntry],
  reservations: [
    { entryHash: curveEntry.entryHash, amountAtomic: "501" },
    { entryHash: secondCurveEntry.entryHash, amountAtomic: "499" }
  ]
});
assert.equal(firstProposal.totalAmountAtomic, "1000");
assert.deepEqual(firstProposal.allocations.map((line) => line.amountAtomic), ["300", "250", "200", "150", "100"]);
assert.equal(firstProposal.transactionPayload, null);
assert.equal(firstProposal.contractExecution, "disabled");
assert.equal(firstProposal.accountingDomain, "v6_token_market");

const marketplaceEntry = createTreasuryLedgerEntry({
  source: "creator_marketplace_platform_fee",
  asset: curveEntry.asset,
  amountAtomic: "50",
  evidence: {
    kind: "offchain_receipt",
    evidenceHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    reference: "test-only-marketplace-receipt"
  },
  receivedAt: "2026-07-28T12:02:00.000Z",
  disclosure: "Test-only marketplace receipt that must remain outside the V6 token-market accounting domain.",
  sourcePolicyHash: policy.policyHash
});
assert.equal(marketplaceEntry.accountingDomain, "creator_marketplace");
assert.throws(() => createTreasuryAllocationProposal({
  policy,
  title: "Mixed domain allocation",
  rationale: "Attempt to combine V6 token-market revenue with marketplace revenue in one allocation draft must fail before governance preparation.",
  asset: curveEntry.asset,
  ledger: [curveEntry, marketplaceEntry],
  reservations: [
    { entryHash: curveEntry.entryHash, amountAtomic: "1" },
    { entryHash: marketplaceEntry.entryHash, amountAtomic: "1" }
  ]
}), /cannot silently combine accounting domains/);

assert.throws(() => createTreasuryAllocationProposal({
  policy: {
    ...policy,
    allocation: { ...policy.allocation, platformGrowthBps: 3_001, safetyReserveBps: 999 }
  },
  title: "Tampered policy allocation",
  rationale: "Attempt to use changed policy percentages while retaining the earlier fingerprint must fail before an accounting proposal can be prepared.",
  asset: curveEntry.asset,
  ledger: [curveEntry, secondCurveEntry],
  reservations: [{ entryHash: curveEntry.entryHash, amountAtomic: "1" }]
}), /fingerprint mismatch/);
assert.throws(() => createTreasuryAllocationProposal({
  policy,
  title: "Conflicting allocation",
  rationale: "Attempt to reserve more than remains in the same immutable source evidence after accounting for a prior draft reservation.",
  asset: curveEntry.asset,
  ledger: [curveEntry, secondCurveEntry],
  existingProposals: [firstProposal],
  reservations: [{ entryHash: curveEntry.entryHash, amountAtomic: "501" }]
}), /exceeds the unreserved/);
assert.throws(() => createTreasuryAllocationProposal({
  policy,
  title: "Unknown source allocation",
  rationale: "Attempt to reference a source that does not exist in the verified ledger and must therefore be rejected before proposal preparation.",
  asset: curveEntry.asset,
  ledger: [curveEntry, secondCurveEntry],
  reservations: [{
    entryHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    amountAtomic: "1"
  }]
}), /unknown source/);

console.info("Treasury accounting and allocation smoke test passed");
