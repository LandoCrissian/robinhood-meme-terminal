# RMT Launch

**A token launchpad for Robinhood Chain.**

RMT Launch is being built for project token creation, bonding-curve trading, and graduation to Uniswap v4 with permanently locked original liquidity. Creators retain control of their own earned fees and can configure independent project treasuries.

[Launchpad website](https://www.rmtlaunch.fun) · [Current release work](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/635) · [Clean launchpad codebase](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/628)

> **Release status: BLOCKED_NO_BROADCAST.** The new engine has passed isolated local and Robinhood Chain fork tests, but no new RMT token or new-engine launchpad contracts have been deployed for public use. The website remains read-only. The active code changes are under review and have not yet merged into `main`.

## The token engine

Every new project follows the same fixed supply:

| Feature | New launch policy |
| --- | --- |
| Network | Robinhood Chain (chain ID 4663) |
| Supply | **1,000,000,000 tokens** for every launch |
| Decimals | 18 |
| Creator supply choices | **None**; no additional minting |
| Bonding-curve inventory | **600,000,000 tokens (60%)** |
| Reserved graduation liquidity | **400,000,000 tokens (40%)** |
| Liquidity | Uniswap v4 graduation with permanently locked original LP principal |
| Eligible fee distribution | **90% project/creator, 5% RMT Operations, 5% RMT Reserve** |

Creation costs, trading fees, and the graduation threshold are subject to final release approval. Project creators choose their project identity and payout configuration, **not** the token supply.

## A brand-new RMT token

The **new RMT token** is planned as the first project launched through this engine, with its own newly issued token contract and address. It is **not** a continuation or reuse of earlier RMT token contracts. No live address for the new RMT token is available yet.

## Creator-controlled revenue

Each project keeps its own 90% allocation of eligible creator fees. Optional, isolated creator treasury automation is being developed so projects may allocate **their own earnings** toward rule-bound token or NFT purchases. No project is required to fund RMT or another project's acquisitions.

RMT's intended first use case is to purchase LAMMB NFTs with approved earnings from the **new RMT project**. LAMMB's own royalties and any purchases of new RMT tokens are a separate, independently authorized treasury flow. Automated acquisitions are **not live**.

## Development and verification

The reviewed candidate has completed synthetic tests for fixed-supply token creation, curve buys/sells, Uniswap v4 graduation, swap execution, fee collection, locked liquidity custody, and browser/indexer restart and reorg recovery. These tests do not constitute live production deployment or an independent security audit.

**Open release requirements** include technical disposition of **22 high-severity static-analysis findings and seven governance-medium findings**, verification of actual treasury smart contracts and release inputs, and hosted production indexing, routing, finality and wallet acceptance.

- [New fixed-supply token engine](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/629)
- [Current production-readiness candidate](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/635)
- [Creator treasury automation work](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/624)

RMT Launch is independent software, not an official Robinhood product or endorsement. Token prices, liquidity, creator earnings and investment outcomes are not guaranteed.
