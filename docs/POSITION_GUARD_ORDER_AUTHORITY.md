# Position Guard order-authority invariants

Automatic Position Guard may operate only inside an exact, auditable boundary shared by the wallet, the onchain executor order, the Privy policy, and the server record. A match in only one layer is not sufficient.

## Prepared-plan invariants

Before the wallet is asked to approve or register anything, the authenticated prepare endpoint must verify:

1. The configured executor contains bytecode on Robinhood Chain.
2. The selected token and pair are valid addresses and the wallet still holds the complete proposed amount.
3. The exact pair is eligible for a zero-RMT-fee Uniswap V3 exit through the immutable production route.
4. The stop, trailing, break-even, price-impact, TWAP, slippage, and expiry values are inside reviewed bounds.
5. No unresolved automatic order already exists for the same identity, wallet, and token.
6. The prepared plan includes a fresh unpredictable one-time `bytes32` order ID.

The client must reject a prepared plan if its token, pool, amount, or protection settings differ from the position the user reviewed.

## Wallet registration invariants

Arming is a multi-transaction process and must occur in this order:

1. Clear a prior nonzero executor allowance when required by the token.
2. Approve an allowance **exactly equal** to the protected amount.
3. Register the exact order from the protected wallet by calling `registerV3Order`.
4. Read the registered order back from Robinhood Chain and verify every immutable field.
5. Add the policy-scoped Privy signer.
6. Create the server order record only after the onchain order and wallet authority are proven.

The registered order binds:

- protected token;
- factory-recognized token/WETH V3 pool and fee tier;
- protected amount;
- initial stop;
- trailing distance;
- break-even activation;
- maximum TWAP slippage;
- TWAP window;
- expiry;
- one-time order ID;
- same-wallet WETH recipient through the immutable executor.

A larger allowance is not accepted as “sufficient.” Exact allowance is part of the order definition and prevents one automatic order from inheriting broader spending authority than the user reviewed.

If any later arming step fails, the client must best-effort cancel the registered order, clear allowance, remove delegated signers, and reconcile the server record. The UI must identify any boundary that could not be proven cleaned up.

## Existing-order replacement

A new order may replace a prior server record only when all conditions are true:

- the prior record is in a terminal state: `inactive`, `cancelled`, `executed`, or `expired`;
- RMT has a positive wallet-cleanup report;
- any registered onchain order is proven cancelled, executed, or expired;
- no execution remains in `executing`, `submitted`, or unknown receipt state.

`active`, `confirming`, `executing`, `submitted`, `review_required`, `approval_required`, and `no_position` records cannot be overwritten by another arm request. They must first be cancelled, reconciled, or reviewed through Protection Center.

This prevents a new authorization from erasing the evidence needed to resolve an older onchain order, allowance, delegated signer, or in-flight transaction.

## Contract trigger invariants

The contract, not the server record, is authoritative for trigger eligibility.

- Entry value is derived from the registered pool’s V3 TWAP.
- The stored high-water mark may increase but may never decrease.
- Static stop, trailing stop, and break-even floor are derived from registered values only.
- A first below-floor checkpoint cannot execute in the same block.
- Execution requires another block and the minimum confirmation interval.
- A recovered price clears the pending confirmation when checkpointed.
- A stale below-floor confirmation must be restarted rather than treated as permanently valid.
- Expired and cancelled orders cannot execute.
- The current factory pool must still equal the registered pool.
- The caller cannot replace token, pool, fee, amount, settings, expiry, recipient, or order ID during execution.
- The supplied minimum output must be at least the contract’s TWAP-derived minimum.

A TWAP trigger can lag a rapid market move and a fresh executable quote may fall below the contract minimum. The evaluator must fail closed and wait or require review; it must never weaken the registered minimum to force execution.

## Evaluator invariants

The evaluator re-checks the complete boundary before every checkpoint or possible execution:

