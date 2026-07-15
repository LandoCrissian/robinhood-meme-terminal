# Robinhood Meme Terminal

Robinhood Meme Terminal (RMT) is a mobile-first meme-token launchpad, bonding-curve market, reward system, and discovery terminal for Robinhood Chain.

**Public mainnet beta:** https://www.rmtlaunch.fun

## Current status

RMT currently has a **V5 mainnet beta stack** on Robinhood Chain. The frozen V6 release candidate is merged into `main` but is not deployed or active. The public application reads the active factory through the onchain version registry. A bounded disposable V5 mainnet launch has exercised:

- wallet connection and one-signature token creation
- fixed-supply market custody
- bonding-curve buying and selling
- disclosed fee accrual
- creator reward claims
- live discovery, token pages, search, watchlists, and connected-wallet holdings

The frozen V6 candidate passed its exact-commit build, 218-test suite, static-analysis gate, generated-artifact check, and Robinhood mainnet-fork deployment rehearsal before merge. No live public token has completed the full DEX migration yet. The contracts have not received an independent security audit and must not be described as audited or risk-free.

See [MAINNET_V5_DEPLOYMENT.md](docs/MAINNET_V5_DEPLOYMENT.md) for current deployed addresses, [V6_MAINNET_RELEASE.md](docs/V6_MAINNET_RELEASE.md) for the paused-first V6 process, [V6_RELEASE_CHECKLIST.md](docs/V6_RELEASE_CHECKLIST.md) for remaining gates, and [INCIDENT_RESPONSE.md](docs/INCIDENT_RESPONSE.md) for operational procedures.

## Product principles

- Three-field default launch flow with optional media and socials
- Fixed one-billion-token supply controlled by the launch market
- V6 gives creators no initial token allocation or liquidity ownership; the full supply enters the market
- No mint authority, blacklist, transfer tax, or token upgrade proxy
- Wallet-signed transactions only; RMT never requests private keys
- Transparent creator and protocol fee destinations
- V6 splits genuine curve and canonical post-graduation swap fees 70% to the current creator-share recipient and 30% to RMT. Post-graduation fees may arrive as ETH or the launched token according to swap direction; they are not supply or liquidity principal.
- Creators cannot authorize, propose, choose, or directly change the payout address. The RMT signer may propose only a delayed, evidence-linked redirect to the immutable V6 governance treasury or restoration to the immutable original creator. After the delay, any account may relay the exact approved governance call but cannot alter it or receive funds.
- The one-time official V6 RMT migration is permanently bound to legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C`; that address is only an identity/provenance anchor. The V6 launch creates a new token contract with a new address and new one-billion-token supply. Old V5 holder balances are not copied, swapped, or migrated. Name/ticker protection is scoped to origin-verified RMT launches, not arbitrary external ERC-20 contracts.
- The official V6 RMT launch uses the operator as its ordinary creator recipient (70%) and the separate V6 governance treasury as protocol recipient (30%); it is not a same-wallet 100% payout.
- Market reserves remain separate from fee splitters and treasury actions
- V6 deploys one fresh protocol-wide governance contract that is also the protocol treasury, plus a fresh registry governed by that same contract and initialized to the legacy V5 factory/version. V6 does not depend on the legacy V5 governance or old registry. RMTMain is the sole initial signer, with a 24-hour delay, seven-day execution window, cancellable/expiring proposals, public transaction inspection, atomic signer/threshold rotation, and configuration-epoch invalidation of stale proposals. Any future signer must prove control and give expiring consent to the exact add-or-replace action, affected signer, threshold, and current epoch, and may revoke unconsumed consent before execution. Adding the first extra wallet creates 2-of-2 governance, not a backup key. Loss of the sole initial signer freezes treasury and protocol control; compromise can authorize treasury/control calls after the delay. In 2-of-2 mode, loss of either signer freezes governance.
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
- Existing tokens, markets, fee splitters, and liquidity cannot be rewritten by a future factory version.
- Report suspected incidents using the public Support page and the private security channel once published.
