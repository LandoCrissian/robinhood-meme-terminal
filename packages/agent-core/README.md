# RMT Agent Core

Paper-only foundation types and deterministic policy/scoring utilities for the RMT agent system.

Current scope:

- immutable `StrategySpec` schema and safety-envelope validation;
- versioned Strategy Compiler policy, request hashing, structured-draft parsing, hardening and admission validation;
- tamper-evident Strategy Compilation records that separate a model candidate from the admitted strategy;
- canonical read-only market snapshots with bounded observations/features, positive reference prices, freshness identity and duplicate-pair rejection;
- tamper-evident paper evaluation-run records that bind the exact strategy, paper-account snapshot, market snapshot, model proposal and runner identity used by a decision;
- v1 paper-evaluation proposal validation restricted to `NO_ACTION` or probabilistic `PREDICTION`;
- performance/execution state types and performance transition guard;
- canonical SHA-256 payload and paper-quote evidence hashes;
- prediction, decision, paper order/fill/account and portfolio snapshot records;
- time-decayed weighted Brier score;
- integer-basis-point return and maximum-drawdown helpers.

The compiler never grants itself wider risk limits. Candidate strategies that exceed the RMT safety envelope or compiler policy are rejected; hard-required prohibitions may only be added, never removed.

Paper evaluation also fails closed: a prediction must use an asset present in the exact stored market snapshot and permitted by the admitted strategy, while prediction resolution time is derived from the strategy horizon rather than chosen by a model.

This foundation is the private, source-first `@rmt/agent-core` workspace package. Its root export is `src/index.ts`; its package-scoped TypeScript project checks all source and smoke files. It has no runtime package dependency and runs under the repository's Node 22 target with TypeScript stripping. Concrete model and market-data providers are deliberately outside `agent-core`; adapters are untrusted inputs to deterministic compiler/evaluation boundaries.