- server executor, token, pool, amount, fee, settings, TWAP window, slippage, expiry, and order ID must match the onchain order;
- onchain order status must be `Active`;
- `allowance === original protected amount` is required;
- an allowance below the order limit moves the order to `approval_required`;
- an allowance above the order limit moves the order to `review_required` with `allowance_exceeds_order_limit`;
- a zero token balance moves the order to `no_position`;
- a lower nonzero balance moves the order to `review_required` with `balance_below_order_limit`;
- the evaluator never silently reduces the protected amount;
- a closed onchain order with residual allowance moves to `review_required`;
- an unknown execution result is never retried automatically.

The evaluator may submit only two policy-authorized calls:

- `checkpointV3Order(orderId)` to advance the onchain high-water mark, initialize or clear confirmation, or persist expiry;
- `executeV3Exit({ orderId, amountOutMinimum, deadline })` after `previewV3Order` reports `Triggered`.

The policy must reject registration, cancellation, token approval, arbitrary calldata, other targets, other chains, and native value.

Checkpointing has an availability and gas cost. A rising high-water mark is checkpointed only after the configured material-increase threshold, when a recovered confirmation must be cleared, when a new below-floor confirmation must begin, or when expiry must be persisted. The contract still evaluates the current TWAP at execution, but protection cannot follow an uncheckpointed historical peak that the evaluator never stored.

## Evaluator scheduling and reconciliation

Production evaluation must remain fair and bounded:

- eligible orders are selected by oldest `lastEvaluatedAt`, not stable document order;
- the required Firestore composite index is deployed before the worker is enabled;
- each invocation processes a bounded batch concurrently under one lease;
- a second invocation cannot refresh the heartbeat while another lease is stuck;
- checkpoint and execution submissions use idempotency keys tied to the order revision or attempt;
- checkpoint receipts are confirmed before the server advances its mirrored order state;
- submitted execution transactions are reconciled by receipt and onchain order status;
- a successful receipt that does not leave the order `Executed` moves to review;
- a submitted transaction with no receipt after the review window moves to `review_required` instead of remaining indefinitely active;
- every order failure is isolated and recorded as a safe evaluation failure.

## Revocation invariants

Revocation is complete only when all applicable boundaries are proven:

1. The wallet cancels the active registered order onchain, or the order is already executed or expired.
2. The token allowance to the executor is zero.
3. Privy removes every additional signer from the matching embedded wallet.
4. The server records cancellation or preserves in-flight reconciliation.

The server independently reads allowance and onchain order status. A client success flag alone cannot prove cleanup.

An already-submitted transaction may still settle after future authority is removed. `executing` and `submitted` records retain reconciliation state and must not be falsely marked cancelled.

## Recovery configuration

The public arming flag may be disabled without removing the guided recovery path. During a release lock or emergency shutdown, retain the non-secret public identifiers required to locate and revoke authority:

- `NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR`;
- `NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID`;
- `NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID`.

Keep `NEXT_PUBLIC_RMT_LIVE_POSITION_GUARD_ENABLED=false` until the release gate is complete. Removing the public identifiers prevents the client from constructing guided onchain cancellation, allowance cleanup, and signer revocation controls. They should be removed only after every known order is terminal, every transaction is reconciled, and affected wallets have had adequate time to clear authority.

## Required test evidence

Before activation, automated, fork, policy, and canary evidence must prove:

- exact allowance is accepted and oversized or undersized allowance is rejected;
- insufficient balance is rejected;
- the registered order exactly matches the prepared plan;
- order IDs cannot be reused;
- pool substitution is rejected;
- high-water mark rises but never moves backward;
- one checkpoint cannot trigger and execute in the same block;
- confirmation requires the configured time and another block;
- recovered and stale confirmations reset safely;
- weak minimum output is rejected against TWAP;
- cancellation and expiry end onchain execution eligibility;
- unsupported transfer behavior, reentrancy, and router reverts do not leave custody or consume the order;
- an unresolved order cannot be replaced;
- a terminal order without onchain and wallet cleanup evidence cannot be replaced;
- an allowance changed after arming stops evaluator execution;
- a lower balance does not produce a partial exit;
- stale submitted transactions enter review without an automatic retry;
- more orders than one evaluator batch are eventually selected fairly;
- an in-flight transaction remains under reconciliation after future authority is removed;
- a second browser with no local storage can discover the record and complete cancellation and cleanup.

Until those checks are attached to the release record, automatic execution remains disabled.
