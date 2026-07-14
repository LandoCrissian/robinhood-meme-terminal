# Persistent Indexer Operations

## Purpose

The public feed currently has an RPC fallback, but broad public traffic should read from the persistent indexer in `apps/indexer`. The indexer is a read-only chain consumer. It has no wallet, private key, governance role, or ability to move funds.

## Correctness model

- Robinhood Chain ID is fixed to 4663.
- Events are published only after the configured confirmation depth.
- Each completed range records its boundary block hash.
- Before every pass, stored boundaries are compared with canonical RPC blocks.
- A mismatch triggers a transactional rollback to the last common checkpoint.
- Launch, trade, graduation, and migration writes are idempotent.
- PostgreSQL numeric columns preserve full uint256 values without JavaScript rounding.

## Production deployment checklist

1. Create a managed PostgreSQL database with point-in-time recovery and encrypted backups.
2. Create a least-privilege database user for the indexer.
3. Choose a primary Robinhood Chain RPC and a separately operated backup RPC.
4. Deploy one continuously running writer with automatic restart.
5. Restrict the indexer API to the web tier or place it behind rate limiting.
6. Set the web deployment's indexer URL only after a full historical backfill matches the onchain launch count.
7. Add independent uptime checks for `/health`.
8. Alert when lag exceeds twice the confirmation depth, a reorg rollback occurs, or the worker reports an error.
9. Exercise database restore and full replay before broad launch.

## Required reconciliation before cutover

- indexed launch count equals `MemeLaunchFactory.launchCount()`
- every token, market, and reward-vault address matches the factory event
- aggregated trade volume equals decoded canonical Trade logs
- the latest reserve equals the latest canonical Trade event or zero before the first trade
- graduation and liquidity migration state matches each market contract
- no duplicate transaction-hash/log-index pairs exist

## Incident handling

If the indexer is unhealthy, the web tier must clearly mark analytics as delayed. Trading remains wallet-to-contract and does not depend on the indexer. Do not silently serve invented or stale activity. Follow [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
