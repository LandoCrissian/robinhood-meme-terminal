# RMT repository map

RMT is a Robinhood Chain market, execution, wallet, portfolio, funding, attribution and RWA terminal. It is not a launchpad.

Before substantial work, read:

1. [`docs/ARCHITECTURE_FREEZE.md`](docs/ARCHITECTURE_FREEZE.md)
2. [`docs/ACTIVE_SYSTEM_MAP.md`](docs/ACTIVE_SYSTEM_MAP.md)
3. [`docs/TERMINAL_COMPLETION_GATE.md`](docs/TERMINAL_COMPLETION_GATE.md)

Working rules:

- VNext (`apps/web/lib/vnext/*`, `apps/web/lib/server/vnext-*`) is the canonical forward terminal architecture. Do not create another terminal or routing framework.
- Profiles, referrals, community/RMT Live, creator/V7, NFT, marketplace and new-launch product work are paused. Preserve their source, tests, rules and stored data unless a separate project explicitly authorizes a change.
- `apps/indexer` is deployed V6 compatibility. `apps/external-origin-indexer` owns external project origin. `apps/market-indexer` owns external market intelligence. Origin, venue and RMT execution attribution are independent.
- Preserve `RMT_EXECUTION_V1` as immutable historical/public Uniswap V3 settlement evidence. The additive forward architecture is `RMT_EXECUTION_V2`: exactly 25 basis points on gross input for every wallet-executable RMT trade, with no per-token allowlist and no fee-free provider fallback. Until a provider has a reviewed, registered V2 atomic settlement implementation, it is quote-only. Never infer policy, treasury, settlement eligibility, or production activation.
- Preserve exact recipient binding, narrow approvals, pinned deployment/runtime evidence, provider-specific verification and fail-closed unknown-field behavior.
- Do not deploy contracts, change production environment values, enable providers/fees/automation, merge, or delete user data unless explicitly requested.
- Read the relevant domain document before changing execution, funding, indexers or contracts. Research and open PRs are not roadmap authority.
- Run focused tests plus the terminal release lane, typecheck, production build, security/secret checks and any affected service tests.
- Update architecture documents only when an explicit architecture decision changes. Do not infer roadmap from historical filenames or contract source presence.
