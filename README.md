# RMT Launch

**A dedicated token launchpad for Robinhood Chain.**

Owner direction, 2026-11-11: return RMT to token launches, keep the existing clean UI, preserve the existing RMT token/curve, and make new third-party launches usable outside the RMT interface. LAMMB Empires continues independently.

## Implementation status

The implementation branch opens the launchpad directly. Its local Base Sepolia fork supports creating fixed-supply tokens, funding hookless Uniswap v4 pools, permanent position custody, buying and selling, and creator fee claims. Launch receipts are verified and published before the bounded indexer reconciles them. Mainnet and hosted transaction paths are disabled.

See the [local runbook and visual evidence](docs/RMT_LAUNCH_V4_LOCAL.md), [private HTTPS preview](docs/RMT_LAUNCH_PRIVATE_PREVIEW.md), and [REST and MCP read tools](docs/RMT_LAUNCH_PUBLIC_READS.md). External routing is unknown until independently observed.

## Product boundary

Keep the existing mobile/desktop design system, branding, wallet connection, token detail/trade surfaces, safe transaction recovery and reusable launch indexing. Focus the product on discovering launches, creating a token, managing its launch and transparently accounting for applicable fees.

Remove unrelated terminal expansion from the forward roadmap: NFT marketplace/catalog products, general stock-token/RWA discovery, social profiles and referrals, community chat, creator NFT products, general-purpose distribution, agent products and broad chain intelligence. Retire their runtime use only after shared dependencies are separated and tested.

## Existing-token protection

No existing token supply, address, contract, curve, holder balance, fee entitlement, liquidity position or transaction history is changed by this reset. V6 and older deployed artifacts remain compatibility/history evidence, not the template for new public launches.

Pinned chain records distinguish the original V4 issuance from the official V6 launch 0. The record preserves the separate addresses and the later product retirement decision. [Legacy RMT evidence](docs/RMT_LAUNCH_BASELINE_EVIDENCE.md).

## Development map

- [Owner scope, research and staged cleanup](docs/RMT_LAUNCHPAD_RESET_2026-11-11.md)
- [Architecture and authorization boundary](docs/ARCHITECTURE_FREEZE.md)
- [Runtime inventory and target disposition](docs/ACTIVE_SYSTEM_MAP.md)
- [Agent/contributor instructions](AGENTS.md)
- [Historical V6 deployment evidence](docs/MAINNET_V6_DEPLOYMENT.md)
- [Historical terminal authority snapshot](docs/archive/terminal-scope-2026-11-11/README.md)

The retired CannaCat integration drafts #575 and #581 are closed. The release stack retains generic wallet, execution and recovery protections. LAMMB Empires continues independently.

## Verification

Use the repository's pinned toolchain and lockfile. The existing documented checks include:

```sh
pnpm install --frozen-lockfile
pnpm audit:production
pnpm test:terminal-release
pnpm typecheck
pnpm build
```

Run the affected contract/indexer/security/visual suites as well. Existing command names reflect the current runtime; renaming a command does not complete the migration. The local launchpad test commands and their evidence boundaries are in the runbook.

## Release and security

Changes stay in reviewable PRs. No automatic merge, production deployment, onchain transaction, provider or fee activation, service shutdown or database deletion. Wallet actions remain explicitly user-confirmed, non-custodial and bound to verified transaction terms. Retain reconciliation and recovery for existing transactions.

RMT is independent software, not Robinhood Markets, Inc. or an official Robinhood product. Protocol integration does not imply endorsement. Token launches can lose all value; contract verification, liquidity locks and listing status are not guarantees of safety or profitability.
