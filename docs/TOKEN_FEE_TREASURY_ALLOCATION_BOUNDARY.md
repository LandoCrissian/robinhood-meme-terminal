# RMT token-fee treasury allocation boundary

## Immutable source split

RMT V6 token markets route realized fees through the launch-specific 70/30 splitter:

- 70% to the current creator-share recipient;
- 30% to the RMT V6 governance contract acting as protocol treasury.

This allocation model admits only the confirmed protocol leg of the disclosed V6 bonding-curve fee. The creator's 70% is not platform revenue and cannot be repurposed for advertising, listings, incentives, grants, buybacks, or operations.

## Intended use of RMT's 30%

RMT intends to develop transparent governance policies for its own protocol-treasury share across:

- platform growth, promotion, and listing expenses;
- project support, ecosystem programs, and grants;
- disclosed holder incentive programs with eligibility rules;
- separately governed token actions such as buybacks, burns, liquidity support, or NFT floor support;
- safety and operating reserves.

These are intended categories, not approved percentages or payment promises. “Back to holders” must mean a disclosed incentive or governed action—not interest, yield, ownership of treasury funds, or a guaranteed return.

`apps/web/lib/token-fee-economics.ts` fixes the source split at 7,000/3,000 basis points and defines a non-executable allocation-policy model for the protocol-owned 30%. Any future allocation must total 100% of that protocol share, carry a versioned fingerprint, and remain subject to V6 delayed governance.

`apps/web/lib/treasury-accounting.ts` adds source-separated evidence records and non-executable allocation drafts. It rejects duplicate evidence, unknown receipts, cross-asset aggregation, and over-reservation. See `docs/TREASURY_ACCOUNTING_AND_ALLOCATION.md`.

## Separate marketplace economics

Token-market fees and future creator-marketplace fees are different revenue sources:

1. Eligible V6 curve fees use the immutable 70/30 creator/protocol split.
2. Creator-marketplace fees require their own approved policy, buyer disclosure, creator-net calculation, refund handling, and settlement contracts.

Neither source may be double counted. Marketplace revenue cannot be described as token-market revenue, and the creator's token-market share cannot be presented as RMT treasury income.

V6 curve revenue remains its own accounting domain, and allocation drafts cannot silently pool it with marketplace, commercial-service, sponsorship, or grant revenue. V4/post-graduation revenue is excluded from the V7 treasury and flywheel model. Existing immutable V6 contract capability remains historical infrastructure, not an eligible accounting source.

## Required before treasury execution

1. Select and publish exact protocol-share allocation percentages.
2. Define program eligibility, budgets, measurement, and conflicts controls.
3. Define how holder incentives avoid misleading yield or investment claims.
4. Define governance proposal payloads and public post-execution reporting.
5. Add treasury accounting by asset and source before combining balances.
6. Obtain specialist legal, tax, and accounting review.
