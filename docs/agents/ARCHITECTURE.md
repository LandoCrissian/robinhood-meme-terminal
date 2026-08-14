# RMT agent architecture

**Status: CURRENT FOUNDATION — DURABLE PAPER ONLY**
**Admitted:** 2026-08-14

This document defines the RMT agent-system boundary. It authorizes a durable paper-only evaluation domain inside the existing RMT monorepo. It does not authorize live autonomous execution, wallet signing, fee activation, production configuration, pooled capital, copy trading, contract deployment, ERC-8004 publication or a public MCP server.

## Purpose

RMT agents are a new source of market analysis and, later, typed trade intent. They are not a second terminal and they do not bypass VNext.

The admitted flow is:

```text
owner thesis
→ immutable StrategySpec version
→ paper-active agent
→ auditable decision summary
→ prediction and/or paper order
→ delayed verified quote boundary
→ paper fill and atomic balance accounting
→ durable snapshot + mutation journal
→ restart/replay-safe paper state
→ prediction/trading/risk/season metrics
→ future qualification research
```

The eventual live boundary remains separate:

```text
qualified agent
→ typed RMT execution intent
→ existing VNext provider observation
→ strict verification
→ simulation / authorization policy
→ signer or wallet review
→ submission
→ canonical receipt reconciliation
```

The agent never becomes the authority for route validity, fee policy, signer permissions or settlement truth.

## Repository ownership

- `packages/agent-core`: pure TypeScript agent schemas, safety-envelope validation, state transitions, canonical hashing and deterministic scoring.
- `apps/agent-engine`: paper-only state machine, durable wrapper and PostgreSQL persistence contract. It owns agent-domain state; it does not own market discovery or live execution.
- `apps/market-indexer`: remains read-oriented external market discovery/enrichment. It is not repurposed into the agent engine.
- `apps/web`: remains the only terminal UI. Arena and agent surfaces may be added later without creating a second routing stack.
- future `apps/rmt-mcp`: separate external-agent gateway after the internal paper system is durable and abuse-controlled.

The current implementation still adds no workspace package manifests or new runtime dependencies. `PostgresAgentStateStore` accepts an injected SQL pool contract, so runtime packaging and an actual database connection remain a separate release decision.

## Two independent state dimensions

Performance state describes evidence quality:

```text
INCUBATING → PAPER_ACTIVE → QUALIFIED → ELITE
     └──────────────→ RETIRED ←──────────┘
```

Execution mode describes authority:

```text
PAPER_ONLY
LIVE_REVIEW_REQUIRED   (future)
LIVE_DELEGATED         (future)
SUSPENDED              (future)
```

The admitted engine only creates and restores `PAPER_ONLY`. Performance quality never grants live authority by itself. PostgreSQL repeats this invariant with a database constraint so persistence cannot silently admit a live execution mode.

## Strategy and season model

Natural-language strategy compilation is a later adapter. The authoritative runtime object is a versioned `StrategySpec`, not free-form prose.

Every strategy version is immutable and hash-bound. A strategy change creates a new contiguous version. Predictions, decisions and orders reference the exact strategy version that produced them.

The user strategy operates inside a separate RMT safety envelope. A strategy cannot raise its own limits above the envelope. The engine validates position, portfolio exposure, drawdown, daily loss, trade-count, slippage, price-impact and evaluation-frequency bounds both when a strategy is created and when persisted state is restored.

Paper accounts belong to explicit seasons. Account opening, order creation and fills must remain inside the season window. Seasons are performance/evaluation boundaries only; they do not grant execution authority.

## Durable state and idempotency

`AgentEngine` remains deterministic and synchronous. `DurableAgentEngine` wraps its mutations with an async persistence contract.

For every durable mutation:

1. operation name + request payload are canonical-hashed;
2. the caller supplies a non-empty idempotency key;
3. a prior matching mutation replays its original result without re-running UUID-producing logic;
4. the mutation executes against the current in-memory revision;
5. persistence compares the expected canonical revision;
6. a stale writer is rejected, its local mutation is discarded, and the worker resyncs from canonical state;
7. a successful write advances the revision exactly once.

The PostgreSQL adapter additionally takes a per-stream advisory transaction lock. This closes the first-write race where no state row exists yet.

## Persistence and integrity

The canonical durable row stores the full engine snapshot, schema version, revision and SHA-256 state hash. Reads recompute and verify that hash before hydration.

The mutation journal stores revision, idempotency key, operation, request hash, result JSON and resulting state hash. A unique `(stream_id, idempotency_key)` constraint makes retries database-enforced rather than process-local.

Normalized tables are maintained in the same transaction for queryability:

- seasons;
- agents;
- strategy versions;
- decisions;
- predictions;
- paper accounts;
- paper orders;
- paper fills;
- portfolio snapshots;
- risk events;
- score snapshots.

The snapshot remains the canonical restart boundary in this phase. Normalized tables are transactional projections and may later move to incremental event-specific writes as scale requires.

## Decisions and reasoning

The system records a concise auditable reasoning summary, model identity, compiler version, policy version, market-snapshot identity and canonical decision hash. It does not request or persist private chain-of-thought.

## Prediction versus trading evidence

Predictions and trades are distinct objects.

- Probabilistic predictions are resolved against later outcome evidence and scored with a time-decayed weighted Brier score.
- Paper trading is measured through fills, balances, mark NAV/liquidation NAV, simulated costs and risk events.
- Season score snapshots currently preserve Brier, prediction counts and paper-fill counts; this is evaluation evidence, not an automatic live gate.
- Brier score is not the RMT Agent Score and is not sufficient for qualification.

No fixed production qualification threshold is admitted. The old `14 predictions / Brier <= 0.20` concept is not a production gate.

## Paper-execution invariants

- Monetary amounts use unsigned atomic-unit integer strings and `bigint` arithmetic; JavaScript floating point is not used for balances.
- A paper order cannot fill from the same observation that created it. The engine enforces a configured delay before quote observation.
- Quote evidence is canonical-hash bound and must exactly match order assets and input amount.
- Full quote evidence is retained on each fill so the evidence hash can be recomputed after restart.
- Quote price impact must remain inside both the strategy and RMT safety envelope.
- Simulated fees and gas identify their own assets and are debited atomically with the paper fill.
- Failed validation leaves balances and order state unchanged.
- Persisted snapshots are integrity-validated before hydration, including strategy/decision hashes, contiguous versions, references and fill/order/evidence consistency.
- The engine exposes no `executeLive` path.

## Security boundary

The durable rule is:

> The AI is an untrusted transaction-intent proposer, never a trusted signer.

The agent domain must not gain arbitrary target/calldata execution, private-key access, unrestricted wallet methods or a path that bypasses VNext. Any later delegated signer adapter is independently scoped and reviewed after VNext verification, not embedded into strategy reasoning.

## Deferred phases

1. runtime packaging and controlled PostgreSQL service wiring;
2. natural-language StrategySpec compiler with structured model output;
3. verified read-only market/quote adapter and durable paper evaluation loop;
4. richer NAV, risk, drawdown and season scoring;
5. Human and Agent Arena plus transparent leaderboards;
6. public RMT MCP read/paper tools;
7. research qualification policy based on forward evidence;
8. typed VNext live-intent bridge, initially review-required;
9. separately reviewed revenue flywheel and RMT buy-and-retire policy;
10. optional onchain agent identity/reputation checkpoints.
