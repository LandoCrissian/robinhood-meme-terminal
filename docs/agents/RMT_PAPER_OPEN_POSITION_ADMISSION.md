# RMT open-position paper admission

**Status: PAPER ONLY — composed admission evidence, no durable order mutation**
**Admitted:** 2026-08-14

`PaperOpenPositionAdmissionService` composes the deterministic security path from a canonical `OPEN_POSITION` agent run to an immutable paper-order admission.

```text
OPEN_POSITION agent run
        ↓
NAV-bps → atomic trade request
        ↓
current-state risk capacity
        ↓
ADMITTED or BLOCKED
        ↓
immutable order admission only when ADMITTED
```

## ADMITTED state

An `ADMITTED` record requires:

- a valid `PaperTradeRequestRecord`;
- a valid current-state `PaperTradeCapacityRecord` whose capacity plan is `ADMITTED`;
- a valid `PaperOrderAdmissionRecord`;
- the order admission's capacity-plan hash exactly matches the composed capacity plan.

The record retains all three evidence layers and a canonical record hash.

## BLOCKED state

A `BLOCKED` record requires:

- the same complete trade-request evidence;
- a valid current-state capacity record whose capacity plan is `BLOCKED`;
- `orderAdmission = null`.

A blocked record containing an order admission is structurally invalid.

This makes a balance/risk change after the model decision observable instead of silently ignored.

## Model authority

The model contributes only:

- `OPEN_POSITION` action;
- canonicalizable target asset;
- confidence;
- requested NAV basis points;
- bounded reasoning summary.

The model does not control atomic sizing, current balance admission, portfolio risk, slippage policy, order submission, quote selection or fills.

## Explicitly absent

This composed service has no:

- `submitPaperOrder` method;
- durable order mutation;
- market quote request;
- paper fill;
- signer/private key;
- wallet authorization;
- live execution.

A separate submission service may consume only an `ADMITTED` order-admission artifact; it must never accept the raw model proposal as an order.
