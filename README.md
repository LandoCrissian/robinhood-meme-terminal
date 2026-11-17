# RMT Launch

RMT Launch is a token launchpad for Robinhood Chain. Creators prepare a token, trade on its bonding curve, and graduate to Uniswap v4 with permanently locked initial liquidity. Projects can direct their own earnings to a creator wallet or an independent treasury.

[Open RMT Launch](https://www.rmtlaunch.fun) · [Architecture](docs/ARCHITECTURE.md) · [Creator treasuries](docs/CREATOR_TREASURIES.md) · [Deployment](docs/DEPLOYMENT.md) · [Security](docs/SECURITY.md)

The hosted site is read-only. The creator, trading, graduation and claim flows have been exercised with synthetic assets in isolated environments. Production execution remains **BLOCKED_NO_BROADCAST**.

## Fixed-supply candidate

The factory mints exactly **1,000,000,000 tokens** with 18 decimals for every launch. Creators choose project details and their own payout terms. Supply is fixed in the ERC-20 constructor and creation has no supply argument. After infrastructure deployment, verification and separate creation approval, the owner will create **RMT** through the normal website form. The infrastructure deployment package excludes token issuance. [Approved launch sequence](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/657#issuecomment-6951267519)

The candidate makes 600 million tokens available on the curve and reserves 400 million for graduation liquidity. The 90% project, 5% Operations and 5% Reserve split applies to curve trading fees and fees earned by the original locked LP position. Review configuration and production approvals are tracked separately. Earlier V4/V6 issuances have independent historical identities.

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
