# RMT Agent Engine

**Status: durable paper-only foundation with Strategy Compiler admission, read-only evaluation runs, verified Robinhood-stock market evidence, controlled scheduling, replay-auditable VNext-style paper quote evidence and deterministic risk-capacity planning. Not a production service.**

The agent engine now has eight layers:

- `AgentEngine`: deterministic paper-domain state machine with immutable strategy versions, seasons, decisions, predictions, accounts, orders, fills, portfolio snapshots, risk events and score snapshots.
- `DurableAgentEngine`: async persistence wrapper that adds idempotency keys, canonical request hashes, optimistic revisions, restart recovery and stale-worker conflict handling.
- `StrategyCompiler` + `StrategyAdmissionService`: converts an agent's stored natural-language thesis into a structured candidate, independently validates it against RMT compiler/safety policy, persists one canonical compilation result per request hash, and only then asks the durable engine to create the immutable strategy version.
- `PaperEvaluationService`: consumes a read-only market-source adapter and an untrusted decision adapter, stores one canonical run per evaluation key, and v1 may write only a decision plus an optional probabilistic prediction. It has no paper-order or live-execution method.
- `RmtRobinhoodStockMarketSource`: adapts RMT's existing VNext market-directory shape to paper evidence, but admits an RWA only after exact contract-address membership in a complete Robinhood Stock Token registry snapshot. Same-symbol non-registry tokens are excluded.
- `PaperEvaluationScheduler`: a bounded `runOnce()` scheduler that derives deterministic evaluation slots from each strategy interval, de-duplicates duplicate candidates, caps concurrency and delegates replay protection to the canonical run store. It does not own a hidden timer or background loop.
- `RmtPaperQuoteService`: converts already-normalized VNext-style quote comparison evidence into replay-auditable, hash-bound `VerifiedPaperQuoteEvidence`, requiring a strictly verifiable, fresh, policy-compliant route and using protected output rather than optimistic expected output. It has no order, fill, wallet or transaction method.
- `PaperRiskCapacityPlanner`: pure `BigInt` risk-capacity planning that computes the maximum quote-asset spend allowed by paper NAV, balance, position/portfolio limits and current risk gates. It approves or rejects an explicit requested size but never creates or silently resizes an order.

A model is deliberately behind adapter interfaces. No OpenAI, Anthropic, Gemini or other concrete model SDK/provider is connected by this foundation, and model output is never treated as trusted policy.

The market and quote evidence layers preserve existing RMT security boundaries. They consume injected read-only readers; they do **not** call or weaken wallet-authenticated VNext trade routes. No production quote reader/provider connection is enabled by this foundation.

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
- market observations may expose bounded source-provided aliases, but the stored observation `assetId` remains the canonical identity;
- full market snapshots and run records are canonical SHA-256 hash-bound and revalidated when read;
- `AgentRunStore` is first-writer-wins, and the PostgreSQL implementation adds an advisory transaction lock plus an independent stored-record hash;
- concurrent nondeterministic model responses for the same evaluation key cannot create multiple canonical histories; the first stored valid run wins;
- v1 decision output is restricted to `NO_ACTION` or `PREDICTION` only;
- a prediction must reference an asset present in the stored snapshot and allowed by the admitted strategy;
- a verified alias may be accepted at proposal time, but it is canonicalized to the observation `assetId` before the proposal/run hash is computed;
- prediction confidence must satisfy the strategy minimum and prediction resolution time is derived from the strategy horizon;
- the exact paper-account balances supplied to the decision adapter are retained in the run record so later balance changes cannot rewrite historical decision evidence;
- decisions and predictions are written through durable idempotency keys derived from the canonical run hash.

## Robinhood RWA market-evidence invariants

