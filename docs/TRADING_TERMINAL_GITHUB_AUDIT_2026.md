# RMT Trading Terminal — Upstream GitHub Audit

**Research date:** 2026-08-06  
**Scope:** Robinhood Chain market discovery, Uniswap v3/v4/UniswapX execution, Sushi routing and Sushi v4, launchpad provenance, hook intelligence, indexing, charts, RPC reliability, and trader-control policy.

This document is a research artifact. It does not change production behavior, deploy contracts, activate delegated trading, or authorize a merge.

## Executive conclusion

RMT does not need another visual redesign. Its next competitive leap comes from five architectural changes:

1. **Protect transaction integrity, not traders from their own market-risk decisions.** Price impact and slippage must be transparent and user-controlled. Route identity, calldata, recipient, balance deltas, stale quotes, unsupported hook data, and failed simulations remain hard safety boundaries.
2. **Replace request-time rediscovery with event-led indexing.** Immutable pool identity, launcher origin, PoolKey, PoolId, hook permissions, LP custody, and migration status should be indexed once and updated from canonical events.
3. **Treat Uniswap v4 hooks as first-class execution programs.** A v4 pool is not adequately described as “Uniswap v4.” RMT must expose hook permissions, dynamic fees, return-delta behavior, custom hook data, upgradeability, source verification, current fee, and exact simulation results.
4. **Build a versioned execution-contract registry.** Official Uniswap repositories currently expose more than one Robinhood Universal Router address across deployment sources. RMT should verify router version and bytecode rather than rely on one hard-coded address copied from one upstream package.
5. **Race supported venues and progressively render results.** Display indexed market evidence immediately, request Sushi/Uniswap quotes in parallel, surface the first valid executable quote, and continue calculating best net execution in the background.

## Repositories reviewed

### Uniswap

- `Uniswap/contracts`
- `Uniswap/sdks`
  - `universal-router-sdk`
  - `v4-sdk`
  - `uniswapx-sdk`
- `Uniswap/interface`
- `Uniswap/liquidity-launcher`
- `Uniswap/v4-core`
- `Uniswap/v4-periphery`
- `Uniswap/hooklist`
- `Uniswap/UniswapX`
- `Uniswap/smart-order-router`
- `Uniswap/routing-api`
- `Uniswap/unified-routing-api` — archived; do not adopt for new work

### Sushi

- `sushi-labs/sushi`
- `sushi-labs/examples`

### Launchpads and launch intelligence

- `ponsdotdev/ponsfamily`
- `mmsaki/pools.trade-contracts` — useful public companion/test repository, but not independently verified here as the canonical Pools.trade organization; every address or behavioral claim from it must be corroborated against official Uniswap repositories and onchain evidence.

### Indexing and data

- `ponder-sh/ponder`
- `enviodev/hyperindex`
- `blockscout/blockscout`

### Interface and charting

- `tradingview/lightweight-charts`

### Hook/security references

- `OpenZeppelin/uniswap-hooks` — reference only; the repository itself labels the software experimental and unaudited.

---

# 1. Immediate RMT findings

## 1.1 The 1% price-impact experience is misleading

RMT already stores selectable price-impact preferences of 1%, 2%, 5%, or no RMT cap, with 5% as the normal default. However, the current smart-order caution always says **“Reduce below 1%”** whenever the quote is above 1%, regardless of the user’s selected limit.

That produces the exact behavior observed in the screenshots:

- a 1.03% quote receives a large red reduction action;
- the interface looks blocked even when price impact is not the actual disabled-state cause;
- a separate insufficient-balance or preflight condition can appear on top of the execution evidence, making it seem that the 1% warning blocked the transaction.

The current confidence component also uses copy equivalent to **“Trade blocked: extreme price impact”**, while the Sushi and Uniswap submit-button conditions do not generally include that display-level impact warning as a hard disable. The text and the actual state machine are therefore inconsistent.

### Upstream comparison

The current Uniswap interface uses a materially different policy:

- approximately 5%: warning;
- approximately 10%: high warning;
- action type: warn before submit;
- hard disable is represented by separate disable-review or disable-submit actions.

