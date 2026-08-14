# RMT Canonical Arena Valuation Scheduler

Status: bounded paper-only scheduler implemented with append-only history storage. No hidden timer and no historical backfill.

## Purpose

Authoritative risk history requires RMT to create canonical valuation checkpoints itself. A caller cannot be allowed to supply a favorable subset, and a missed scheduler run cannot be repaired by fetching a current quote and pretending it was observed in the past.

`PaperCanonicalValuationScheduler` therefore exposes only bounded `runOnce()` execution.

## Inputs

The scheduler is configured with:

- durable `AgentStateStore`;
- append-only `PaperCanonicalValuationHistoryStore`;
- read-only `PaperCanonicalLiquidationQuoteSource`;
- stream ID;
- valuation cadence;
- maximum lateness;
- maximum quote age;
- maximum open-position count.

Each run receives the immutable Arena entry and the current observation time.

## Due logic

The next checkpoint is based on the latest stored canonical valuation, or Arena entry when history is empty:

```text
nextDue = lastObservedValuation + cadence
```

Before `nextDue`, the scheduler returns `NOT_DUE` and does not quote.

Once due, the scheduler may execute only inside the configured lateness budget.

If:

```text
now - nextDue > maximumLateness
```

it fails with a missed-checkpoint error.

It does **not** backdate `valuedAt` and does not request a current market quote on behalf of the missed historical time.

## Full-position liquidation quotes

The scheduler loads current canonical paper state and rebuilds the account position book from canonical fills.

For every open position it requests exactly one quote for:

```text
entire current position quantity -> Arena quote asset
```

The returned `RmtPaperQuoteResult` must exactly match the canonical asset IDs and full quantity.

Cash-only accounts require no fake market quote.

## State-race protection

The scheduler hashes and records the engine revision/state before requesting position quotes.

After quote collection, `PaperCanonicalValuationService` reloads the canonical state and produces a state-bound valuation. The scheduler refuses to store it when revision/state hash differs from the state that initiated the checkpoint.

A trade or other paper mutation racing the quote collection therefore cannot silently produce a checkpoint for mixed state.

## Append-only write

Successful valuation is written through `PaperCanonicalValuationHistoryStore`.

The history store is first-writer-wins for:

```text
stream + account + actual valuation timestamp
```

A duplicate identical record is idempotent. Different evidence for the same timestamp fails.

## No hidden daemon

Like the Agent evaluation scheduler, this component does not install `setInterval`, cron or a background process itself.

Deployment infrastructure may call `runOnce()` on a bounded schedule. The scheduler contract remains deterministic and observable.

## Smoke coverage

`paper-canonical-valuation-scheduler-smoke.ts` verifies:

1. before the first due checkpoint, status is `NOT_DUE` and quote source is untouched;
2. a cash-only due checkpoint stores NAV without fabricating a quote;
3. after a canonical Human fill, the next checkpoint requests the full current position quantity;
4. protected liquidation output is used to calculate the canonical NAV;
5. history contains both checkpoints;
6. running 101 ms late against a 100 ms lateness budget fails with the explicit no-backfill error;
7. no extra quote or valuation is written after that failure.

A dependency-free GitHub Actions workflow runs this scheduler smoke directly under Node 22.

## Production adapter boundary

The quote source is injected and read-only. The scheduler does not know a signer, private key, wallet authorization payload or transaction method.

A production RMT adapter should map canonical asset IDs to the verified VNext quote reader and return only strictly verified paper quote results.

No live funds or custody are introduced by this scheduler.
