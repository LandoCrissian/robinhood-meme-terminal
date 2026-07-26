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

Each source also pins its deployment transaction and current runtime bytecode
hash. Startup fails if the RPC is on the wrong chain, a deployment receipt does
not match its pinned block, or current runtime code differs. Historical
deployment-block bytecode is checked when the RPC retains that state; the
official public RPC prunes some early state, so immutable transaction receipts
remain the required deployment-boundary proof.

The indexer records only canonical pool-creation or initialization events:

- V2 `PairCreated`;
- V3 `PoolCreated`;
- V4 `Initialize`.

It does not calculate prices, volume, liquidity, token metadata, origin
attribution, rankings, or trade routes yet. Those are separate, later layers.

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
  configured storage mode.
- `GET /v1/pools` requires the internal bearer token and carries the same
  non-authoritative label.

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
shadow backfill may instead use `rebuildable`, which creates all three indexer
tables as PostgreSQL `UNLOGGED` tables. This sharply reduces write-ahead-log
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