### RMT policy change

RMT should distinguish three independent concepts:

| Concept | Purpose | Default behavior |
|---|---|---|
| Advisory threshold | Calls attention to market risk | Warn, never imply a block |
| User-selected impact limit | Trader preference | Acknowledge-and-proceed by default; optional strict mode |
| Transaction-integrity failure | Route/calldata/simulation invalid | Hard block |

Recommended default behavior:

- Below 1%: neutral.
- 1%–5%: informational or mild caution.
- 5%–10%: high-impact warning requiring acknowledgement.
- Above 10%: critical warning requiring deliberate confirmation and showing the estimated loss.
- User can select 1%, 2%, 5%, 10%, custom, or no RMT advisory cap.
- **Strict cap** is opt-in. In strict mode, RMT blocks above the user’s limit.
- “Reduce below X%” uses the user-selected X and remains an optional convenience.

RMT should never silently widen slippage or change the amount. The trader chooses whether to reduce, continue, or cancel.

## 1.2 The screenshot’s “blocked” state is probably not price impact

The screenshot contains:

- `Price impact 1.03%`;
- `Network fee Blocked`;
- a large `Insufficient balance` state;
- `Review required` evidence.

This indicates that the executable state is most likely blocked by balance/network-fee reserve or required evidence review, not by the 1.03% warning itself. RMT needs one authoritative blocker summary:

> **Cannot open wallet review: wallet needs X more ETH for amount + estimated network reserve.**

Then price-impact warnings remain separate and do not visually cover execution evidence.

## 1.3 RMT currently ships no official Uniswap SDK packages

The web application depends on `viem`, `wagmi`, React, Next.js, and internal route builders. It does not currently depend on:

- `@uniswap/universal-router-sdk`;
- `@uniswap/v4-sdk`;
- `@uniswap/uniswapx-sdk`;
- `@uniswap/sdk-core`.

Hand-built viem logic is valuable for validation and independence, but RMT must continuously compare its command encoding/decoding against official SDK behavior. The strongest approach is not “replace everything with the SDK.” It is:

1. use official SDKs as the reference encoder/decoder and deployment/version registry;
2. independently decode and verify every returned transaction with RMT’s existing viem-based validator;
3. reject any disagreement.

## 1.4 RMT’s v4 verifier is sophisticated but request-heavy

Current v4 verification already does several good things:

- reconstructs `PoolKey` from the canonical PoolManager `Initialize` event;
- recomputes `PoolId` from the key;
- verifies token membership;
- reads `StateView.getSlot0`;
- checks bytecode on PoolManager, StateView, Quoter, router, and hook;
- decodes the 14 hook permission bits;
- inspects Blockscout source/proxy/changed-bytecode evidence;
- simulates a real-holder sell path;
- simulates the exact wallet route before returning executable calldata.

The main performance problem is where those facts are obtained:

- DexScreener is queried before canonical onchain evidence;
- `Initialize` logs may be scanned from block zero on a request path;
- multiple bytecode and source requests run during the quote path;
- one HTTP RPC endpoint is selected;
- immutable hook and pool facts are repeatedly recomputed.

These belong in an index and evidence cache, not on every Buy click.

## 1.5 RMT currently excludes most nontrivial v4 hooks

The assessment marks a pool as `review` when a hook:

- affects swaps;
- returns swap deltas;
- has custom state-changing functions;
- is or may be upgradeable;
- lacks independently published source.

The execution builder then requires the assessment state to be exactly `eligible`. In practice, many legitimate hooked pools become nontradeable even if an exact quote and exact route simulation pass.

That explains why v4 support can look broad in discovery but narrow in execution.

Recommended policy:

### Hard block

- hook address has no code;
- published bytecode is known to mismatch;
- required custom `hookData` is unsupported or unavailable;
- current exact quote cannot be produced;
- exact wallet route simulation fails;
- recipient, token, PoolId, PoolKey, router, amount, or minimum output does not match;
- hook changes the exact-input/exact-output direction or violates the protected minimum;
- dynamic or hook fees exceed a user-selected hard cap;
- unsupported fee-on-transfer/rebase behavior invalidates balance accounting.

