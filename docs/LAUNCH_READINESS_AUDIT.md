# RMT Launch-Readiness Audit

Status date: 2026-07-13  
Scope: public Robinhood Chain testnet alpha and the repository's current `main` branch

## Executive assessment

RMT has a working testnet vertical slice: launch, discover, buy, sell, accrue fees, and claim rewards. The core alpha is real, but it is not yet authorized for a public mainnet launch. The largest remaining risks are the missing production graduation adapter, browser-side historical indexing, unaudited economics/contracts, single-controller community-purpose vaults, and incomplete operational controls.

## V1 product gate

The first public release should remain intentionally narrow:

1. Connect wallet.
2. Launch a fixed-supply token with name, ticker, and description.
3. Add optional artwork and social links.
4. Buy and sell on the bonding curve.
5. See price, market cap, reserve, and recent trades.
6. Share a permanent token page.
7. See and claim transparent rewards.

Profiles, comments, notifications, creator seasons, Reddit integrations, advanced referrals, and governance remain future modules. They should not delay or complicate V1.

## Findings

### P0 — blocks mainnet

- **Production graduation is not active.** The public testnet adapter deliberately reverts. A production DEX adapter, one-time migration flow, LP custody policy, and failure recovery must be reviewed and tested end to end.
- **No independent smart-contract review.** Factory, market, vault, graduation, clone initialization, rounding, reentrancy, MEV, and economic invariants require an external review before mainnet value is accepted.
- **No production economic model.** The 1% fee, virtual reserves, graduation threshold, and reward splits are test/prototype decisions until simulated against launches, whales, panic sells, low liquidity, and gas costs.
- **Operational authority is not hardened.** Community-purpose vault releases use one controller address. Production needs a transparent multisig/timelock policy, monitoring, and documented incident procedures.

### P1 — required before a broad public beta

- **Direct browser event scanning will not scale.** Token pages and the feed query factory/trade history from the RPC. Add a reorg-safe, idempotent indexer and cached API before meaningful traffic.
- **Launch history must be permanent.** Feed scanning must begin at the recorded factory deployment block, not an arbitrary recent window.
- **Product claims must match deployed behavior.** Testnet must clearly say that DEX migration is disabled while launch, trading, fees, and claims remain live.
- **Dependency installs are not reproducible.** The repository has no committed pnpm lockfile. Add one and switch CI to frozen installs.
- **Frontend quality gates are incomplete.** Type checking and production builds run, but linting, component tests, wallet-flow tests, accessibility checks, and visual regression tests do not.
- **RPC usage is duplicated.** Market and rewards panels independently rediscover the same factory launch. Centralize launch records and share cached results.
- **Metadata availability needs redundancy.** IPFS content should use more than one gateway and expose a clear fallback when media cannot load.

### P2 — post-V1 improvements

- creator profiles and reputation
- saved scanners and watchlists
- comments and social activity
- push/email/webhook notifications
- public API and bot integrations
- referral campaigns with abuse controls
- community governance and bounty workflows

## Architecture boundaries

### Keep for V1

- fixed-supply, non-upgradeable token
- factory-created market and vault
- market-custodied public inventory
- pull-based reward claims
- preset fee configurations
- wallet-signed transactions

### Replace or harden before mainnet

- lightweight disabled graduation adapter
- single-controller purpose vault operations
- browser-only historical indexing
- testnet economic constants
- public RPC as the sole data plane

## Revenue and flywheel

Trading fees are protocol revenue; they are not a promise of token appreciation or user income. Every deployed preset must expose the fee and its destinations before signature. Graduation reserves stay in the market and must not be confused with a discretionary fee vault. Future buybacks, referrals, or ecosystem rewards require separate disclosed modules, caps, and abuse-resistant accounting.

## Definition of launch-ready

RMT is ready for mainnet only when:

- the complete launch-to-DEX lifecycle passes testnet and adversarial tests
- contract and economic reviews have no unresolved critical/high findings
- the indexer survives reorgs, retries, and RPC outages
- treasury/controller powers are multisig/timelocked and publicly documented
- CI is reproducible and covers frontend, contract, integration, accessibility, and deployment checks
- production monitoring, rollback boundaries, incident response, and source verification are operational
- every product claim can be proven from the deployed configuration

Until then, the public application remains a clearly labeled testnet alpha.
