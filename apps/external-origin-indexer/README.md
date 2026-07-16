# RMT External Origin Indexer

This standalone service is the fail-closed foundation for future external-launchpad discovery on Robinhood Chain.

It is intentionally separate from the canonical RMT V6 indexer. The V6 indexer remains the authority for official RMT launches, trades, fees, graduation, and protocol state. This service may only record independently verified, chain-evidenced claims about tokens originating from external platforms.

## Current status

This commit is a source-only, zero-adapter scaffold.

- No external launchpad adapter is configured or enabled.
- No RPC endpoint is accepted or contacted.
- No external token is imported or presented as verified.
- No production service, database, domain, or web environment variable should be created yet.
- No live RMT indexer or web route reads from this service.
- The service never signs transactions, trades, launches tokens, or moves funds.

The Railway definition checks `/ready`, which deliberately returns `503` while the adapter registry is empty. This prevents an adapter-free build from becoming ready accidentally.

## Isolation boundary

The service requires its own PostgreSQL database through `EXTERNAL_ORIGIN_DATABASE_URL`.

Never point this variable at the canonical RMT V6 indexer database, never alias `DATABASE_URL` into this service, and never add these tables to `apps/indexer`. The separate application, database name, token, schema, CI job, and eventual deployment keep external attribution failures away from public RMT launches and trading.

The schema contains exactly:

- `external_origin_adapter_state`
- `external_origin_sync_points`
- `external_origin_claims`

Claims bind to the full immutable provenance tuple: chain, adapter, source ID, source name, and factory. Transaction hash plus log index identifies the chain event, evidence hashes cannot be reused, and claims prevent their parent provenance record from being deleted.

## API

### `GET /health`

Public database-backed liveness endpoint. With the empty registry and a reachable database it returns:

```json
{"ok":true,"mode":"shadow","chainId":4663,"servingProductionTraffic":false,"attributionReady":false,"coverage":"unavailable","configuredAdapters":0,"enabledAdapters":0,"readyAdapters":0,"error":null}
```

Liveness never means attribution is ready.

### `GET /ready`

Public readiness endpoint. It returns `503` until at least one compile-time adapter is enabled and every enabled adapter has an exact matching ready state. Railway targets this endpoint on purpose.

### `GET /v1/origins?tokens=<addresses>`

Protected exact-address origin lookup. Send:

```http
Authorization: Bearer <EXTERNAL_ORIGIN_READ_TOKEN>
```

The `tokens` parameter must appear once and contain 1 to 100 comma-separated EVM contract addresses. In the current zero-adapter state, a valid authorized request returns `200` with an explicit non-authoritative result:

```json
{"chainId":4663,"mode":"shadow","authoritative":false,"coverage":"unavailable","enabledAdapters":[],"claims":[],"indexedThrough":null}
```

There is no `/launches` route and no broad token feed.

## Environment

Required:

- `EXTERNAL_ORIGIN_DATABASE_URL` — dedicated external-origin PostgreSQL database
- `EXTERNAL_ORIGIN_READ_TOKEN` — at least 32 characters

Optional:

- `PORT` — default `3002`
- `EXTERNAL_ORIGIN_DB_POOL_SIZE` — default `5`
- `PGSSLMODE=disable` — local PostgreSQL without TLS; other values use TLS

The scaffold intentionally has no RPC, factory, deployment-block, confirmation-depth, polling, or chunk-size environment variable. Environment variables cannot enable adapters.

## Checks

From the repository root:

```bash
pnpm --filter external-origin-indexer typecheck
pnpm --filter external-origin-indexer build
pnpm --filter external-origin-indexer test:schema
pnpm --filter external-origin-indexer test:api
```

The schema smoke test creates and drops a private test schema, applies the migration twice, proves that only the three external tables exist, checks keys and indexes, and exercises duplicate, orphan, lowercase-address, immutable-provenance, and deletion constraints.

## First-adapter activation gate

Do not deploy this service merely because the scaffold compiles. Before enabling the first adapter:

1. Confirm the official source identity and public HTTPS documentation.
2. Verify the exact factory or emitting contract and runtime bytecode.
3. Record the exact deployment block or safe ingestion boundary.
4. Match a verified source and ABI to live creation-event evidence.
5. Publish a deterministic manifest hash and compile-time registry entry.
6. Add backfill, restart, checkpoint, and reorg rollback tests.
7. Prove conflicting and partial attribution fails closed.
8. Complete a shadow backfill and compare results independently.
9. Preserve the `External` origin label through every API and UI surface.
10. Review a separate database and deployment before any production consumer is connected.

Read-only discovery is the first allowed integration level. External trading and smart routing remain out of scope until origin, ABI, security, and execution reviews are complete.
