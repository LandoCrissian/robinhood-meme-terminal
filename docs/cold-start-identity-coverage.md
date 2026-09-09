# Cold-start canonical browse identity coverage

## Evidence and limits

The frozen fixture captures 100 validated canonical pools and 82 unique non-native
token addresses from the authorized Preview read path at source
`4c3f9739e81d77be06fc541d8c0836df84c910c2`. Only 3 had durable browse identities.
All 82 resolved through the existing verified live identity reader. The real web
reader admitted 80 with live identity evidence and 3 when those live reads were
forced unavailable. The captured baseline uses real project admission; the
isolated cold/warm timing test admits the frozen identities to isolate the
identity-availability boundary. Existing positive-quarantine tests remain required.

This proves insufficient durable coverage, not loss of persisted records. It does
not establish that every missing Production identity has a legacy negative row.
No Production database inspection or mutation is claimed.

The separately observed eight-row curated response had
`INDEXED_INVENTORY_UNAVAILABLE`. That is an earlier indexer-read failure, not the
same boundary as a valid indexed page with sparse identities. Repairing identity
population cannot make an unreachable indexer available. Root fallback provenance,
unknown first-load counts, and loaded-window retention remain necessary.

The directory route's 22 local runtime dependencies are unchanged between
`b37e405dff587b12e512208854cbe969cfdf3287` and the authorized base. Dependency
versions and the lockfile are unchanged. No PR512 directory causal link was found.

## Existing population path and the correction

The indexer worker queues canonical pool tokens and periodically rescans the full
canonical token catalog. It writes verified identity metadata into the existing
compressed PostgreSQL identity shard. Web directory reads consume those records;
they do not write the shard. HTTP pool pagination is not the worker's population
boundary. Existing pruning removes addresses no longer in canonical inventory.

Previously an unsuccessful multicall field could become a permanent `i` entry.
The catalog scan skipped every stored entry, including those negative entries.
Consequently healthy later RPC reads could never recover that identity. The
regression reproduces this with the frozen token set and real production functions.

The worker now retries legacy negatives under its existing bounded scan/backoff,
uses bounded individual reads after aggregate field failures, and does not store
incomplete RPC reads as invalid identity evidence. Fully read but invalid metadata
remains inadmissible and retryable. Successful identities are published to the
reader only after the shard write succeeds; failed writes requeue their batch.

## Bounded initial backfill and rehearsal

There is deliberately no second live database writer, unauthenticated debug route,
new service, or database rewiring. The existing worker is the backfill mechanism.
After an independently authorized indexer release, its ordinary catalog scan
revisits previously skipped negative entries and unresolved canonical tokens.
It retains the configured per-cycle batch bound, five identities per aggregate,
two concurrent aggregate batches, finalized-block pinning, and existing backoff.
Ready durable identities are skipped, so repeated work is idempotent. A worker
restart reloads completed shards; it does not require a web request to rediscover
them. Do not run an independent shard-writing script alongside the worker.

Run the rehearsal without Production credentials:

```sh
pnpm --filter market-indexer test:server
```

The tests seed the exact observed three ready identities plus legacy negatives,
backfill through `refreshCanonicalTokenIdentityIndex`, restart the test reader,
and compare the same frozen addresses. They also cover generic multicall failure,
incomplete responses, invalid decimals, retry pacing, failed persistence,
idempotence, and bounded processing beyond a single shard/batch.

`cold-directory-coverage-proof.cjs` runs separate Node processes for sparse, cold,
and warm cases. It calls the same production shard reader and indexed directory
reader. Fully backfilled browse must publish within two seconds with zero live
identity calls, so a delayed or failed live identity RPC cannot block that set.

## Authority and release controls

Last-known browse identity is not fresh execution identity authority. Quote,
runtime, wallet, fee, approval, settlement, stock classification, and positive
project-quarantine verification are unchanged. No trade UX source is changed.

Production coverage remains sparse until an owner-authorized indexer deployment
and verified backfill actually occur. Test-storage coverage is not Production
coverage. Before a future web release, remeasure the same frozen Production token
set and require adequate durable coverage, healthy indexed reads, and fresh
desktop/mobile acceptance. No Production release is part of this PR.
