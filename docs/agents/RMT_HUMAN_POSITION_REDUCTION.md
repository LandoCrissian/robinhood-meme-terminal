# RMT Human Authoritative Position Reduction

Status: full and partial Human paper position reduction implemented. PAPER ONLY.

## Why reduction is separate from opening capacity

Opening a new position increases risk and must be subject to position, portfolio, loss, drawdown, trade-count and open-position capacity gates.

Closing or reducing an existing position lowers market exposure. Blocking a valid exit because the account has already hit a loss or drawdown threshold would be counterproductive.

RMT therefore treats reduction as a separate risk-reducing authorization path.

## Authoritative reduction plan

`HumanAuthoritativePositionReductionService` loads:

- current durable paper state;
- append-only canonical valuation history;
- current Human account;
- latest canonical position book;
- configured Human risk/slippage/price-impact policy.

It requires the latest canonical valuation to match the current engine revision and state hash.

The requested input asset must be an existing open position. The current paper account balance must exactly equal the canonical position quantity.

A reduction may request any positive quantity up to that current quantity:

```text
0 < requestedReduction <= canonicalPositionQuantity
```

No silent clamping is performed.

The record retains:

- authoritative valuation history and digest;
- current revision/state hash;
- exact current position quantity;
- requested quantity;
- remaining quantity;
- full-close flag;
- Human risk policy and RMT safety envelope;
- slippage and price-impact limits;
- canonical result hash.

## Risk gates

Daily-loss, drawdown, open-position and new-exposure capacity gates do **not** prevent a position reduction.

This is intentional: the action reduces exposure.

The reduction still enforces:

- exact canonical position ownership/quantity;
- current-state freshness;
- authoritative valuation-history cadence;
- requested slippage policy;
- maximum price-impact policy;
- verified quote evidence;
- paper fill delay and expiry;
- exact costs;
- sufficient paper token balance;
- season window.

## Durable submission

`HumanAuthoritativePositionReductionSubmissionService` requires:

```text
authoritative reduction plan
+ manual Human admission
+ exact revision/state gate
```

The manual admission must be exactly:

```text
position asset -> Arena quote asset
```

with the same quantity and slippage as the authoritative reduction plan.

The reduction result hash becomes the durable order authorization hash.

The dedicated idempotency namespace is:

```text
human-paper-reduction:<admissionId>
```

## Verified fill

`HumanAuthoritativePositionReductionFillService` requires:

- PENDING Human reduction order;
- exact position-to-quote route;
- exact full/partial reduction input amount;
- strictly verified `RmtPaperQuoteResult`;
- READY `PaperFillCostPlan`;
- quote price impact at or below the Human risk-policy ceiling.

The underlying balance mutation is still `DurableAgentEngine.fillHumanPaperOrder()`, so reduction uses the same canonical paper fill machinery as other Human paper trades.

## Accounting

Because the resulting fill is a normal canonical Human paper fill, `buildPaperPositionBook()` automatically applies average-cost disposal and realized P&L.

A complete close leaves:

```text
position quantity = 0
remaining cost basis = 0
realized P&L = net quote proceeds - allocated cost basis
```

## Smoke coverage

`human-authoritative-position-reduction-smoke.ts` proves:

1. a Human account has a canonical 490-unit open position with 200 quote units of cost basis;
2. full-position executable liquidation evidence is stored;
3. an authoritative full-close plan admits exactly 490 units;
4. the manual Human admission/gate matches that reduction;
5. a 200 bps route is rejected when Human policy allows only 150 bps even though global safety allows more;
6. a verified lower-impact route fills 490 position units for 220 quote units;
7. final paper balances are 1,020 quote / 0 position;
8. canonical position accounting reports quantity 0, cost basis 0 and realized P&L +20.

A dependency-free GitHub Actions workflow executes this focused smoke under Node 22.

## Agent parity

The Agent model path does not yet expose first-class `CLOSE_POSITION` proposal execution. That is now the next logical convergence step: Agents should receive an equivalent risk-reducing close/reduce path using the same canonical position history and verified fill mechanics.

No live wallet, signer, custody or real capital is introduced here.
