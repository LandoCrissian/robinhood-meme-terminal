# RMT Agent Engine

**Status: complete deterministic paper-trading foundation from bounded agent proposal through simulated fill. PAPER ONLY. Not a production service and not live execution.**

The agent engine is intentionally split into narrow evidence and mutation boundaries rather than one autonomous trading function.

## Workspace boundary

`apps/agent-engine` is the private, source-first `@rmt/agent-engine` workspace package. It declares only `@rmt/agent-core` as a runtime package dependency and has a package-scoped strict TypeScript project.

The root package export owns the paper engine implementation. The separate `@rmt/agent-engine/public` export is deliberately smaller: it exposes only the sanitized Arena model constants, validators, and data types admitted for read consumers. It does not export engine state, accounts, persistence adapters, strategies, prompts, quote evidence, wallet state, or transaction capabilities.

## Current layers

- `AgentEngine`: deterministic paper-domain state machine with immutable strategy versions, seasons, decisions, predictions, paper accounts, orders, fills, portfolio snapshots, risk events and score snapshots.
- `DurableAgentEngine`: async persistence wrapper adding idempotency keys, canonical request hashes, optimistic revisions, restart recovery and stale-worker conflict handling.
- `StrategyCompiler` + `StrategyAdmissionService`: converts stored natural-language theses into untrusted structured candidates, independently validates them against RMT compiler/safety policy, and only then creates immutable strategy versions.
- `PaperEvaluationService`: captures read-only market evidence and stores one canonical model run per evaluation key. The model may propose only `NO_ACTION`, `PREDICTION`, or bounded `OPEN_POSITION` intent; it cannot create an order.
- `RmtRobinhoodStockMarketSource`: maps RMT VNext market-directory evidence to canonical Robinhood Stock Token identity using exact live-registry contract membership.
- `PaperEvaluationScheduler`: bounded `runOnce()` scheduling with deterministic slots, de-duplication and capped concurrency; no hidden daemon/timer.
- `PaperTradeRequest`: converts an admitted `OPEN_POSITION` NAV-bps request into an atomic quote-asset amount using `BigInt` and a fresh post-decision risk snapshot.
- `PaperTradeCapacityService`: re-evaluates that request against the **current** paper agent/account state through `PaperRiskCapacityPlanner`; stale model account state is never spend authority.
- `PaperOpenPositionAdmissionService`: composes trade request + current-state capacity and returns either `BLOCKED` or a hash-bound immutable order admission.
- `PaperOrderSubmissionService`: accepts only a validated admission and uses a deterministic idempotency key to create a `PENDING` paper order through the durable paper engine.
- `RmtPaperQuoteService`: converts already-normalized VNext-style route comparisons into replay-auditable, strictly verified paper quote evidence using protected output.
- `PaperFillCostPlan`: prevents fee double-counting and requires explicit native-ETH network gas when the selected route says the wallet pays gas.
- `PaperFillOrchestrationService`: allows a simulated fill only when the pending order, admission chain, strictly verified quote and `READY` cost plan agree exactly.

A model is deliberately behind adapter interfaces. No OpenAI, Anthropic, Gemini or other concrete model SDK/provider is connected by this foundation, and model output is never treated as trusted policy or transaction authority.

The market and quote layers consume injected read-only readers. They do **not** call or weaken wallet-authenticated VNext trade routes. The paper system has no signer, private key, authorization codec or live-transaction method.

## End-to-end paper path

```text
natural-language thesis
        ↓
Strategy Compiler + safety admission
        ↓
immutable StrategyVersion
        ↓
read-only market snapshot
        ↓
untrusted model evaluation
        ↓
NO_ACTION | PREDICTION | OPEN_POSITION(target, NAV bps)
        ↓
canonical, hash-bound AgentRun
        ↓
OPEN_POSITION only:
post-decision risk snapshot
        ↓
NAV bps → atomic PaperTradeRequest
        ↓
current account/agent → PaperRiskCapacityPlanner
        ↓
BLOCKED ──────────────────────────────┐
        or                            │
ADMITTED                              │
        ↓                             │
immutable PaperOrderAdmission         │
        ↓                             │
idempotent PENDING paper order        │
        ↓                             │
fresh strictly verified VNext quote  │
        ↓                             │
explicit PaperFillCostPlan            │
        ↓                             │
READY? ─ no → block                   │
        ↓ yes                         │
guarded simulated fill               │
        ↓                             │
canonical paper balances/history      │
                                      │
No path above can submit live funds. ◄┘
```

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
- `PostgresStrategyCompilationStore` stores the full tamper-checked compilation record and uses an advisory transaction lock;
- retries reuse the canonical compilation and use the compilation request hash as the durable strategy-version idempotency boundary.

