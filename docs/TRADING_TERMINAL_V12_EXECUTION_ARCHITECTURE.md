# RMT Terminal V12 — Execution Architecture

**Status:** Research proposal  
**Production effect:** None  
**Contract effect:** None  
**Autonomous execution:** Remains disabled and out of scope

## Product objective

Build the fastest trustworthy trading path on Robinhood Chain without turning RMT into a paternalistic gatekeeper.

The terminal workflow becomes:

```text
INDEX → DISCOVER → EXPLAIN → RACE ROUTES → VERIFY → SIMULATE → WALLET → RECONCILE
```

Operating principle:

> RMT hard-blocks invalid transactions. RMT warns about market risk. The trader decides whether the market risk is acceptable.

---

# 1. System boundaries

## RMT must hard-block

- wrong chain;
- wrong token or PoolId/PoolKey;
- wrong router, executor, recipient, or spender;
- unapproved runtime bytecode;
- malformed or unsupported command sequence;
- stale/expired quote;
- stale route evidence used as execution authority;
- exact simulation failure;
- output below the protected minimum;
- unsupported custom hook data;
- unresolved prior submission that could be duplicated;
- amount/balance/allowance mismatch;
- known changed/mismatched hook bytecode;
- transaction receipt with `reverted` status.

## RMT should warn and allow deliberate user choice

- price impact;
- shallow liquidity;
- rapid price movement;
- concentrated ownership;
- newly created market;
- swap-affecting hook;
- dynamic fee;
- proxy/upgradeable hook;
- unverified source where code and exact simulation still pass;
- return-delta hook whose effect is reflected in the exact quote and minimum output;
- manual route selection that is worse than the recommended route.

## RMT should never do silently

- widen slippage;
- increase the trade amount;
- switch the selected token;
- switch the wallet recipient;
- replace a manually selected route;
- resubmit a signed transaction;
- reuse a stale quote;
- treat provider failure as proof a pool no longer exists.

---

# 2. Component architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    Robinhood Chain events                   │
│ v3 factories · v4 PoolManager · Sushi v4 · launch factories│
└───────────────────────────┬─────────────────────────────────┘
                            │
                    Event-led indexer
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                    RMT Market Evidence DB                   │
│ token · origin · pool key · hook · custody · lifecycle     │
│ immutable facts + latest volatile state + provenance       │
└──────────────┬───────────────────────┬──────────────────────┘
               │                       │
        Discovery API             Evidence API
               │                       │
┌──────────────▼───────────────────────▼──────────────────────┐
│                    Terminal workspace                       │
│ cached shell · live chart · warnings · route status        │
└───────────────────────────┬─────────────────────────────────┘
                            │ amount settles
                    Quote orchestrator
        ┌──────────────┬────┴────┬───────────────┐
        │              │         │               │
    Sushi v7       Uniswap v3  Uniswap v4    UniswapX*
        │              │         │               │
        └──────────────┴────┬────┴───────────────┘
                            │
                   Normalized route candidates
                            │
                   Independent verification
                            │
                     Exact simulation
                            │
                         Wallet
                            │
                 Submission reconciliation

