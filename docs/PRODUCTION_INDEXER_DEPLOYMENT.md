# Production indexer deployment

Current status: **the V6 Railway/PostgreSQL indexer is live and is the production Discovery source**. This document retains the deployment and recovery procedure; provider credentials and database details remain private.

## Recommended beta topology

- **Primary RPC:** Robinhood Chain mainnet endpoint for current-chain polling and log ingestion
- **Archive RPC:** Alchemy Robinhood Chain mainnet archive-capable endpoint for exact deployment-boundary verification
- **Backup RPC:** separately operated Robinhood Chain provider
- **Database:** managed PostgreSQL with encrypted backups and point-in-time recovery
- **Worker/API:** one continuously running Railway service
- **Public web:** Vercel at https://www.rmtlaunch.fun

The indexer is read-only. It must never receive a wallet key, seed phrase, governance signer, or funds.

## Why the public RPC is not sufficient

Robinhood documents the public RPC as rate-limited and not intended for production-grade, high-throughput, or latency-sensitive applications. The historical backfill requires a provider endpoint that supports the required log history.

## Deployment inputs

Create these as encrypted service variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Managed PostgreSQL connection string |
| `RMT_RPC_URL` | Primary Robinhood Chain mainnet RPC for current-chain polling and logs |
| `RMT_ARCHIVE_RPC_URL` | Archive-capable RPC used only for exact factory deployment-boundary verification |
| `RMT_FACTORY_ADDRESS` | Exact canonical V6 factory address recorded after deployment; never use the V5 address with the V6 indexer |
| `RMT_FACTORY_START_BLOCK` | Confirmed V6 factory deployment block recorded from its deployment receipt |
| `RMT_INDEXER_READ_TOKEN` | Long random bearer token shared only with the Vercel server |
| `RMT_CONFIRMATION_DEPTH` | `20` |
| `RMT_INDEXER_CHUNK_SIZE` | `2000` |
| `RMT_INDEXER_POLL_MS` | `10000` |
| `RMT_DB_POOL_SIZE` | `10` |
| `PGSSLMODE` | `require` |

Railway injects `PORT`. Do not override it unless the provider requires an explicit value.

Do not configure governance, creator-payout, or treasury addresses separately. At startup the indexer uses `RMT_ARCHIVE_RPC_URL` to require factory bytecode at the exact configured deployment block and no factory bytecode at the preceding block. It uses `RMT_RPC_URL` for current-chain reads and log ingestion, so archive-provider historical query limits cannot slow live synchronization. The indexer then reads `policyRegistry()` and `creatorPayoutAuthority()` from the configured V6 factory, reads `governance()` and `canonicalProtocolTreasury()` from that policy registry, requires the creator-payout authority and treasury to equal the fresh V6 governance contract, and requires bytecode at the policy-registry and governance addresses. Any future or late start block, missing contract, zero address, mismatch, RPC failure, or legacy factory stops startup before indexing.

## Railway setup

1. Create a Railway project from the GitHub repository.
2. Select the `indexer` workspace/service.
3. Keep the repository root as the source root.
4. Set the config-as-code path to `/apps/indexer/railway.json`.
5. Add the encrypted variables above.
6. Generate a public service domain only for the indexer API.
7. Deploy one replica.
8. Confirm `/ready` stays unavailable during the initial backfill, then passes only after the first safe-head sync and accounting-invariant pass complete. Confirm `/health` separately reports live RPC synchronization.

The committed Railway configuration builds only the indexer, starts the long-running worker/API, checks RPC-independent `/ready` plus the local database dependency, restarts after a local worker/data failure, and limits redeploy triggers to relevant files. `/health` remains the external synchronization monitor; an upstream RPC timeout should alert without restarting a worker that still has a valid confirmed checkpoint.

## Historical reconciliation

Do not connect the public web app to the indexer until all checks pass:

