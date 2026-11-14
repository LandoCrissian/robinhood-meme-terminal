# RMT Mainnet Indexer

This service replaces repeated full-range RPC scans with a persistent PostgreSQL event index.

It:

- waits for a configurable confirmation depth before publishing events
- checkpoints every indexed range with its canonical block hash
- detects reorgs and rolls back launches, trades, graduations, and migrations to the last common checkpoint
- replays idempotently using transaction-hash and log-index keys
- preserves the permanent original creator separately from the current creator-fee recipient
- records append-only governance-only creator-payout changes, stale-nonce invalidations, fee distribution, deferred-payment, and V4 fee-collection events
- reports cumulative post-graduation ETH and launched-token fees for every V6 launch
- exposes RPC-independent `/ready`, diagnostic `/health`, `/launches`, exact `/origins` token-origin claims, and bounded `/markets/:market/trades` reads for the web tier and monitoring
- never holds a signing key and cannot move protocol or user funds

## Required environment

- `DATABASE_URL`
- `RMT_RPC_URL` (current-chain polling and log ingestion)
- `RMT_ARCHIVE_RPC_URL` (historical deployment-boundary verification; falls back to `RMT_RPC_URL` locally)
- `RMT_FACTORY_ADDRESS` (must expose `protocolVersion() == 6`)
- `RMT_FACTORY_START_BLOCK` (the canonical V6 factory deployment block)
- `RMT_INDEXER_READ_TOKEN` (long random bearer token shared only with the web server)

There are no legacy-factory or legacy-start-block defaults. A missing value, an invalid address/block, an RPC failure, or a factory version other than V6 stops startup before any database indexing begins. The archive RPC must prove that the configured factory first has bytecode at the exact start block and has no bytecode at the preceding block. Current-chain reads remain on the primary RPC so a constrained archive provider cannot throttle live ingestion. The indexer derives the policy registry from the configured factory, reads the V6 governance/creator-payout authority and canonical protocol treasury from that deployed stack, and fails closed unless those bindings match and both authority contracts contain bytecode. No V5 governance or treasury address is configured or accepted as a fallback.

`/ready` is a process and database readiness check. It can return `200` after factory verification, acquisition of the sole PostgreSQL writer lock, startup validation of the persisted state and checkpoint reconciliation. It does not wait for the full backfill. Check `initialSyncComplete` separately. `/health` reports the last head observed by the worker and returns `503` while backfill is running or synchronization is degraded. It does not start an RPC request on behalf of each visitor. Data endpoints remain unavailable until initial sync succeeds, and historical data additionally requires verified receipt coverage. During a classified upstream RPC delay, `/launches` can serve the last confirmed PostgreSQL checkpoint and marks that response stale; exact origin and market-trade reads fail closed until synchronization recovers. Upstream diagnostics remain private in service logs. `/launches`, `/origins`, and `/markets/:market/trades` require `Authorization: Bearer <RMT_INDEXER_READ_TOKEN>` when the token is configured. Origin reads accept 1–100 explicit token addresses, return only confirmed RMT V6 creation claims, and never infer origin from a DEX listing. Market trade reads are limited to 50 confirmed rows, reject unknown/non-V6 markets, and return the indexer checkpoint with every response. The recovery binary accepts the same chain, factory, deployment block and existing index schema version 5. A previously indexed database with an absent or inconsistent checkpoint a cursor ahead of the confirmed chain head, or an older/newer schema stops without a reset. Test an isolated backup restore for incompatible data.

Production should also set:
- `RMT_CONFIRMATION_DEPTH` (default 20)
- `RMT_INDEXER_CHUNK_SIZE` (default 2000)
- `RMT_INDEXER_POLL_MS` (default 10000, allowed values 1 through 60000 ms)
- `RMT_INDEXER_CAUGHT_UP_POLL_MS` (default 30000, allowed values 1 through 60000 ms). Applies only to the pinned historical V6 binding with an authenticated, verified checkpoint and completed proof backfill. The interval is at least the base polling interval. Failures and incomplete proof backfill keep the base interval or existing failure backoff.
- `RMT_DB_POOL_SIZE` (default 10)
- `PORT`

Run one worker replica and stop any pre-lock worker against the same database before deploying. The worker uses one dedicated direct PostgreSQL session for the chain-scoped advisory lock, schema initialization, backfill, proof updates, and reorg writes. Session loss aborts that worker, and another instance can then open the last committed checkpoint. Do not point the writer at a transaction-pooling endpoint. The HTTP query pool defaults to a read-only transaction mode and does not hold the writer lock.

## Historical launch projection

`GET /historical-launches` requires a configured bearer token. The projection is
limited to the pinned Robinhood Chain 4663 V6 factory
`0x8e75c57079a01ce2094bc4187b78710887547651`, deployment block `10248855`,
and runtime Keccak-256
`0x274321493d48091b4443e007b8335a93a977e67dffe67d6147ff8557a1e58830`.
Both configured RPCs must report chain 4663. The confirmation depth must be at
least 20. This route describes historical V6 registrations only.

- Query by exact `?token=0x…` or request a page with `?limit=1..25` and the
  optional cursor returned by the previous page. Each response carries its
  own checkpoint. A client should restart pagination if the checkpoint
  changes and a consistent historical page sequence is required.
- Each row includes the factory receipt's transaction hash, block hash, block
  number, log index and canonical block timestamp. A `graduated` lifecycle requires a
  successful, canonical `LiquidityMigrated` receipt with positive amounts and
  liquidity. Pool and custody remain unknown. Without proven migration the
  lifecycle is unknown. The response contains no market metrics.
