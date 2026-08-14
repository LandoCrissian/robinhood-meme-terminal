# RMT Agent Engine

**Status: durable paper-only foundation. Not a production service.**

The agent engine now has two layers:

- `AgentEngine`: deterministic paper-domain state machine with immutable strategy versions, seasons, decisions, predictions, accounts, orders, fills, portfolio snapshots, risk events and score snapshots.
- `DurableAgentEngine`: async persistence wrapper that adds idempotency keys, canonical request hashes, optimistic revisions, restart recovery and stale-worker conflict handling.

`PostgresAgentStateStore` supplies the PostgreSQL persistence boundary without importing `pg` at module scope. A runtime service can inject a compatible pool later, keeping this foundation dependency-neutral and leaving the existing pnpm dependency graph untouched.

## Persistence invariants

- `agent_engine_state` stores the canonical versioned snapshot and canonical SHA-256 state hash.
- every database read recomputes the snapshot hash before accepting persisted state;
- `agent_engine_mutations` provides unique `(stream_id, idempotency_key)` replay protection and records request/result/state hashes;
- commits take a per-stream PostgreSQL advisory transaction lock and compare the expected revision before writing;
- normalized tables project seasons, agents, strategy versions, decisions, predictions, paper accounts/orders/fills, portfolio snapshots, risk events and score snapshots in the same transaction;
- quote evidence is persisted in full, not only by hash, so a restored fill can independently recompute and verify its quote-evidence hash;
- the SQL schema hard-constrains agent execution mode to `PAPER_ONLY`.

## Explicitly absent

There is still:

- no HTTP server;
- no signer or private key;
- no wallet submission;
- no arbitrary contract-write path;
- no provider or fee activation;
- no `executeLive` method;
- no production database connection or environment change;
- no pooled capital or autonomous custody.

The next engineering layer is the structured Strategy Compiler: natural language -> validated `StrategySpec`, followed by a verified read-only market/quote adapter. Any future live intent must still pass through VNext's existing verification and authorization boundary.