* UniswapX only after public API/filler availability is proven.
```

---

# 3. Market evidence data model

## 3.1 Token

```ts
type IndexedToken = {
  chainId: 4663;
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: string;
  bytecodeHash: Hex;
  firstSeenBlock: string;
  metadataSource: "onchain" | "launcher" | "project-api" | "provider";
};
```

## 3.2 Launch provenance

```ts
type LaunchProvenance = {
  token: Address;
  source: "uniswap-liquidity-launcher" | "pons-v1" | "pons-v2" | "rmt-v6" | "other";
  launcher: Address;
  strategy?: Address;
  strategyVersion?: string;
  creator?: Address;
  transactionHash: Hex;
  blockNumber: string;
  lifecycle:
    | "token-created"
    | "auction-active"
    | "migration-pending"
    | "migration-failed"
    | "funds-recovered"
    | "pool-initialized"
    | "route-verified";
  evidenceHash: Hex;
};
```

## 3.3 Pool

```ts
type IndexedPool = {
  protocol: "uniswap-v2" | "uniswap-v3" | "uniswap-v4" | "sushi-v4";
  poolIdentity: Address | Hex;
  token0: Address;
  token1: Address;
  createdAtBlock: string;
  createdAtTransaction: Hex;
  canonical: boolean;
  poolKey?: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  positionCustodian?: Address;
  positionTokenId?: string;
};
```

## 3.4 Hook profile

```ts
type HookProfile = {
  chainId: 4663;
  address: Address;
  codeHash: Hex;
  permissions: string[];
  affectsSwap: boolean;
  returnsSwapDelta: boolean;
  dynamicFee: boolean;
  currentLpFee?: number;
  sourcePublished: boolean | null;
  contractName: string | null;
  proxy: {
    status: "no" | "yes" | "unknown";
    implementation?: Address;
    admin?: Address;
    implementationCodeHash?: Hex;
  };
  hookData: "none" | "deterministic-supported" | "project-specific" | "unknown";
  customWriteFunctions: string[];
  hooklist?: {
    listed: boolean;
    auditUrl?: string;
    description?: string;
    vanillaSwapCompatible?: boolean;
    lastSyncedCommit?: string;
  };
  checkedAtBlock: string;
};
```

## 3.5 Route health

```ts
type RouteHealth = {
  token: Address;
  venue: "sushi" | "uniswap-v3" | "uniswap-v4" | "sushi-v4" | "uniswapx";
  state:
    | "indexed"
    | "verifying"
    | "ready"
    | "rechecking"
    | "temporarily-unavailable"
    | "view-only"
    | "route-changed";
  lastVerifiedAt?: string;
  lastVerifiedBlock?: string;
  lastSuccessLatencyMs?: number;
  lastFailureCategory?: string;
  consecutiveFailures: number;
};
```

---

# 4. Event indexer

## 4.1 Contracts and events

### Uniswap v3

- factory `PoolCreated`;
- pool `Initialize`, `Swap`, `Mint`, `Burn`;
- position manager transfer/custody events as needed.

### Uniswap v4

- PoolManager `Initialize`;
- `Swap`;
- `ModifyLiquidity`;
- dynamic LP-fee updates where emitted/derivable;
- PositionManager transfer and position lifecycle.

### Uniswap Liquidity Launcher

- launcher `TokenCreated`, `TokenDistributed`;
- instant strategy `DistributionInitialized`, `TokenLaunched`;
- LBP `InitializerCreated`, `Migrated`, `MigrationFailed`, `FundsRecovered`;
- FeeSplitter `FeesCollected`, `FeesForwarded`;
- beneficiary/claim recipient `AmountsReceived`, `Claimed`;
- beneficiary NFT transfers.

### Sushi v4

- CL PoolManager pool initialization and swap/liquidity events;
- PositionManager events;
- protocol-fee changes.

### Pons V1

- launch factory token/pool/position records;
- locker custody;
- anti-snipe window parameters;
- graduation evidence.

### Pons V2

- launch creation;
- curve buys/sells and fee events;
- graduation preparation;
- `graduate` and final pool creation;
- fee policy and escrow;
- buyback vault;
- final v4 PoolKey/hook/position lock.

## 4.2 Reorg handling

The index must retain:

- block number;
- block hash;
- transaction hash;
- log index;
- canonical flag;
- observed confirmations.

A rollback deletes or reverses rows after the common ancestor, then replays canonical logs.

No launch or pool should be permanently marked complete solely from an unconfirmed event.

## 4.3 Indexer benchmark

Implement the same schema/handlers in short prototypes:

- Ponder;
- Envio HyperIndex;
- minimal viem worker.

Use a pinned block range and compare event counts/hashes. Select from measured performance and operational risk.

---

# 5. Versioned deployment registry

## 5.1 Registry shape

```ts
type ExecutionContract = {
  chainId: 4663;
  role:
    | "universal-router"
    | "swap-router-02"
    | "v4-quoter"
    | "v4-pool-manager"
    | "v4-state-view"
    | "permit2"
    | "sushi-red-snwapper"
    | "sushi-v4-quoter"
    | "sushi-v4-pool-manager"
    | "uniswapx-reactor"
    | "uniswapx-order-quoter";
  address: Address;
  version: string;
  activeForNewExecution: boolean;
  acceptedForHistoricalDecoding: boolean;
  creationBlock?: string;
  runtimeCodeHash: Hex;
  implementationCodeHash?: Hex;
  immutablesHash?: Hex;
  commands?: string[];
  source: {
    repository: string;
    path: string;
    commit: string;
  };
};
```

## 5.2 Router divergence handling

Robinhood Uniswap sources currently contain both:

- `0x8876789976decbfcbbbe364623c63652db8c0904`;
- `0x06afBA43fd06227fA663b0dAeCF536F6eaA6BF99`.

The latest contracts JSON identifies `0x06af…` as a Router 2.1.1 redeployment with a production Across SpokePool immutable, while SDK/generated sources may still point to `0x8876…`.

V12 must:

1. retain both in the registry;
2. verify current code and immutables;
3. designate one active router for new API routes;
4. decode/validate both for historical/API compatibility where appropriate;
5. reject any third address;
6. alert when upstream repositories change.

## 5.3 CI upstream watcher

Scheduled workflow:

1. fetch official deployment JSON and selected package manifests/changelogs;
2. normalize addresses and versions;
3. compare with committed registry;
4. check runtime code hashes through two RPC providers;
5. open an issue/PR on divergence;
6. never auto-merge the registry change.

---

# 6. Hook intelligence and execution policy

## 6.1 Hook profile sources

Evidence priority:

1. onchain PoolKey and hook address;
2. hook permission bits encoded in the address;
3. runtime bytecode and code hash;
4. proxy implementation/admin state;
5. exact quote + exact simulation;
6. official Hooklist metadata;
7. verified explorer source/ABI;
8. project documentation.

Lower-priority evidence cannot override higher-priority contradictions.

## 6.2 Hook execution states

```ts
type HookExecutionState =
  | "vanilla"
  | "supported-hook"
  | "review-required"
  | "adapter-required"
  | "blocked";
