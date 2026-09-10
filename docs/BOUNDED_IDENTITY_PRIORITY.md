# Bounded canonical identity scheduling

Identity scheduling is not directory admission, activity classification, risk
classification, or execution authorization. No trading policy is changed.

The existing single canonical identity worker selects up to 2,000 distinct
nonzero token addresses from the newest 2,000 canonical pool events. Selection
uses the same block/log ordering as canonical browse pagination. Ties between
tokens use their address bytes. The input window is bounded before the SQL
deduplication and sort; the existing unique pool event index supports the
newest-first input scan.

This repository's pool rows do not provide trustworthy swap activity or current
liquidity quantities for ranking. Those signals are not inferred. Stock, RWA,
and curated tokens participate when present in the bounded canonical window;
their scheduling does not change their display or trading policies.

The selection refreshes every 15 minutes, not every worker tick. A failed
selection read retains the previous selection and permits background work.
Errors are reduced to a bounded unavailable classification without logging
database connection information.

There is only one pending queue and one shard writer. Priority is an ordering
over that queue, not a second writer. Four priority batches are followed by one
background batch when background work is eligible. If either lane is empty,
the other progresses immediately. READY identities and retry-backoff entries
are not selected. A background address promoted into priority is removed from
the same pending queue when selected. Existing shard persistence and failed
write requeue remain responsible for publication.

Concurrent refresh calls for the same worker pool share one promise, including
the persistence phase. On restart, priority is rebuilt from canonical rows and
READY identities remain loaded from the existing durable shard.

The existing complete canonical metadata rescan is retained. This change avoids
resolving historical identities before relevant identities; it does not claim
to eliminate the existing metadata catalog read. No historical token is deleted
or permanently excluded.

`readIdentityPriorityDiagnostics` exposes bounded scheduling counts and selection
timing to internal diagnostics. It does not expose credentials or identity
provider responses.
