# RMT paper risk-capacity boundary

**Status: PAPER ONLY — pure capacity planning, no order mutation**
**Admitted:** 2026-08-14

`PaperRiskCapacityPlanner` answers one bounded question:

> Given the exact admitted strategy, paper-account state, verified market identity and current risk snapshot, what is the maximum quote-asset amount this agent may spend on this position right now?

It does not decide that an agent should trade. It does not create an order. It does not call a quote provider. It does not fill anything. It does not submit a wallet transaction.

## Deterministic inputs

The planner binds:

- paper-only agent identity/state;
- immutable strategy version and recomputed strategy hash;
- current paper-account snapshot;
- tamper-checked `PaperRiskSnapshot`;
- verified `MarketObservationDraft` canonical asset identity + aliases;
- exact requested input amount;
- planning timestamp;
- RMT paper-capacity policy version;
- the RMT hard safety envelope.

Risk snapshots contain quote-asset atomic values only:

- mark NAV;
- current total portfolio exposure;
- current exposure to the requested position asset;
- open-position count;
- trades today;
- daily-loss bps;
- drawdown bps;
- capture timestamp.

No floating-point amount arithmetic is used for capacity. Monetary limits and headroom use `BigInt` and floor-rounded basis-point multiplication.

## Capacity calculation

For no-leverage paper v1:

```text
position_limit   = floor(mark_nav * max_position_bps / 10_000)
portfolio_limit  = floor(mark_nav * max_portfolio_bps / 10_000)

position_headroom  = max(0, position_limit - current_position_exposure)
portfolio_headroom = max(0, portfolio_limit - current_portfolio_exposure)

structural_capacity = min(
  available_quote_balance,
  position_headroom,
  portfolio_headroom
)
```

The planner then applies hard state gates:

- daily-loss limit;
- drawdown limit;
- maximum trades per day;
- maximum open positions when the requested asset would be a new position.

A hard-state gate reduces admissible capacity to zero.

## No silent sizing clamp

The requested amount is never silently reduced.

If:

```text
requested_input > maximum_admissible_input
```

then the plan is `BLOCKED`, the admitted amount is `null`, and `REQUEST_EXCEEDS_CAPACITY` is recorded. The caller may later submit a different explicit request, but this plan never rewrites the user's/model's request into a smaller trade.

This keeps the distinction clear:

```text
risk authority says what is allowed
        !=
strategy/model says what it wants
```

## Additional fail-closed invariants

- agent execution mode must remain `PAPER_ONLY`;
- agent must be paper-active / qualified / elite;
- strategy must belong to the agent and remain inside the RMT hard safety envelope;
- strategy hash is recomputed before limits are trusted;
- paper account must belong to the agent;
- risk snapshot must belong to the same account, be hash-valid, non-future and fresh;
- no-leverage v1 rejects portfolio exposure above mark NAV;
- per-position exposure cannot exceed total portfolio exposure;
- non-zero portfolio exposure requires at least one open position;
- requested market observation must exactly match the risk position asset;
- strategy include/exclude scope may match the observation canonical ID or its verified aliases;
- available quote balance is read from the exact paper-account snapshot;
- all plans are canonical SHA-256 hash-bound and tamper checked.

## Explicitly absent

`PaperRiskCapacityPlanner` has no:

- model decision authority;
- automatic target-allocation formula;
- silent amount clamp;
- quote-provider call;
- `submitPaperOrder` method;
- fill method;
- signer/private key;
- wallet submission;
- live execution path;
- leverage;
- production scheduler/deployment.

The next safe boundary is to define how a specific paper trade request becomes an **immutable proposed paper order** that binds a canonical evaluation run, an admitted capacity plan and strictly verified quote evidence—still without mutating the paper account or calling `submitPaperOrder`.