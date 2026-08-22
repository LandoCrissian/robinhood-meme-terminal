# Market indexer compact-schema benchmark

**Status:** DESIGN AND LOCAL BENCHMARK ONLY

**Base main:** `58ca0ce59e6845f3ac2de22c9c8c004e563b9d6d`

**Date:** 2026-08-22
**Production migration authorized:** no

This document records the compact-storage result requested after issue #419. It
does not change the production schema, schema version, Railway configuration,
storage limit, release locks, or browse activation. All empirical candidate
measurements used a disposable PostgreSQL 17.10 instance bound to loopback.

## Conclusion

The winning design is a manifest-bound binary pool row with packed immutable
evidence, exact canonical-key uniqueness, and one canonical event-coordinate
index that also serves keyset pagination. It is paired with a bounded
sync-point retention rule of the newest 64 points per source—the exact maximum
the current reorg reconciler reads.

At 800,000 deterministic representative rows, the winning pool relation used:

| Measurement | Bytes/pool |
| --- | ---: |
| Heap | 185.37472 |
| Canonical-key and event indexes | 82.83136 |
| Total relation | **268.30848** |

The production observation was 982.034 logical bytes per newly discovered pool,
and the same current table/index design measured 895.85664 relation bytes per
pool locally at 400,000 rows. The compact design therefore removes about 70% of
the measured physical pool relation.

Using a 10% pool-count uncertainty allowance, the conservative projected final
logical database size is **286,321,235 bytes**. That is 78.02% of the existing
367,001,600-byte guard, 7,280,045 bytes below the 80% telemetry warning, and
80,680,365 bytes (21.98%) below the hard guard. The point estimate is
261,090,042 bytes (71.14% of the guard).

## Authoritative #419 inputs

| Input | Value |
| --- | ---: |
| Current logical bytes at catalog diagnostic | 203,314,879 |
| Latest owner-observed logical bytes | 220,468,927 |
| Current pool rows | 198,181 |
| Aggregate remaining source lag | 196,400,389 blocks |
| Current pool relation | 183,394,304 bytes |
| Current pool heap | 83,894,272 bytes |
| Current pool indexes | 99,434,496 bytes |
| Pool inserts / updates / deletes | 191,290 / 0 / 0 |
| Dead pool tuples | 0 |
| Canonical/event/cross-source duplicates | 0 / 0 / 0 |
| Baseline projected completion | 932,174,267 bytes |
| Existing logical guard | 367,001,600 bytes |

This evidence rules out dead tuples, duplicate suppression, repeated UPSERTs,
UP enrichment, checkpoints, and RPC retry writes as the primary pool-growth
cause. Failed RPC batches occur before the database transaction, so a 429 may
repeat RPC work but does not commit that failed batch.

## Phase 1: runtime query and invariant inventory

| Runtime responsibility | Current use of `market_pools` | Winning-design requirement |
| --- | --- | --- |
| Inventory pagination | Server orders by block, transaction, and log coordinates and returns an opaque cursor. | `(block_number, log_index)` is the unique canonical log coordinate and the pagination index. Transaction index is not exposed and is redundant with block-global log order. |
| Exact token search | `token0 = value OR token1 = value`. | Scan compact binary token columns. At 800k rows the median was 63.078 ms. No result semantics change. |
| Exact pool/PoolId search | Exact `pool_key`. | Scan the compact key. Address and bytes32 lengths remain distinct; median was 62.096 ms at 800k. |
| Source filter | Exact reviewed source ID. | Resolve the source ID through the seven-row manifest mapping and filter its compact source code. Source pagination used the event index and measured 0.349 ms at 800k. |
| Restart/resume | `next_block` and source status live in `market_indexer_source_state`; pool rows are immutable evidence. | Source checkpoint behavior is unchanged. No pool timestamp or textual protocol field is needed to resume. |
| Canonical duplicate protection | Primary key `(chain_id, source_id, pool_key)` and exact-conflict comparison in the worker. | Primary key `(source_code, pool_key)` retains exact full-key uniqueness. Exact duplicate/conflict handling continues to compare packed provenance. |
| Event duplicate protection | Unique `(chain_id, transaction_hash, log_index)`. | Unique `(block_number, log_index)`. JSON-RPC defines `logIndex` as the log's position in the block, so the pair is a collision-free canonical log coordinate. Transaction and block hashes remain stored in packed provenance. |
| Reorg rollback | Delete pool rows for one source above the common ancestor. | Same source/block predicate. The 800k read-side benchmark was 79.325 ms; rollback remains transactional and rare. |
| Finalized-head handling | Source state plus sync-point hashes; pools carry event block/hash provenance. | Unchanged. Packed provenance retains the exact 32-byte block hash. |
| UP enrichment | Select `up-v2`/`up-cl` pools and join state by canonical pool identity. | Derive V2/V3 pool address from the 20-byte pool key and reference the compact canonical key. Representative selection measured 0.156 ms at 800k. |
| Telemetry | Count pools grouped by source and join the small UP state table. | Count/filter compact source codes and map through the reviewed manifest. |
| STONKBROKER/V4 | Token may occur in a V4 row; PoolId is bytes32 and address is null. | The deterministic V4 fixture preserves token `0xe934…bf50`, a 32-byte PoolId, 20-byte hooks, and derived null pool address. |
| Web adapter | Expects lowercase hex identities, exact source/protocol/version binding, V4 null address, hashes, and provenance. | Encode binary values at the server API boundary and derive source metadata/pool address. The public contract does not change. |

