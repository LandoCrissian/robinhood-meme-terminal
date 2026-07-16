# RMT External Origin Indexer

This standalone service is the fail-closed foundation for future external-launchpad discovery on Robinhood Chain.

It is intentionally separate from the canonical RMT V6 indexer. The V6 indexer remains the authority for official RMT launches, trades, fees, graduation, and protocol state. This service may only record independently verified, chain-evidenced claims about tokens originating from external platforms.

## Current status

This commit is a source-only, zero-adapter scaffold with a compile-time activation lock.

- No external launchpad adapter is configured or enabled.
- No RPC endpoint is accepted or contacted.
- No external token is imported or presented as verified.
- No production service, database, domain, or web environment variable should be created yet.
- No live RMT indexer or web route reads from this service.
- The API has no code path that can serve an authoritative origin claim.
- The service never signs transactions, trades, launches tokens, or moves funds.

The Railway definition checks `/ready`. That endpoint always returns `503` in this version, even if someone adds a manifest, because `EXTERNAL_ORIGIN_ATTRIBUTION_ACTIVATION_LOCKED` is compiled as `true`. Removing the lock requires a separate implementation and review.

## Bow candidate research (not enabled)

The repository contains a proof-pinned Bow.fun candidate decoder. It is research code, not an adapter:

- Bow's [official documentation](https://bow.fun/docs.html) binds the current factory, exact `Launched` ABI, and canonical event signature.
- The factory is pinned to `0xc70e510e14710ea535cab7b2414860af63feab79`, deployment block `7158095`, deployment block hash `0xfe25444d15866ce7fcb22a009148836eb98b45670908d8144b5c5fb38d1a8409`, and deployed runtime code hash `0x8d56cbcdf72dbf04ed8170d55878cc894997ccc54c2ab0aec782274eb7fe7a14`.
- Two independent successful factory receipts are committed as decoder fixtures with exact emitter, topics, data, transaction hash, log index, block, and block hash.
- The decoder rejects removed logs, pre-deployment logs, the wrong emitter or topic, non-canonical ABI address padding, malformed data, invalid hashes, and invalid log indexes.