- The checkpoint joins the persisted cursor and range hash and verifies
  registry coverage against `launchCount()` there. `timestamp` is the block
  timestamp and `observedAt` is the worker's last verification time.
  `l2-confirmed` reflects the configured L2 depth. Ethereum L1 finality is
  unverified.
- Restart resumes the existing PostgreSQL cursor. Additive proof columns are
  backfilled from at most 25 registration receipts and 25 migration receipts
  per sync pass. Timed-out, rate-limited or missing proof reads may retry
  against a separately configured archive endpoint. A factory registration
  scan may use the archive when its range boundary agrees with the primary
  before and after the scan. Trade and fee-event scans retain the existing
  primary-provider retry/backoff behavior.
- A caught-up poll rechecks the canonical checkpoint and reads the latest L2
  head. When the exact checkpoint block, hash and timestamp are unchanged,
  it can reuse a complete proof for up to 90 seconds. Reuse preserves the
  original verification time. A changed checkpoint, restart or recovery
  after an observed upstream failure requires a full proof. Real block age
  is measured when serving responses.
- Authenticated history requests share a 120 per minute budget with a burst of
  12 and at most four concurrent database reads. Throttled requests return
  HTTP 429 with Retry-After. The endpoint sets a one-second database acquire
  timeout and one-second statement limit.
- Read-only repeatable-read transactions keep the response consistent across
  a checkout or rollback. A transient upstream error can return the previous
  checkpoint marked stale for up to two minutes after verification. A block
  over five minutes old is also marked stale. Missing proof coverage, invalid
  identity, provider disagreement and database failures cause the projection
  to return HTTP 503. A reorg rollback requires both configured providers to
  agree on changed canonical hashes and a common ancestor among the last
  64 stored checkpoints. A deeper disagreement requires operator review.

Maintain an isolated PostgreSQL backup with the cursor and all associated
tables in the same backup. Verify restoration to an isolated database and
check the chain, runtime pin and newest checkpoint before offering data.
Restoring a known-good cursor avoids rescanning from the V6 deployment block.
The archive must support the pinned block's state, receipts and the configured
factory log range. A full initial replay can be expensive on rate-limited
providers and is not part of a website request.

## New bonding-curve engine registration review

`src/curve-launch-evidence.ts` verifies registration evidence for a future
reviewed V1 factory using a separate `curve-launch-v1` record. The production
worker has no new-engine configuration, polling, writer, schema or HTTP route.
Without an explicit binding the verifier performs zero reads.

A future binding needs chain 4663, engine version 1, the factory deployment
height and hash, pinned factory and registry runtime identities, immutable
creation fee and recipient, and at least 20 L2 confirmations. The verifier
compares runtime at deployment and creation, confirms the transaction's slot in
the canonical block, and binds the successful receipt's factory creation and fee
logs to the registry registration and transaction calldata. No refund transfer
trace is inferred from the fee event. The result records creation only and marks
Ethereum L1 finality unverified. Project text and metadata URI are untrusted
event fields. The verifier performs no metadata dereferencing.

After approval, consume this verifier inside the existing authoritative writer.
Persist the separate source identity, registration log and canonical checkpoint
under the same transaction. Include chain, factory, block hash, transaction hash
and log index in replay/rollback tests. Bind later engine and pool state to the
registered project and verified active version separately. Production archive
and independent canonicality, reorg, and L1 finality operations require their own
review before exposing a new-engine read endpoint. The V6 reader keeps its own
source and schema throughout.

### Isolated creator fixture

`pnpm --filter indexer start:curve-fixture` runs the Task 036 worker after
`pnpm --filter indexer build`. `scripts/visual-qa/rmt-creator-integration.mjs`
creates its isolated services and runs the actual creator journey. The worker
binds to IPv4 loopback and requires `RMT_CURVE_FIXTURE=task036-local-only`, an
explicit `RMT_CURVE_FIXTURE_PORT`, `RMT_CURVE_FIXTURE_RPC` on a distinct loopback
port, an absolute `RMT_CURVE_FIXTURE_DEPLOYMENT` manifest, and a separately named
loopback TCP PostgreSQL `RMT_CURVE_FIXTURE_DATABASE` database. The disposable
database name must begin with `rmt_curve_fixture_` and carry an explicit
`rmt_curve_fixture_marker` row with identity `task036-local-only`. A legacy
indexer table or another public relation causes startup to refuse the DB.

The fixture verifies the manifest deployment hash, runtime identities, chain
31337 and immutable 0.0004 ETH creation fee before opening the database. A
two-block confirmation delay qualifies its output as `fixture-confirmed`.
Successful ranges span at most 32 blocks within a 4,096-block fixture window.
They independently compare creation logs with every direct factory creation
receipt in the range, with a limit of 32 transactions per block. Nested
smart-account entry and blocks with same-block changes to the opening balances
are outside this fixture's accepted evidence. The proof reads fixed token
supply, full opening inventory, zero sold and backing, the 2 ETH target and
the exact treasury split from creation-block state. The contract records project
URI in creation calldata and the event. It has no separate URI storage getter.

Each range commits its tokens and checkpoints together under one database
writer lock. Restart resumes the latest canonical checkpoint. Reorgs discard
the orphaned checkpoint suffix and its registrations atomically. With no
matching checkpoint in the bounded lookback, the worker verifies the deployment
anchor before replaying from it. Missing receipts, changed deployment, failed
proofs and incomplete replay return HTTP 503. `GET /curve-launches` returns at
most 25 records, and `GET /curve-launches/<token>` returns 404 only when the
confirmed range is verified. These routes use private no-store caching and have
no public binding or production credential.
