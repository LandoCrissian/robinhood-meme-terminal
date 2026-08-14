# RMT Agent Engine

**Status: durable paper-only foundation with Strategy Compiler admission, read-only evaluation runs, verified Robinhood-stock market evidence and a controlled scheduler. Not a production service.**

The agent engine now has six layers:

- `AgentEngine`: deterministic paper-domain state machine with immutable strategy versions, seasons, decisions, predictions, accounts, orders, fills, portfolio snapshots, risk events and score snapshots.
- `DurableAgentEngine`: async persistence wrapper that adds idempotency keys, canonical request hashes, optimistic revisions, restart recovery and stale-worker conflict handling.
- `StrategyCompiler` + `StrategyAdmissionService`: converts an agent's stored natural-language thesis into a structured candidate, independently validates it against RMT compiler/safety policy, persists one canonical compilation result per request hash, and only then asks the durable engine to create the immutable strategy version.
- `PaperEvaluationService`: consumes a read-only market-source adapter and an untrusted decision adapter, stores one canonical run per evaluation key, and v1 may write only a decision plus an optional probabilistic prediction. It has no paper-order or live-execution method.
- `RmtRobinhoodStockMarketSource`: adapts RMT's existing VNext market-directory shape to paper evidence, but admits an RWA only after exact contract-address membership in the complete Robinhood Stock Token registry snapshot. Same-symbol non-registry tokens are excluded.
- `PaperEvaluationScheduler`: a bounded `runOnce()` scheduler that derives deterministic evaluation slots from each strategy interval, de-duplicates duplicate candidates, caps concurrency and delegates replay protection to the canonical run store. It does not own a hidden timer or background loop.

A model is deliberately behind adapter interfaces. No OpenAI, Anthropic, Gemini or other concrete model SDK/provider is connected by this foundation, and model output is never treated as trusted policy.

The market-evidence source preserves existing RMT security boundaries. It consumes a read-only market-directory reader plus the existing Robinhood-stock registry snapshot contract; it does **not** call the wallet-authenticated VNext quote route and does not weaken recipient authentication. Executable quote reuse remains a later paper-fill boundary.

## Persistence invariants

- `agent_engine_state` stores the canonical versioned paper snapshot and canonical SHA-256 state hash.
- every database read recomputes the snapshot hash before accepting persisted state;
- `agent_engine_mutations` provides unique `(stream_id, idempotency_key)` replay protection and records request/result/state hashes;
- durable commits take a per-stream PostgreSQL advisory transaction lock and compare the expected revision before writing;
- normalized tables project seasons, agents, strategy versions, decisions, predictions, paper accounts/orders/fills, portfolio snapshots, risk events and score snapshots in the same transaction;
- quote evidence is persisted in full, not only by hash, so a restored fill can independently recompute and verify its quote-evidence hash;
- the SQL state schema hard-constrains agent execution mode to `PAPER_ONLY`.

## Paper evaluation and market-evidence invariants

- an evaluation key is a logical idempotency boundary. Once a canonical run exists, retries reuse it before calling the market source or decision model again;
- each run binds the exact strategy version/hash, paper-account snapshot, market snapshot, runner version, market-source identity, decision-adapter identity and model identity;
- `RmtRobinhoodStockMarketSource` is RWA-only in v1 and refuses mixed `COMMUNITY` scope;
- Robinhood-stock identity comes from exact contract-address membership in a complete registry snapshot, never from directory symbol/name alone;
- the verified Robinhood registry symbol is the v1 strategy/prediction identifier only after contract membership and active status are proven; duplicate active registry symbols fail closed;
- the source uses VNext directory `priceUsd`, `liquidityUsd`, `volume24h`, `priceChange24h`, market-cap, pair and DEX evidence where available, and converts monetary values to integer six-decimal USD evidence;
- stale/error directory payloads and unavailable registry coverage fail closed;
- v1 decision output remains restricted to `NO_ACTION` or `PREDICTION` only;
- `PaperEvaluationScheduler` computes the current slot only—no unbounded catch-up—and has no paper-order or live-execution capability.

## Explicitly absent

There is still:

- no HTTP server;
- no concrete model provider/API key;
- no production worker/cron deployment;
- no community-asset classification authority in this RWA source;
- no executable VNext quote adapter for paper fills yet;
- no paper-order creation from the evaluation scheduler;
- no signer or private key;
- no wallet submission;
- no arbitrary contract-write path;
- no provider or fee activation;
- no `executeLive` method;
- no production database connection or environment change;
- no pooled capital or autonomous custody.

The next engineering boundary is an executable **paper quote adapter** that reuses VNext's normalized provider quote semantics without calling or weakening the wallet-authenticated trade endpoint. Only after that is proven should the evaluation pipeline be allowed to generate paper order intents and simulated fills.
