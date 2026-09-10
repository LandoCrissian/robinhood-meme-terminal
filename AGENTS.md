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
- Current public Token Terminal execution is `ZERO_X_ONLY` (`zero-x-swap`). Detailed provider/source authority is [the 0x AllowanceHolder boundary](docs/RMT_ZEROX_ALLOWANCE_HOLDER_PUBLIC_EXECUTION_V1.md); [execution hot-path authorities](docs/execution-hot-path-authorities.md) governs identity, intelligence, execution and settlement separation. Current economics use `PROVIDER_NATIVE_INPUT_FEE`, not historical custom-executor policy as provider-independent authority.
- Public wallet submission is user-controlled and enabled only behind existing release/authorization gates and explicit wallet review/confirmation. RMT never automatically signs or broadcasts, holds private keys/seed phrases, or autonomously executes customer trades. Background work never signs or submits. Stock Tokens remain view-only/execution-ineligible, fail closed. Strict firm verification, committed authorization, simulation and settlement reconciliation remain mandatory.
- Preserve Uniswap V3/V2 deployments, controlled proofs, receipts, hashes, manifests and `RMT_EXECUTION_V1/V2` release records as historical/versioned evidence, not current public-provider authority. Source or deployment existence never activates a provider.
- NFT execution is `NONE`. Marketplace providers supply read evidence only and never replace canonical ownership authority.
- Preserve exact recipient binding, narrow approvals, pinned deployment/runtime evidence, provider-specific verification, and fail-closed unknown-field behavior.
- `apps/indexer` is deployed V6 compatibility; `apps/external-origin-indexer` owns external project origin; `apps/market-indexer` is optional historical external-market infrastructure. Origin, venue, marketplace evidence, ownership, and RMT execution attribution remain independent.
- Do not deploy, change production environment values, enable providers/fees/automation, broadcast transactions, promote `WATCHING` to `ACTIVE`, admit assets, merge, or delete user data without explicit owner authorization. “Continue” is not merge or deployment authorization.
- Read the relevant domain document before changing execution, funding, indexers, contracts, NFT verification, or marketplace evidence. Historical documents and research are not current roadmap authority.
- Run validation proportionate to the change. Documentation-only authority work does not require a production build unless a repository rule or affected executable surface requires it.
- Update current authority documents only for explicit owner decisions. Do not rewrite valid historical records.

## Authority resolution

Durable safety, security and prohibition invariants remain binding across domains. For mutable current-state facts (provider, release state, economics or verification boundary), the newest explicit owner-approved CURRENT authority for that exact domain governs; older general current-state prose does not override it. Establish owner approval, scope and supersession, not merely a newer filename, timestamp or source implementation. Neither execution reference above governs unrelated domains or proves current Production environment values.

An exact task narrows work; it does not broaden product, R2/R3 or Production authority. An explicit owner decision may be recorded only through permitted change control. Historical/research records and worker output are evidence, not authority. If scope, recency and explicit owner decision cannot resolve two CURRENT claims, `STOP_FOR_OWNER_REVIEW`. See the deterministic procedure in [RMT Agent Control Plane](docs/RMT_AGENT_CONTROL_PLANE.md).