### Review-required but executable

- swap-affecting hook with known permissions;
- return-delta fee hook where the quoted output already includes the delta;
- dynamic fee pool with current fee disclosed;
- verified proxy/upgradeable hook;
- source not independently published but bytecode and current simulation are valid;
- project-specific write functions unrelated to the exact transaction.

Review-required execution should require a deliberate acknowledgement and fresh exact simulation, but it should not silently become “view only.”

## 1.6 Single-RPC architecture remains a latency and availability risk

The shared chain configuration defines one public Robinhood Chain HTTP RPC. Several server modules instantiate separate clients against one selected endpoint with retries.

Recommended provider architecture:

- primary paid/private RPC;
- Robinhood public RPC;
- one independent fallback RPC;
- viem fallback transport with ranking/timeout controls;
- WebSocket or sequencer-feed consumer for live logs where available;
- Blockscout API only as historical/metadata fallback, never as the sole transaction truth source;
- per-provider latency, error-rate, block-height, and stale-head monitoring.

---

# 2. Uniswap deployment and SDK findings

## 2.1 Universal Router sources are not perfectly synchronized

This is the most important upstream-integration finding.

RMT currently uses Robinhood Universal Router:

`0x06afBA43fd06227fA663b0dAeCF536F6eaA6BF99`

The current `Uniswap/contracts` Robinhood deployment JSON labels that address as the latest Universal Router and describes it as a Universal Router v2.1.1 redeployment wired to the production Across SpokePool.

However:

- the Universal Router SDK chain constants point to `0x8876789976decbfcbbbe364623c63652db8c0904`;
- the generated `deployments/4663.md` summary also shows `0x8876…0904`;
- the latest deployment JSON explains that `0x06af…bf99` differs because the SpokePool is an immutable constructor parameter.

Therefore, the answer is **not** to blindly replace RMT’s address with the one in the SDK or the X post.

### Required solution: versioned deployment registry

RMT should maintain an upstream-synchronized registry containing:

- contract role;
- address;
- version;
- creation block;
- immutable constructor configuration;
- approved runtime bytecode hash;
- source repository + commit;
- active/deprecated state;
- supported command set;
- decoder version.

Both known routers can be represented, but only an explicitly active/approved router may be selected for new execution. Any API-produced transaction must identify a router whose bytecode hash and immutable configuration match the registry.

A scheduled CI job should diff:

- `Uniswap/contracts/deployments/json/4663.json`;
- `Uniswap/sdks` chain constants and changelogs;
- RMT’s local registry.

A divergence opens a blocking maintenance issue instead of silently changing production.

## 2.2 Universal Router SDK requirements

Current official upstream versions reviewed:

- `@uniswap/universal-router-sdk` 5.11.2;
- `@uniswap/v4-sdk` 2.3.1;
- `@uniswap/uniswapx-sdk` 3.0.11.

Important Universal Router SDK changes relevant to RMT:

- router 2.1.1 command decoding;
- `minHopPriceX36` support;
- v4 exact-output underdelivery protection;
- output-based slippage semantics;
- explicit inbound budgets and outbound coverage;
- rejection of unsafe v4 `SETTLE_ALL` / `TAKE_ALL` plans unless direct transfers are explicitly allowed.

RMT should add conformance fixtures that encode representative trades with the official SDK, decode them independently, and require exact agreement on:

- router;
- commands;
- input budgets;
- output recipients;
- minimum outputs;
- sweep recipients;
- Permit2 spender;
- v4 paths and hook data;
- deadlines;
- native value.

## 2.3 Pool identity and hooks

Official v4 core defines:

```text
PoolKey = currency0 + currency1 + fee + tickSpacing + hooks
PoolId  = keccak256(abi.encode(PoolKey))
```

RMT already recomputes PoolId correctly. The next step is to persist the complete PoolKey as the canonical primary identity for each v4 market rather than treating a generic market API’s pair identifier as authoritative.

## 2.4 Hooklist now contains Robinhood Chain entries

The official Uniswap hooklist includes Robinhood Chain and already has multiple Robinhood hook metadata files. Its schema exposes:

