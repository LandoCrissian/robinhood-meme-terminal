# RMT Agent Core

Paper-only foundation types and deterministic policy/scoring utilities for the RMT agent system.

Current scope:

- immutable `StrategySpec` schema and safety-envelope validation;
- performance/execution state types and performance transition guard;
- canonical SHA-256 payload and paper-quote evidence hashes;
- prediction, decision, paper order/fill/account and portfolio snapshot records;
- time-decayed weighted Brier score;
- integer-basis-point return and maximum-drawdown helpers.

This foundation is intentionally source-only and has no package manifest or third-party runtime dependency yet. It runs under the repository's Node 22 target with TypeScript stripping. Packaging is deferred to the persistence/compiler phase so this change does not alter the frozen pnpm lockfile.
