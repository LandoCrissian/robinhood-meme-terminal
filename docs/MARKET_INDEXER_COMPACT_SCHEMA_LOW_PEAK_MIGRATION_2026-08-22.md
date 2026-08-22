# Market indexer compact-schema low-peak migration

**Status:** CODE AND DISPOSABLE-POSTGRES PROOF ONLY

**Benchmark base:** `0ca982797fc9cac5b5fb9dc7a1111dd12b6dcfff`

**Production migration authorized:** no

This document records the implementation and local proof for issue #421. It
does not authorize a Railway deployment, a live writer stop, a production DDL
operation, a storage-limit increase, canonical browse, authority, or production
traffic.

## Result

The compact v3 runtime implements the benchmark winner:

- one exact reviewed source code for each of the seven manifest sources;
- binary 20/32-byte pool identities and 20-byte token identities;
- source-version-bound packed attributes;
- exact 64-byte transaction/block provenance;
- exact native uniqueness on `(source_code, pool_key)`;
- exact event uniqueness and pagination on `(block_number, log_index)`;
- V2/V3 pool address derived from the 20-byte key;
- V4 PoolId retained as bytes32 with `poolAddress: null`;
- newest 64 sync points retained per source.

The public `/v1/pools` row shape is unchanged. Transaction index remains an
internal v2 migration input and is not exposed. The opaque cursor is version 2
and binds the same source/token/pool filters to block/log coordinates.

## Mandatory writer-stop boundary

The migration executable requires exact affirmative acknowledgements for:

- writer stopped;
- shadow mode;
- authority false;
- production traffic false;
- activation lock enabled;
- separately authorized old-relation cleanup.

The executable holds a dedicated migration advisory lock. Checkpoints are
captured before any DDL, checked after the copy, and locked/rechecked in the
cutover transaction. The cutover writes schema marker `3001`. Normal startup
explicitly rejects that marker with `writer must remain stopped`.

Schema version `3` is written only after all of the following succeed:

1. the compact relations pass equivalence validation;
2. the short transactional name swap commits;
3. the compact current relations pass post-cutover checks;
4. the old full relations are dropped;
5. PostgreSQL proves those old relations are absent;
6. `pg_database_size` proves actual reclamation and the hard-limit reserve.

The future writer must not restart between any of these steps. Each committed
boundary is recorded in a small logged migration-state relation and
cross-checked against PostgreSQL relation layouts, constraints, source
bindings, checkpoints, row counts, and evidence fingerprints. Process death
therefore leaves a deterministic recovery phase rather than relying on local
process memory.

## Low-peak sequence

The writer-stopped sequence is:

1. capture logical bytes, pool rows, relation sizes, exact seven-source
   manifest/checkpoints, storage mode, and exact v2 index/constraint DDL;
2. refuse unless the projected peak, including a 32 MiB temp/WAL reserve, is
   below the 80% warning threshold and retains at least that same reserve below
   the hard guard;
3. transactionally add the seven-row source-code binding and create empty
   compact staging pool/state/sync relations with compact primary key, event
   uniqueness, foreign keys, and checks already enforced;
4. validate the empty staging catalog and persist `V3_STAGING_PREPARED`;
5. drop the old pool-state FK and refresh index, both old pool uniqueness
   constraints/indexes, the old composite token index, and the old block index,
   then persist `V2_INDEXES_PREDROPPED`;
6. populate compact staging in one transaction and persist
   `V3_STAGING_POPULATED`;
7. validate full row, per-source, key, event, provenance, pagination-order,
   checkpoint, V2/V3/V4, and STONKBROKER equivalence;
8. transactionally lock, recheck checkpoints, swap names, and set marker 3001;
9. validate current compact counts/evidence and persist
   `V3_OLD_RELATIONS_PRESENT`;
10. under the separate cleanup acknowledgement, drop the old relations and
   read back physical logical-database reclamation;
11. persist `V3_OLD_RELATIONS_CLEANED`, validate the compact evidence
    fingerprint, checkpoint equality, actual reclamation, and reserve again;
12. set schema version 3 and atomically remove the migration-state relation,
    which is the first restart-eligible state.

