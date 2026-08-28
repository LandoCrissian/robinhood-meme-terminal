# Robinhood Meme Terminal

Robinhood Meme Terminal (RMT) is the market operating layer for Robinhood Chain: a mobile-first, non-custodial system for discovering and understanding curated token and NFT markets, ownership, activity, portfolio state and canonical evidence.

- **Live application:** [www.rmtlaunch.fun](https://www.rmtlaunch.fun)
- **Live status:** [www.rmtlaunch.fun/status](https://www.rmtlaunch.fun/status)
- **Risk disclosures:** [www.rmtlaunch.fun/risks](https://www.rmtlaunch.fun/risks)
- **Network:** Robinhood Chain mainnet (`4663`)

RMT is independent software. It is not Robinhood Markets, Inc., an official Robinhood product, or evidence of endorsement by any integrated protocol or data provider.

## Product direction

RMT connects discovery, the curated Token Terminal, the curated NFT Terminal, Project Market, portfolio/ownership, market activity, community and future distribution. It is not a launchpad or a generic NFT marketplace clone.

The terminal loop is:

```text
SCAN → VERIFY → ANALYZE → EXECUTE → RECONCILE → MANAGE
```

Terminal VNext is the canonical Token Terminal architecture served from `/`. The former `/vnext` address redirects to the public root; preserved legacy market and portfolio routes are compatibility-only and are not separate terminal architectures. The curated NFT Terminal is an active product lane served from `/nft`; future token/NFT connections require verified Project Market identity rather than inferred branding relationships.

Read the current system-of-record documents before substantial work:

- [Architecture freeze](docs/ARCHITECTURE_FREEZE.md)
- [Active system map](docs/ACTIVE_SYSTEM_MAP.md)
- [Terminal completion gate](docs/TERMINAL_COMPLETION_GATE.md)
- [VNext architecture](docs/RMT_TERMINAL_VNEXT_ARCHITECTURE.md)
- [Execution revenue architecture](docs/RMT_EXECUTION_REVENUE.md)

## Current terminal behavior

RMT currently provides:

- exactly eight owner-curated Robinhood Chain token markets with live enrichment, canonical identity and venue evidence;
- self-custodial wallet connection plus VNext quote, verification, authorization, recovery and portfolio foundations while public wallet submission remains disabled;
- an active curated NFT Terminal with CCFF00 as the only public `ACTIVE` project;
- technically verified, non-public `WATCHING` status for Robin Rabbits and Gogh Punks;
- canonical NFT ownership/activity foundations and separately labeled OpenSea marketplace evidence, with no NFT execution;
- VNext Spend Balance, asset-to-asset intent, provider comparison, authorization, settlement and recovery foundations;
- disabled-by-default up. v2 and up. Slipstream quote, strict-verification and exact wallet-authorization paths with live onchain fee evidence; controlled mainnet proofs and explicit release activation remain pending;
- canonical V6 compatibility for the existing official RMT market;
- independent external-origin and market indexers;
- chain-qualified asset and Robinhood stock-token evidence;
- release-gated, asynchronous cross-chain funding/recovery foundations.

RMT never receives a private key or recovery phrase. A provider quote is not permission to execute. Strict verification, wallet authorization, wallet submission and production activation are independently admitted. Public Token Terminal wallet execution remains disabled through the default-false client authorization, server authorization and wallet-submission gates.

Current owner product policy is `RMT_FEE = 0`. No RMT trading fee is authorized for activation, and fee work is not a Token Terminal completion prerequisite. The repository preserves the prior `RMT_EXECUTION_V1` deployment, controlled proof, release boundary, receipts and monitoring as historical technical evidence, and preserves `RMT_EXECUTION_V2` as dormant implementation work. Neither record self-authorizes current or future fee activation. See the [execution revenue historical record](docs/RMT_EXECUTION_REVENUE.md).

## Paused product systems

Profiles, referrals, RMT Live/community, creator applications, creator media/releases, V7 launches, creator marketplace creation and new token launches remain paused unless separately reauthorized. The active curated NFT Terminal, NFT technical verification and NFT marketplace read-evidence foundations are not part of this paused Creator/V7 classification.

Their source, tests, Firestore rules and stored user data are preserved. They are not current roadmap authority and are not required for wallet trading. Minimal authenticated wallet identity remains active security infrastructure so protected endpoints can bind the session to the exact recipient wallet.

The public `/launch` route is a permanent product-direction notice, not a promise that launching will reopen through V7.

## Deployed V6 compatibility

RMT V6 remains a live mainnet compatibility domain for its existing official market. New V6 creation is closed.

| Current V6 component | Mainnet address |
| --- | --- |
| Governance and protocol treasury | [`0x52c43239df8965eb27f26e115cc5ead11b35d5c3`](https://robinhoodchain.blockscout.com/address/0x52c43239df8965eb27f26e115cc5ead11b35d5c3) |
| Version registry | [`0x27c0269e16209eee149e2738d0819a2633f44246`](https://robinhoodchain.blockscout.com/address/0x27c0269e16209eee149e2738d0819a2633f44246) |
| V6 launch factory | [`0x8e75c57079a01ce2094bc4187b78710887547651`](https://robinhoodchain.blockscout.com/address/0x8e75c57079a01ce2094bc4187b78710887547651) |
| V6 policy registry | [`0x70177a46a38c981480fee9586ccbe281ee70dfcf`](https://robinhoodchain.blockscout.com/address/0x70177a46a38c981480fee9586ccbe281ee70dfcf) |
| Uniswap v4 graduation adapter | [`0x680a227794b1204a57aab6bac56a84d3280e40a6`](https://robinhoodchain.blockscout.com/address/0x680a227794b1204a57aab6bac56a84d3280e40a6) |

The V6 factory was deployed at block `10248855`. The [canonical V6 deployment record](docs/MAINNET_V6_DEPLOYMENT.md) preserves addresses, receipts and deployed economics. Historical V6 fee splits are deployed-protocol facts, not forward terminal fee policy.

RMT V4/V5 and earlier generations are retired historical systems. Their source and records remain for onchain compatibility and evidence, not as product roadmap.

## Service ownership

- `apps/web` — canonical production VNext terminal plus preserved compatibility routes, trading, wallet, evidence and recovery UI
- `apps/indexer` — canonical deployed V6 event/history authority
- `apps/external-origin-indexer` — fail-closed external project-origin attribution
- `apps/market-indexer` — optional historical external-market infrastructure; not a curated Token Terminal admission dependency
- `apps/nft-indexer` — canonical NFT ownership, mint, transfer and burn evidence
- `apps/nft-marketplace-indexer` — marketplace read evidence, separate from canonical ownership and NFT execution
- `packages/contracts` — deployed compatibility, terminal security, paused experimental and retired historical contract source
- `packages/shared` — shared chain and market-origin types
- `docs` — architecture, deployment, operations, security, historical and research records with status defined by the active system map

Origin, market venue and RMT execution attribution are separate. A source listing does not prove token creation, and an observed trade does not prove RMT originated it.

## Development and verification

The project targets Node 22, pnpm 10.12.1, Solidity 0.8.26 and Foundry 1.7.1.

```bash
pnpm install --frozen-lockfile
pnpm audit:production
pnpm test:terminal-release
pnpm typecheck
pnpm build
```

Paused and legacy systems retain a separate integrity command:

```bash
pnpm test:paused-integrity
```

Affected indexer, Firestore, contract, security and visual suites remain required for their domains. Use committed `.env.example` files as configuration references. Never commit RPC credentials, database tokens, Firebase Admin keys, indexer bearer tokens, wallet keys, recovery phrases or signed production transactions.

## Security

RMT evidence is time-bound. No terminal can guarantee that a token is safe, profitable or sellable in every future state. Exact recipients, assets, protected output, approvals, provider targets, deadlines, order economics and transaction payloads must be verified before wallet authorization.

See the [risk disclosures](https://www.rmtlaunch.fun/risks), [incident response plan](docs/INCIDENT_RESPONSE.md), [security review scope](docs/SECURITY_REVIEW_SCOPE.md), [external Uniswap boundary](docs/EXTERNAL_UNISWAP_TRADING.md), and [third-party notices](docs/THIRD_PARTY_NOTICES.md).
