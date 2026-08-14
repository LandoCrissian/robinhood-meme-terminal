# RMT agent architecture

**Status: CURRENT FOUNDATION — PAPER ONLY**
**Admitted:** 2026-08-14

This document defines the first RMT agent-system boundary. It authorizes a paper-only evaluation foundation inside the existing RMT monorepo. It does not authorize live autonomous execution, wallet signing, fee activation, production configuration, pooled capital, copy trading, contract deployment, ERC-8004 publication or a public MCP server.

## Purpose

RMT agents are a new source of market analysis and, later, typed trade intent. They are not a second terminal and they do not bypass VNext.

The foundation flow is:

```text
owner thesis
→ immutable StrategySpec version
→ paper-active agent
→ auditable decision summary
→ prediction and/or paper order
→ delayed verified quote boundary
→ paper fill and atomic balance accounting
→ prediction/trading metrics
→ future qualification research
```

The eventual live boundary is deliberately separate:

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
- `apps/agent-engine`: paper-only state machine and simulation foundation. Its first admitted implementation is in-memory and dependency-free by design; durable PostgreSQL persistence is a later reviewed change.
- `apps/market-indexer`: remains read-oriented external market discovery/enrichment. It is not repurposed into the agent engine.
- `apps/web`: remains the only terminal UI. Arena and agent surfaces may be added later without creating a second routing stack.
- future `apps/rmt-mcp`: separate external-agent gateway after the internal paper system is durable and abuse-controlled.

The initial source-only foundation intentionally adds no workspace package manifests or new dependencies, so the existing frozen pnpm lockfile and production install graph remain unchanged. Packaging and runtime dependencies are admitted only with the persistence/compiler phase.

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

The foundation engine only creates and accepts `PAPER_ONLY`. Performance quality never grants live authority by itself.

## Strategy model

Natural-language strategy compilation is a later adapter. The authoritative runtime object is a versioned `StrategySpec`, not free-form prose.

Every strategy version is immutable and hash-bound. A strategy change creates a new version. Predictions, decisions and orders reference the exact strategy version that produced them.

The user strategy operates inside a separate RMT safety envelope. A strategy cannot raise its own limits above the envelope. The foundation validates position, portfolio exposure, drawdown, daily loss, trade-count, slippage, price-impact and evaluation-frequency bounds at strategy admission.

## Decisions and reasoning

The system records a concise auditable reasoning summary, model identity, compiler version, policy version, market-snapshot identity and canonical decision hash. It does not request or persist private chain-of-thought.

## Prediction versus trading evidence

Predictions and trades are distinct objects.

- Probabilistic predictions are resolved against later outcome evidence and scored with a time-decayed weighted Brier score.
- Paper trading is measured through fills, balances, NAV/liquidation NAV, costs, drawdown and other execution/risk metrics added in later phases.
- Brier score is not the RMT Agent Score and is not sufficient for qualification.

No fixed production qualification threshold is admitted in this foundation. The old `14 predictions / Brier <= 0.20` concept is not a production gate.

## Paper-execution invariants

- Monetary amounts use unsigned atomic-unit integer strings and `bigint` arithmetic; JavaScript floating point is not used for balances.
- A paper order cannot fill from the same observation that created it. The engine enforces a configured delay before quote observation.
- Quote evidence is canonical-hash bound and must exactly match order assets and input amount.
- Quote price impact must remain inside both the strategy and RMT safety envelope.
- Simulated fees and gas identify their own assets and are debited atomically with the paper fill.
- Failed validation leaves balances and order state unchanged.
- The engine exposes no `executeLive` path.

## Security boundary

The durable rule is:

> The AI is an untrusted transaction-intent proposer, never a trusted signer.

The agent domain must not gain arbitrary target/calldata execution, private-key access, unrestricted wallet methods or a path that bypasses VNext. Any later delegated signer adapter is independently scoped and reviewed after VNext verification, not embedded into strategy reasoning.

## Deferred phases

1. workspace packaging plus isolated PostgreSQL persistence and migrations;
2. natural-language StrategySpec compiler with structured model output;
3. verified market/quote adapter and durable paper execution;
4. portfolio snapshots, liquidation NAV, risk events and season accounting;
5. Human and Agent Arena plus transparent leaderboards;
6. public RMT MCP read/paper tools;
7. research qualification policy based on forward evidence;
8. typed VNext live-intent bridge, initially review-required;
9. separately reviewed revenue flywheel and RMT buy-and-retire policy;
10. optional onchain agent identity/reputation checkpoints.
