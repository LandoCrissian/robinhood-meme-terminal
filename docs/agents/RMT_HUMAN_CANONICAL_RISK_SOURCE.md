# RMT Human Canonical Risk Source

Status: implemented as the product-facing Human Arena paper-risk source. PAPER ONLY.

## Why this layer exists

A deterministic risk formula is not sufficient if a caller can choose the inputs. Human paper risk therefore cannot rely on externally assembled values for exposure, trades today, daily loss or drawdown.

The canonical Human path derives those values from RMT's own durable paper state and canonical liquidation valuations.

## Source record

`HumanCanonicalRiskSnapshotRecord` retains:

- stream ID;
- current durable engine revision;
- full current engine snapshot;
- current engine state hash;
- immutable Arena entry;
- canonical valuation history used for the calculation;
- target position asset;
- rolling trade window;
- derived `PaperRiskSnapshot`;
- canonical source hash.

Validation re-derives the complete record from the retained evidence.

## Conservative NAV and exposure

Risk NAV uses the latest **executable liquidation NAV**.

It does not use a chart's last price or a caller-provided mark.

For every open position:

```text
conservativeExposure = max(
  remaining cost basis,
  executable full-position liquidation value
)
```

This prevents a losing or illiquid position from creating artificial buying capacity merely because its current liquidation value fell.

Portfolio exposure is the sum of those conservative position exposures. Target-position exposure is the same conservative value for the requested asset.

## Drawdown

Peak NAV is the maximum of:

- Arena starting NAV; and
- canonical liquidation NAV observations in the supplied canonical history.

```text
drawdownBps = ceil((peakNAV - currentNAV) / peakNAV × 10,000)
```

No drawdown is recorded when current NAV is at or above the peak.

## Rolling daily loss

The default rolling window is 24 hours.

The baseline is:

1. the most recent canonical valuation at or before `latestValuationTime - rollingWindow`; or
2. Arena starting NAV when the participant entered inside the rolling window.

If the participant entered before the rolling window and no qualifying historical valuation exists, derivation fails closed. RMT does not substitute a convenient newer baseline that would understate loss.

## Trade count

`tradesToday` is derived from canonical paper fills for the Human account inside the same rolling window.

It is not caller-supplied.

## Current-state binding

The latest valuation must match:

- the current durable engine revision; and
- the canonical hash of the current engine snapshot.

The current paper account must also match the account retained by that latest canonical valuation.

A stale valuation cannot authorize new capacity after the paper state changes.

## Canonical capacity

`HumanCanonicalRiskCapacityService` combines:

```text
canonical Arena entry
+ canonical valuation history
+ current durable paper state
        ↓
HumanCanonicalRiskSnapshot
        ↓
HumanPaperRiskCapacityPlanner
        ↓
HumanCanonicalRiskCapacityRecord
```

The result retains both the canonical source record and the independently re-derivable capacity plan.

## Product-facing submission

`HumanCanonicalPaperOrderSubmissionService` is the product-facing Human submit path.

It requires:

- manual Human order admission;
- exact revision/state gate;
- canonical Human risk-capacity record.

The canonical risk source must bind the **same revision and state hash** as the manual admission/gate.

The canonical risk-capacity result hash becomes the durable Human order authorization hash. Therefore the durable mutation journal binds the source evidence as well as the capacity result.

## Product-facing fill

`HumanCanonicalPaperFillOrchestrationService` wraps the shared Human fill orchestrator and additionally enforces:

```text
quote priceImpactBps <= admitted Human risk-policy maximumPriceImpactBps
```

This closes the gap where the global RMT safety ceiling could be looser than the Human Arena risk policy.

The underlying fill still uses the same verified quote evidence, paper delay, expiry, fee/gas accounting, season checks and balance mutation as Agent paper fills.

## Current verification coverage

Focused smoke coverage includes:

- canonical state/revision binding;
- conservative exposure from cost basis vs liquidation value;
- rolling trade count;
- daily loss;
- maximum drawdown;
- fail-closed missing daily-loss baseline;
- full canonical Human order submission;
- rejection of a route whose price impact is below the global safety ceiling but above the Human risk policy;
- successful verified Human fill under the narrower Human policy.

A dependency-free branch CI runner (`all-foundation-smoke.ts`) executes the complete Agent/Human paper foundation under Node 22 without package installation.

## Remaining production hardening

Canonical valuation records are cryptographically/state bound, but public Arena operation should also make the **valuation timeline authoritative and scheduled** rather than allowing a caller to choose which valid valuation records participate in drawdown/history calculations.

That means the next fairness boundary is an append-only canonical valuation-history store plus a bounded valuation cadence/gap policy.

No signer, private key, real wallet authorization, live funds, custody or contract deployment is introduced here.
