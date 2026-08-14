# RMT paper trade request derivation

**Status: PAPER ONLY — deterministic sizing request, no order mutation**
**Admitted:** 2026-08-14

`buildPaperTradeRequest()` is the deterministic bridge between a stored `OPEN_POSITION` agent run and risk-capacity planning.

The model does not choose an atomic token amount. Its admitted output is limited to a canonical target asset and `requestedPositionBps` of paper NAV.

## Sizing rule

The atomic quote-asset request is derived with integer arithmetic:

```text
requestedInputAmountAtomic = floor(markNavAtomic * requestedPositionBps / 10_000)
```

No JavaScript floating-point money math is used.

A request that rounds to zero atomic units is rejected.

## Evidence requirements

The layer revalidates:

- the complete agent run and run hash;
- `OPEN_POSITION` action and canonical target asset;
- the exact strategy version and recomputed strategy hash;
- requested bps is positive and no greater than the strategy position limit;
- risk snapshot belongs to the same paper account;
- risk snapshot target equals the canonical proposal target;
- risk snapshot was captured at or after the model decision;
- request timestamp is at or after the risk snapshot and within the configured freshness window;
- the retained market observation is exactly the observation from the agent run.

The result retains the full run, strategy, risk snapshot and market observation and is canonical SHA-256 hash-bound.

## Authority boundary

This layer answers only:

> What exact atomic quote-asset amount corresponds to the model's admitted NAV-bps request under this post-decision risk snapshot?

It does not decide whether current paper balance or portfolio limits can still support that amount. That remains the separate current-state capacity step.

## Explicitly absent

No:

- order creation;
- quote request;
- fill;
- wallet/signing authority;
- RPC write;
- live execution.