## Paper evaluation invariants

- an evaluation key is a logical idempotency boundary; once a canonical run exists, retries reuse it before calling market/model adapters again;
- each run binds exact strategy version/hash, paper-account snapshot, market snapshot, runner version, market-source identity, decision-adapter identity and model identity;
- market observations require positive price evidence, bounded decimals/features, unique asset/quote pairs and non-future/non-stale capture time;
- market observations may expose bounded source-provided aliases, but stored observation `assetId` remains canonical identity;
- full snapshots and run records are canonical SHA-256 hash-bound and revalidated when read;
- `AgentRunStore` is first-writer-wins; PostgreSQL adds an advisory transaction lock and independent stored-record hash;
- concurrent nondeterministic model responses cannot create multiple canonical histories for one evaluation key;
- evaluation output is restricted to `NO_ACTION`, `PREDICTION`, or `OPEN_POSITION`;
- `OPEN_POSITION` contains only canonicalizable target asset and positive `requestedPositionBps`, bounded by strategy `maximumPositionBps`;
- the model never supplies atomic order size, route, provider, calldata, signer or wallet instruction;
- proposal aliases are resolved to exact canonical market observation IDs before proposal/run hashes are computed;
- prediction confidence and trade-proposal confidence must meet the admitted strategy minimum;
- the exact paper-account balances supplied to the model are retained as historical evidence, but they are not later treated as current spend authority;
- an `OPEN_POSITION` run records a decision only; `PaperEvaluationService` has no `submitPaperOrder` method.

## Robinhood RWA market-evidence invariants

- `RmtRobinhoodStockMarketSource` is RWA-only in v1 and refuses mixed `COMMUNITY` scope;
- Robinhood-stock identity comes from exact contract-address membership in a complete registry snapshot, never from directory symbol/name alone;
- same-symbol non-registry tokens are excluded even when they advertise more liquidity than the verified asset;
- active duplicate symbols inside the verified registry fail closed;
- strategy aliases may use verified symbol, Robinhood registry asset ID, contract address, or canonical chain+contract ID;
- snapshots persist canonical identity as `eip155:4663/contract:<lowercase-address>` and retain verified aliases separately;
- the source consumes VNext directory `priceUsd`, `liquidityUsd`, `volume24h`, `priceChange24h`, market-cap, pair and DEX evidence where available;
- monetary market evidence is converted to integer six-decimal USD values;
- zero-price rows are ignored; stale/error directory payloads and unavailable registry coverage fail closed.

## Scheduler invariants

- scheduler exposes only bounded `runOnce(now)` execution; no `setInterval`, daemon loop or hidden background work;
- each strategy interval deterministically selects current slot and evaluation key;
- duplicate candidates collapse before execution;
- candidate count and concurrency are explicitly capped;
- no unbounded catch-up across missed slots;
- failures are isolated per candidate;
- canonical evaluation-run storage remains replay/idempotency authority.

## Trade-request and current-state capacity invariants

- model sizing is expressed only as NAV basis points;
- `requestedInputAmountAtomic = floor(markNavAtomic × requestedPositionBps / 10_000)` using `BigInt`;
- a request that rounds to zero is rejected;
- trade request requires a risk snapshot captured at or after the model decision and inside an explicit freshness window;
- exact strategy hash is recomputed before the proposal is trusted;
- current-state capacity uses a fresh/current paper account and agent snapshot, not the historical account snapshot shown to the model;
- capacity is the minimum of available quote balance, per-position headroom and portfolio headroom, subject to daily-loss/drawdown/trade/open-position gates;
- all monetary capacity math is `BigInt`;
- no-leverage paper v1 rejects total exposure above mark NAV and position exposure above total exposure;
- a requested amount above current capacity is `BLOCKED`; it is never silently resized;
- composed `PaperOpenPositionAdmissionRecord` may contain an order admission only when current capacity is `ADMITTED`.