The candidate is deliberately absent from `externalOriginAdapters`. The [factory's Blockscout record](https://robinhoodchain.blockscout.com/address/0xC70E510E14710Ea535CAB7b2414860aF63FEab79?tab=contract) still presents `Verify & publish`, so source verification is incomplete. RPC backfill, finality/reorg execution, and independent shadow comparison are also not implemented. CI asserts the registry stays empty and the activation lock continues to prevent readiness or claims.

### Offline replay validator (CI-only)

The `shadow/` directory now contains a pure transcript validator and bounded inclusive block-range planner. It is outside `src/`, excluded from the runtime build, and never imported by `index.ts`. It accepts caller-prepared data only: there is still no RPC client, worker, environment switch, database writer, adapter registration, API claim, web consumer, or deployment path.

A replay window is accepted only when its supplied facts agree on the pinned chain, candidate, factory, and deployment anchor; bounded contiguous headers; exact block-hash tags; factory runtime boundaries; candidate-assumed zero-indexed `launchCount()` accounting; globally ordered `Launched` logs; complete successful receipt logs; `launches(id)` state; and nonempty token/pool runtime code. Call observations must name the exact Bow factory and function. Any gap, fork, omission, duplicate, coordinate conflict, reordering, failed receipt, counter mismatch, state mismatch, role collision, or missing code rejects the entire window. The output is frozen, deterministic, and explicitly marks itself unverified, nonauthoritative, activation-ineligible, unpersisted, and not an adapter claim. Bow's event field remains `deployer`; it is never converted to the RMT claim model's `creator`.

This is a safety harness, not a completed backfill:

- one provider can fabricate a self-consistent transcript
- the supplied runtime hash is compared with the pin but is not yet recomputed locally from raw bytecode
- count and `launches(id)` values are structured reported assertions, not locally decoded raw call returns
- the zero-index counter relationship is a candidate assumption exercised with synthetic framing, not a live-proven invariant
- a reported finalized-head anchor above the window does not prove ancestry by itself
- the deployment window uses an explicit predeployment-zero assumption; coverage from deployment is not proven
- independent archival-provider comparison, RPC collection, reorg execution, and persistence remain unimplemented
- Bow source verification remains incomplete

Every replay result reports those limits directly: independent-provider agreement, finalized ancestry, coverage from deployment, live counter semantics, local runtime hashing, and local state decoding are all `false`. They continue to block activation.

## Isolation boundary

The service requires its own PostgreSQL database through `EXTERNAL_ORIGIN_DATABASE_URL`.

It rejects an identical `DATABASE_URL`, obtains a transactional advisory migration lock, and refuses to create anything if the public schema contains a table outside this service's exact allowlist. Existing schema columns, constraints, defaults, and indexes are checked on every startup. This prevents an accidental canonical RMT database URL or drifted partial schema from being accepted.

Never add these tables to `apps/indexer`. The separate application, database, token, schema checks, CI job, and eventual deployment keep external attribution failures away from public RMT launches and trading.

TLS certificate verification is on by default. `PGSSLMODE=disable` is only for local PostgreSQL.

## Evidence model

The schema contains exactly:

- `external_origin_adapter_state`
- `external_origin_sync_points`
- `external_origin_claims`

The model enforces:

- immutable manifest identity on every claim
- a checkpoint foreign key for every claim
- automatic claim removal when a reorg checkpoint is deleted
- one creation origin per chain/token
- unique transaction/log and canonical evidence identities
- lowercase nonzero addresses and hashes
- no claim before its adapter start block
- consistent ready/error adapter state
- versioned adapters that may safely reference the same historical factory

`source-listed` evidence is distinct from `token-created` evidence. Exact origin lookup code filters to `token-created`; a source listing alone can never prove creation origin.

Adapter manifests and evidence hashes use deterministic SHA-256 identities:

- manifest domain: `rmt-external-origin-adapter-v1`
- evidence domain: `rmt-external-origin-evidence-v1`

The canonical serializers are committed in `adapter-registry.ts` and `evidence.ts`. Changing a factory, start block, bytecode hash, event topic, source evidence, or claim kind without recomputing and reviewing the manifest is rejected.

## API

### `GET /health`

Public database-backed liveness endpoint. With the empty registry and a reachable database it returns:

```json
{"ok":true,"mode":"shadow","chainId":4663,"servingProductionTraffic":false,"attributionReady":false,"coverage":"unavailable","configuredAdapters":0,"enabledAdapters":0,"readyAdapters":0,"error":null}
```

Liveness never means attribution is ready.

### `GET /ready`

Public deployment guard. It returns `503` throughout this release.

### `GET /v1/origins?tokens=<addresses>`

Protected exact-address lookup. Send:

```http
Authorization: Bearer <EXTERNAL_ORIGIN_READ_TOKEN>
```

The `tokens` parameter must appear once and contain 1 to 100 comma-separated EVM contract addresses. No other query parameter is accepted. In this activation-locked release, a valid authorized request returns:

```json
{"chainId":4663,"mode":"shadow","authoritative":false,"coverage":"unavailable","enabledAdapters":[],"claims":[],"indexedThrough":null}
```

There is no `/launches` route and no broad token feed.

## Environment

Required:

- `EXTERNAL_ORIGIN_DATABASE_URL` — dedicated external-origin PostgreSQL database
- `EXTERNAL_ORIGIN_READ_TOKEN` — 32 to 512 bearer-token characters

Optional:

- `PORT` — default `3002`
- `EXTERNAL_ORIGIN_DB_POOL_SIZE` — default `5`, maximum `50`
- `PGSSLMODE=verify-full` — default behavior
- `PGSSLMODE=disable` — local development only

The scaffold intentionally has no RPC, factory, deployment-block, confirmation-depth, polling, or chunk-size environment variable. Environment variables cannot enable adapters.

## Checks

From the repository root:

```bash
pnpm --filter external-origin-indexer typecheck
pnpm --filter external-origin-indexer typecheck:shadow
pnpm --filter external-origin-indexer build
pnpm --filter external-origin-indexer test:schema
pnpm --filter external-origin-indexer test:api
pnpm --filter external-origin-indexer test:candidates
pnpm --filter external-origin-indexer test:shadow-replay
```

Tests cover concurrent/idempotent migration, database isolation, schema drift, manifest mutation, versioned factories, source-list exclusion, duplicate/conflicting origin evidence, checkpoint mismatches, reorg cleanup, block ranges, authentication, activation lock, exact API responses, zero-indexed Bow replay accounting, and adversarial whole-window rejection.

## First-adapter activation gate

Do not deploy this service merely because the scaffold compiles. Before the activation lock can be removed:

1. Confirm the official source identity and public HTTPS documentation.
2. Verify the exact factory, deployment block, runtime bytecode, source, ABI, and creation event.
3. Commit the adapter manifest and deterministic hash.
4. Implement its RPC backfill in this isolated service.
5. Track a finalized target head and exact checkpoint at the indexed boundary.
6. Enforce bounded block lag and synchronization freshness.
7. Make readiness verification and claim reads atomic.
8. Test restart, chunk boundaries, provider failure, and multi-block reorg rollback.
9. Complete a shadow backfill and compare results independently.
10. Preserve the `External` origin label through every API and UI surface.
11. Review a separate database and production deployment.
12. Remove the compile-time activation lock only in that reviewed change.

Read-only discovery is the first allowed integration level. External trading and smart routing remain out of scope until origin, ABI, security, and execution reviews are complete.