```

### Vanilla

- zero hook address;
- exact quote/simulation passes.

### Supported hook

- known permission profile;
- no custom data or deterministic supported adapter;
- code hash matches registry/profile;
- exact quote/simulation passes;
- fee/delta reflected in minimum output.

### Review required

- source unavailable;
- proxy/upgradeable;
- return-delta fee behavior;
- dynamic fee;
- custom project controls;
- current exact simulation still passes.

### Adapter required

- custom `hookData` is mandatory;
- path requires project-specific signed data or state;
- RMT cannot currently produce or validate it.

### Blocked

- no code;
- changed bytecode against a required published profile;
- exact simulation fails;
- output accounting violates minimum;
- token/pool/router/recipient mismatch;
- malicious or unsupported transfer behavior.

## 6.3 User disclosure

Before wallet review, display:

```text
HOOKED POOL
Hook: 0x…
Callbacks: beforeSwap · afterSwap-return-delta
Current LP fee: 0.25%
Additional quoted hook effect: 0.35%
Upgradeable: Yes
Custom swap data: No
Exact route simulation: Passed at block N
```

The acknowledgement must describe the current behavior, not merely say “hooked pool.”

---

# 7. Quote orchestration

## 7.1 Progressive quote model

After the amount input settles:

1. start eligible venue quote requests concurrently;
2. render the first verified executable quote;
3. continue remaining venue requests;
4. update recommendation only when another route is materially better;
5. never replace a manual selection;
6. invalidate all quotes when amount, side, recipient, route policy, block-sensitive evidence, or user limit changes.

## 7.2 Normalized quote

```ts
type NormalizedQuote = {
  venue: string;
  routeId: string;
  requestedAt: string;
  expiresAt: string;
  amountIn: string;
  grossAmountOut: string;
  netAmountOut: string;
  minimumOut: string;
  gasEstimate: string;
  estimatedGasCostQuote: string;
  protocolFee: string;
  hookEffect: string;
  platformFee: string;
  priceImpact: number;
  slippage: number;
  executionType: "amm" | "intent";
  confidence: "fresh" | "aging" | "expired";
  exactSimulation: "pending" | "passed" | "failed";
};
```

## 7.3 Recommendation score

Do not rank only by gross output.

```text
score = net protected output
      - gas cost
      - latency penalty
      - stale-head penalty
      - fill-risk penalty
      - unsupported/review friction
