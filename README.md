# Robinhood Meme Terminal

Robinhood Meme Terminal (RMT) is a mobile-first meme-token launchpad, bonding-curve market, reward system, and discovery terminal for Robinhood Chain.

## Current status

The public application is a Robinhood Chain **testnet alpha**. The following loop is live and has been exercised end to end:

- connect an EVM wallet
- create a fixed-supply token and market in one signature
- upload optional permanent IPFS artwork and metadata
- buy and sell through the token's bonding curve
- route the disclosed trading fee to an onchain reward vault
- inspect market activity and claim accrued rewards

DEX graduation is deliberately disabled in the lightweight public testnet stack. The market keeps its real ETH reserve, but no UI or documentation should represent DEX migration as active until the production adapter is deployed and independently reviewed.

## Product principles

- Three-field default launch flow with optional media and socials
- Fixed one-billion-token supply controlled by the launch market
- No mint authority, blacklist, transfer tax, or upgrade proxy
- Wallet-signed transactions only; RMT never requests private keys
- Transparent creator, community, trader, and platform fee splits
- Market reserves remain separate from discretionary reward vaults
- Mainnet deployment automatically creates 2-of-3 governance and five purpose-specific protocol vaults from three independent signer addresses
- Testnet, staging, and mainnet behavior are labeled honestly

## Architecture

- `apps/web` — Next.js launch, discovery, trading, and rewards interface
- `packages/contracts` — Foundry contracts, deployment scripts, fuzz tests, and invariants
- `packages/shared` — shared chain configuration
- `docs` — deployment, graduation, and launch-readiness records

The Fresh feed reads verified factory events through a cached server API, while token-market history still comes directly from Robinhood Chain testnet. That is acceptable for the limited alpha, but a persistent reorg-safe indexer is required before a public mainnet launch.

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

- Never commit a private key, seed phrase, API secret, or signed production transaction.
- Mainnet deployment requires three distinct signer wallets, an explicit confirmation phrase, and a dedicated funded deployer.
- Governance signers are public address inputs only; private keys and recovery phrases never belong in the repository, chat, Vercel, or screenshots.
- Current contracts and economic parameters require independent review before mainnet use.
- Automated checks describe known contract properties; they do not guarantee a token is safe.
