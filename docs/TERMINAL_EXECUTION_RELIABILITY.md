# RMT Terminal Execution Reliability Standard

Status: implementation draft

Scope: public Sushi and Uniswap trade preparation and transaction reconciliation. This document does not authorize autonomous Position Guard deployment.

## Product objective

RMT should optimize for a trader knowing exactly what happened, what remains uncertain, and whether another transaction is safe to submit.

The execution loop is:

> Quote → simulate → wallet review → submit once → reconcile → confirm or explain

A fast interface is not reliable if a timeout is presented as failure, a reverted receipt is presented as success, or a page refresh removes the only visible transaction hash.

## Recurring user-feedback patterns

Public documentation and user support material from established onchain terminals repeatedly center the same operational problems:

1. **A timeout is not proof of failure.** A transaction can already be accepted or confirmed while an RPC or interface is still waiting. The trader must retain the hash and check chain state before resubmitting.
2. **Slippage and priority settings need explicit consequences.** Low slippage can protect the order while increasing failure probability in a moving market. Higher priority can improve inclusion without guaranteeing execution.
3. **Simulation failures need a reason, not a generic disabled button.** Gas estimation, insufficient balance, route loss, approval state, and token reverts require different recovery actions.
4. **Duplicate submission is a real failure mode.** Wallet, nonce, and “already known” responses may indicate that an earlier transaction remains in flight.
5. **Displayed valuation is not executable value.** The route quote, protected minimum, liquidity depth, and exact transaction simulation remain the authoritative trade evidence.

RMT improves on these patterns by retaining strict execution boundaries while making uncertainty explicit.

## Required behavior

### Quote preparation

- Every quote is bound to the authenticated identity, selected wallet, token, pool, venue, side, and exact input amount.
- Transient network, rate-limit, and upstream service failures may receive one bounded retry before the UI reports failure.
- Deterministic business-rule failures are not repeatedly retried.
- Every request has a timeout.
- Quote freshness is evaluated by a live clock, not only when another React state change happens.
- When the protected signing window expires, RMT invalidates the old quote and requests a new one.
- RMT never widens slippage automatically to rescue a quote.

### Exact preflight

Before wallet review, the exact approval or swap transaction must have:

- a valid destination;
- validated calldata;
- the required value;
- a successful gas estimate;
- a usable gas price;
- a positive network-fee estimate.

Transient RPC failure may be retried once. A deterministic revert remains blocked.

### Wallet review

RMT distinguishes:

- wallet rejection;
- insufficient balance;
- approval failure;
- simulation failure;
- stale quote;
- route loss;
- duplicate or nonce conflict;
- public transaction submission.

A wallet rejection means nothing was submitted. A returned transaction hash changes the state to reconciliation and disables duplicate submission.

### Receipt interpretation

A successful receipt query is not the same as a successful EVM transaction.

RMT must check the receipt status explicitly:

- `success` → confirmed;
- `reverted` → failed;
- RPC error with a known hash → confirmation unavailable, keep reconciling;
- no hash and wallet rejection → no transaction submitted.

### Refresh recovery

RMT stores a bounded local journal containing only what is needed to recover a public transaction:

- wallet;
- token;
- pool identifier;
- venue;
- side;
- input amount;
- transaction hash;
- state and timestamps.

A submitted transaction remains recoverable for 24 hours for the exact wallet, token, venue, and side. Completed local history is pruned after seven days and capped at 24 records.

Local recovery is not cross-device synchronization and does not create custody. The user can always inspect the public hash on Blockscout.

### Failure taxonomy

RMT maps wallet and RPC output into actionable classes:

| Code | Meaning | Default action |
| --- | --- | --- |
| `user-rejected` | Wallet request declined | Review and reopen the wallet |
| `insufficient-funds` | Input or gas reserve unavailable | Reduce or fund the order |
| `slippage` | Protected minimum unavailable | Request a fresh quote or reduce size |
| `allowance` | Exact authority missing | Recheck approval receipt |
| `route-unavailable` | Pool cannot satisfy order | Change venue, reduce size, or wait |
| `simulation-failed` | Exact transaction cannot be proven | Do not sign; refresh and inspect evidence |
| `network` | Receipt or RPC status uncertain | Do not resubmit; reconcile the hash |
| `nonce-or-duplicate` | Earlier transaction may exist | Check history before another submission |
| `reverted` | EVM reverted after submission | Inspect receipt and prepare a new quote |
| `unknown` | No safe automatic interpretation | Check explorer and copy diagnostics |

Raw technical responses may be disclosed, but the primary message must state what happened and the safe next action.

## Behavior measurement

RMT extends its existing opt-in, once-per-browser-session anonymous funnel with:

- quote ready or failed;
- preflight passed or blocked;
- wallet review started or declined;
- transaction submitted;
- pending transaction recovered after refresh;
- transaction confirmed or failed;
- execution-status explanation marked clear or unclear.

The event contains only the stage, desktop/mobile class, and schema version. It does not contain wallet, token, amount, hash, route, search, profile, cookie, or persistent visitor identifier.

This data is used to find drop-off and confusion, not to profile traders or infer financial performance.

## Non-negotiable boundaries

- No custody.
- No automatic transaction resubmission.
- No silent slippage widening.
- No unlimited approval introduced by recovery logic.
- No treating a receipt-query timeout as a failed trade.
- No treating a reverted receipt as success.
- No hiding the transaction hash once it exists.
- No autonomous Position Guard activation through this work.

## Release acceptance

The reliability pass is mergeable only after:

1. quote deduplication, timeout, and retry tests pass;
2. local transaction-journal tests pass;
3. wallet rejection, approval revert, swap revert, RPC outage, refresh recovery, and confirmation states are rehearsed;
4. Sushi and Uniswap transaction-integrity tests remain green;
5. TypeScript and production build are green;
6. desktop and mobile execution rails show readable, non-overlapping state cards;
7. a human verifies that unresolved hashes cannot be submitted twice.