```

The UI should show the reason:

- “Best protected output”;
- “Fastest verified route”;
- “Manual Sushi preference”;
- “UniswapX estimated better, but fill not guaranteed.”

## 7.4 Soft and hard deadlines

- soft first-response target: 1.5 seconds;
- keep other route requests running up to 4–6 seconds;
- provider timeout is not a permanent market downgrade;
- deterministic no-route result is cached briefly;
- fresh quote and simulation are still required for wallet review.

---

# 8. Price-impact and slippage policy

## 8.1 Settings

```ts
type MarketRiskPreferences = {
  impactMode: "advisory" | "strict";
  maxPriceImpactBps: number | null;
  slippageBps: number;
  autoReduce: false;
};
```

Recommended presets:

- Impact: 1%, 2%, 5%, 10%, custom, no advisory cap.
- Slippage: auto, 0.5%, 1%, 2%, custom.
- Default impact mode: advisory.
- Auto-reduce: never enabled by default.

## 8.2 Warning copy

### Advisory

> Estimated price impact is 1.03%. Your selected advisory level is 1%. You can continue, reduce the amount, or change your preference.

### Strict

> This quote exceeds your strict 1% impact limit. Reduce the amount or change the limit before wallet review.

### Actual hard failure

> RMT cannot prepare this transaction because the fresh route simulation failed.

Do not mix these states.

---

# 9. Workspace route-state machine

```text
UNKNOWN
  └─► INDEXED
        └─► VERIFYING
              ├─► READY
              │     └─► RECHECKING
              │           ├─► READY
              │           ├─► TEMPORARILY_UNAVAILABLE
              │           └─► ROUTE_CHANGED
              ├─► VIEW_ONLY
              └─► TEMPORARILY_UNAVAILABLE
