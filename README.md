# Robinhood Meme Terminal

Robinhood Meme Terminal (RMT) is a mobile-first meme-token launchpad, bonding-curve market, reward system, and discovery terminal for Robinhood Chain.

## Current status

RMT has deployed a **mainnet beta stack** on Robinhood Chain. The public application reads the active factory through the onchain version registry. A bounded disposable mainnet launch has exercised:

- wallet connection and one-signature token creation
- fixed-supply market custody
- bonding-curve buying and selling
- disclosed fee accrual
- creator reward claims
- live discovery, token pages, search, watchlists, and connected-wallet holdings

Production graduation has passed the permanent mainnet-fork release test against the deployed contracts. No live public token has completed the full DEX migration yet. The contracts have not received an independent security audit and must not be described as audited or risk-free.

See [MAINNET_DEPLOYMENT.md](docs/MAINNET_DEPLOYMENT.md) for deployed addresses and smoke evidence, [LAUNCH_READINESS_AUDIT.md](docs/LAUNCH_READINESS_AUDIT.md) for remaining gates, and [INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md) for operational procedures.

## Product principles

- Three-field default launch flow with optional media and socials
- Fixed one-billion-token supply controlled by the launch market
- No mint authority, blacklist, transfer tax, or token upgrade proxy
- Wallet-signed transactions only; RMT never requests private keys
- Transparent creator, community, trader, and protocol fee destinations
- Market reserves remain separate from discretionary reward vaults
- Mainnet uses 2-of-3 governance and delayed factory-version activation
- Public claims must match deployed behavior

## Architecture

- `apps/web` — Next.js launch, discovery, trading, portfolio, rewards, and public disclosures
- `packages/contracts` — Foundry contracts, deployment scripts, fork tests, fuzz tests, and invariants
- `packages/shared` — shared chain configuration
- `docs` — deployment, security-review, incident-response, and launch-readiness records

The feed is served through a cached API, but token history still relies on RPC event reads. A persistent, reorg-safe indexer and production monitoring remain required before a broad unrestricted launch.

## Development

The project targets Node 22, pnpm 10.12.1, and Foundry.

```bash
pnpm install
pnpm typecheck
pnpm build

cd packages/contracts
forge fmt --check
forge build
forge test -vvv
```

## Security boundary

- Never commit or transmit a private key, seed phrase, API secret, or signed production transaction.
- Governance signers are public address inputs only.
- Automated tests and smoke transactions do not replace an independent audit.
- Existing tokens, markets, reward vaults, and liquidity cannot be rewritten by a future factory version.
- Report suspected incidents using the public Support page and the private security channel once published.
