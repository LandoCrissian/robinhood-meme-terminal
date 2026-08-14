# RMT repository map

RMT is a Robinhood Chain market, execution, wallet, portfolio, funding, attribution and RWA terminal. It is not a launchpad.

Before substantial work, read:

1. [`docs/ARCHITECTURE_FREEZE.md`](docs/ARCHITECTURE_FREEZE.md)
2. [`docs/ACTIVE_SYSTEM_MAP.md`](docs/ACTIVE_SYSTEM_MAP.md)
3. [`docs/TERMINAL_COMPLETION_GATE.md`](docs/TERMINAL_COMPLETION_GATE.md)
4. [`docs/agents/ARCHITECTURE.md`](docs/agents/ARCHITECTURE.md) before agent-system work

Working rules:

- VNext (`apps/web/lib/vnext/*`, `apps/web/lib/server/vnext-*`) is the canonical forward terminal architecture. Do not create another terminal or routing framework.
- Profiles, referrals, community/RMT Live, creator/V7, NFT, marketplace and new-launch product work are paused. Preserve their source, tests, rules and stored data unless a separate project explicitly authorizes a change.
- `apps/indexer` is deployed V6 compatibility. `apps/external-origin-indexer` owns external project origin. `apps/market-indexer` owns external market intelligence. Origin, venue and RMT execution attribution are independent.
- `packages/agent-core` owns pure agent schemas, Strategy Compiler policy/admission validation, state transitions, canonical hashes and deterministic scoring. `apps/agent-engine` owns the separate paper-only runtime, durable state, compiler adapter boundary and compilation persistence. Never hide agent execution, signing or treasury behavior inside `apps/market-indexer`.
- Model adapters are untrusted structured-input providers. No concrete model provider, SDK or API key is production-admitted merely because the Strategy Compiler boundary exists. Model output cannot raise the RMT safety envelope, bypass required prohibitions or grant execution authority.
- Paper market-source adapters are read-only evidence providers. `PaperEvaluationService` v1 may produce only `NO_ACTION` or `PREDICTION`, must retain the exact paper-account and market snapshots used by the decision, and must not expose paper-order creation, VNext submission, wallet signing, arbitrary calldata or live execution.
- Evaluation keys are canonical first-writer-wins boundaries. A retry must reuse the stored run rather than re-querying a market source or model and creating a competing historical decision.
- Agent foundation work is paper-only unless a later reviewed release explicitly admits a VNext execution-intent bridge. The agent engine must not contain a signer, private key, wallet submission, arbitrary calldata, contract-write path, provider/fee activation or production environment mutation.
- A future live agent is an untrusted typed-intent proposer. VNext remains authoritative for provider observation, strict verification, authorization, wallet/signer policy, submission and receipt reconciliation.
- Implementation support is approved for `RMT_EXECUTION_V1`: 25 basis points, floor rounding, no minimum and 100% allocation to RMT operations. Production fee collection remains disabled and requires a separate explicit release decision. Do not infer buyback allocation or production activation from the policy.
- Preserve exact recipient binding, narrow approvals, pinned deployment/runtime evidence, provider-specific verification and fail-closed unknown-field behavior.
- Do not deploy contracts, change production environment values, enable providers/fees/automation, merge, or delete user data unless explicitly requested.
- Read the relevant domain document before changing execution, funding, indexers, agents or contracts. Research and open PRs are not roadmap authority.
- Run focused tests plus the terminal release lane, typecheck, production build, security/secret checks and any affected service tests when the touched domain requires them.
- Update architecture documents only when an explicit architecture decision changes. Do not infer roadmap from historical filenames or contract source presence.
