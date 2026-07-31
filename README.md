# Robinhood Meme Terminal

Robinhood Meme Terminal (RMT) is a mobile-first, non-custodial market terminal and creator ecosystem for Robinhood Chain.

- **Live application:** [www.rmtlaunch.fun](https://www.rmtlaunch.fun)
- **Live status:** [www.rmtlaunch.fun/status](https://www.rmtlaunch.fun/status)
- **Risk disclosures:** [www.rmtlaunch.fun/risks](https://www.rmtlaunch.fun/risks)
- **Official RMT market:** [`0xdBa33be56C89CC9fc014c4459028d7e5c7878671`](https://www.rmtlaunch.fun/project/0xdBa33be56C89CC9fc014c4459028d7e5c7878671?launch=0)
- **Network:** Robinhood Chain mainnet (`4663`)

RMT is independent software. It is not Robinhood Markets, Inc., an official Robinhood product, or evidence of an endorsement by any integrated protocol or data provider.

## What is live

### Terminal

Terminal is the primary trading and discovery surface for markets launched outside RMT.

- aggregated Robinhood Chain market discovery across Pons, Lemon, Sushi, Uniswap, and the wider ecosystem;
- current age, liquidity, volume, market-cap, activity, origin, and movement signals;
- token and pool identity checks, observed exit evidence, holder and creator signals, route constraints, and explicit limitations;
- in-RMT, self-custodial buy and sell preparation;
- automatic comparison of eligible Sushi, Uniswap v3, and Passport-gated Uniswap v4 routes;
- wallet review and confirmation for every transaction;
- no trading fee added by RMT. Venue fees, price impact, slippage, approvals, and network gas still apply and remain visible.

RMT never receives a private key, recovery phrase, or authority to move funds without the connected wallet’s explicit approval.

### RMT ecosystem

Explore is the home for reviewed RMT projects, creator pages, games, and RMT-native markets. Projects do not need a token to apply.

- reviewed project applications and owner assignments;
- dedicated project identity and audience tools;
- optional token, game, art, music, NFT, marketplace, and community module preparation for V7;
- private creator controls and bounded media publishing;
- project follows, referrals, watchlists, and cross-device profiles;
- RMT Live for public chat, feedback, bug reports, updates, moderation, and approximate privacy-preserving presence.

Creator and marketplace contracts are not represented as production-ready until their separate architecture, tests, security review, and release gates are complete.

## RMT-native protocol status

RMT V6 is a live mainnet beta for its existing official market. New V6 token creation is intentionally paused while V7 is designed and reviewed. The public site cannot reopen V6 launches through an environment-variable change.

| Current V6 component | Mainnet address |
| --- | --- |
| Governance and protocol treasury | [`0x52c43239df8965eb27f26e115cc5ead11b35d5c3`](https://robinhoodchain.blockscout.com/address/0x52c43239df8965eb27f26e115cc5ead11b35d5c3) |
| Version registry | [`0x27c0269e16209eee149e2738d0819a2633f44246`](https://robinhoodchain.blockscout.com/address/0x27c0269e16209eee149e2738d0819a2633f44246) |
| V6 launch factory | [`0x8e75c57079a01ce2094bc4187b78710887547651`](https://robinhoodchain.blockscout.com/address/0x8e75c57079a01ce2094bc4187b78710887547651) |
| V6 policy registry | [`0x70177a46a38c981480fee9586ccbe281ee70dfcf`](https://robinhoodchain.blockscout.com/address/0x70177a46a38c981480fee9586ccbe281ee70dfcf) |
| Uniswap v4 graduation adapter | [`0x680a227794b1204a57aab6bac56a84d3280e40a6`](https://robinhoodchain.blockscout.com/address/0x680a227794b1204a57aab6bac56a84d3280e40a6) |

The V6 factory was deployed at block `10248855`. The [canonical V6 deployment record](docs/MAINNET_V6_DEPLOYMENT.md) contains the currently reconstructed foundation addresses and receipts.

### V6 economics

| Parameter | V6 value |
| --- | --- |
| Token supply | Fixed `1,000,000,000` |
| Creator launch allocation | None; the full supply enters the market |
| Bonding-curve fee | `1%` |
| Graduation target | `2 ETH` net real reserve |
| Creator share of genuine trading fees | `70%` |
| RMT protocol share of genuine trading fees | `30%` |
| Post-graduation Uniswap v4 pool fee | `0.5%` |
| Graduation liquidity | Full range and permanently locked |

The 70/30 split applies to V6 curve fees and collected fees from the canonical Uniswap v4 position. It does not create an additional token allocation, ownership of liquidity principal, or a claim that revenue is guaranteed.

## Retired RMT generations

RMT V4 and V5 are retired product generations. They are not selectable launch versions, do not appear as current RMT markets, and are not part of the public V7 direction.

RMT V4 infrastructure was deployed and received one explicitly disposable operator smoke token used to prove the bounded launch loop. No community or public project launched through RMT V4. Its contracts remain onchain and cannot be deleted, so the repository preserves their records only as historical evidence and as part of the legacy name/ticker reservation chain.

The archived records live under [`docs/archive/rmt-v4`](docs/archive/rmt-v4/README.md). “RMT V4” is not the same thing as **Uniswap v4**, which is a current external DEX protocol used by eligible RMT trading and V6 graduation routes.

## Profiles and Bring Your Desk

Profiles are optional and separate from wallet connection.

- local mode works automatically without an account;
- cloud mode synchronizes profile preferences and watchlists through a private Firebase workspace;
- users may continue with Google or use a passwordless sign-in link sent to Gmail, Outlook, Yahoo, iCloud, Proton, a business address, or another valid email provider;
- email-link completion requires control of the same address and never places the address in the link URL;
- the sign-in identity does not grant wallet, trade, approval, or custody permission.

See [Firebase profile setup](docs/FIREBASE_PROFILES.md) for the data model, security rules, provider configuration, and activation checks.

## Data and reliability

Wallet transactions do not depend on the profile database or market indexer.

- Firebase Authentication and Firestore provide optional profile, creator, referral, and community features.
- The confirmed market-data service runs through a protected Railway/PostgreSQL indexer and a same-origin cache.
- During an indexer delay, RMT keeps the last confirmed snapshot visible instead of rebuilding the complete history in every visitor’s browser.
- Production health checks verify the canonical domain, V6 registry/factory bindings, launch pause, market feeds, and critical external dependencies.

## Repository map

- `apps/web` — Next.js terminal, trading, discovery, creator ecosystem, profiles, community, disclosures, and operations UI
- `apps/indexer` — confirmed RMT V6 event indexer and protected read API
- `apps/market-indexer` — rebuildable external DEX market index
- `apps/external-origin-indexer` — launch-origin and metadata ingestion
- `packages/contracts` — Foundry contracts, scripts, fork tests, fuzz tests, and invariants
- `packages/shared` — shared Robinhood Chain and market-origin types
- `docs` — current architecture, deployment, operations, monitoring, and security records
- `docs/archive` — retired release evidence that remains available without being presented as the current product

## Development

The project targets Node 22, pnpm 10.12.1, Solidity 0.8.26, and Foundry 1.7.1.

```bash
pnpm install --frozen-lockfile
pnpm audit:production
pnpm test:firebase-rules
pnpm --filter web test:profile
pnpm --filter web test:public-discovery
pnpm --filter web test:trade-ticket
pnpm --filter web test:external-venues
pnpm typecheck
pnpm build

cd packages/contracts
forge fmt --check
forge build
forge test -vvv
```

Use the committed `.env.example` files as the configuration reference. Never commit RPC credentials, database tokens, Firebase Admin keys, indexer bearer tokens, wallet keys, recovery phrases, or signed production transactions.

## Security status

RMT V6 is an explicitly disclosed mainnet beta. Automated tests, state verification, fork rehearsals, failure simulation, and static analysis reduce risk but do not replace an independent audit.

No terminal can guarantee that a token is safe, profitable, or sellable in every future state. RMT evidence is time-bound and must be reviewed before every wallet confirmation.

Read the [risk disclosures](https://www.rmtlaunch.fun/risks), [incident response plan](docs/INCIDENT_RESPONSE.md), [security review scope](docs/SECURITY_REVIEW_SCOPE.md), [external Uniswap trading boundary](docs/EXTERNAL_UNISWAP_TRADING.md), and [V6 deployment record](docs/MAINNET_V6_DEPLOYMENT.md).

See [third-party notices](docs/THIRD_PARTY_NOTICES.md) for upstream licensing and integration boundaries.

## Support RMT

RMT can be supported through [GitHub Sponsors](https://github.com/sponsors/LandoCrissian).

Sponsorship helps fund infrastructure, security testing, verified integrations, mobile reliability, and public documentation. It is voluntary support—not an investment, token purchase, listing fee, revenue share, or partnership. See the [RMT sponsorship policy](docs/SPONSORSHIP.md).