The JSON-RPC definition used for event coordinates is the official
[Ethereum JSON-RPC log object](https://ethereum.org/developers/docs/apis/json-rpc/):
`logIndex` is the log index position in the block, while `transactionIndex` is
the originating transaction's position. Because log position is already global
within the block, ordering by `(blockNumber, logIndex)` is equivalent for these
finalized logs and uniquely identifies the event.

### Column classification

No winning-design column remains unknown.

| Current column | Classification | Winning representation / proof |
| --- | --- | --- |
| `chain_id` | DERIVABLE | The dedicated database remains structurally bound to chain 4663 in source state and the reviewed manifest; each pool has a source FK. |
| `source_id` | REPLACEABLE | Small integer code bound one-to-one to the exact seven source-state rows. |
| `protocol` | DERIVABLE | Exact function of the reviewed source code. |
| `protocol_version` | DERIVABLE | Exact function of the reviewed source code. |
| `pool_key` | REQUIRED_STORED | Binary 20-byte address or 32-byte PoolId. |
| `pool_address` | DERIVABLE | V2/V3 equals the 20-byte key; V4 is null. |
| `token0` | REQUIRED_STORED | Binary 20-byte address. |
| `token1` | REQUIRED_STORED | Binary 20-byte address. |
| `stable` | REPLACEABLE | One source-version-bound attribute byte for `up-v2`. |
| `fee` | REPLACEABLE | Source-version-bound packed uint24 where present. |
| `tick_spacing` | REPLACEABLE | Source-version-bound packed integer where present. |
| `hooks` | REPLACEABLE | Exact 20 bytes in the V4 attribute payload. |
| `transaction_hash` | REPLACEABLE | First 32 bytes of the immutable provenance payload. |
| `transaction_index` | REMOVABLE | Not public, not used by replay after persistence, and redundant with block-global `log_index` for event ordering. |
| `log_index` | REQUIRED_STORED | Exact block-global event coordinate and continuation key. |
| `block_number` | REQUIRED_STORED | Pagination, rollback, finality, and provenance coordinate. An explicit nonnegative 32-bit bound is sufficient for the reviewed Robinhood backfill; future overflow must fail closed into a reviewed schema version. |
| `block_hash` | REPLACEABLE | Second 32 bytes of immutable provenance. |
| `observed_at` | REMOVABLE | No inventory, replay, restart, rollback, telemetry, enrichment, or web query reads it; discovery block provenance supplies canonical ordering. |

### Index classification

| Current index | Classification | Query mapping / replacement |
| --- | --- | --- |
| Pool PK `(chain_id, source_id, pool_key)` | REPLACEABLE | Compact PK `(source_code, pool_key)` retains exact canonical uniqueness and supports UP source scans. |
| Event unique `(chain_id, transaction_hash, log_index)` | REPLACEABLE | Unique `(block_number, log_index)` is equally exact and also serves global/source keyset pagination. Full transaction/block hashes remain stored for API evidence and conflict comparison. |
| Tokens `(chain_id, token0, token1)` | REMOVABLE | The runtime OR predicate does not obtain a complete token0-or-token1 plan from this composite index. A compact scan remained below 64 ms at 800k; retaining or adding GIN materially exceeded the storage budget. |
| Block `(chain_id, source_id, block_number, transaction_index, log_index)` | REPLACEABLE | The event-coordinate unique index serves pagination. Source rollback remains a bounded scan; no second block index is required at shadow scale. |

## Phase 2/3: candidates and empirical results

The generator uses the exact seven-source identities and the source/version mix
from the #419 191,290-row catalog sample. It generates deterministic binary
identities, repeated token relationships, immutable event provenance, and a
test-only STONKBROKER V4 row. Every candidate receives the same rows.

| Candidate (400k rows) | Heap B/pool | Index B/pool | Total B/pool | Insert rows/s | Decision |
| --- | ---: | ---: | ---: | ---: | --- |
| Current TEXT schema/indexes | 438.579 | 457.052 | 895.857 | 35,111 | Baseline; cannot complete. |
| Binary-equivalent, all redundancy retained | 266.977 | 339.579 | 606.740 | 39,605 | Large gain, still not viable. |
| Binary + normalized source, tx-hash event key | 217.641 | 264.110 | 481.915 | 38,350 | Still index-heavy. |
| Normalized source + coordinate event + separate page index | 217.641 | 146.719 | 364.524 | 45,918 | Better, but redundant event/page indexes remain. |
| Previous candidate + GIN tokens | 217.641 | 194.724 | 412.529 | 42,148 | Token lookup is fast but storage fails the budget. |
| **Packed manifest + shared event/page coordinates** | **185.385** | **82.985** | **268.534** | **49,881** | **Winner.** |
| Packed + hashed canonical identity | 202.281 | 65.618 | 268.063 | 47,921 | Rejected: negligible gain and collision-allocation machinery would replace a native exact-key constraint. |

At 800,000 rows, the winner stabilized at 185.37472 heap bytes and
82.83136 index bytes per pool (268.30848 total), with 48,676 inserts/second.
Repeated 200,000-row runs produced byte-identical heap, index, relation, sync,
and invariant results.

### Required query workload at 800k rows

| Operation | Median `EXPLAIN ANALYZE` time | Plan/effect |
| --- | ---: | --- |
| Canonical keyset page | 0.031 ms | Unique event-coordinate index |
| Source-filtered keyset page | 0.349 ms | Event-coordinate index with source filter |
| Exact token | 63.078 ms | Compact heap scan |
| Exact 20/32-byte pool key | 62.096 ms | Compact heap scan |
| Exact V4 PoolId | 61.150 ms | Compact heap scan |
| Source rollback predicate | 79.325 ms | Compact heap scan; rollback remains exceptional and transactional |
| UP enrichment candidate | 0.156 ms | Compact canonical-key index |

Adjacent frozen-fixture pages had zero overlap. Forced duplicate inserts were
rejected, and a rollback delete inside a transaction restored the exact row
count. The exact source/protocol/version mapping, 20/32-byte key shapes,
STONKBROKER V4 evidence, packed hashes, and V4 null-address derivation all
passed in the harness.

## Winning physical design

This is a design contract for the next migration tranche, not production DDL.

1. Keep the existing source-state table as the manifest authority and add a
   reviewed compact source code with an exact one-to-one constraint for all
   seven sources. Do not create a competing source registry.
2. Store pool key, token addresses, hooks, transaction hash, and block hash as
   binary bytes. Reject incorrect lengths before and in PostgreSQL.
3. Do not store chain, textual source/protocol/version, pool address, observed
   time, or transaction index on each immutable row.
4. Bind the attribute layout to the schema version and source code:
   V2 none; V3 fee/tick; V4 fee/tick/hooks; up-v2 stable; up-cl tick spacing.
5. Pack transaction hash followed by block hash in a 64-byte provenance value.
   API code must decode both exact halves and never reinterpret their order.
6. Keep exact native uniqueness on `(source_code, pool_key)`.
7. Keep exact native uniqueness on `(block_number, log_index)`. Use this same
   index for descending pagination. On any coordinate conflict, compare full
   packed provenance and fail closed.
8. Preserve the public API exactly: lowercase `0x` hex, sourceId/protocol/
   version from the reviewed source manifest, V2/V3 address equal to key, and
   V4 address null.
9. Retain only the newest 64 sync points for each source, transactionally after
   each committed checkpoint. The current reconciler already queries
   `ORDER BY block_number DESC LIMIT 64`; a deeper reorg already fails closed.

The sync-point benchmark measured the projected current representation at
53,881 rows as 15,409,152 bytes. A binary 64-per-source representation (448
rows) measured 139,264 bytes. There is no raw event table or historical
enrichment table to compact. UP state and source state remain independently
required and small.

## Phase 4: full-backfill projection

Observed incremental density:

```text
(198,181 - 95,209) pools / 27,248,616 source-blocks
= 0.0037789809 pools/source-block
```

Applying that density to 196,400,389 remaining source-blocks yields 742,193
additional pools and a point estimate of 940,375 final pools. The conservative
projection adds 10%, producing **1,034,413 pools**.

| Projection component | Point estimate | Conservative (+10% pools) |
| --- | ---: | ---: |
| Compact pool relation | 252,310,587 | 277,541,780 |
| Bounded sync points | 139,264 | 139,264 |
| Observed fixed DB/catalog/non-pool allowance | 8,640,191 | 8,640,191 |
| **Final logical bytes** | **261,090,042** | **286,321,235** |
| Guard usage | 71.14% | 78.02% |
| Hard-guard headroom | 105,911,558 | 80,680,365 |

The fixed allowance preserves the #419 observed 8,345,279-byte gap between
database size and measured user relations plus 294,912 bytes of non-pool,
non-sync relations. The projection is for PostgreSQL logical database bytes.
As existing telemetry states, WAL, backups, snapshots, temporary index-build
files, and provider-volume overhead remain outside this logical guard and need
separate operational observation during an authorized migration.

## Phase 5: migration options (not executed)

### Option A — preserve current progress

**Viable at the recorded 220,468,927-byte snapshot, subject to a fresh
preflight immediately before migration.**

1. Stop the shadow writer under separate operational authorization. Keep
   shadow mode, authority false, production traffic false, and the activation
   lock unchanged.
2. In the same dedicated database, create versioned compact staging tables.
3. Copy and validate all seven source rows, current checkpoints, canonical
   pools, and UP state. Decode/re-encode every field with strict length/source
   checks. Keep the old tables untouched.
4. Require exact row counts, per-source counts, canonical-key uniqueness,
   event-coordinate uniqueness, source-manifest equality, representative
   V2/V3/V4 rows, STONKBROKER if already present, and API-equivalent evidence.
5. In one short cutover transaction, acquire the migration/worker lock, verify
   source checkpoints have not moved, swap table names, bind the reviewed new
   schema version, and commit. Restart and prove resume from the same next
   blocks.
6. Rollback before commit by dropping only staging tables. After commit, retain
   the old tables until restart/read validation succeeds; removal requires the
   separately authorized migration plan.

At 198,181 pools the compact copy projects to 53,607,819 bytes including
bounded sync/support. Adding a 10% copy/build allowance to the observed live
logical size gives a **279,437,528-byte peak**, leaving 87,564,072 bytes under
the hard guard. This includes both old and new logical relations, but not
provider-volume temp/WAL overhead. The migration must fail closed if a fresh
size/row-count calculation no longer proves the peak.

Expected write-stop window: the local copy rate was about 48k rows/second, but
the owner should budget 5–15 minutes for copy, invariant validation, locks, and
restart rather than extrapolating local hardware directly to Railway.

### Option B — rebuild rebuildable inventory

**Viable but not recommended while preserve-progress remains safe.**

Under separate destructive/rebuild authorization, install the reviewed compact
schema in a fresh dedicated rebuildable database or after an explicitly
authorized reset. Preserve configuration, source manifest pins, runtime proofs,
storage guard, and release locks. Intentionally reset pool rows, UP state, sync
points, and each source's next block to its reviewed manifest start. Do not
preserve a checkpoint while discarding the canonical evidence it covers.

The worker must verify all seven deployments/runtimes before replay and must
show each source progressing from its exact start. At the observed aggregate
rate (~27.25M source-blocks in about 2.4 hours), a clean replay is roughly 24–36
hours after allowing for RPC 429 recovery. Its conservative maximum logical
size is **286,321,235 bytes**. Recovery before cutover is to keep/restart the old
shadow deployment; after an authorized destructive reset, recovery is another
full verified replay.

## Decision

The compact design is viable under the existing logical guard and below the
existing warning threshold with a 10% pool-count uncertainty allowance.
`PRESERVE_PROGRESS` is the recommended production migration because its
recorded peak fits and it avoids discarding verified progress. Neither option
is authorized by this benchmark. A dedicated migration PR and a separately
authorized operational window are required.

## Reproduction

Use a disposable loopback PostgreSQL database only:

```powershell
$env:MARKET_INDEXER_BENCHMARK_DATABASE_URL = "postgresql://postgres@127.0.0.1:55432/postgres"
$env:MARKET_INDEXER_BENCHMARK_ALLOW_LOCAL = "1"
$env:MARKET_INDEXER_BENCHMARK_ROWS = "200000,400000"
pnpm --filter market-indexer benchmark:compact-schema
```

The harness rejects non-loopback hosts, bounds row counts, uses fixed schema
names, and contains no production credentials or configuration. It creates and
drops only its own local benchmark schemas.
