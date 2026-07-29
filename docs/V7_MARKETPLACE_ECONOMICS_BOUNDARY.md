# V7 Marketplace Economics Boundary

## Purpose

RMT marketplace economics must be explicit, versioned, inspectable, and separate from creator ownership. No asset draft, collaborator credit, or proposed revenue split currently charges a fee or moves funds.

The foundational policy model separates:

1. gross buyer payment;
2. the disclosed marketplace or service fee;
3. net creator and collaborator proceeds;
4. allocation of the platform fee among operations, the creator ecosystem, a safety reserve, and an optional token-directed flywheel;
5. refunds, failed settlement, and funds that cannot be distributed.

## Non-negotiable accounting rules

- Creator revenue splits apply to creator proceeds, not secretly to the platform fee.
- A marketplace fee must be displayed before signature and bounded by the reviewed policy.
- Platform-fee allocations must total exactly 10,000 basis points.
- A token-directed allocation is treasury revenue first. It cannot be represented as creator revenue, interest, yield, or a guaranteed return.
- Token buybacks, burns, liquidity support, floor purchases, grants, or incentives are separate governed actions. A fee collection must not silently execute them.
- Every executable marketplace contract must bind to an immutable fee-policy hash.
- Changing a fee rate or allocation requires a new policy version and cannot rewrite completed sales.
- Refund and failed-payment paths take priority over any flywheel allocation.
- Marketplace contracts must remain solvent under rounding, partial fills, reverted payouts, malicious recipients, and unsupported tokens.

## Current implementation boundary

`apps/web/lib/creator-economics.ts` provides a non-executable policy model, normalization, validation, and a deterministic Keccak-256 policy hash. It intentionally does not select RMT’s final fee, store a live policy, collect funds, perform a swap, buy RMT, burn tokens, add liquidity, purchase NFTs, or promise rewards.

The current model caps a configured marketplace fee at 10% as a defensive software boundary. The actual launch policy should be materially lower unless a specific service, user disclosure, legal review, and market comparison justify otherwise.

## Required work before contracts

1. choose and publish the initial fee rate and allocation with plain-language examples;
2. decide which governance system can approve token-directed actions;
3. define treasury custody and emergency pause authority;
4. define royalty compatibility and creator-split precedence;
5. specify supported payment assets and price-conversion rules;
6. model refunds, chargebacks where applicable, payout failure, dust, and rounding;
7. run legal review for marketplace, music, royalty, token, and promotional-reward claims;
8. build invariant and adversarial tests before any mainnet deployment.