- all 14 permission flags;
- dynamic fee status;
- upgradeability;
- custom swap-data requirements;
- vanilla-swap compatibility;
- source verification;
- audit URL;
- deployer and description.

Example: `RobinhoodArenaFeeHook` declares `beforeInitialize` and `afterSwap`, returns an after-swap delta, calculates fees through an external helper, restricts initialization through an owner allowlist, is non-upgradeable, and does not require custom swap data.

RMT should ingest Hooklist as **supplemental metadata**, then independently verify onchain:

- hook address flags;
- deployed code hash;
- proxy implementation and admin;
- current helper/config addresses;
- current fee/dynamic-fee state;
- exact quote and exact simulation.

Hooklist metadata is evidence, not an execution guarantee.

## 2.5 Hook data must be explicit

The official v4 Quoter accepts `hookData` for exact-input and exact-output quotes. RMT currently quotes with `hookData = 0x`.

This is correct only for pools that do not require custom swap data. The terminal must classify pools as:

- `hookData: none required`;
- `hookData: deterministic and supported`;
- `hookData: user/project-specific`;
- `hookData: unknown`.

Only the first two can be executed automatically. Unknown or project-specific hook data remains view-only until a validated adapter exists.

---

# 3. Liquidity Launcher and Pools.trade findings

## 3.1 Do not use one version label for the full launcher generation

The screenshot describes a “Liquidity Launcher v3.1.1” generation. Current official deployments are mixed by component. The current upstream README shows, for Robinhood Chain, a combination including:

- LiquidityLauncher v3.2.0;
- InstantLaunchStrategy v3.2.0 fees-on and fees-off variants;
- UniversalRouterStrategy v3.2.0;
- TokenSplitter v3.2.0;
- LBPStrategy v3.1.1;
- InitializerHook v3.1.1;
- FeeSplitter contracts;
- UERC20BeneficiaryVault;
- CompoundingClaimRecipient.

RMT should store component-level versions and addresses rather than assign one generation number to every launch.

## 3.2 Canonical event graph

RMT can identify launcher markets quickly and deterministically from these official events:

### LiquidityLauncher

- `TokenCreated(tokenAddress)`
- `TokenDistributed(tokenAddress, strategy, amount)`

### InstantLaunchStrategy

- `DistributionInitialized(...)`
- `TokenLaunched(poolId, token, finalPositionRecipient, PoolKey)`

### LBPStrategy

- `InitializerCreated(initializer, migrationParams)`
- `Migrated(initializer, PoolKey, initialSqrtPriceX96, plan)`
- `MigrationFailed(initializer, reason)`
- `FundsRecovered(initializer, recipient, amount)`
- `CurrencySwept(...)`
- `TokensSwept(...)`

### FeeSplitter

- `FeesCollected(tokenId, token, nativeAmount, tokenAmount)`
- `FeesForwarded(recipient, currency, amount)`

### Claimable recipients / beneficiary vault

- `AmountsReceived(tokenId, currency0Amount, currency1Amount)`
- `Claimed(tokenId, currency0Amount, currency1Amount, PoolKey)`
- ERC-721 transfer events identify the current beneficiary claim owner.

### v4 PoolManager

- `Initialize`
- swaps and liquidity changes needed for price, volume, active-liquidity, and current-fee state.

This event chain gives RMT immediate provenance:

```text
launcher → token → strategy → pool key → pool id → hook → LP recipient → fee beneficiary
```

It should remove the delay caused by waiting for generic market providers to discover a launch.

## 3.3 Instant launch behavior

The current official InstantLaunchStrategy:

- requires a fixed one-billion-token supply with 18 decimals;
- creates a hookless native-ETH v4 pool;
- uses 25 bps LP fee and tick spacing 25;
- mints a one-sided position;
- transfers the LP position to the configured FeeSplitter;
- can register a fee beneficiary before transferring custody.

A public Pools.trade companion/test repository reproduces this operational flow and notes that the pool opens token-only with zero active liquidity until the first buy moves price into range. Because that repository is not independently verified here as the canonical project organization, RMT should corroborate it with official launcher events and live PoolManager state.