All pre-dropped v2 objects have exact rollback DDL. Before cutover, rollback
drops staging/source-code additions and reconstructs the six old indexes or
constraints. After a cutover failure but before cleanup, rollback swaps the old
relations back, restores schema version 2, drops compact staging, removes the
source-code addition, and rebuilds the v2 objects. After old-relation cleanup,
rollback is impossible by design. The only allowed recovery is
`FINALIZE_CLEANED_V3`, which revalidates compact relations, checkpoints,
evidence fingerprint, actual reclamation, and guard reserve before schema
version 3. Failure leaves marker 3001 and the writer stopped.

## Crash recovery and status

The read-only status mode recognizes `V2_CLEAN`, `V3_STAGING_PREPARED`,
`V2_INDEXES_PREDROPPED`, the recoverable internal
`V2_ROLLBACK_INDEXES_REQUIRED` boundary, `V3_STAGING_POPULATED`,
`V3_CUTOVER_MARKER_3001`, `V3_OLD_RELATIONS_PRESENT`,
`V3_OLD_RELATIONS_CLEANED`, `V3_FINALIZED`, and `UNKNOWN_UNSAFE`.
`UNKNOWN_UNSAFE` never mutates the database.

Pre-cutover phases may explicitly resume or roll back. Marker 3001 with all old
relations present may explicitly resume the validated cutover or roll back to
v2 after revalidating both representations. Once old relations are absent,
finalization is the only permitted recovery. Repeated clean-v2 rollback and
valid-v3 finalization commands are safe no-ops. All staging and cleanup
operations use the exact reviewed artifact names, and each phase transition
shares a transaction with the DDL it describes.

## Fresh-preflight calculation

The executable uses current catalog sizes, not this document, as operational
authority:

```text
projected peak =
  max(
    current logical bytes + 1 MiB empty-staging allowance,
    current logical bytes
      - all old market_pools index bytes
      + compact copy at measured 268.30848 bytes/pool with 10% build allowance
      + max(current state/sync bytes, 1 MiB)
      + 32 MiB temp/WAL safety reserve
  )
```

The latest issue input was 260,568,767 logical bytes and 256,599 pools. Using
the local representative old-index density, the conservative reviewed estimate
is:

| Input/result | Bytes |
| --- | ---: |
| Latest logical input | 260,568,767 |
| Estimated reclaimable old pool indexes | 116,567,256 |
| Compact copy plus 10% build allowance | 75,732,457 |
| Support copy allowance | 1,048,576 |
| Temp/WAL safety reserve | 33,554,432 |
| Empty-staging allowance | 1,048,576 |
| Copy-phase estimate | 254,336,976 |
| **Projected migration peak** | **261,617,343** |
| Hard-guard headroom | 105,384,257 |

That is 71.29% of the 367,001,600-byte guard and below its 293,601,280-byte
warning threshold. This extrapolation is design evidence only. Production must
use the executable's fresh exact index sizes and refuse if they do not pass.

## Disposable PostgreSQL proof

The representative proof used 260,000 deterministic v2 pool rows with the
reviewed seven-source mixture and test-only STONKBROKER V4 evidence.

| Phase | Logical database bytes |
| --- | ---: |
| v2 baseline | 243,734,195 |
| empty constrained compact staging prepared | 243,947,187 |
| after old-index reclamation | 125,777,587 |
| full compact staging present | 195,278,515 |
| after old-relation cleanup | 80,901,811 |

The actual measured maximum was the empty-staging phase, only 212,992 bytes
above the starting database and still below the warning threshold. Compact
staging plus the explicit reserve was 228,832,947 bytes (62.35% of the guard).
The completed compact database reclaimed 162,832,384 logical bytes.

The same harness proves abrupt connection/process-loss recovery after the
source-code transaction, empty staging, old-index predrop, staging population,
cutover marker, cutover validation, and old-relation cleanup. It proves both
pre/post-cutover rollback and resume, repeated finalization, checkpoint-motion
refusal, and corrupt-artifact fail-closed behavior. It also proves checkpoint
equality, seven-source binding, canonical
and event uniqueness, exact token/pool lookup, pagination ordering, V4 and
STONKBROKER evidence, restart admission only at schema v3, source rollback,
and 64-point retention.

## Operational prohibitions

Do not run this against production without a separate owner-authorized window.
Do not deploy the v3 writer before that window: it intentionally refuses the v2
database. Do not restart the writer while marker 3001 exists. Do not increase
the storage guard, mutate Railway/Vercel, reset backfill, enable browse,
authority, or production traffic, or remove the activation lock.
