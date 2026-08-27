# Adding a curated RMT market

RMT is an owner-curated Robinhood Chain trading terminal. A token existing onchain does not automatically admit it to normal RMT browse or trading.

## Registry change

Add one reviewed entry to `apps/web/lib/vnext/curated-market-registry.ts` with:

- `chainId: 4663`;
- the exact nonzero ERC20 contract;
- a supported canonical venue (`uniswap-v2`, `uniswap-v3`, or `uniswap-v4`);
- the exact pair/pool address or V4 PoolId and PoolKey;
- bounded search aliases;
- `enabled: true`;
- the canonical creation/initialization transaction, block, and block hash.

Aliases are discovery hints only. Displayed name, symbol, decimals, code presence, and positive total supply come from fresh Robinhood Chain contract reads.

## Automated proof

The registry verifier must prove before the entry is served:

1. the contract is a live ERC20 with a positive supply;
2. V2/V3 pool bytecode exists;
3. the pool's `factory`, `token0`, and `token1` match the configured entry;
4. the official factory returns the exact configured pair/pool;
5. V3 fee and tick spacing match;
6. a V4 PoolKey independently derives the exact PoolId and the StateView reports an initialized pool;
7. the configured token is one side of the market.

Registry admission never bypasses quote freshness, strict verification, exact-call simulation, calldata binding, slippage protection, wallet review, project-identity controls, or receipt recovery.

## Review and acceptance

A listing PR should remain small. It should update the registry, focused controls, and any truthful documentation only. It must show desktop and mobile text search, exact-contract search, selection, exact market identity, supported quote state, and no token-specific runtime branch outside the registry.

No historical reindex, database migration, new backend, or market-indexer backfill is required.

## Unlisted tokens

Exact contract lookup may verify that an unlisted ERC20 exists and return the bounded state “Token exists on Robinhood Chain but is not currently listed on RMT.” It must not open the normal market workspace or expose trading.

## Post-cutover Railway retirement

After the curated web build is merged, deployed, and independently accepted:

1. stop `rmt-market-indexer-shadow` so historical reconstruction no longer consumes compute;
2. keep `Postgres-EHZZ` unchanged for a short, owner-reviewed recovery window;
3. confirm Terminal health, directory, search, quote, and strict verification remain independent of the stopped worker;
4. decide database deletion only through a later explicit owner action.

PR #453 is not required for this curated product model. Its bounded-scan lesson remains useful if the historical indexer is ever restored, but the superseded exhaustive backfill is not a Terminal release gate.