1. `/health` reports `ok: true`, chain ID `4663`, protocol version `6`, the exact canonical V6 factory, and the derived policy-registry, governance, creator-payout-authority, and protocol-treasury addresses from the deployment record.
2. The worker has indexed through the confirmed chain head.
3. Indexed launch count equals the factory's onchain `launchCount()`.
4. Every indexed token, market, fee splitter, and creator matches its canonical launch event.
5. Indexed buy/sell totals match canonical Trade logs.
6. The latest reserve matches the latest canonical Trade event.
7. No duplicate transaction-hash/log-index pairs exist.
8. A clean restart resumes from the saved checkpoint without duplicates.
9. A database restore into a temporary project can resume indexing.
10. The backup RPC can complete a reconciliation pass.

The V6 deployment block is the intentional product boundary: the production indexer and V6 terminal do not ingest V4/V5 launches as V6. The active V6 factory consults the retained legacy V5 identity factory only to preserve protected names and tickers. Production binding is established by the canonical registry, factory, and start-block values; it does not imply exact explorer source verification.

## Web cutover

After reconciliation:

1. Store the indexer base URL as encrypted Vercel production variable `RMT_INDEXER_URL`.
2. Store the same long random bearer token in Railway and Vercel as `RMT_INDEXER_READ_TOKEN`; never prefix either value with `NEXT_PUBLIC_`.
3. Set `RMT_INDEXER_TIMEOUT_MS=5000` in Vercel.
4. Serve `/api/markets/*/trades` and `/api/launches` through Vercel's shared cache. Trades use the committed five-second policy; launch discovery uses a fifteen-second policy with stale-while-revalidate.
5. Use a Vercel Firewall rule restricted to `www.rmtlaunch.fun`, request paths beginning with `/api/markets/`, and request paths ending in `/trades`. Observe the exact match in log-only mode before enabling a per-IP rate limit. Never include static assets, launch routes, wallet transaction RPC calls, or contract writes.
6. Use the persistent indexer as the production launch-feed source. Do not let visitor traffic trigger repeated full-history factory scans when the configured indexer is delayed; keep the last confirmed launch snapshot visible instead. The direct-chain scanner remains available only for local/test operation when no indexer URL is configured.
7. Display a delayed-data state without clearing the last confirmed launch snapshot. Pause polling in hidden tabs, prevent overlapping refreshes, and back off repeated failures.
8. Keep `.github/workflows/production-health.yml` scheduled every five minutes. It checks the Railway `/health` endpoint and the public official-RMT trade route independently of the application deployment. GitHub scheduling is best-effort, so use an external uptime provider for dependable 1–5 minute alert delivery.
9. Warn when the last completed indexer sync is older than one minute and fail when it is older than ten minutes. Bound block lag and launch-feed checkpoint drift against their synchronization timestamps using a conservative fast-chain block-rate allowance instead of treating confirmation depth as a wall-clock interval. An incorrect V6 binding, stale sync, wrong launch-feed source, or missing shared-cache headers remains a failed production-health run.

Trading remains wallet-to-contract and must never depend on the indexer being available.

## Historical launchpad indexer cutover

- **Railway indexer:** https://robinhood-meme-terminal-production.up.railway.app
- **Public market-data boundary:** `https://www.rmtlaunch.fun/api/markets/{market}/trades`
- **Retired launch 0 token (historical evidence):** `0xdBa33be56C89CC9fc014c4459028d7e5c7878671`
- **Retired launch 0 market (historical evidence):** `0xb26Fb775c0ac365d369BEe9ac2E044C5D90FfBee`
- **Edge protection:** exact-host and exact-route-shape Vercel Firewall observation rule; wallet and contract traffic are outside the rule
- **Independent monitoring:** current Terminal release health uses live canonical market-search controls. Launch 0 is not a release acceptance fixture. Historical V6 launch-feed/indexer checks remain separate protocol evidence.

The public trade proxy can fall back to bounded verified direct-chain reads when the indexer is unavailable. RMT launch discovery instead retains the last confirmed indexed snapshot so a service delay does not create a new full-history RPC scan per visitor. Trading remains wallet-to-contract and does not pass through Railway, PostgreSQL, or the market-data proxy.

## Cost boundary

Begin with the smallest paid continuous-worker tier and a managed PostgreSQL plan with point-in-time recovery. Set provider spending alerts before backfill. Upgrade only after measured CPU, memory, database, and RPC usage justify it.
