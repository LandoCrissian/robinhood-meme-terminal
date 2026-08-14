# RMT paper position accounting

**Status: PAPER ONLY — deterministic fill-derived cost basis and realized P&L**
**Admitted:** 2026-08-14

`buildPaperPositionBook()` derives position state from canonical paper fills rather than trusting mutable UI balances or last-trade prices.

## Accounting model

For each non-quote asset, the position book tracks:

- current atomic quantity;
- remaining quote-asset cost basis;
- signed realized quote P&L;
- buy-fill count;
- sell-fill count.

Multiple buys accumulate quantity and quote cost basis. Sells use deterministic average-cost disposal:

```text
allocatedCost = floor(currentCostBasis * quantitySold / currentQuantity)
```

A full close allocates all remaining cost basis so rounding dust cannot survive a closed position.

## Cost handling

- route/provider token economics are already represented by protected fill output;
- quote-denominated separate costs, if present in a generic paper fill, are added to buy cost basis or subtracted from sell proceeds exactly once;
- non-quote costs such as Robinhood native ETH gas are accumulated separately in `externalCostsByAsset`;
- non-zero costs paid in the traded position asset are rejected in v1 because they would require an explicit net-quantity accounting contract.

External costs are not silently converted into quote P&L without verified FX evidence.

## Evidence requirements

Every fill must match its retained quote evidence exactly on assets, input/output amounts, provider, observation time and evidence hash.

The book rejects:

- duplicate fill IDs;
- account-mismatched fills;
- fills without exactly one quote-asset side;
- sells larger than derived position quantity;
- tampered quote evidence;
- closed positions with residual cost basis.

Fills are applied deterministically by `(filledAt, fillId)` ordering.

## Output

The self-contained book contains all derived positions, total signed realized quote P&L, external costs by asset, fill count and a canonical SHA-256 book hash.

It is an accounting primitive only; it does not create trades, quotes, orders or live transactions.
