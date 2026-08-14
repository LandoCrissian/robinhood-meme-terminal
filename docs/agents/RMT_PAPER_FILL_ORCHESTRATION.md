# RMT guarded paper fill orchestration

**Status: PAPER ONLY — simulated fill mutation, no wallet or live authority**
**Admitted:** 2026-08-14

`PaperFillOrchestrationService` is the final mutation boundary for a simulated paper trade.

It cannot choose an asset, amount, strategy, route or cost policy. Those decisions must already be represented by independently validated evidence.

## Required evidence chain

A fill call requires all four artifacts:

1. a self-contained `PaperOrderSubmissionRecord` whose order is still represented as the immutable `PENDING` admission snapshot;
2. a validated `RmtPaperQuoteResult` with strictly verified quote evidence;
3. a `PaperFillCostPlan` that validates against that exact quote result;
4. cost-plan status `READY` with explicit `PaperExecutionCosts`.

The orchestrator refuses a fill when network gas is still pending.

## Exact identity checks

Before the writer is called, quote evidence must match the pending paper order exactly on:

- input asset ID;
- output asset ID;
- input amount.

The quote observation timestamp must not predate the paper order.

The underlying `AgentEngine.fillPaperOrder()` remains authoritative for its configured paper-fill delay, season window, quote expiry, price-impact limits and paper balances.

## Idempotency

The fill idempotency key is derived from:

- paper order ID;
- order-submission hash;
- quote-evidence hash;
- cost-plan hash.

The caller cannot choose the idempotency key.

Retries of the exact same evidence therefore reach the durable paper engine under the same mutation identity.

## Writer verification

A returned fill is accepted only if it exactly matches the admitted evidence on:

- order ID and quote ID;
- agent and paper account;
- input/output assets;
- exact input amount;
- protected output amount;
- provider identity;
- fill timestamp;
- quote evidence hash and full quote evidence;
- fee asset/amount;
- gas asset/amount.

A writer that changes any field is rejected.

## Self-contained record

`PaperFillOrchestrationRecord` retains the complete:

- order submission/admission/capacity evidence chain;
- quote comparison and selected evidence;
- cost plan;
- deterministic idempotency key;
- returned paper fill;
- canonical orchestration hash.

This allows later audit without reconstructing the decision from mutable current state.

## Explicitly absent

This boundary has no:

- private key;
- signer;
- wallet authorization;
- transaction calldata;
- RPC write;
- live execution;
- autonomous custody;
- production fee activation.

At this point RMT has the complete deterministic mechanics for a paper trade from admitted risk capacity through a simulated fill. The next agent feature should not widen execution authority; it should extend `PaperEvaluationService` with a separately validated **trade proposal** output so an untrusted model can propose `OPEN_POSITION` without being able to size, submit or fill an order itself.