# Position Guard order-authority invariants

Automatic Position Guard is allowed to operate only inside an exact, auditable wallet-authority boundary. These invariants apply in addition to the executor contract’s immutable route and recipient restrictions.

## Arming invariants

Before an order record can become `active`, RMT must independently verify all of the following against current Robinhood Chain state:

1. The configured executor address contains deployed bytecode.
2. The protected wallet still holds at least the proposed protected amount.
3. The ERC-20 allowance to the executor is **exactly equal** to the protected amount.
4. The allowance is neither smaller nor larger than the proposed order.
5. The token, pool, wallet recipient, route, and price-impact controls produce a currently eligible zero-RMT-fee exit quote.
6. No unresolved automatic order already exists for the same identity, wallet, and token.

A larger allowance is not accepted as “sufficient.” Exact allowance is part of the order definition and prevents one automatic order from silently inheriting broader spending authority than the user reviewed.

## Existing-order replacement

A new order may replace a prior record only when both conditions are true:

- the prior record is in a terminal state: `inactive`, `cancelled`, `executed`, or `expired`; and
- RMT has a positive wallet-cleanup report showing that the client completed the revocation sequence.

`active`, `confirming`, `executing`, `submitted`, `review_required`, `approval_required`, and `no_position` records cannot be overwritten by another arm request. They must first be cancelled, reconciled, or reviewed through Protection Center.

This prevents a new authorization from erasing the evidence needed to resolve an older allowance, delegated signer, or in-flight transaction.

## Evaluator invariants

The evaluator re-checks allowance and wallet balance before every possible execution:

- `allowance === original protected amount` is required to continue evaluation;
- an allowance below the order limit moves the order to `approval_required`;
- an allowance above the order limit moves the order to `review_required` with `allowance_exceeds_order_limit`;
- a zero token balance moves the order to `no_position`;
- a lower nonzero balance may reduce the executed amount, but never increases the original order limit;
- an unknown execution result is not retried automatically.

The server must never interpret a changed allowance as permission to expand, repair, or silently replace the user’s reviewed plan.

## Recovery configuration

The public arming flag may be disabled without removing the guided recovery path. During a release lock or emergency shutdown, retain the non-secret public identifiers required to locate and revoke authority:

- `NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR`;
- `NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID`;
- `NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID`.

Keep `NEXT_PUBLIC_RMT_LIVE_POSITION_GUARD_ENABLED=false` until the release gate is complete. Removing the public identifiers prevents the client from constructing guided allowance cleanup and signer revocation controls. They should be removed only after every known order is terminal, every transaction is reconciled, and affected wallets have had adequate time to clear authority.

## Required test evidence

Before activation, automated and canary evidence must prove:

- exact allowance is accepted;
- oversized allowance is rejected at arm time;
- undersized allowance is rejected at arm time;
- insufficient balance is rejected at arm time;
- an unresolved order cannot be replaced;
- a terminal order without cleanup evidence cannot be replaced;
- a terminal order with cleanup evidence can be replaced;
- an allowance changed after arming stops evaluator execution;
- an oversized post-arm allowance enters `review_required`;
- an undersized post-arm allowance enters `approval_required`;
- an in-flight transaction remains under reconciliation after future authority is removed.

Until those checks are attached to the release record, automatic execution remains disabled.
