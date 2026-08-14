# RMT historical external-cost valuation

**Status: PAPER ONLY — verified conversion of separately denominated costs**
**Admitted:** 2026-08-14

`buildPaperExternalCostValuation()` converts non-quote paper costs such as Robinhood native ETH gas into the Arena quote asset without guessing a current price or assuming native ETH is an ERC-20 token.

## Event authority

External cost events originate from the canonical fill-derived `PaperPositionBookRecord` and retain:

- fill ID;
- cost kind (`FEE` or `GAS`);
- source asset ID;
- exact atomic amount;
- occurrence timestamp.

One external-cost valuation requires exactly one conversion evidence record for every such event.

## Conversion evidence

Each conversion binds:

- exact fill ID and cost kind;
- exact source asset and atomic amount;
- Arena quote asset;
- converted quote-asset amount;
- verified source identity;
- source observation timestamp;
- bounded raw source-evidence fields;
- raw source-evidence hash;
- final conversion-evidence hash.

The source observation must fall within the versioned policy's maximum time distance from the original cost event.

This is intended to support a later historical oracle/market adapter. The core valuation layer does not itself invent an ETH/USD or ETH/USDG price.

## Fail-closed behavior

The layer rejects:

- missing event conversions;
- duplicate conversions;
- wrong fill/kind/asset/amount;
- wrong quote asset;
- source observations too far from the cost event;
- tampered raw evidence;
- mixed or invalid aggregate totals.

## Arena use

A cost-bearing gross Arena record remains provisional until the required historical cost evidence exists. Once every event is valued, a separate net-performance record may subtract those costs exactly once.

No cost conversion grants order, wallet, signing or live-execution authority.