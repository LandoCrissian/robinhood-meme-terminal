# Robinhood Meme Terminal

Robinhood Meme Terminal (RMT) is a mobile-first launch, discovery, and trading terminal for meme tokens on Robinhood Chain.

- **Live app:** [www.rmtlaunch.fun](https://www.rmtlaunch.fun)
- **Protocol status:** [www.rmtlaunch.fun/status](https://www.rmtlaunch.fun/status)
- **Official RMT V6 token:** [`0xdBa33be56C89CC9fc014c4459028d7e5c7878671`](https://www.rmtlaunch.fun/token/0xdBa33be56C89CC9fc014c4459028d7e5c7878671?launch=0)
- **Chain:** Robinhood Chain mainnet (`4663`)

## Live V6 status

RMT V6 is deployed, active, and open for public token creation. The production application resolves the active factory through the V6 version registry and displays only origin-verified V6 launches in RMT Discovery.

| Component | Mainnet address |
| --- | --- |
| V6 governance and protocol treasury | [`0x52c43239df8965eb27f26e115cc5ead11b35d5c3`](https://robinhoodchain.blockscout.com/address/0x52c43239df8965eb27f26e115cc5ead11b35d5c3) |
| Version registry | [`0x27c0269e16209eee149e2738d0819a2633f44246`](https://robinhoodchain.blockscout.com/address/0x27c0269e16209eee149e2738d0819a2633f44246) |
| V6 launch factory | [`0x8e75c57079a01ce2094bc4187b78710887547651`](https://robinhoodchain.blockscout.com/address/0x8e75c57079a01ce2094bc4187b78710887547651) |
| Policy registry | [`0x70177a46a38c981480fee9586ccbe281ee70dfcf`](https://robinhoodchain.blockscout.com/address/0x70177a46a38c981480fee9586ccbe281ee70dfcf) |
| V4 graduation adapter | [`0x680a227794b1204a57aab6bac56a84d3280e40a6`](https://robinhoodchain.blockscout.com/address/0x680a227794b1204a57aab6bac56a84d3280e40a6) |

The V6 factory was deployed at block `10248855`. See the [canonical V6 deployment record](docs/MAINNET_V6_DEPLOYMENT.md) for the top-level foundation addresses and creation receipts currently reconstructed. V4 and V5 records remain in this repository as labeled historical evidence; their launches are not mixed into the V6 terminal.

## What RMT offers

- One-transaction fixed-supply token creation
- Unique RMT launch names and tickers, including legacy RMT reservation checks
- Optional Fair Start protection for the opening blocks
- Live bonding-curve buy and sell quotes
- Immediate Buy and Sell actions from RMT Discovery
- Native in-RMT buy and sell review for canonical graduated RMT V4 pools, using Uniswap's official Quoter, Universal Router, and amount-limited Permit2 approvals
- Creator concentration and creator-wallet activity signals
- Transparent progress toward permissionless Uniswap V4 graduation
- Creator rewards before and after graduation
- Connected-wallet balances for the active discovery set and a local-device watchlist page
- Optional private Firebase profiles with Google sign-in and live profile/watchlist sync across devices; local mode remains the automatic fallback
- Clearly labeled external Robinhood Chain market discovery in Runner Radar
- A continuous edge-to-edge operator interface across discovery, trading, runners, portfolio, watchlist, launch, and live status, with responsive terminal layouts instead of nested card grids

Wallet ownership remains the authority for launches and trades. The application never receives a private key, seed phrase, or permission to move assets on a user&apos;s behalf.

## Wallet funding

RMT includes an environment-gated Add funds experience for Robinhood Connect. It remains in a clearly labeled pending state until Robinhood approves RMT and issues the exact partner checkout or SDK configuration. After approval, set `NEXT_PUBLIC_ROBINHOOD_CONNECT_ENABLED=true` and use the official Robinhood-hosted HTTPS URL in `NEXT_PUBLIC_ROBINHOOD_CONNECT_URL`.

Payment, identity-verification, Google Pay, card, and bank details must remain inside the provider-hosted flow. RMT must never collect or proxy that information. Google Pay must be described as an eligible payment option, not a guarantee, because Robinhood controls availability by user, account, device, transaction, and region. Adding Robinhood cards to Google Wallet remains a Robinhood/Google Wallet account action outside RMT.

## V6 economics

| Parameter | V6 value |
| --- | --- |
| Token supply | Fixed `1,000,000,000` |
| Creator launch allocation | None; the full supply enters the market |
| Bonding-curve fee | `1%` |
| Graduation target | `2 ETH` net real reserve |
| Creator share of trading fees | `70%` |
| RMT protocol share of trading fees | `30%` |
| Post-graduation V4 pool fee | `0.5%` |
| Graduation liquidity | Full range and permanently locked |

The 70/30 split applies to curve fees and to collected fees from the canonical V4 position after graduation. Post-graduation fees can be received in ETH or the launched token according to swap direction; they are fees, not an additional token allocation or ownership of liquidity principal.

The original creator is permanently recorded. A creator cannot self-change the creator-share recipient. Delayed V6 governance can redirect only future creator-share payments to the immutable protocol treasury or restore the immutable original creator; previously paid rewards and purchased tokens cannot be clawed back.

The legacy token [`0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C`](https://robinhoodchain.blockscout.com/address/0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C) is the official V6 launch&apos;s identity and provenance anchor only. The live official V6 token has its own address and fixed one-billion-token supply; legacy balances were not copied, swapped, or migrated.

## Fair Start

Fair Start is the default launch policy, not a permanent trading restriction:

- one-block opening delay
- ten protected blocks
- maximum `1%` of supply per opening buy
- maximum `3%` per wallet during the protected window
- one buy per wallet per block

The Open policy uses the same supply, fee split, curve, and graduation economics without the temporary opening limits.

## Data and reliability

Trading and launches remain wallet-to-contract transactions. They do not depend on the database or indexer.

Firebase Authentication and Firestore are optional offchain profile conveniences. If they are unconfigured or unavailable, profiles and watchlists remain local and every wallet, launch, discovery, and trading path continues operating. See [Firebase profile setup](docs/FIREBASE_PROFILES.md) for the isolated data model, rules, test suite, and activation order.

The public discovery feed uses the read-only Railway/PostgreSQL indexer for confirmed launch and trade data, with a same-origin shared cache and a last-confirmed-data state during delays. This avoids making every visitor rescan the complete factory history through an RPC provider. Creator concentration is enriched with a single batched balance read per shared refresh.

Runner Radar ranks only eligible external base tokens quoted against canonical WETH/USDG assets, then rejects invalid or zero-address identities and confirmed RMT V6 launches. DEX Screener price and valuation fields therefore cannot be reassigned to the opposite side of a pair, and a native-asset sentinel or malformed token record can never become an external Buy/Sell target.

Production monitoring requests checks of the canonical domain, V6 registry and factory bindings, immutable economics, latest market, graduation adapter, indexer health, launch-feed source, and official-market trade data every five minutes. GitHub Actions scheduling is best-effort, so an independent uptime service remains required for dependable 1–5 minute alerting.

## Repository map

- `apps/web` — Next.js terminal, launch flow, trading, discovery, portfolio, and disclosures
- `apps/indexer` — persistent V6 event indexer and protected read API
- `apps/external-origin-indexer` — activation-locked external-origin research/indexer scaffold; no external adapters are active yet
- `packages/contracts` — Foundry contracts, deployment scripts, fork tests, fuzz tests, and invariants
- `packages/shared` — shared Robinhood Chain and market-origin types
- `docs` — deployment, operations, monitoring, incident response, and security-review records

## Development

The project targets Node 22, pnpm 10.12.1, Solidity 0.8.26, and Foundry 1.7.1. Keep Foundry pinned when reproducing the mainnet-fork execution suite.

```bash
pnpm install --frozen-lockfile
pnpm audit:production
pnpm test:firebase-rules
pnpm --filter web test:profile
pnpm --filter web test:reliability
pnpm --filter web test:v4-trade
pnpm typecheck
pnpm build

cd packages/contracts
forge fmt --check
forge build
forge test -vvv
```

Use `.env.example` files as the configuration reference. Never commit RPC keys, database credentials, indexer bearer tokens, wallet keys, seed phrases, or signed production transactions.

The web application encodes the reviewed Universal Router 2.1.1 command and V4 action ABI with the existing pinned `viem` dependency. RMT independently pins and verifies the Robinhood Chain deployment addresses and its immutable V6 pool configuration before returning calldata. Update these ABIs or addresses only with matching official deployment evidence, exact calldata regression tests, and the mainnet-fork Buy/Sell execution test.

See the [dependency security policy](docs/DEPENDENCY_SECURITY.md) for the enforced pnpm build allowlist, workspace overrides, audit gate, and the reviewed moderate wallet-connector advisory.

## Security status

RMT V6 is an explicitly disclosed mainnet beta. Automated tests, mainnet-fork rehearsals, invariant checks, static analysis, and live state verification reduce risk but do not replace an independent security audit.

Exact Blockscout source publication is also incomplete: key V6 explorer records currently do not show the canonical Solidity 0.8.26, optimizer-200, via-IR source match. Explorer pages are useful for address, bytecode, transaction, and event inspection, but RMT must not describe the V6 contracts as exactly source-verified or independently audited until those separate tasks are completed.

Read the [risk disclosures](https://www.rmtlaunch.fun/risks), [incident response plan](docs/INCIDENT_RESPONSE.md), [security review scope](docs/SECURITY_REVIEW_SCOPE.md), and [V6 protocol foundation](docs/V6_PROTOCOL_FOUNDATION.md) before operating or reviewing the protocol.

See [third-party notices](docs/THIRD_PARTY_NOTICES.md) for the Sushi V3 ABI compatibility reference and upstream licensing boundary.

The testnet-first [RMT consent-based Sushi V3 migration design](docs/LIQUIDITY_RESCUE.md) explores a direct, self-custodial mint into one code-bound Robinhood Chain WETH market. A valueless Sushi V3 ABI-compatible rehearsal stack is source verified on Robinhood Chain Testnet and remains paused with no public execution path. It cannot access source pools or pool customer funds, is isolated from the live V6 contracts, and is not an official Sushi deployment or production AMM.
