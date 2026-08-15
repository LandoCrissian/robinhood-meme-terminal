# RMT agent architecture

**Status: CURRENT FOUNDATION — DURABLE PAPER ONLY + STRATEGY COMPILER + READ-ONLY EVALUATION RUNS**
**Admitted:** 2026-08-14

This document defines the RMT agent-system boundary. It authorizes a durable paper-only evaluation domain, deterministic Strategy Compiler admission boundary and read-only paper-evaluation run boundary inside the existing RMT monorepo. It does not authorize live autonomous execution, wallet signing, fee activation, production configuration, pooled capital, copy trading, contract deployment, ERC-8004 publication, a public MCP server or any concrete model/market provider credential.

## Purpose

RMT agents are a new source of market analysis and, later, typed trade intent. They are not a second terminal and they do not bypass VNext.

The admitted flow is:

```text
owner thesis
→ untrusted structured model adapter
→ deterministic Strategy Compiler
→ candidate StrategySpec
→ RMT safety/policy admission
→ canonical compilation record
→ immutable admitted StrategySpec version
→ paper-active agent + paper account
→ read-only market snapshot
→ untrusted decision adapter
→ canonical first-writer paper evaluation run
→ NO_ACTION or probabilistic PREDICTION only
→ auditable decision / prediction records
→ durable snapshot + mutation journal
→ restart/replay-safe paper state
→ prediction/trading/risk/season metrics
→ future qualification research
```

Paper-order creation remains outside the admitted evaluation runner. The eventual live boundary remains deliberately separate:

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

- `packages/agent-core`: pure TypeScript agent schemas, Strategy Compiler policy/admission validation, read-only market/run evidence schemas, safety-envelope validation, state transitions, canonical hashing and deterministic scoring.
- `apps/agent-engine`: paper-only state machine, durable wrapper, Strategy Compiler adapter/admission layer, read-only `PaperEvaluationService`, agent-run persistence and persistence contracts. It owns agent-domain state; it does not own market discovery or live execution.
- `apps/market-indexer`: remains read-oriented external market discovery/enrichment. It is not repurposed into the agent engine.
- `apps/web`: remains the only terminal UI. Arena and agent surfaces may be added later without creating a second routing stack.
- `apps/rmt-mcp`: source-only, read-only external-agent boundary over sanitized public Arena models. Transport and write capabilities remain unadmitted.

The three Agent domains are private, source-first workspace packages with package-scoped strict TypeScript projects. Dependency direction is checked as `agent-core ← agent-engine ← rmt-mcp`, with MCP additionally permitted to use Agent Core utilities and types. MCP may consume Agent Engine only through its explicit sanitized `public` export. The manifests add no third-party runtime dependency: PostgreSQL adapters still accept injected SQL pool contracts, and actual database connections remain separate release decisions. Market and decision adapters are also injected interfaces; this architecture does not connect a production provider merely by defining its boundary.

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

## Strategy Compiler

Free-form prose is not authoritative runtime state. The exact stored agent thesis is normalized and fingerprinted together with:

- agent ID;
- compiler version;
- compiler policy version;
- RMT safety envelope;
- adapter identity;
- model identity.

That fingerprint becomes the compilation request hash. A concrete model adapter may only propose a structured draft. The deterministic compiler independently:

1. parses the draft as untrusted runtime data;
2. validates the `StrategySpec` schema;
3. bounds asset classes, asset-list sizes, signal count and signal-parameter count;
4. enforces the RMT safety envelope without allowing the model to raise or silently clamp risk limits;
5. appends hard-required prohibitions such as `ARBITRARY_CALL` and `UNVERIFIED_VENUE` even when the model omits them;
6. rejects include/exclude asset conflicts and other policy violations;
7. hashes the candidate strategy, admitted strategy and complete compilation record independently.

The compiler records only a concise summary, assumptions and warnings from the structured draft. It does not request or persist private chain-of-thought.

No concrete model provider is admitted by this architecture. OpenAI, Anthropic, Gemini or any other provider must implement the same `StrategyModelAdapter` boundary and remains untrusted input to the deterministic compiler.

## Compilation persistence and concurrency

Strategy compilation has a separate first-writer-wins persistence boundary because model output may be nondeterministic.

`StrategyCompilationStore` is keyed by `(stream_id, request_hash)`. On retry, a previously stored canonical compilation is reused before another model call. If two workers race and produce different model proposals for the same request hash, only the first stored compilation becomes canonical; both workers then use that same admitted or rejected record.

`PostgresStrategyCompilationStore`:

