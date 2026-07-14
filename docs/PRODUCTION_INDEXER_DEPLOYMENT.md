# Production indexer deployment

## Recommended beta topology

- **Primary RPC:** Alchemy Robinhood Chain mainnet archive-capable endpoint
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
| `RMT_RPC_URL` | Primary Robinhood Chain mainnet RPC |
| `RMT_FACTORY_ADDRESS` | `0x25a92d8c79c38d07b0d3efd0ebe929d30e401cdd` |
| `RMT_FACTORY_START_BLOCK` | `9567266` |
| `RMT_CONFIRMATION_DEPTH` | `20` |
| `RMT_INDEXER_CHUNK_SIZE` | `2000` |
| `RMT_INDEXER_POLL_MS` | `5000` |
| `RMT_DB_POOL_SIZE` | `10` |
| `PGSSLMODE` | `require` |

Railway injects `PORT`. Do not override it unless the provider requires an explicit value.

## Railway setup

1. Create a Railway project from the GitHub repository.
2. Select the `indexer` workspace/service.
3. Keep the repository root as the source root.
4. Set the config-as-code path to `/apps/indexer/railway.json`.
5. Add the encrypted variables above.
6. Generate a public service domain only for the indexer API.
7. Deploy one replica.
8. Confirm the deployment health check passes at `/health`.

The committed Railway configuration builds only the indexer, starts the long-running worker/API, checks `/health`, restarts after failure, and limits redeploy triggers to relevant files.

## Historical reconciliation

Do not connect the public web app to the indexer until all checks pass:

1. `/health` reports `ok: true`, chain ID `4663`, and the canonical V5 factory.
2. The worker has indexed through the confirmed chain head.
3. Indexed launch count equals the factory's onchain `launchCount()`.
4. Every indexed token, market, reward vault, and creator matches its canonical launch event.
5. Indexed buy/sell totals match canonical Trade logs.
6. The latest reserve matches the latest canonical Trade event.
7. No duplicate transaction-hash/log-index pairs exist.
8. A clean restart resumes from the saved checkpoint without duplicates.
9. A database restore into a temporary project can resume indexing.
10. The backup RPC can complete a reconciliation pass.

The V5 start block is an intentional product boundary. The production indexer and terminal do not ingest legacy V4 launches; V4 is consulted only by the V5 factory to prevent reuse of protected names and tickers.

## Web cutover

After reconciliation:

1. Store the indexer base URL as an encrypted Vercel production variable.
2. Keep the existing verified-factory RPC feed available as an explicit degraded fallback.
3. Display a delayed-data state when indexer health fails.
4. Add an independent uptime check for the indexer `/health` endpoint.
5. Alert when lag exceeds twice the confirmation depth.

Trading remains wallet-to-contract and must never depend on the indexer being available.

## Cost boundary

Begin with the smallest paid continuous-worker tier and a managed PostgreSQL plan with point-in-time recovery. Set provider spending alerts before backfill. Upgrade only after measured CPU, memory, database, and RPC usage justify it.
