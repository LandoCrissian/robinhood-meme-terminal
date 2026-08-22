# RMT Market Indexer

This service is RMT's first-party, read-only Robinhood Chain pool-discovery
indexer. It replaces neither the live discovery API nor its current external
providers. The initial release is deliberately isolated in shadow mode so RMT
can measure coverage before any product cutover.

## What it indexes

The reviewed source manifest is compiled into the service:

| Source | Contract | Start block | Primary upstream record |
| --- | --- | ---: | --- |
| Sushi V2 factory | `0xE52abd50ad151ecDf56427effD715E703696a6B1` | 6,269,958 | [Pinned Sushi SDK V2 config](https://github.com/sushi-labs/sushi/blob/c74a93dcbbcdd4ad9d4b86669880f182dcaeb680/src/evm/config/features/sushiswap-v2.ts) |
| Sushi V3 factory | `0xE51960f1B45f1C9FB6D166E6a884F866fC70433B` | 6,292,626 | [Pinned Sushi SDK V3 config](https://github.com/sushi-labs/sushi/blob/c74a93dcbbcdd4ad9d4b86669880f182dcaeb680/src/evm/config/features/sushiswap-v3.ts) |
| Uniswap V2 factory | `0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f` | 8,928 | [Pinned Uniswap chain 4663 deployment record](https://github.com/Uniswap/contracts/blob/37936185dee7decf681360ec799c124e0e034672/deployments/json/4663.json) |
| Uniswap V3 factory | `0x1f7d7550B1b028f7571e69A784071F0205FD2EfA` | 8,930 | [Pinned Uniswap chain 4663 deployment record](https://github.com/Uniswap/contracts/blob/37936185dee7decf681360ec799c124e0e034672/deployments/json/4663.json) |
| Uniswap V4 PoolManager | `0x8366a39CC670B4001A1121B8F6A443A643E40951` | 9,070 | [Pinned Uniswap chain 4663 deployment record](https://github.com/Uniswap/contracts/blob/37936185dee7decf681360ec799c124e0e034672/deployments/json/4663.json) |
| up. V2 PoolFactory | `0xFA5429AEBa338BEa2BFcc1b9a889862Ee395bc28` | 6,180,950 | [Pinned official up. production application record](https://up33.xyz/assets/index-Cx7kG_8N.js) |
| up. Slipstream CLFactory | `0x1ac9dB4a2608ba45D6127B1737949b51Bb54B7F3` | 6,184,096 | [Pinned official up. production application record](https://up33.xyz/assets/index-Cx7kG_8N.js) |

Each source also pins its deployment transaction and current runtime bytecode
hash. Startup fails if the RPC is on the wrong chain, a deployment receipt does
not match its pinned block, or current runtime code differs. Historical
deployment-block bytecode is checked when the RPC retains that state; the
official public RPC prunes some early state, so immutable transaction receipts
remain the required deployment-boundary proof.

The official up. production record is cross-checked against each factory's
verified Blockscout source, exact creation receipt and current runtime. The
application record alone is never allowed to activate a source.

The up. manifest additionally pins the shared Voter at
`0x7F749fDD351C1Ceed82d76d7699CB631Eb8332a7`, both factory-selected pool
implementations and all three runtime hashes. Startup independently checks the
Voter deployment receipt, every pinned runtime, and both factories' current
implementation getters. Any drift stops the shadow worker.

The indexer records only canonical pool-creation or initialization events:

- V2 `PairCreated`;
- V3 `PoolCreated`;
- V4 `Initialize`.
- up. V2 `PoolCreated(token0, token1, stable, pool, index)`;
- up. CL `PoolCreated(token0, token1, tickSpacing, pool)`.

`up-v2` and `up-cl` are separate source identities. Slipstream is not decoded
or routed as Uniswap V3. A version number retained in the shared storage shape
does not override the source identity.

For up. pools, a bounded round-robin enrichment pass reads state at the same
finalized block boundary used by the worker. It verifies factory membership,
then records the current fee and denominator:

- V2: `PoolFactory.getFee(pool, stable)`, denominator `10,000`;
- CL: pool `fee()`, denominator `1,000,000`.

The Voter is enrichment only. The indexer records `gauges`, `isAlive`,
`weights`, `claimable`, `gaugeToFees` and `gaugeToBribe` when a gauge exists.
A zero gauge remains a valid, visible market with null gauge evidence. Gauge
state can never create, reject or rename a pool.

An enrichment read failure is stored as non-authoritative error evidence and
rotated through the bounded refresh queue, so one malformed or temporarily
unreadable pool cannot starve the remaining market inventory. The pool itself
remains discoverable; only its live state is withheld until verification passes.

It does not calculate prices, volume, liquidity, token metadata, origin
attribution, rankings, quotes or trade routes yet. Those are separate, later
layers. This change cannot authorize or submit an up. trade.

## Fail-safe state machine

Each source moves independently:

```text
backfilling -> shadow-ready
      |              |
      +---- error <--+
```

- `backfilling`: scanning finalized ranges from the pinned deployment block.
- `shadow-ready`: caught up through the configured confirmation boundary.
- `error`: malformed logs, identity conflicts, source drift, RPC failures, or a
  reorg deeper than retained checkpoints stop that source.

Exact duplicate logs are idempotent. Conflicting duplicates fail closed. Every
committed batch stores its canonical block hash in the same database
transaction as its pools and next-block checkpoint. A reorg rolls back derived
pools and checkpoints to the newest common ancestor. If no retained ancestor
exists, the service stops instead of guessing.

## Isolation and API

- It requires its own `MARKET_INDEXER_DATABASE_URL` and rejects the canonical
  indexer or external-origin database URL.
- Before any DDL, a transaction-scoped migration lock is acquired and every
  existing public table must match the market indexer's exact table allowlist.
  A canonical, external-origin, or otherwise unrelated populated database is
  rejected without creating a market-indexer table.
- It has no wallet, signer, transaction submission, key, or contract-write
  path.
- `GET /ready` always returns HTTP 503 while the source-level activation lock is
  compiled in, preventing a hosting platform from routing production traffic.
- `GET /health` is public and labels every response `mode: shadow`,
  `authoritative: false`, `servingProductionTraffic: false`, and reports the
  configured storage mode. It exposes only operational summaries: heartbeat
  age, logical database pressure, aggregate pool count, source state, and lag.
- `GET /v1/status` requires the internal bearer token and returns the detailed
  per-source telemetry snapshot used for private shadow verification.
- `GET /v1/pools` requires the internal bearer token and carries the same
  non-authoritative label. Its optional `source=<sourceId>`,
  `token=<20-byte address>` and `poolKey=<20-byte address or bytes32 PoolId>`
  filters are exact, may be combined with AND semantics, and are applied in
  PostgreSQL before the bounded result limit. V2/V3 pool keys remain pool
  addresses; V4 pool keys remain PoolIds with a null `poolAddress`.

The external-origin indexer remains separate. Pool existence is market evidence;
it is not proof that a launchpad created a token.

## Local validation

Copy `.env.example`, create an isolated PostgreSQL database, then run:

```sh
pnpm --filter market-indexer typecheck
pnpm --filter market-indexer build
pnpm --filter market-indexer test:config
pnpm --filter market-indexer test:decoder
pnpm --filter market-indexer test:replay
pnpm --filter market-indexer test:schema
pnpm --filter market-indexer test:telemetry
pnpm --filter market-indexer test:server
pnpm --filter market-indexer test:up-enrichment
pnpm --filter market-indexer test:position-guard
```

## Cutover blockers

Before this data can influence the public product:

1. complete a full backfill against at least two independent Robinhood Chain
   RPCs;
2. compare pool coverage and event provenance against the current live feed;
3. add token metadata, reserve/state reads, price and volume aggregation, and
   freshness monitoring as separately reviewed layers;
4. run extended reorg, outage, throttling, and corrupt-response rehearsals;
5. deploy redundant shadow instances and alerting;
6. review API abuse controls and retention;
7. remove the source-level activation lock in a dedicated reviewed release.

No cutover should silently change the live feed. RMT should publish measured
coverage and limitations first.

## Railway shadow deployment

The checked-in `railway.json` builds only this workspace. Configure it as a
separate Railway service with a separate PostgreSQL database and the variables
in `.env.example`. Its provider health check uses `/health` only to prove the
shadow process is alive. `/ready` remains permanently unavailable while the
activation lock is compiled in.

Do not add `DATABASE_URL`, `RMT_INDEXER_URL`, a public production-domain route,
or any Vercel variable for this service. The first deployment is for private
backfill and coverage measurement only.

### Storage modes

`MARKET_INDEXER_STORAGE_MODE` defaults to `durable`, which creates ordinary
PostgreSQL tables and is required for any production candidate. A disposable
shadow backfill may instead use `rebuildable`, which creates all indexer
relations as PostgreSQL `UNLOGGED` tables. This sharply reduces write-ahead-log
pressure on constrained rehearsal databases because every stored row can be
reconstructed from the pinned chain history.

The mode is fail-closed: startup rejects existing indexer tables whose
persistence does not match the configured mode. Use a fresh dedicated database
when changing modes. A PostgreSQL crash automatically truncates unlogged tables,
so the worker detects missing source state after recovery, transactionally
reseeds it, and replays from the pinned start blocks. Never use `rebuildable`
for authoritative or production data.

Constrained rehearsals should also set `MARKET_INDEXER_MAX_DATABASE_MB` below
the provider volume limit (for example, `350` on a disposable 500 MB database).
Before every indexing cycle, the worker checks `pg_database_size` and fails
closed before derived table growth can consume the reserved recovery space.
This is a rehearsal guardrail, not a substitute for correctly sized production
storage and monitoring.

### Observability and storage scope

The worker emits a structured `market_indexer_heartbeat` log at most once per
`MARKET_INDEXER_HEARTBEAT_INTERVAL_MS` (60 seconds by default), plus an immediate
heartbeat whenever the error state changes. Each heartbeat includes the
finalized head, cycle duration, aggregate pool count, per-source progress and
lag, and logical database pressure. This is operational telemetry only and does
not unlock readiness or make the feed authoritative.

Database telemetry deliberately reports
`scope: logical-database-only` and `providerVolumeIncluded: false`.
`pg_database_size` measures the PostgreSQL logical database; it does not measure
the hosting volume's operating files, write-ahead logs, backups, snapshots, or
other provider overhead. Railway volume usage must therefore be monitored
separately. The logical cap cannot guarantee that a small provider volume will
not fill.

### Compact schema v3 migration boundary

Schema v3 uses the reviewed manifest-bound binary pool representation and
retains only the newest 64 sync points per source. Existing schema-v2 databases
are never auto-migrated at startup. The worker refuses v2 and the intermediate
migration marker, so a future operational migration must keep the writer
stopped until old relations are removed and logical storage reclamation is
verified.

`pnpm --filter market-indexer migrate:compact-schema` is preflight-only unless
the separately reviewed execution and old-relation cleanup acknowledgements
are present. `MARKET_INDEXER_COMPACT_MIGRATION_STATUS=READ_ONLY` reports only
the detected persisted phase, schema version, logical bytes, pool count,
relation-presence flags, checkpoint equality, and restart eligibility.
Interrupted runs require one explicit reviewed recovery value:
`RESUME_PRE_CUTOVER`, `ROLLBACK_TO_V2`, `RESUME_VALIDATED_CUTOVER`, or
`FINALIZE_CLEANED_V3`. Every recovery keeps the advisory lock and all writer,
shadow, authority, traffic, activation-lock, and database-limit acknowledgements.
Unknown or internally inconsistent catalog states fail closed. The migration
plan and disposable-Postgres evidence are recorded
in
[`../../docs/MARKET_INDEXER_COMPACT_SCHEMA_LOW_PEAK_MIGRATION_2026-08-22.md`](../../docs/MARKET_INDEXER_COMPACT_SCHEMA_LOW_PEAK_MIGRATION_2026-08-22.md).

### Optional Position Guard heartbeat

The same private process can call RMT's release-locked Position Guard evaluator
without provisioning another Railway service. This does not make the shadow
market index authoritative and does not expose a new public endpoint.

The worker is disabled when both `RMT_POSITION_GUARD_EVALUATOR_URL` and
`RMT_POSITION_GUARD_EVALUATOR_TOKEN` are empty. If only one is present, startup
fails. When enabled, the URL must be an exact HTTPS
`/api/internal/position-guards/evaluate` endpoint with no credentials, query or
fragment, and the random bearer token must match the server configuration.
Intervals are restricted to 5–25 seconds so RMT can reject new automatic orders
when the evaluator heartbeat is older than 30 seconds. Failures are reported in
private service health without logging the bearer token.
