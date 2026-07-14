# Robinhood Meme Terminal

Robinhood Meme Terminal (RMT) is a mobile-first meme-token launchpad, bonding-curve market, reward system, and discovery terminal for Robinhood Chain.

**Public mainnet beta:** https://www.rmtlaunch.fun

## Current status

RMT currently has a **V5 mainnet beta stack** on Robinhood Chain. The policy-driven V6 release is a draft candidate and is not deployed or active. The public application reads the active factory through the onchain version registry. A bounded disposable V5 mainnet launch has exercised:

- wallet connection and one-signature token creation
- fixed-supply market custody
- bonding-curve buying and selling
- disclosed fee accrual
- creator reward claims
- live discovery, token pages, search, watchlists, and connected-wallet holdings

Production graduation has passed the permanent mainnet-fork release test against the deployed contracts. No live public token has completed the full DEX migration yet. The contracts have not received an independent security audit and must not be described as audited or risk-free.

See [MAINNET_V5_DEPLOYMENT.md](docs/MAINNET_V5_DEPLOYMENT.md) for current deployed addresses, [V6_MAINNET_RELEASE.md](docs/V6_MAINNET_RELEASE.md) for the paused-first V6 process, [V6_RELEASE_CHECKLIST.md](docs/V6_RELEASE_CHECKLIST.md) for remaining gates, and [INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md) for operational procedures.

## Product principles

- Three-field default launch flow with optional media and socials
- Fixed one-billion-token supply controlled by the launch market
- No mint authority, blacklist, transfer tax, or token upgrade proxy
- Wallet-signed transactions only; RMT never requests private keys
- Transparent creator and protocol fee destinations
- Market reserves remain separate from discretionary reward vaults
- Mainnet uses delayed expandable 1-of-1 governance today, with an onchain path to add signers later
- Public claims must match deployed behavior

## Architecture

- `apps/web` — Next.js launch, discovery, trading, portfolio, rewards, and public disclosures
- `packages/contracts` — Foundry contracts, deployment scripts, fork tests, fuzz tests, and invariants
- `packages/shared` — shared chain configuration
- `docs` — deployment, security-review, incident-response, and launch-readiness records

The repository includes a persistent indexer with schema checks. Production health, reorg handling, monitoring, and V6 event ingestion must still be verified against the final deployed addresses before public V6 launches reopen.

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