```

Rules:

- preserve the last verified route while rechecking;
- label it stale/rechecking;
- disable wallet review until fresh verification returns;
- do not erase the route on a transient outage;
- only show view-only after an authoritative completed verification finds no supported route;
- only show route-changed after current evidence contradicts prior identity/state.

---

# 10. Transaction preparation and validation

## 10.1 Reference encoding

Use official SDKs to construct reference plans:

- Universal Router SDK;
- v4 SDK;
- UniswapX SDK;
- Sushi SDK/API schemas.

## 10.2 Independent RMT validation

RMT independently verifies:

- chain ID;
- sender/recipient;
- router/executor/spender against versioned registry;
- runtime bytecode hash;
- function selector and command list;
- token in/out;
- exact input amount;
- Permit2 amount/expiration;
- protected minimum output;
- sweep/take recipients;
- native value;
- deadline;
- PoolKey/PoolId/path;
- hookData classification;
- no unexpected residual-token recipient;
- simulation status and output balance delta.

## 10.3 Universal Router safety fixtures

Include test vectors for:

- v3 exact input;
- v4 exact input;
- v4 exact output;
- mixed v3/v4 route;
- Permit2 approval/transfer;
- native wrap/unwrap;
- safe sweep;
- unsafe `TAKE_ALL`/`SETTLE_ALL`;
- output underdelivery;
- wrong recipient;
- wrong router generation;
- unexpected Across/bridge command;
- min-hop-price encoding.

---

# 11. UniswapX integration gate

Do not enable UniswapX merely because contracts are deployed.

Required evidence:

- official public quoting/order API supports chain 4663;
- active fillers exist;
- exact token pair and amount are accepted;
- reactor/order-quoter registry is current;
- Permit2 authorization is explicit;
- cancellation/expiry/recovery states are implemented;
- block-driven decay stall is monitored;
- user sees that fill is competitive, not guaranteed;
- no silent fallback after the user signs a specific order.

RMT route comparison may show “UniswapX unavailable” with an explanation until the gate passes.

---

# 12. Chart and market-tape integration

After the indexer is stable, evaluate Lightweight Charts.

Required series:

- OHLC candles;
- volume;
- live confirmed swaps;
- buy/sell markers;
- launch/migration marker;
- liquidity changes;
- dynamic fee changes;
- hook config changes;
- Position Guard levels;
- wallet fills;
- stale-feed indicator.

The chart must never imply pending or simulated data is a confirmed trade.

---

# 13. Delivery phases

## Phase 0 — Correct misleading behavior

- dynamic price-impact warning;
- true blocker summary;
- advisory/strict modes;
- remove false “blocked” copy;
- exact insufficient-balance requirement;
- no runtime protocol change.

## Phase 1 — Deployment registry and upstream watcher

- versioned Uniswap/Sushi contracts;
- codehash and immutable checks;
- SDK/deployment divergence CI;
- no route behavior change until registry tests pass.

## Phase 2 — Event-led indexer

- Uniswap v3/v4;
- Liquidity Launcher;
- Sushi v4;
- Pons V1/V2;
- route shell served from Postgres;
- benchmark Ponder/Envio/custom worker.

## Phase 3 — Hook intelligence

- Hooklist ingestion;
- onchain code/proxy/fee verification;
- supported/review/adapter/block policy;
- hook disclosure UI;
- exact simulation remains mandatory.

## Phase 4 — Progressive best execution

- parallel Sushi/Uniswap requests;
- first executable quote rendering;
- net-output route scoring;
- persistent route-state machine;
- latency/failure observability.

## Phase 5 — UniswapX gate

- service/filler verification;
- order lifecycle;
- Permit2 intent signing;
- block-decay monitoring;
- cancellation/expiry/reconciliation.

## Phase 6 — Chart upgrade

- Lightweight Charts prototype;
- compare bundle/runtime cost with current SVG;
- migrate only after route improvements are stable.

---

# 14. Release gates

No V12 runtime PR merges until it passes:

- exact TypeScript build;
- Sushi v7 quote/swap schema tests;
- Uniswap v3/v4 quote and transaction-integrity tests;
- official SDK conformance fixtures;
- router registry/codehash tests;
- hook classification tests;
- transient provider failure tests;
- route ready → outage → recovery;
- route ready → authoritative route removal;
- price-impact advisory vs strict-mode tests;
- mobile Buy/Sell sheet regression;
- desktop terminal regression;
- wallet rejection, receipt timeout, revert, refresh recovery;
- production preview and real-device review;
- no automated contract deployment.

---

# 15. Competitive definition

RMT beats another terminal only when measurements show that it:

- discovers launches sooner from canonical events;
- explains v4 hook behavior more clearly;
- produces a verified quote faster;
- maintains route-state stability through provider outages;
- compares more supported execution paths;
- gives traders control over price impact without weakening transaction validation;
- recovers uncertain transactions without duplicate submission;
- exposes the exact reason a wallet action is unavailable.

The target is not the most information on screen. The target is the shortest path to a decision the trader can understand and a transaction RMT can prove.
