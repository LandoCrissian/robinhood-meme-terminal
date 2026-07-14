# RMT Mainnet Indexer

This service replaces repeated full-range RPC scans with a persistent PostgreSQL event index.

It:

- waits for a configurable confirmation depth before publishing events
- checkpoints every indexed range with its canonical block hash
- detects reorgs and rolls back launches, trades, graduations, and migrations to the last common checkpoint
- replays idempotently using transaction-hash and log-index keys
- exposes `/health` and `/launches` for the web tier and monitoring
- never holds a signing key and cannot move protocol or user funds

## Required environment

- `DATABASE_URL`
- `RMT_RPC_URL`

Production should also set:

- `RMT_FACTORY_ADDRESS`
- `RMT_FACTORY_START_BLOCK`
- `RMT_CONFIRMATION_DEPTH` (default 20)
- `RMT_INDEXER_CHUNK_SIZE` (default 2000)
- `RMT_INDEXER_POLL_MS` (default 5000)
- `RMT_DB_POOL_SIZE` (default 10)
- `PORT`

Run one writer instance until leader election is added. The database constraints make replay idempotent, but multiple simultaneous writers create unnecessary RPC and lock contention.
