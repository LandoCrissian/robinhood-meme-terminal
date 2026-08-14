# RMT Agent Engine

**Status: durable paper-only foundation with Strategy Compiler admission, read-only evaluation runs, verified Robinhood-stock market evidence and a controlled scheduler. Not a production service.**

The agent engine now has six layers:

- `AgentEngine`: deterministic paper-domain state machine with immutable strategy versions, seasons, decisions, predictions, accounts, orders, fills, portfolio snapshots, risk events and score snapshots.
- `DurableAgentEngine`: async persistence wrapper that adds idempotency keys, canonical request hashes, optimistic revisions, restart recovery and stale-worker conflict handling.
- `StrategyCompiler` + `StrategyAdmissionService`: converts an agent's stored natural-language thesis into a structured candidate, independently validates it against RMT compiler/safety policy, persists one canonical compilation result per request hash, and only then asks the durable engine to create the immutable strategy version.
- `PaperEvaluationService`: consumes a read-only market-source adapter and an untrusted decision adapter, stores one canonical run per evaluation key, and v1 may write only a decision plus an optional probabilistic prediction. It has no paper-order or live-execution method.
- `RmtRobinhoodStockMarketSource`: adapts RMT's existing VNext market-directory shape to paper evidence, but admits an RWA only after exact contract-address membership in a complete Robinhood Stock Token registry snapshot. Same-symbol non-registry tokens are excluded.
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

## Paper evaluation invariants

- an evaluation key is a logical idempotency boundary. Once a canonical run exists, retries reuse it before calling the market source or decision model again;
- each run binds the exact strategy version/hash, paper-account snapshot, market snapshot, runner version, market-source identity, decision-adapter identity and model identity;
- market observations require a positive reference price, bounded decimals/features, unique asset/quote pairs and a non-future, non-stale capture time;
- full market snapshots and run records are canonical SHA-256 hash-bound and revalidated when read;
- `AgentRunStore` is first-writer-wins, and the PostgreSQL implementation adds an advisory transaction lock plus an independent stored-record hash;
- concurrent nondeterministic model responses for the same evaluation key cannot create multiple canonical histories; the first stored valid run wins;
- v1 decision output is restricted to `NO_ACTION` or `PREDICTION` only;
- a prediction must reference an asset present in the stored snapshot and allowed by the admitted strategy;
- prediction confidence must satisfy the strategy minimum and prediction resolution time is derived from the strategy horizon;
- the exact paper-account balances supplied to the decision adapter are retained in the run record so later balance changes cannot rewrite historical decision evidence;
- decisions and predictions are written through durable idempotency keys derived from the canonical run hash.

## Robinhood RWA market-evidence invariants

- `RmtRobinhoodStockMarketSource` is RWA-only in v1 and refuses mixed `COMMUNITY` scope;
- Robinhood-stock identity comes from exact contract-address membership in a complete registry snapshot, never from directory symbol/name alone;
- same-symbol non-registry tokens are excluded even when they advertise more liquidity than the verified asset;
- active duplicate symbols inside the verified registry fail closed instead of being guessed apart;
- strategy aliases may use the verified symbol, Robinhood registry asset ID, contract address, or canonical chain+contract ID;
- the market snapshot persists the canonical asset identity as `eip155:4663/contract:<lowercase-address>` and retains the verified symbol/registry ID as evidence aliases;
- a model may propose a verified alias such as `NVDA`, but `PaperEvaluationService` resolves it to the exact canonical market observation ID **before** the proposal/run hash is computed;
- persisted prediction records must exactly match one canonical observation asset ID in the stored market snapshot;
- the source consumes VNext directory `priceUsd`, `liquidityUsd`, `volume24h`, `priceChange24h`, market-cap, pair and DEX evidence where available, and converts monetary values to integer six-decimal USD evidence;
- zero-price directory rows are ignored; stale/error directory payloads and unavailable registry coverage fail closed.

## Scheduler invariants

- the scheduler exposes only bounded `runOnce(now)` execution; it does not install `setInterval`, a daemon loop, or hidden background work;
- each candidate's evaluation interval deterministically selects the current slot start and therefore the evaluation key;
- duplicate candidate rows collapse before execution;
- candidate count and concurrency are capped by explicit scheduler policy;
- the scheduler performs no unbounded catch-up across missed slots;
- scheduler failures are isolated per candidate and returned as structured fulfilled/rejected results;
- canonical evaluation-run storage remains the replay/idempotency authority.

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