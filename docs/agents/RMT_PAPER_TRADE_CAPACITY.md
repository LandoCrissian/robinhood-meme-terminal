# RMT current-state paper trade capacity

**Status: PAPER ONLY — current-state risk admission, no order mutation**
**Admitted:** 2026-08-14

`PaperTradeCapacityService` is the only supported bridge from a validated `PaperTradeRequestRecord` into `PaperRiskCapacityPlanner`.

Its key purpose is to re-evaluate the model's earlier request against the **current** paper agent/account state before an order can exist.

## Stale-decision protection

The model's agent run retains the account snapshot it originally saw. That historical snapshot is audit evidence, not spend authority.

Capacity planning receives a fresh/current `AgentRecord` and `PaperAccountRecord`. The service requires those identities to match the stored run and passes the current account into the risk planner.

Example:

```text
model decision saw quote balance: 1,000
requested position: 4% NAV = 40

current balance before admission: 30

result: BLOCKED
maximum capacity: 30
admitted amount: null
```

The system does not silently resize 40 into 30.

## Exact mapping

The resulting capacity record proves that the risk plan maps exactly from the trade request on:

- agent and strategy version/hash;
- paper account;
- input/output assets;
- requested atomic amount;
- risk snapshot hash;
- exact market observation;
- request/planning timestamp.

The complete trade request, current agent/account snapshots and capacity plan are retained and hash-bound.

## Security boundary

This layer cannot create or submit an order. It only returns an `ADMITTED` or `BLOCKED` capacity plan from current state.

Non-paper/suspended execution state is rejected by the underlying risk planner.

## Explicitly absent

No:

- order mutation;
- quote request;
- fill;
- wallet signer;
- live execution;
- automatic amount clamping.
