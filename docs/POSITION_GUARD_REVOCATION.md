# Position Guard revocation and in-flight reconciliation

Automatic Position Guard V2 uses three separate authority and state boundaries:

1. a wallet-registered order inside the fixed executor contract;
2. an ERC-20 allowance from the protected wallet to that executor; and
3. a Privy additional signer constrained by the production checkpoint-and-execute policy.

The server order record coordinates the system but is not itself wallet authority. Revocation must address all applicable onchain and wallet boundaries. Cancelling only the database order, clearing only the allowance, removing only the signer, or disabling only the evaluator is incomplete.

## User-facing revocation sequence

The RMT client performs revocation in this order:

1. read the registered order using the order ID stored in the authenticated inventory;
2. when the order is still `Active`, submit `cancelV3Order(orderId)` from the protected wallet and wait for a successful receipt;
3. verify the order is `Cancelled`, `Executed`, or `Expired` onchain;
4. submit `approve(executor, 0)` for the protected token when allowance is nonzero and verify the resulting allowance is zero;
5. call Privy `removeSigners` for the matching embedded wallet;
6. request cancellation or reconciliation of the server-side order record;
7. preserve and display any transaction already in `executing` or `submitted` state until its chain result and registered-order status are reconciled.

Privy’s current `removeSigners({ address })` client method removes **all additional signers on that embedded wallet**, not only the Position Guard signer. The interface must disclose this before authorization and revocation. RMT must not imply that it can selectively remove only one signer through this method.

## Independent server verification

The cancel endpoint must not trust a client success message as proof of cleanup. It independently reads:

- the token allowance from wallet to executor;
- the registered order from the executor using wallet and order ID;
- the existing server status and any in-flight transaction record.

A non-flight order may be marked `cancelled` only when the onchain order is closed and wallet cleanup was reported with allowance independently proven zero. Otherwise the record moves to `review_required` with a specific reason such as:

- `onchain_order_not_closed`;
- `wallet_authority_not_cleared`;
- `cancellation_unknown_state`.

Signer removal currently cannot be independently queried through the same onchain read, so its evidence comes from the Privy operation and release/canary inspection. That remaining trust boundary must not be described as an onchain proof.

## Fail-closed behavior

New automatic-exit authority is blocked when:

- the public arming flag is disabled;
- the server configuration is incomplete;
- the evaluator heartbeat is stale;
- order status cannot be verified;
- the embedded wallet or identity cannot be verified;
- the registered order does not exactly match the server plan;
- the onchain order or a prior cleanup remains unresolved.

Emergency cancellation and wallet cleanup remain available when the evaluator is offline or the automatic-exit release is locked, provided the public executor, policy, and signer identifiers remain configured.

During an emergency shutdown, disable the arming flag and worker, but retain:

- `NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR`;
- `NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID`;
- `NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID`.

Removing those public identifiers also removes the application’s guided order-cancellation, allowance-cleanup, and signer-removal path. They should remain published until every affected wallet has been given sufficient time and notice to revoke.

## Cancellation race

A transaction may already be signed or broadcast when a user begins revocation. Onchain order cancellation, clearing allowance, and removing additional signers prevent future submissions, but they cannot reliably cancel a transaction already accepted for submission.

The order API therefore uses three cancellation dispositions:

- `cancel`: orders that are not in flight can become `cancelled` only after onchain order closure and wallet cleanup are proven;
- `reconcile`: `executing` or `submitted` orders retain their status and record a revocation request while receipt and registered-order reconciliation continue;
- `review`: an unknown state, incomplete onchain cancellation, or incomplete wallet cleanup moves to `review_required` instead of being falsely represented as cancelled.

The interface must say that an in-flight exit may still settle. It should display checkpoint and execution transaction hashes when known and must not replace an unknown chain result with a success message.

A successful execution receipt is reconciled against the registered order. If the receipt succeeds but the executor order is not `Executed`, the record moves to review rather than assuming the exit completed correctly.

## Expired and executed orders

An order being `Expired` or `Executed` ends contract execution eligibility, but it does not by itself prove all wallet authority is gone.

- Exact allowance normally falls to zero after a successful full-amount execution, but the evaluator and Protection Center still verify it.
- An expired order can retain its exact allowance indefinitely until the wallet clears it.
- A cancelled order can also retain allowance until `approve(executor, 0)` confirms.
- Any terminal order with residual allowance enters `review_required`.
- Additional signers must still be removed through Privy cleanup.

## Operational verification

Before production activation, rehearse all of the following with a dedicated test wallet:

- revoke while an order is active but not triggered;
- revoke while a first below-floor checkpoint is confirming;
- revoke after a trigger is eligible but before execution submission;
- revoke while the evaluator heartbeat is stale;
- revoke with the public arming flag disabled;
- revoke while execution is in progress but before a transaction hash is returned;
- revoke after a transaction hash exists but before receipt confirmation;
- verify that an in-flight transaction remains reconciled after future authority is removed;
- verify that a non-flight order is cancelled onchain before the server marks it cancelled;
- verify the token allowance is zero;
- verify all additional signers are removed;
- verify an expired order with residual allowance requires cleanup;
- verify an executed order is matched to the successful receipt and registered order status;
- verify a second browser with no local storage can recover the order and perform the complete sequence;
- verify the UI accurately distinguishes onchain order closed, allowance zero, signers removed, server record updated, transaction pending, transaction confirmed, and review required.

## Incident language

Use precise language:

- **Onchain order closed** means the executor order is proven `Cancelled`, `Executed`, or `Expired`.
- **Allowance cleared** means the ERC-20 allowance from wallet to executor is proven zero onchain.
- **Additional signers removed** means the Privy cleanup call completed; current client behavior removes all additional signers on that embedded wallet.
- **Wallet authority removed** means allowance is zero and Privy signer cleanup completed.
- **Order cancelled** means the onchain order is closed, wallet cleanup is complete, the server record was cancellable, and no transaction remains in flight.
- **Revocation pending reconciliation** means future authority may be removed but an already-authorized transaction may still confirm.
- **Review required** means RMT cannot prove the final order, wallet, or chain outcome and will not retry automatically.

Never use “cancelled” or “revoked” to imply that a transaction already submitted to Robinhood Chain cannot settle. Never claim signer removal is onchain proof.
