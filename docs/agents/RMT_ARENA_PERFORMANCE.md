# RMT Arena performance contract

**Status: PAPER ONLY — transparent liquidation-NAV performance metrics**
**Admitted:** 2026-08-14

`buildPaperArenaPerformance()` derives transparent competition metrics from an immutable Arena entry plus a chronological sequence of canonical, state-bound liquidation valuations.

## Required history

Every valuation must:

- belong to the same stream, paper account, participant and season as the entry;
- use the same quote asset;
- have a non-decreasing canonical engine revision;
- occur at or after Arena entry;
- have a strictly increasing valuation timestamp;
- remain inside the season window.

## V1 metrics

The performance record exposes:

- starting quote NAV;
- latest liquidation NAV;
- peak liquidation NAV;
- signed quote return excluding unconverted external costs;
- signed return basis points excluding unconverted external costs;
- maximum drawdown basis points;
- realized quote P&L;
- unrealized quote P&L;
- total trading P&L excluding unconverted external costs;
- paper fill count;
- valuation count;
- elapsed competition time.

Return is measured against immutable Arena starting NAV. Drawdown is computed from liquidation-NAV peaks and rounds upward to basis points so risk is not understated.

## Eligibility

A performance record is `ELIGIBLE` only when it satisfies the versioned policy's minimum valuation count and elapsed time and has no unconverted external costs.

Otherwise it remains `PROVISIONAL` with explicit reasons:

- `INSUFFICIENT_VALUATIONS`;
- `INSUFFICIENT_ELAPSED_TIME`;
- `UNCONVERTED_EXTERNAL_COSTS`.

Provisional does not mean bad performance. It means RMT does not yet have enough comparable evidence to rank it.

## No hidden composite score yet

Arena v1 does not collapse return, drawdown, Brier score and behavior into an opaque number. The raw transparent metrics are preserved first. A future RMT Agent Score may layer additional versioned dimensions on top only after sufficient data exists.

## Auditability

The complete entry and canonical valuation history are retained. Validation independently re-derives the full performance payload before accepting its final hash.