## 3.4 LBP/crowd launches need lifecycle states

A launch token is not equivalent to a live executable pool merely because a launcher token exists.

Required lifecycle states:

- token created;
- initializer/auction created;
- auction active;
- auction ended;
- migration eligible;
- migration submitted;
- migration failed/recoverable;
- funds recovered;
- pool migrated and initialized;
- executable route verified.

Only `Migrated` plus a matching PoolManager `Initialize` and fresh route proof should produce a live pool state.

## 3.5 Fee ownership is a product feature

LaunchProof’s fees page exposes positions where the connected wallet is the current beneficiary. RMT can support the same evidence model from official events, while improving it with:

- current beneficiary NFT holder;
- accrued claimable amounts;
- FeeSplitter split configuration;
- callback risk or claim revert reason;
- claim simulation;
- exact transaction preview;
- position and PoolKey evidence;
- “creator fee source” tied back to launch provenance.

---

# 4. Sushi findings

## 4.1 RMT is already on the current Sushi Swap API generation

Current RMT server code uses:

- `https://api.sushi.com/quote/v7`;
- `https://api.sushi.com/swap/v7`;
- current Robinhood RedSnwapper `0x8e6fd69a77e88ee20ba4b4fbd59dfcda3ec0e98a`;
- `simulate=true` and `validate=true`;
- recipient, sender, max slippage, max price impact, referrer;
- independent calldata and bytecode validation.

Therefore, the upgrade is not “move from Sushi v6 to v7.” That is already done.

## 4.2 RedSnwapper execution semantics

The official Sushi SDK describes RedSnwapper as the facade over RouteProcessor/executor contracts. It:

1. transfers input to the executor;
2. invokes executor calldata;
3. verifies that the recipient’s output balance increased by at least `amountOutMin`.

RMT should retain its current independent checks of:

- router address/code hash;
- executor address/code hash;
- function selector;
- sender and recipient;
- token in/out;
- amount in;
- minimum out;
- native value;
- simulation result.

## 4.3 Sushi v4 is deployed on Robinhood

The current official Sushi SDK lists Robinhood Chain support for SushiSwap v4 CL and publishes addresses including:

- Vault: `0xeb4f1e157d18b1a4d09a5207a96e17601ea354b2`
- CL Pool Manager: `0x81d732702f87d2d652ae79e9f52bf44928eca210`
- Protocol Fee Controller: `0x6774ca40df651c3139d25f61d3b5cdbc8aec63de`
- Position Manager: `0xd3d35fbc4e44523ca3cd383c1948322ddb42f644`
- Quoter: `0x2a0819373b09ec553e7b15808f76601362b1c291`
- Tick Lens: `0xbb9757cb480a08730f372dfe3068a6e86f35c63a`

RMT’s current venue model recognizes Sushi aggregator execution but does not treat Sushi v4 CL as a separately indexed pool protocol. V12 should index Sushi v4 pools and compare direct/quoter evidence with Sushi API output.

---

# 5. Pons findings

The official Pons source repository contains two distinct generations:

- V1: CREATE2 token, one-sided Uniswap v3 liquidity, locked position, atomic optional developer buy, launch-window anti-snipe limits.
- V2: bonding curve, permissionless two-stage graduation into Uniswap v4, permanent full-range position lock, singleton hook, quote-denominated fees, creator tax, escrow, and buyback vault.

This matters to RMT because “Pons” cannot be one generic launch label.

## Required V1 evidence

- predicted/created token address;
- factory launch event;
- canonical v3 pool;
- position token ID;
- locker custody;
- anti-snipe window status and limits;
- optional developer buy;
- locked-capital graduation status.

## Required V2 evidence

- curve address and quote asset;
- virtual/phantom reserve and current curve state;
- current quote-leg fees and creator tax;
- graduation phase;
- retryable pool-creation status;
- final v4 PoolKey and PoolId;
- permanent locker custody;
- PonsV2MemeHook permissions and current fee policy;
- buyback-vault balances and vesting;
- fee escrow balances.