- stores the full compilation record plus a canonical SHA-256 record hash;
- verifies both the compilation's self-hash and database record hash on reads;
- takes an advisory transaction lock scoped to stream + request hash;
- exposes an explicit `ensureSchema()`; the base agent tables must exist first so compilation rows can foreign-key to an agent;
- never writes wallet, execution, treasury or live-order state.

The admission service then derives a durable strategy-version idempotency key from the compilation request hash. A crash after compilation persistence but before strategy-version creation is recoverable: the next attempt reuses the canonical compilation and retries the idempotent durable engine mutation.

## Read-only paper evaluation runs

`PaperEvaluationService` is the admitted recurring decision boundary. It consumes two injected, untrusted adapters:

- a `PaperEvaluationMarketSource`, which may provide only read-only market observations;
- a `PaperDecisionAdapter`, which may propose only `NO_ACTION` or `PREDICTION` in v1.

Before either adapter is called, the service requires a `PAPER_ONLY`, paper-active agent, the latest admitted strategy and an agent-owned paper account. A caller-supplied evaluation key identifies the logical evaluation slot. Its request hash binds the agent/account, exact strategy version/hash, chain, runner policy, market-source identity and decision-adapter/model identity. The wall-clock retry time is deliberately not part of that fingerprint.

`AgentRunStore` is first-writer-wins by `(stream_id, evaluation_key)`. A retry reads the canonical run before calling the market source or model. Concurrent nondeterministic outputs cannot create multiple histories for the same logical evaluation key; the first valid stored run becomes canonical.

Every canonical run retains:

- exact paper-account snapshot and balances seen by the decision adapter;
- exact market snapshot, source identity, capture time and canonical snapshot hash;
- exact strategy version/hash;
- runner, decision-adapter and model identities;
- normalized proposal and proposal hash;
- canonical request and run hashes.

Market evidence fails closed. Observations require a positive reference price, bounded decimals and feature values, unique asset/quote identities, the configured chain, and a non-future/non-stale capture time. A prediction must use an asset present in that exact snapshot and allowed by the admitted strategy. Confidence must satisfy the strategy minimum, and `resolvesAt` is derived from the strategy horizon rather than chosen by a model.

`PostgresAgentRunStore` stores the full run plus an independent record hash and protects first-write selection with a stream/evaluation advisory transaction lock. Decisions and optional predictions are then written through durable idempotency keys derived from the canonical run hash.

The v1 evaluation service intentionally has no `submitPaperOrder`, live execution, wallet or signer method. Trade sizing/order generation is a later boundary after a real verified market/quote adapter is admitted and evaluated.

## Strategy and season model

Every admitted strategy version is immutable and hash-bound. A strategy change or a deliberately different compilation fingerprint creates a new contiguous version. Predictions, decisions and orders reference the exact strategy version that produced them.

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

Strategy compilation records and agent-run records are intentionally separate from the canonical paper-engine snapshot because they are model/market provenance artifacts surrounding deterministic mutations. The admitted immutable strategy, decision and prediction records remain part of canonical engine state.

The snapshot remains the canonical restart boundary for trading/evaluation state in this phase. Normalized tables are transactional projections and may later move to incremental event-specific writes as scale requires.

## Decisions and reasoning

The system records a concise auditable reasoning summary, model identity, runner/compiler version, policy version, market-snapshot identity and canonical decision hash. It does not request or persist private chain-of-thought.

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
- The evaluation runner cannot create a paper order in v1.
- The engine exposes no `executeLive` path.

## Security boundary

The durable rule is:

> The AI is an untrusted transaction-intent proposer, never a trusted signer.

The agent domain must not gain arbitrary target/calldata execution, private-key access, unrestricted wallet methods or a path that bypasses VNext. Any later delegated signer adapter is independently scoped and reviewed after VNext verification, not embedded into strategy reasoning.

## Deferred phases

1. runtime packaging and controlled PostgreSQL service wiring;
2. concrete structured-model adapter behind the admitted Strategy Compiler/decision boundaries;
3. verified read-only RMT/VNext-compatible market and quote adapter plus controlled evaluation scheduler;
4. separately gated paper trade sizing/order-generation runner using verified quote evidence;
5. richer NAV, risk, drawdown and season scoring;
6. Human and Agent Arena plus transparent leaderboards;
7. public RMT MCP read/paper tools;
8. research qualification policy based on forward evidence;
9. typed VNext live-intent bridge, initially review-required;
10. separately reviewed revenue flywheel and RMT buy-and-retire policy;
11. optional onchain agent identity/reputation checkpoints.
