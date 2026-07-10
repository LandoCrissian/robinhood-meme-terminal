# Robinhood Meme Terminal

Mobile-first EVM meme-token launch and discovery terminal.

## Status

Initial scaffold. The first release will target a test network before any mainnet deployment.

## MVP

- Wallet connection and network validation
- Fixed-supply ERC-20 deployment through a factory
- Token launch form with image and social metadata
- Transaction progress and explorer links
- New-launch feed and basic contract safety indicators
- No custodial keys and no hidden minting privileges

## Architecture

- `apps/web` — Next.js frontend
- `packages/contracts` — Foundry smart contracts and tests
- `packages/shared` — shared types, validation, and chain configuration

## Security rules

- Never commit private keys or seed phrases.
- Mainnet deployment remains disabled until contracts are tested and reviewed.
- Generated tokens are fixed supply unless a future token template explicitly discloses otherwise.
