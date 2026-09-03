# RMT repository authority

RMT is becoming the market operating layer for Robinhood Chain. Current product architecture connects discovery, the curated Token Terminal, the curated NFT Terminal, Project Market, portfolio/ownership, market activity, community, and future distribution.

Before substantial work, read:

1. [`docs/ARCHITECTURE_FREEZE.md`](docs/ARCHITECTURE_FREEZE.md)
2. [`docs/ACTIVE_SYSTEM_MAP.md`](docs/ACTIVE_SYSTEM_MAP.md)
3. [`docs/TERMINAL_COMPLETION_GATE.md`](docs/TERMINAL_COMPLETION_GATE.md)

Working rules:

- VNext (`apps/web/lib/vnext/*`, `apps/web/lib/server/vnext-*`) remains the canonical Token Terminal architecture. Its eight owner-curated markets are canonical seed authority, not a ceiling on bounded public Robinhood Chain market visibility. Visibility, curated authority and execution eligibility remain separate; do not restore exhaustive chain-wide indexing as a Terminal dependency or create another state/execution framework.
- The NFT Terminal is an active, curated, read-only-execution product lane. CCFF00 is the only public `ACTIVE` NFT project. Robin Rabbits and Gogh Punks are technically verified `WATCHING` projects; `WATCHING` never implies public admission.
- Creator/V7 launch, creator media/marketplace creation, profiles/referrals, and community/RMT Live remain separate preserved domains and are paused unless explicitly reauthorized. Do not bundle the active NFT Terminal back into Creator/V7.
- Project Market is the future evidence-backed connection between token and NFT lanes. Never infer an NFT-to-ERC20 relationship from names, symbols, branding, metadata, or contract functions; require owner confirmation plus independent technical verification.
- Current owner product policy is the shared `RMT_EXECUTION_V2` atomic 25-basis-point input fee. Uniswap V3 V2 is public and live in Production. Uniswap V2 V2 is deployed and has one successful controlled native-input mainnet proof, but its public execution remains off pending a separate explicit owner-authorized Production release. Preserve `RMT_EXECUTION_V1` deployments, proofs, receipts, hashes, manifests and release boundaries as historical evidence.
- Public Token Terminal wallet execution is exact-provider release-scoped. Preserve the live Uniswap V3 V2 boundary and keep Uniswap V2 V2 public authorization off and outside the Production provider scope unless the owner explicitly authorizes the separate release action.
- NFT execution is `NONE`. Marketplace providers supply read evidence only and never replace canonical ownership authority.
- Preserve exact recipient binding, narrow approvals, pinned deployment/runtime evidence, provider-specific verification, and fail-closed unknown-field behavior.
- `apps/indexer` is deployed V6 compatibility; `apps/external-origin-indexer` owns external project origin; `apps/market-indexer` is optional historical external-market infrastructure. Origin, venue, marketplace evidence, ownership, and RMT execution attribution remain independent.
- Do not deploy, change production environment values, enable providers/fees/automation, broadcast transactions, promote `WATCHING` to `ACTIVE`, admit assets, merge, or delete user data without explicit owner authorization. “Continue” is not merge or deployment authorization.
- Read the relevant domain document before changing execution, funding, indexers, contracts, NFT verification, or marketplace evidence. Historical documents and research are not current roadmap authority.
- Run validation proportionate to the change. Documentation-only authority work does not require a production build unless a repository rule or affected executable surface requires it.
- Update current authority documents only for explicit owner decisions. Do not rewrite valid historical records.
