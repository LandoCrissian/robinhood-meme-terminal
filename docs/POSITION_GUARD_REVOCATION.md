# Position Guard revocation and in-flight reconciliation

Automatic Position Guard exits use two separate wallet permissions:

1. an ERC-20 allowance from the protected wallet to the fixed executor contract; and
2. a Privy additional signer constrained by the production policy.

Revocation must address both permissions. Cancelling only the database order is not sufficient, and disabling the evaluator is not a substitute for removing wallet authority.

## User-facing revocation sequence

The RMT client performs revocation in this order:

1. submit `approve(executor, 0)` for the protected token and wait for a successful receipt;
2. call Privy `removeSigners` for the embedded wallet;
3. request cancellation of the server-side order record;
4. preserve and display any transaction already in `executing` or `submitted` state until its chain result is reconciled.

Privy’s current `removeSigners({ address })` client method removes **all additional signers on that embedded wallet**, not only the Position Guard signer. The interface must disclose this before authorization and revocation. RMT must not imply that it can selectively remove only one signer through this method.

## Fail-closed behavior

New automatic-exit authority is blocked when:

- the public arming flag is disabled;
- the server configuration is incomplete;
- the evaluator heartbeat is stale;
- order status cannot be verified;
- the embedded wallet or identity cannot be verified.

Emergency wallet revocation remains available when the evaluator is offline or the automatic-exit release is locked, provided the public executor, policy, and signer identifiers remain configured.

During an emergency shutdown, disable the arming flag and worker, but retain:

- `NEXT_PUBLIC_RMT_POSITION_GUARD_EXECUTOR`;
- `NEXT_PUBLIC_RMT_POSITION_GUARD_POLICY_ID`;
- `NEXT_PUBLIC_RMT_POSITION_GUARD_SIGNER_ID`.

Removing those public identifiers also removes the application’s guided revocation path. They should remain published until every affected wallet has been given sufficient time and notice to revoke.

## Cancellation race

A transaction may already be signed or broadcast when a user begins revocation. Clearing the allowance and additional signers prevents future authority, but it cannot reliably cancel a transaction already accepted for submission.

The order API therefore uses three cancellation dispositions:

- `cancel`: orders that are not in flight are marked `cancelled`;
- `reconcile`: `executing` or `submitted` orders retain their status and record a revocation request while receipt reconciliation continues;
- `review`: an unknown state is moved to `review_required` instead of being falsely represented as cancelled.

The interface must say that an in-flight exit may still settle. It should display the transaction hash when known and must not replace an unknown chain result with a success message.

## Operational verification

Before production activation, rehearse all of the following with a dedicated test wallet:

- revoke while an order is active but not triggered;
- revoke while the evaluator heartbeat is stale;
- revoke with the public arming flag disabled;
- revoke while execution is in progress but before a transaction hash is returned;
- revoke after a transaction hash exists but before receipt confirmation;
- verify that an in-flight transaction remains reconciled after revocation;
- verify that an order with no transaction is cancelled;
- verify the token allowance is zero;
- verify all additional signers are removed;
- verify the UI accurately distinguishes wallet authority removed, server record updated, transaction pending, transaction confirmed, and review required.

## Incident language

Use precise language:

- **Wallet authority removed** means the token allowance was cleared and Privy removed all additional signers.
- **Order cancelled** means the server record was cancellable and is no longer eligible for evaluation.
- **Revocation pending reconciliation** means future authority was removed but an already-authorized transaction may still confirm.
- **Review required** means RMT cannot prove the final chain outcome and will not retry automatically.

Never use “cancelled” or “revoked” to imply that a transaction already submitted to Robinhood Chain cannot settle.