Pons V2 is a strong example of why RMT must stop treating all swap-affecting hooks as automatically non-executable. Its after-swap hook intentionally takes and converts fees. RMT must disclose and simulate that behavior rather than reduce the entire pool to “view only.”

---

# 6. UniswapX findings

The official UniswapX repository now includes Robinhood Chain deployment material:

- V3DutchOrderReactor: `0x000000007A1C8e570011EeDF86A2A35593013cBA`
- OrderQuoter: `0x00000000a3db63Df9078cBF3dF88B4CAdD5a7F58`
- Permit2: canonical address

Robinhood Chain is an Arbitrum Orbit chain. The reactor uses `ArbSys.arbBlockNumber()` for decay semantics. The official chain playbook warns that on-demand block production can cause block-driven Dutch-order decay to stall during idle periods even though timestamp deadlines continue normally.

The same playbook states that contract deployment is complete while SDK/service wiring remains a separate phase. Therefore:

- RMT may index the contracts now;
- RMT should not promise a usable UniswapX route until public API/filler/service coverage is confirmed for the exact token and order size;
- route selection must monitor L2 blocks per minute and explain stalled price decay;
- RFQ/intent routes should be compared with AMM routes by net output, fill probability, expiry, and settlement state.

UniswapX is valuable for:

- filler competition;
- MEV-aware intent settlement;
- gasless-style user experience where supported;
- arbitrary liquidity sources.

It introduces additional states that the terminal must expose:

- order signed;
- broadcast to fillers;
- exclusive period;
- decay active/stalled;
- fill submitted;
- fill settled;
- order expired/cancelled;
- no filler accepted.

---

# 7. Indexing architecture findings

## 7.1 Why an indexer is mandatory

Request-time discovery forces the user to wait for facts that rarely change:

- factory/launcher origin;
- pool creation block;
- PoolKey and PoolId;
- hook flags;
- strategy version;
- LP custody;
- beneficiary assignment;
- contract code hash;
- migration status.

These should be indexed once. At trade time, RMT should fetch only volatile facts:

- current slot/tick/fee;
- current liquidity;
- fresh route;
- fresh quote;
- balances/allowances;
- exact simulation.

## 7.2 Ponder

Ponder is an open-source TypeScript EVM indexing framework with Postgres output, generated GraphQL/SQL APIs, factory-contract support, and local development tooling. It fits RMT’s TypeScript stack and minimizes operational complexity.

## 7.3 Envio HyperIndex

HyperIndex provides TypeScript/JavaScript handlers, GraphQL output, reorg handling, wildcard/factory indexing, and RPC fallback. Its strongest speed claims rely on HyperSync. Robinhood native HyperSync availability must be confirmed; otherwise it can still run through RPC.

## 7.4 Recommendation

Benchmark three implementations against the same Robinhood block range and event set:

1. Ponder with primary/fallback RPC.
2. HyperIndex using HyperSync if Robinhood is supported, otherwise RPC mode.
3. Minimal custom viem worker using batched `eth_getLogs`, Blockscout fallback, and Postgres.

Measure:

- historical sync speed;
- live-event delay;
- reorg handling;
- RPC calls and cost;
- missed/duplicate event rate;
- recovery after downtime;
- deployment complexity.

Do not select an indexer solely from vendor benchmark claims.

---

# 8. Charting findings

TradingView Lightweight Charts is an appropriate candidate for replacing or supplementing the hand-built SVG chart. It provides efficient financial candles, crosshair/scale behavior, live updates, plugins, markers, and annotations.

Useful RMT overlays:

- confirmed buys/sells;
- launch and migration markers;
- dynamic-fee changes;
- hook configuration changes;
- liquidity add/remove events;
- Position Guard floors and targets;
- route failure/staleness markers;
- current protected minimum and wallet entry.

The library requires TradingView attribution under its license/NOTICE terms.

This is a later-stage improvement. It should not precede route-speed and execution-state fixes.

---

# 9. Recommended adoption matrix