- `RmtRobinhoodStockMarketSource` is RWA-only in v1 and refuses mixed `COMMUNITY` scope;
- Robinhood-stock identity comes from exact contract-address membership in a complete registry snapshot, never from directory symbol/name alone;
- same-symbol non-registry tokens are excluded even when they advertise more liquidity than the verified asset;
- active duplicate symbols inside the verified registry fail closed instead of being guessed apart;
- strategy aliases may use the verified symbol, Robinhood registry asset ID, contract address, or canonical chain+contract ID;
- the market snapshot persists the canonical asset identity as `eip155:4663/contract:<lowercase-address>` and retains verified symbol/registry/address aliases separately;
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

## Paper quote evidence invariants

- `RmtPaperQuoteService` accepts only Robinhood Chain quote comparisons (`chainId = 4663`) and rechecks exact token addresses and input amount;
- quote attempts remain observation-only and must declare `authorizationReady = false`;
- indicative quote timestamps must be consistent with the comparison request/completion window under the explicit clock-skew budget;
- only `indicative` attempts with `strictVerificationAvailable = true` can be selected;
- selected attempts must be fresh, unexpired and within the configured maximum price-impact policy;
- price impact is rounded **up** to integer basis points so paper policy never understates impact, including any positive sub-basis-point impact;
- route ranking uses highest protected output, then lowest latency, then provider ID for deterministic tie-breaking;
- optimistic expected output is never written as the paper fill amount; evidence uses `protectedOutputAtomic`;
- input/output paper asset IDs are canonical `eip155:4663/contract:<lowercase-address>` values;
- each result retains the full bounded agent-normalized comparison plus `comparisonHash`, the exact `selectedAttemptHash`, quote evidence hash and final `resultHash`;
- `assertRmtPaperQuoteResult()` recomputes those hashes and cross-checks the selected route against the retained comparison;
- VNext fee/gas economics are not translated into a separate `PaperExecutionCosts` ledger yet, avoiding double-counting until the cost basis is explicitly proven.

## Paper risk-capacity invariants

- `PaperRiskCapacityPlanner` is a pure planner; it cannot mutate `AgentEngine` state;
- all quote-denominated capacity arithmetic uses `BigInt`; no floating-point monetary sizing is admitted;
- per-position and total-portfolio limits are floor-rounded from mark NAV and strategy basis-point limits;
- capacity is the minimum of available quote balance, remaining per-position headroom and remaining portfolio headroom;
- daily-loss, drawdown and trades-per-day thresholds are hard gates;
- maximum-open-position count is a hard gate when the requested asset would open a new position, while an existing admitted position may still use its remaining position headroom;
- no-leverage paper v1 rejects total exposure above mark NAV and position exposure above total exposure;
- the risk snapshot is canonical hash-bound, account-bound, non-future and freshness-limited;
- the strategy remains inside the hard safety envelope and its stored strategy hash is recomputed before risk limits are trusted;
- strategy scope may match the verified market observation canonical ID or its admitted aliases;
- an explicit requested amount that exceeds capacity is `BLOCKED`; the planner never silently clamps it to the maximum;
- the full capacity plan, including account/risk/market snapshots, limits, headroom, reasons and admitted/null amount, is canonical SHA-256 hash-bound.

## Explicitly absent

There is still:

- no HTTP server;
- no concrete model provider/API key;
- no production worker/cron deployment;
- no community-asset classification authority in this RWA source;
- no production VNext quote-reader/provider connection;
- no automatic target-allocation formula;
- no paper-order generation from the evaluation runner, scheduler, quote service or capacity planner;
- no paper-fill integration from `RmtPaperQuoteService`;
- no proven separate fee/gas cost ledger for simulated fills;
- no signer or private key;
- no wallet submission;
- no arbitrary contract-write path;
- no provider or fee activation;
- no `executeLive` method;
- no production database connection or environment change;
- no pooled capital or autonomous custody.

The next engineering boundary is an immutable **proposed paper-order record** that binds one canonical evaluation run, one admitted capacity plan and one strictly verified paper quote comparison. It must remain non-mutating: no `submitPaperOrder`, fill, wallet submission or live execution until that proposal/replay contract and the separate fill-cost accounting boundary are proven.