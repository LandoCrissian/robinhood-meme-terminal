# RMT Launch

RMT Launch is a token launchpad for Robinhood Chain. Creators prepare a token, trade on its bonding curve, and graduate to Uniswap v4 with permanently locked initial liquidity. Projects can direct their own earnings to a creator wallet or an independent treasury.

[Open RMT Launch](https://www.rmtlaunch.fun) · [Architecture](docs/ARCHITECTURE.md) · [Creator treasuries](docs/CREATOR_TREASURIES.md) · [Deployment](docs/DEPLOYMENT.md) · [Security](docs/SECURITY.md)

The hosted site is read-only. The creator, trading, graduation and claim flows have been exercised with synthetic assets in isolated environments. Production execution remains **BLOCKED_NO_BROADCAST**.

## Next release

[Task 049](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/626) implements a fresh RMT token as the first project on a separately versioned engine. Every creation will mint exactly **1,000,000,000 tokens** with 18 decimals and no further minting. Creators choose project details and their own payout terms. The factory sets supply without creator or administrator overrides. The current fixture predates that rule and still needs the contract, website and indexing changes in Task 049.

The proposed launch economics are 60% of supply for the curve and 40% for graduation liquidity. The 90% project, 5% Operations and 5% Reserve split applies to curve trading fees and fees earned by the original locked LP position. Review configuration and production approvals are tracked separately. Earlier V4/V6 issuances have independent historical identities.

## Local checks

Use Node 22 and pnpm 10.12.1. Run from the repository root.

~~~sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm test:release-evidence
node docs/evidence/rmt-task041-closeout/verify-release.mjs
~~~

The [deployment guide](docs/DEPLOYMENT.md) covers the isolated wallet/indexer rehearsal, pinned Robinhood 4663 fork and unsigned deployment evidence.