| Repository / capability | Decision | Reason |
|---|---|---|
| Uniswap deployment JSON | Adopt now | Canonical versioned contract inventory |
| Universal Router SDK 5.11.x | Adopt as reference + conformance tests | Current command semantics and safety invariants |
| v4 SDK 2.3.x | Adopt as reference | Pool/path/slippage encoding consistency |
| Uniswap interface warning model | Adopt conceptually | Separates warnings from hard disable states |
| Liquidity Launcher events | Index now | Fast, authoritative launch provenance |
| Uniswap Hooklist | Ingest as supplemental evidence | Rich Robinhood hook metadata already exists |
| v4 core/periphery ABIs | Index/verify now | Canonical PoolKey, PoolId, hooks, current state |
| Sushi API v7 | Keep | RMT is already current |
| Sushi v4 deployment registry | Add | Currently missing as first-class venue |
| UniswapX | Stage behind service-availability gate | Contracts exist; service/filler availability must be proven |
| Pons V1/V2 factories | Index directly | Eliminates delayed/ambiguous launch state |
| Ponder | Prototype | Best stack fit |
| Envio HyperIndex | Benchmark | Potentially faster, network support must be verified |
| Lightweight Charts | Later integration | Strong chart UX; not the current bottleneck |
| OpenZeppelin hook library | Reference only | Explicitly experimental/unaudited |
| Archived unified-routing-api | Reject for new work | Archived upstream |
| Unverified third-party trade bots | Reject | No authoritative safety or maintenance boundary |

---

# 10. Highest-priority corrections

## P0 — Truthful trader controls

- Replace fixed “Reduce below 1%” with dynamic user preference.
- Separate caution from actual disabled reason.
- Remove “trade blocked” language unless submit is truly disabled.
- Show exact missing ETH/token balance and fee reserve.
- Add advisory vs strict price-impact modes.

## P0 — Deployment registry

- Add versioned Uniswap/Sushi deployment registry.
- Import and diff official upstream deployment manifests.
- Support explicit active/deprecated addresses and code hashes.
- Fail CI on unexplained upstream divergence.

## P0 — Index-first discovery

- Index Liquidity Launcher, Pons, Uniswap v3/v4, and Sushi v4 events.
- Stop scanning PoolManager from genesis in the quote path.
- Stop making DexScreener eligibility a prerequisite for canonical v4 evidence.

## P1 — Hook intelligence

- Ingest Hooklist Robinhood records.
- Persist permission bits, current LP fee, dynamic fee, proxy/admin, helper addresses, custom hook-data requirement, and code hash.
- Replace blanket hooked-pool exclusion with block/review/eligible policy.

## P1 — Progressive best execution

- Race Sushi v7, Uniswap v3, Uniswap v4, and supported UniswapX intents.
- Display first executable quote immediately.
- Continue comparing net output after gas, platform fee, hook delta, and route risk.
- Never use a cached quote for wallet submission.

## P1 — RPC resilience

- Add fallback transports and health scoring.
- Cache immutable evidence by block/code hash.
- Add live subscriptions for PoolManager and launch-factory events.

---

# 11. Acceptance metrics

V12 should not be declared better than established terminals from appearance alone. It must meet measurable gates:

| Metric | Target |
|---|---|
| Indexed market shell visible | p50 < 300 ms, p95 < 800 ms |
| First executable quote after amount settles | p50 < 1.5 s, p95 < 4 s |
| All supported venues compared | p95 < 6 s |
| False permanent-unavailable state after transient provider failure | 0 |
| Fresh quote required before wallet review | 100% |
| Exact simulation required before wallet review | 100% |
| v4 markets with complete PoolKey/PoolId | 100% |
| hooked pools with permission and custom-data classification | 100% |
| warnings labeled as blocks when submit is actually enabled | 0 |
| router/calldata/recipient mismatch accepted | 0 |
| unresolved submitted transaction permitted to duplicate-submit | 0 |
| launch provenance derived from canonical events where supported | 100% |

---

# Final position

RMT’s competitive advantage should be:

> **The fastest path from a newly created Robinhood Chain market to an understandable, independently verified, user-controlled transaction.**

That requires less request-time rediscovery, more canonical indexing, deeper v4-hook intelligence, progressive multi-venue quoting, and clearer separation between transaction safety and trader discretion.
