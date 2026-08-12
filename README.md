# Robinhood Meme Terminal

Robinhood Meme Terminal (RMT) is a mobile-first, non-custodial Robinhood Chain terminal for discovering, comparing and trading ecosystem markets.

- **Live application:** [www.rmtlaunch.fun](https://www.rmtlaunch.fun)
- **Live status:** [www.rmtlaunch.fun/status](https://www.rmtlaunch.fun/status)
- **Risk disclosures:** [www.rmtlaunch.fun/risks](https://www.rmtlaunch.fun/risks)
- **Network:** Robinhood Chain mainnet (`4663`)

RMT is independent software. It is not Robinhood Markets, Inc., an official Robinhood product, or evidence of endorsement by any integrated protocol or data provider.

## Product direction

RMT is a discovery, market-intelligence, execution, wallet portfolio, funding, attribution and RWA terminal. It is not a launchpad.

The terminal loop is:

```text
SCAN → VERIFY → ANALYZE → EXECUTE → RECONCILE → MANAGE
```

The canonical forward architecture is Terminal VNext. During migration, the current production terminal remains at `/` and the forward terminal remains at `/vnext`. Production root cutover happens only after the documented completion gate passes; the repository will not create another terminal generation.

Read the current system-of-record documents before substantial work:

- [Architecture freeze](docs/ARCHITECTURE_FREEZE.md)
- [Active system map](docs/ACTIVE_SYSTEM_MAP.md)
- [Terminal completion gate](docs/TERMINAL_COMPLETION_GATE.md)
- [VNext architecture](docs/RMT_TERMINAL_VNEXT_ARCHITECTURE.md)

## Current terminal behavior

RMT provides:

- Robinhood Chain market discovery with origin, venue, age, liquidity, activity and market evidence;
- self-custodial wallet connection and wallet-reviewed transactions;
- verified Sushi and Uniswap execution where an independently supported route exists;
- VNext Spend Balance, asset-to-asset intent, provider comparison, authorization, settlement and recovery foundations;
- disabled-by-default up. v2 and up. Slipstream quote observation with live onchain fee evidence, without signing or execution activation;
- canonical V6 compatibility for the existing official RMT market;
- independent external-origin and market indexers;
- chain-qualified asset and Robinhood stock-token evidence;
- release-gated, asynchronous cross-chain funding/recovery foundations.

RMT never receives a private key or recovery phrase. A provider quote is not permission to execute. Strict verification, wallet authorization and production activation are independently admitted.

No forward RMT terminal execution fee or treasury policy is approved. RMT adds no enabled trading fee. Venue fees, price impact, slippage, approvals and network gas remain visible where applicable.

## Paused product systems

Profiles, referrals, RMT Live/community, creator applications, creator media/releases, V7 launches, NFT/marketplace preparation and new token launches are paused during terminal completion.

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

- `apps/web` — production compatibility terminal, canonical VNext terminal, trading, wallet, evidence and recovery UI
- `apps/indexer` — canonical deployed V6 event/history authority
- `apps/external-origin-indexer` — fail-closed external project-origin attribution
- `apps/market-indexer` — read-oriented external market discovery and enrichment
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
