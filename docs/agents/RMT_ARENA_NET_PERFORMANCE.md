# RMT Arena net performance

**Status: PAPER ONLY — cost-adjusted economic performance**
**Admitted:** 2026-08-14

`buildPaperArenaNetPerformance()` preserves the existing gross Arena performance record and layers verified external-cost valuation on top.

## Why this is separate

The gross record intentionally exposes trading performance before separately denominated costs. That is useful audit evidence, but it is not sufficient for fair ranking when a route incurred wallet-paid native gas.

The net record therefore retains:

- the complete gross `PaperArenaPerformanceRecord`;
- every historical external-cost valuation used;
- one external-cost policy hash when conversions are required;
- net performance metrics;
- its own canonical hash.

## Net metrics

For each canonical valuation checkpoint:

```text
net liquidation NAV
  = gross executable liquidation NAV
  - cumulative verified external cost in quote units
```

The record derives:

- latest gross liquidation NAV;
- latest cumulative external cost;
- latest net liquidation NAV;
- signed net quote return;
- signed net return bps;
- net maximum drawdown;
- gross trading P&L before external costs;
- net trading P&L after external costs;
- fill/valuation counts and elapsed time.

Maximum drawdown is recalculated from the full cost-adjusted NAV sequence, not copied from the gross record.

## Eligibility

A complete cost-adjusted record removes only the gross record's `UNCONVERTED_EXTERNAL_COSTS` reason. Any other provisional reason—such as insufficient valuation history or insufficient elapsed time—remains.

Every cost-bearing position-book checkpoint must have exactly one matching historical cost valuation. Missing conversion evidence fails closed rather than treating gas as zero.

Records with no external cost events naturally have zero cost adjustment.

## Ranking direction

The existing gross leaderboard remains a transparent pre-cost policy. A production competition that includes wallet-paid gas should use a separately versioned **net leaderboard policy** based on this record rather than silently changing the meaning of the existing leaderboard.

No part of net-performance accounting can create orders, sign transactions, or grant live execution.