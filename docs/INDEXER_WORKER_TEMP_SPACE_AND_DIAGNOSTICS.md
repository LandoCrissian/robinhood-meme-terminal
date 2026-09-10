# Identity catalog temporary-space failure and read-only diagnostics

## Production evidence

Deployment `824ac8e7-f97f-4e75-b0f0-f773c8185b24`, authorized source
`fd2824687f6b4e106b32a7f2defc8f90ccfb9c14`, first worker heartbeat failure:
2026-09-10T13:34:23.372555045Z. Sanitized classification:
`DATABASE_TEMP_DISK_FULL` during token identity catalog rescan.

PostgreSQL deployment logs independently pair temporary-file ENOSPC errors with
the canonical token `UNION ... ORDER BY` statement, including
2026-09-10T13:34:32.872750256Z. Worker failures recur across subsequent cycles;
this is not a stale success/failure flag. Logical database pressure reporting
healthy does not establish sufficient physical temporary-file headroom.

The repair reads at most 4096 pools per query through the existing unique
block/log event index, using strict descending keyset pagination. It preserves
the complete canonical token set and deterministic historical scheduling.
Deduplication uses the existing process catalog instead of PostgreSQL's global
UNION/sort temporary files. No schema, database binding, volume, or memory-limit
change is introduced. The single worker still controls catalog reconciliation
and identity publication.

The PostgreSQL fixture executes the old statement with constrained work memory
and a zero temporary-file budget: the old query fails, while the repaired
catalog reader completes with identical expected token membership. This
reproduces temporary-space demand without filling a real disk. It is not a
claim that the fixture's resource-limit error code equals Production ENOSPC.

## Diagnostics

`GET /v1/token-identities/priority` uses the existing read-token bearer check.
Missing/wrong authentication returns 401; authenticated non-GET returns 405.
Query strings and forwarding headers cannot supply authorization.

The endpoint only peeks at existing process state. It does not initialize the
identity index, query the database, invoke the worker, refresh priority, or
persist anything. Uninitialized identity statistics are null, not fabricated
zeros. State-loading failure produces a bounded 503 classification.

`prioritySetDigest` is SHA-256 of ordered lowercase 0x-prefixed candidate
addresses joined with newline separators. Counts describe this same live
selection; a changed digest requires a new comparison window. Addresses are
not returned. Worker success/failure timestamps and consecutive/total failure
counts supplement existing truthful health semantics. A complete successful
cycle clears consecutive failures, not historical failure evidence.

Diagnostics never return raw errors, stacks, connection strings, headers, or
credentials. Priority-query failure retains the last valid selection and
reports unavailable. Identity persistence failure still makes worker health
unhealthy. Production deployment and backfill remain separate owner-reviewed
operations; this PR does not perform either.