## Order admission and submission invariants

- an immutable order admission derives every `PaperOrderIntent` field from admitted capacity evidence; callers cannot change token, amount, strategy, account or slippage;
- admitted amount must exactly equal the original requested amount;
- admission has an explicit capacity-plan freshness window and deterministic ID/hash;
- blocked capacity can never produce an order admission;
- paper-order submission accepts only a full validated admission record;
- submission idempotency key is `paper-order-admission:<admissionId>` and cannot be caller-selected;
- returned order must be exactly `PENDING` and exactly match every admitted intent field;
- submission record retains the entire admission/capacity chain and its own hash.

## Paper quote evidence invariants

- `RmtPaperQuoteService` accepts only Robinhood Chain comparisons (`chainId = 4663`) and rechecks exact token addresses and input amount;
- quote attempts remain observation-only and must declare `authorizationReady = false`;
- indicative timestamps must be consistent with comparison request/completion under explicit clock-skew budget;
- only `indicative` attempts with `strictVerificationAvailable = true` can be selected;
- selected attempts must be fresh, unexpired and within configured price-impact policy;
- price impact rounds **up** to integer bps, including any positive sub-basis-point impact;
- route ranking uses highest protected output, then lowest latency, then provider ID;
- optimistic expected output is never used as paper fill credit; evidence uses `protectedOutputAtomic`;
- input/output paper asset IDs are canonical `eip155:4663/contract:<lowercase-address>` values;
- each result retains full bounded normalized comparison, `comparisonHash`, exact `selectedAttemptHash`, quote evidence hash and final `resultHash`;
- all hashes and selected-route linkage are independently recomputable.

## Fill-cost invariants

- VNext protected output is treated as protected **net token output**, so paper accounting never debits route/provider/RMT token fees a second time;
- ready paper costs therefore always use `feeAmountAtomic = 0` with no separate fee asset;
- Robinhood native ETH follows VNext's native key: `eip155:4663/native`;
- when `userPaysGas = true` and exact `networkFeeNativeAtomic` is known, that exact amount becomes the separate native-ETH paper debit;
- when user-paid network gas is still unknown, cost state is `BLOCKED_NETWORK_FEE_PENDING` and no guessed costs are exposed;
- sponsored/intent gas creates no separate paper gas debit;
- cost plan binds quote result/evidence/selected-attempt hashes and has its own canonical hash.

## Guarded paper fill invariants

- a fill requires a validated self-contained order submission, exact quote result and matching `READY` cost plan;
- quote input/output/amount must exactly match the pending order before the writer is called;
- quote cannot predate the paper order;
- fill idempotency binds order ID, submission hash, quote-evidence hash and cost-plan hash;
- returned fill must exactly match order, agent, account, assets, amounts, protected output, provider, timestamp, full quote evidence and exact fee/gas costs;
- the underlying `AgentEngine.fillPaperOrder()` remains authoritative for paper-fill delay, quote expiry, season window, price-impact limits and paper balances;
- the orchestration record retains the complete evidence chain and a canonical hash.

## Explicitly absent

There is still:

- no HTTP/API service for agents;
- no concrete OpenAI/Anthropic/Gemini model provider or API key;
- no production worker/cron deployment;
- no production PostgreSQL connection/environment wiring for this agent service;
- no community-asset classification authority in the RWA source;
- no production VNext quote-reader/provider connection from the agent service;
- no automatic end-to-end daemon that converts every `OPEN_POSITION` run into a submitted/fill attempt;
- no `CLOSE_POSITION` proposal path yet;
- no autonomous signer/private key;
- no wallet submission;
- no arbitrary contract-write path;
- no live provider or fee activation caused by this agent work;
- no `executeLive` method;
- no pooled customer capital or autonomous custody;
- no claim that paper qualification grants live authority.

The next product-facing milestone should build **paper position accounting and Arena-ready performance state** on top of these mechanics: current positions, cost basis, realized/unrealized P&L, mark NAV vs liquidation NAV, season snapshots and transparent Human-vs-Agent scoring. A concrete model adapter and RMT MCP can then plug into a paper system whose execution behavior is already deterministic and auditable.
