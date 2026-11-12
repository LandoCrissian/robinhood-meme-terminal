# RMT Launch

**A dedicated token launchpad for Robinhood Chain.**

Owner direction, 2026-11-11: return RMT to token launches, keep the existing clean UI, preserve the existing RMT token/curve, and make new third-party launches usable outside the RMT interface. LAMMB Empires continues independently.

## Implementation status

This change records the scope reset and a source-backed implementation plan. It does **not** implement a new launch factory, remove the existing runtime features, enable launches, change production, or migrate a token. The current codebase still contains the broader terminal and its compatibility services.

The proposed new-launch architecture is an RMT-owned factory that creates a standard token and funds a standard Uniswap v4 pool at launch. It is separate from the existing deployed RMT curve. External discovery and routing depend on the individual platform; deploying a token does not list it everywhere automatically.

## Product boundary

Keep the existing mobile/desktop design system, branding, wallet connection, token detail/trade surfaces, safe transaction recovery and reusable launch indexing. Focus the product on discovering launches, creating a token, managing its launch and transparently accounting for applicable fees.

Remove unrelated terminal expansion from the forward roadmap: NFT marketplace/catalog products, general stock-token/RWA discovery, social profiles and referrals, community chat, creator NFT products, general-purpose distribution, agent products and broad chain intelligence. Retire their runtime use only after shared dependencies are separated and tested.

## Existing-token protection

No existing token supply, address, contract, curve, holder balance, fee entitlement, liquidity position or transaction history is changed by this reset. V6 and older deployed artifacts remain compatibility/history evidence, not the template for new public launches.

There is a documented conflict between this repository's earlier README and its V6 deployment record concerning historical launch 0. Do not guess the current-token address or describe a historical token as current without reconciling factory events and deployment records. The cleanup preserves all bindings while this is resolved.

## Development map

- [Owner scope, research and staged cleanup](docs/RMT_LAUNCHPAD_RESET_2026-11-11.md)
- [Architecture and authorization boundary](docs/ARCHITECTURE_FREEZE.md)
- [Runtime inventory and target disposition](docs/ACTIVE_SYSTEM_MAP.md)
- [Agent/contributor instructions](AGENTS.md)
- [Historical V6 deployment evidence](docs/MAINNET_V6_DEPLOYMENT.md)
- [Historical terminal authority snapshot](docs/archive/terminal-scope-2026-11-11/README.md)

The current terminal execution/recovery stack also has a LAMMB embed consumer in open PR #575. Separate that dependency before deleting shared modules. Do not merge or modify that PR as an incidental part of this cleanup.

## Verification

Use the repository's pinned toolchain and lockfile. The existing documented checks include:

```sh
pnpm install --frozen-lockfile
pnpm audit:production
pnpm test:terminal-release
pnpm typecheck
pnpm build
```

Run the affected contract/indexer/security/visual suites as well. Existing command names reflect the current runtime; renaming a command does not complete the migration. No local full build or contract suite was run for this documentation-only reset.

## Release and security

Changes stay in reviewable PRs. No automatic merge, production deployment, onchain transaction, provider or fee activation, service shutdown or database deletion. Wallet actions remain explicitly user-confirmed, non-custodial and bound to verified transaction terms. Retain reconciliation and recovery for existing transactions.

RMT is independent software, not Robinhood Markets, Inc. or an official Robinhood product. Protocol integration does not imply endorsement. Token launches can lose all value; contract verification, liquidity locks and listing status are not guarantees of safety or profitability.
