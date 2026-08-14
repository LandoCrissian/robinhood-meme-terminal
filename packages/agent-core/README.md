# RMT Agent Core

Paper-only foundation types and deterministic policy/scoring utilities for the RMT agent system.

Current scope:

- immutable `StrategySpec` schema and safety-envelope validation;
- versioned Strategy Compiler policy, request hashing, structured-draft parsing, hardening and admission validation;
- tamper-evident Strategy Compilation records that separate a model candidate from the admitted strategy;
- performance/execution state types and performance transition guard;
- canonical SHA-256 payload and paper-quote evidence hashes;
- prediction, decision, paper order/fill/account and portfolio snapshot records;
- time-decayed weighted Brier score;
- integer-basis-point return and maximum-drawdown helpers.

The compiler never grants itself wider risk limits. Candidate strategies that exceed the RMT safety envelope or compiler policy are rejected; hard-required prohibitions may only be added, never removed.

This foundation remains source-only and has no package manifest or third-party runtime dependency. It runs under the repository's Node 22 target with TypeScript stripping. A concrete model SDK/provider is deliberately outside `agent-core`; model adapters are untrusted inputs to the deterministic compiler boundary.
