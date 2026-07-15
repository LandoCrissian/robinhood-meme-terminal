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
- exposes `/health` and `/launches` for the web tier and monitoring
- never holds a signing key and cannot move protocol or user funds

## Required environment

- `DATABASE_URL`
- `RMT_RPC_URL`
- `RMT_FACTORY_ADDRESS` (must expose `protocolVersion() == 6`)
- `RMT_FACTORY_START_BLOCK` (the canonical V6 factory deployment block)

There are no legacy-factory or legacy-start-block defaults. A missing value, an invalid address/block, an RPC failure, or a factory version other than V6 stops startup before any database indexing begins. The archive RPC must prove that the configured factory first has bytecode at the exact start block and has no bytecode at the preceding block. The indexer derives the policy registry from the configured factory, reads the V6 governance/creator-payout authority and canonical protocol treasury from that deployed stack, and fails closed unless those bindings match and both authority contracts contain bytecode. No V5 governance or treasury address is configured or accepted as a fallback.

`/health` remains unavailable and `/launches` returns `503` until the first confirmed-chain backfill and all V6 accounting invariants complete successfully. Changing the schema version, factory, or exact deployment block forces a clean replay rather than trusting earlier indexed rows.

Production should also set:
- `RMT_CONFIRMATION_DEPTH` (default 20)
- `RMT_INDEXER_CHUNK_SIZE` (default 2000)
- `RMT_INDEXER_POLL_MS` (default 5000)
- `RMT_DB_POOL_SIZE` (default 10)
- `PORT`

Run one writer instance until leader election is added. The database constraints make replay idempotent, but multiple simultaneous writers create unnecessary RPC and lock contention.
