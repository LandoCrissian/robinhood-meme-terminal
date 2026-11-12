# Persistent Indexer Operations

## Local RMT Launch v1

The new launchpad uses a separate Node 22.13+ SQLite index. Start the Anvil deployment described by `packages/contracts/scripts/deploy-launchpad-local.mjs`, copy its factory evidence into `apps/web/.env.local` using the launchpad settings in `apps/web/.env.example`, and use an absolute SQLite path in a writable local directory. From `apps/web`, start the worker with `node --env-file=.env.local --import tsx scripts/new-launchpad-indexer.ts` and start the web app with the same environment.

The worker reads only the configured factory's `LaunchCreated` events from its verified deployment block, in ranges of at most 256 blocks. A direct receipt submitted to `/api/launchpad/launches` appears immediately after pool, funding, custody and canonical block verification. The worker reconciles pending records against the current chain and rewinds SQLite rows to the last common checkpoint after a reorg. A missing worker or provider failure leaves the last evidence visible with a delayed status. The local launchpad requires a persistent filesystem shared by the web process and worker. Keep the loopback Anvil RPC private.

The REST reads under `/api/launchpad/public/[operation]` and the MCP data tools use the same domain. List and activity pages default to 10 records and allow up to 20. Activity covers at most the most recent 128 blocks ending at the page's canonical anchor. The SQLite database enforces a shared ceiling of 120 requests per minute and a smaller ceiling per operation. Responses carry block identity and freshness evidence for the local fork. The service exposes project metadata references as text and does not fetch them.

The following sections describe the deployed V6 compatibility service.

## Purpose

Production discovery reads confirmed launch and trade data from the persistent indexer in `apps/indexer`. The public launch route keeps its last confirmed snapshot during indexer delays instead of making each visitor repeat a full-history RPC scan. The indexer is a read-only chain consumer. It has no wallet, private key, governance role, or ability to move funds.

## Correctness model

- Robinhood Chain ID is fixed to 4663.
- Events are published only after the configured confirmation depth.
- Each completed range records its boundary block hash.
- Before every pass, stored boundaries are compared with canonical RPC blocks.
- A mismatch triggers a transactional rollback to the last common checkpoint.
- Launch, trade, graduation, and migration writes are idempotent.
- PostgreSQL numeric columns preserve full uint256 values without JavaScript rounding.

Use [PRODUCTION_INDEXER_DEPLOYMENT.md](PRODUCTION_INDEXER_DEPLOYMENT.md) for the provider-ready environment, Railway configuration, reconciliation, and web cutover sequence.

## Production deployment checklist

1. Create a managed PostgreSQL database with point-in-time recovery and encrypted backups.
2. Create a least-privilege database user for the indexer.
3. Choose a primary Robinhood Chain RPC and a separately operated backup RPC.
4. Deploy one continuously running writer with automatic restart.
5. Restrict the indexer API to the web tier or place it behind rate limiting.
6. Set the web deployment's indexer URL only after a full historical backfill matches the onchain launch count.
7. Use `/ready` for Railway process readiness and add an independent synchronization monitor for `/health`.
8. Warn when the most recent completed sync is older than one minute. Alert when it is older than ten minutes, block lag exceeds the timestamp-adjusted fast-chain budget, a reorg rollback occurs, or the worker reports an error.
9. Exercise database restore and full replay before broad launch.

## Required reconciliation before cutover

- indexed launch count equals `MemeLaunchFactory.launchCount()`
- every token, market, and fee-splitter address matches the factory event
- aggregated trade volume equals decoded canonical Trade logs
- the latest reserve equals the latest canonical Trade event or zero before the first trade
- graduation and liquidity migration state matches each market contract
- no duplicate transaction-hash/log-index pairs exist

## Incident handling

If the indexer is unhealthy, the web tier must clearly mark analytics as delayed and identify retained data as the last confirmed snapshot. Trading remains wallet-to-contract and does not depend on the indexer. Never invent activity or present delayed data as live. Follow [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
