# RMT Canonical Arena Valuation History

Status: append-only history store and authoritative Human risk-capacity path implemented. PAPER ONLY.

## Problem

A collection of individually valid valuation records is not sufficient for a fair Arena if a participant or caller can choose which records are presented to the risk engine.

Omitting a legitimate high-water mark can understate drawdown. Omitting an older loss baseline can understate rolling loss.

RMT therefore treats the valuation **timeline** as canonical evidence, not caller-selected input.

## Append-only store

`PaperCanonicalValuationHistoryStore` exposes only:

```text
put(canonical valuation)
list(stream, account)
```

There is no update or delete operation in the store interface.

The key is:

```text
streamId + accountId + valuedAt
```

First writer wins for that timestamp. Re-inserting identical evidence is idempotent. Attempting to place different valid evidence at the same timestamp fails.

## In-memory implementation

`InMemoryPaperCanonicalValuationHistoryStore` exists for deterministic paper tests and local architecture checks.

It validates every record and returns history in timestamp/revision order.

## PostgreSQL implementation

`PostgresPaperCanonicalValuationHistoryStore` stores:

- stream ID;
- account ID;
- valuation timestamp;
- engine revision;
- engine state hash;
- independent record hash;
- full canonical valuation JSON;
- creation timestamp.

Primary key:

```sql
(stream_id, account_id, valued_at_ms)
```

Writes take a per-stream/account PostgreSQL advisory transaction lock. `ON CONFLICT DO NOTHING` is followed by a read-back and full hash comparison, so a conflicting timestamp cannot silently replace the first record.

Reads recompute and verify the full record hash before returning evidence.

## Cadence policy

`HumanAuthoritativeRiskCapacityService` does not accept a valuation array from its caller. It loads the full account history from `PaperCanonicalValuationHistoryStore`.

It requires explicit:

- `maximumValuationGapMs`;
- `maximumLatestValuationAgeMs`.

The first canonical valuation must occur within the maximum gap after Arena entry. Every consecutive valuation gap must stay within policy. The latest valuation must also be sufficiently fresh when capacity is planned.

A missing checkpoint fails the request. RMT does not skip the gap and continue from a more favorable later valuation.

## History digest

The authoritative risk-capacity record hashes the complete ordered history using each valuation's:

- timestamp;
- revision;
- engine state hash;
- full canonical record hash.

That digest is retained in `HumanAuthoritativeRiskCapacityRecord`.

## Durable order authorization

`HumanAuthoritativePaperOrderSubmissionService` uses the **authoritative risk-capacity result hash** as the durable Human order authorization hash.

Therefore durable Human order authorization is transitively bound to:

```text
canonical durable state
+ Arena entry
+ complete stored valuation history
+ cadence policy
+ conservative risk snapshot
+ Human risk policy
+ capacity result
+ manual order admission
+ exact state/revision gate
```

A different history cannot reuse the same durable authorization without changing the request hash.

## Fill path

`HumanAuthoritativePaperFillOrchestrationService` carries the authoritative submission through the canonical Human fill path.

It retains the narrower Human risk-policy price-impact ceiling in addition to the shared RMT quote/fill safety checks.

## Current smoke coverage

`human-authoritative-paper-execution-smoke.ts` verifies:

- append-only identical replay;
- conflicting evidence at one timestamp rejected;
- complete 1,200 → 1,700 → 1,800 history admitted under a 600 ms gap budget;
- intentionally missing 1,700 checkpoint rejected under a 500 ms gap budget;
- history digest retained in risk authorization;
- authoritative Human PENDING order creation;
- Human-specific price-impact rejection;
- successful verified paper fill under the admitted policy.

## Production scheduling

The next production-facing step is a bounded valuation scheduler that writes canonical valuations to this store at the Arena cadence using RMT's verified quote source.

The scheduler must fail visibly on missed checkpoints; it must not backfill a historical quote by pretending it was observed earlier.

No live signer, wallet transaction, custody or real funds are introduced by this history store.
