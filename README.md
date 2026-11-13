# RMT Launch

RMT Launch is a token launchpad for Robinhood Chain. The product path is token creation for a small fixed ETH fee plus network gas, ETH trading on a bonding curve, then permissionless graduation into a funded Uniswap v4 pool with permanently locked initial liquidity.

## Curve V1 review

The engine mints a fixed supply at creation. The creator sees the exact ETH fee before signing. The isolated fixture charges 0.0004 ETH, approximately $1 at an illustrative $2,500 per ETH. The factory credits the fee to its fixed operating recipient and refunds excess ETH. Creators need no seed liquidity or initial purchase. The production ETH amount and treasury address are pending approval.

Trading applies the provisional 1% curve fee. The committed project policy receives 90% of collected curve fees, RMT operations receive 5%, and the future RMT reserve receives 5%. Creation fees are accounted for separately. At 60% sold, the remaining 40% pairs with actual backing. The final buyer can choose atomic buy-and-graduate, or anyone can submit graduation once the curve is funded. The same token moves into the v4 pool, and the original position stays in immutable custody.

Curve V1 is an isolated review candidate. This branch provides development contracts, simulations and local acceptance paths. Robinhood Chain execution is reviewed in a loopback fork. Production deployment, economics and release remain pending separate approval and independent review.

| Lifecycle | Evidence shown in the launchpad |
| --- | --- |
| Create | Exact ETH fee, fixed supply, creator and project terms, factory events and transaction |
| Trade on curve | Virtual curve terms, actual ETH backing, quotes, progress and fees |
| Graduate | Funded threshold, canonical full PoolKey, deposited assets and LP custody |
| Trade on v4 | Verified pool identity, transaction settlement and observed routing availability |

Pool creation and external indexing are separate observations. The original LP position stays permanently locked. Its earned fees are claimable under the launch's fixed allocations. Swaps through other pools generate no fees for this position.

Active curves can migrate from V1 to V2 and then to V3 after creator approval, two independent signatures and public notice for each transition. Later adjacent versions require independently reviewed template approval and exact successor authorization. Migration preserves the token, holder balances, tracked backing, inventory and original fee ledger. The token page shows the origin, current version and verified history.

## Development

Use the pinned toolchain and dependency lockfile.

```sh
pnpm install --frozen-lockfile
node packages/contracts/scripts/simulate-launch-curve.mjs
pnpm --filter web test:local-launchpad
pnpm typecheck
pnpm build
```

See the [independent-audit handoff](docs/RMT_CURVE_TASK021_AUDIT_HANDOFF.md), [curve review guide](docs/RMT_LAUNCH_CURVE_V1.md) and [repository authority](AGENTS.md).

The existing RMT token, deployed curve, balances, contracts, receipts and history retain their original terms. The [prior direct-to-v4 review](docs/RMT_LAUNCH_PRODUCTION_DATA_READINESS.md) is historical engineering evidence. LAMMB Empires continues independently.
