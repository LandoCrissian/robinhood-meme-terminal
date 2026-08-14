# RMT paper liquidation NAV

**Status: PAPER ONLY — executable-value portfolio accounting**
**Admitted:** 2026-08-14

`buildPaperLiquidationValuation()` values open paper positions by what the full current quantity can actually receive from a fresh, strictly verified RMT/VNext-style quote back into the account quote asset.

It does not use last trade price or an unbounded spot-price multiplication.

## Liquidation rule

For every open position, valuation requires exactly one quote where:

- quote input asset = canonical position asset;
- quote input amount = the **entire current position quantity**;
- quote output asset = the paper account quote asset;
- protected output is the liquidation value;
- quote is valid, unexpired and within the explicit valuation freshness window.

Partial-size quotes do not value a full position.

## Account reconciliation

The self-contained valuation retains the full `PaperPositionBookRecord` and current `PaperAccountRecord`.

For every open position, current account balance must exactly equal the quantity derived from canonical fills. Quote-asset balance comes from that same current account snapshot.

Liquidation NAV is:

```text
current quote balance
+ sum(full-position protected liquidation outputs)
```

## P&L

- realized quote P&L must exactly equal the position book;
- unrealized quote P&L is `liquidation value - remaining quote cost basis`;
- total quote P&L is realized + unrealized;
- separately denominated costs such as native ETH gas remain disclosed in `externalCostsByAsset` and are **not** silently converted into quote P&L.

This keeps quote-denominated trading performance distinct from costs that still require verified FX valuation.

## Anti-inflation properties

The valuation fails on:

- stale or expired liquidation quotes;
- a quote for less than the full position;
- missing quote for an open position;
- extra quote for a non-open position;
- duplicate quote evidence;
- current account/position-book quantity disagreement;
- tampered retained position book or quote result;
- inconsistent P&L or NAV arithmetic.

A closed position requires no synthetic market value.

This is the preferred future Arena valuation basis because thin liquidity directly reduces liquidation NAV instead of allowing an inflated last-price mark to dominate rankings.
