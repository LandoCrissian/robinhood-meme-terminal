# RMT Agent Engine

**Status: durable paper-only foundation with Strategy Compiler admission. Not a production service.**

The agent engine now has three layers:

- `AgentEngine`: deterministic paper-domain state machine with immutable strategy versions, seasons, decisions, predictions, accounts, orders, fills, portfolio snapshots, risk events and score snapshots.
- `DurableAgentEngine`: async persistence wrapper that adds idempotency keys, canonical request hashes, optimistic revisions, restart recovery and stale-worker conflict handling.
- `StrategyCompiler` + `StrategyAdmissionService`: converts an agent's stored natural-language thesis into a structured candidate, independently validates it against RMT compiler/safety policy, persists one canonical compilation result per request hash, and only then asks the durable engine to create the immutable strategy version.

A model is deliberately behind the `StrategyModelAdapter` interface. No OpenAI, Anthropic, Gemini or other concrete model SDK/provider is connected by this foundation, and model output is never treated as trusted policy.

## Persistence invariants

- `agent_engine_state` stores the canonical versioned paper snapshot and canonical SHA-256 state hash.
- every database read recomputes the snapshot hash before accepting persisted state;
- `agent_engine_mutations` provides unique `(stream_id, idempotency_key)` replay protection and records request/result/state hashes;
- durable commits take a per-stream PostgreSQL advisory transaction lock and compare the expected revision before writing;
- normalized tables project seasons, agents, strategy versions, decisions, predictions, paper accounts/orders/fills, portfolio snapshots, risk events and score snapshots in the same transaction;
- quote evidence is persisted in full, not only by hash, so a restored fill can independently recompute and verify its quote-evidence hash;
- the SQL state schema hard-constrains agent execution mode to `PAPER_ONLY`.

## Strategy Compiler invariants

- the exact stored agent thesis is normalized and hash-bound with compiler version, policy version, safety envelope, adapter identity and model identity;
- model output is parsed as an untrusted structured draft; malformed output is rejected rather than guessed into shape;
- risk limits are never silently raised or clamped by the model;
- allowed asset classes, asset-list sizes, signal counts and parameter counts are deterministic compiler policy;
- required prohibitions such as `ARBITRARY_CALL` and `UNVERIFIED_VENUE` are added by deterministic hardening even if the model omits them;
- admitted and candidate strategy payloads have independent hashes, and the full compilation record has its own canonical hash;
- `StrategyCompilationStore` makes a request hash first-writer-wins so concurrent model responses cannot create competing strategy versions for the same exact compilation request;
- `PostgresStrategyCompilationStore` stores the full tamper-checked compilation record and uses an advisory transaction lock. Its schema is explicit through `ensureSchema()` and expects the base agent tables to exist first;
- the admission service reuses the canonical compilation on retries and uses the compilation request hash as the durable strategy-version idempotency boundary.

## Explicitly absent

There is still:

- no HTTP server;
- no concrete model provider/API key;
- no signer or private key;
- no wallet submission;
- no arbitrary contract-write path;
- no provider or fee activation;
- no `executeLive` method;
- no production database connection or environment change;
- no pooled capital or autonomous custody.

The next engineering layer is a verified read-only market/quote adapter plus the recurring paper-evaluation runner. Any future live intent must still pass through VNext's existing verification and authorization boundary.
