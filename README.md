# RMT Launch

RMT Launch is a token launchpad for Robinhood Chain. The product path is gas-only creation, ETH trading on a bonding curve, then permissionless graduation into a funded Uniswap v4 pool with permanently locked liquidity.

## Curve V1 review

The new engine mints a fixed token supply at creation. The creator pays network gas, with no creation fee, seed-liquidity payment or initial purchase. Trading uses a disclosed curve fee and separate accounting for project revenue, RMT operations and a future RMT token reserve. The final buyer can choose atomic buy-and-graduate, or anyone can submit graduation after the funded threshold is reached. The same token moves into the v4 pool, and the original position stays in immutable custody.

Curve V1 is an isolated review candidate. This branch provides development contracts, simulations and local acceptance paths. Robinhood Chain execution is reviewed in a loopback fork. Production deployment, economics and release remain pending separate approval and independent review.

| Lifecycle | Evidence shown in the launchpad |
| --- | --- |
| Create | Fixed supply, creator and project terms, factory event and transaction |
| Trade on curve | Virtual curve terms, actual ETH backing, quotes, progress and fees |
| Graduate | Funded threshold, canonical full PoolKey, deposited assets and LP custody |
| Trade on v4 | Verified pool identity, transaction settlement and observed routing availability |

Pool creation and external indexing are separate observations. Curve V1 imposes no RMT fee on v4 swaps. Earnings attributable to the initial LP position remain locked under this version's custody policy.

## Development

Use the pinned toolchain and dependency lockfile.

```sh
pnpm install --frozen-lockfile
node packages/contracts/scripts/simulate-launch-curve.mjs
pnpm --filter web test:local-launchpad
pnpm typecheck
pnpm build
```

See the [Curve V1 review guide and release decisions](docs/RMT_LAUNCH_CURVE_V1.md), [repository authority](AGENTS.md), and [architecture boundary](docs/ARCHITECTURE_FREEZE.md).

The existing RMT token, deployed curve, balances, contracts, receipts and history retain their original terms. The [prior direct-to-v4 review](docs/RMT_LAUNCH_PRODUCTION_DATA_READINESS.md) is historical engineering evidence. LAMMB Empires continues independently.
