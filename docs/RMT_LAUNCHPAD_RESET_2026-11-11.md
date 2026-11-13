# RMT Launch: scope reset, research and cleanup plan

Historical record. Task 018's [Curve V1 roadmap](RMT_LAUNCH_CURVE_V1.md) governs future launches.

Date: 2026-11-11 (America/Denver)

Base: `LandoCrissian/robinhood-meme-terminal` at `6d0b8103bdad95367445a38e5f5327458baa9ab2`; tree `fdc846300c1d980f3b5c8de34885417098f02448`.

## Owner-approved product requirements

RMT becomes strictly a token launchpad. Keep the current clean UI. Preserve the existing RMT token and its custom curve. New third-party launches should become usable outside RMT without being trapped behind an RMT-only market. Research Pons and v4 rather than assuming a protocol version solves discovery. LAMMB Empires continues separately.

Approval covers research and reviewable repository cleanup. It does not approve a particular new fee/supply/seed-liquidity policy, deployed contract, merge, production cutover, onchain transaction or shutdown of services.

## Work completed in this change

Replaced contradictory current product instructions in AGENTS, README, architecture, system map and the terminal completion gate. Preserved their old bytes under `docs/archive/terminal-scope-2026-11-11/` using the original Git blobs. Historical relative links in those snapshots refer to their original locations.

No executable files, deployed contracts, dependencies, UI, databases or cloud settings are changed. This is an initial scope/authority cleanup, not completion of the requested runtime strip-down. The new launch engine is not implemented.

## Repository findings

- `apps/web/app/page.tsx` mounts the existing VNext shell, imports its CSS and restores launch-specific asset intent through `readLaunchIntelligence` and `launchTerminalEntry`. Preserve this reusable entry/identity logic rather than replacing it with a new unrelated app.
- `terminal-presentations.tsx` includes Projects/NFT/Portfolio/Distribution navigation and Chain Pulse/Capital Flow cards. Those unrelated product modules are concrete cleanup targets. Retain wallet, token detail, trade/recovery and the visual system.
- `RMTLaunchFactoryV6.sol` imports `CloneBondingCurveMarketV6` and graduation adapter interfaces. `MAINNET_V6_DEPLOYMENT.md` records a custom curve followed by Uniswap v4 graduation. The gap is launch-time standard liquidity, not absence of v4 anywhere in RMT.
- The prior README and V6 deployment document conflict about historical launch 0. Preserve all contract bindings; resolve the exact current-token identity before any relabeling or address-specific action. No token identity was independently established onchain in this review.
- Open PR #575 contains LAMMB CannaCat embed and security/recovery work against this base. Its shared dependencies must survive cleanup. Other open PRs include discovery, NFT, quote recovery and historical indexing changes; do not merge, close or rebase them incidentally.
- The contract record itself documents incomplete historical evidence and source-verification/audit limitations. Those limitations are not cured by a scope reset.

Inspected areas include the five authority files, root tree, contracts tree, V6 deployment record, the beginning of the V6 factory, root entry and portions of the shell/presentation files, plus open PR summaries. This was not a complete line-by-line audit of every repository file, a smart-contract audit, or a deployed-runtime inspection.

## Primary-source research

### Pons: distinguish product versions

[Pons V1 documentation](https://docs.ponsfamily.com/) describes token deployment with a locked Uniswap v3/WETH pool in the same transaction. Graduation is a threshold in that same pool, not a later liquidity migration. This is closer to the owner's day-one external-pool requirement.

[Pons V2 documentation](https://docs.ponsfamily.com/v2) instead describes a token trading on a bonding curve first, then graduating into a permanently locked Uniswap v4 pool. Its factory, curve events, hook, fee escrow and recovery logic are separate components. That design does not supply a standard DEX pool at initial token creation. These are documentation findings, not independent bytecode verification or certification of current public-launch availability.

No Pons contract or frontend code is copied by this change. Do not trust similarly named fork repositories as official source or infer a reusable license without verifying provenance and terms.

### v4 is available, but not universal

[Uniswap's Robinhood Chain announcement](https://blog.uniswap.org/robinhood-chain-is-live) states that v2, v3, v4 and UniswapX coexist. [Official v4 deployment mappings](https://developers.uniswap.org/docs/protocols/v4/deployments) include chain 4663; the candidate PoolManager is `0x8366a39cc670b4001a1121b8f6a443a643e40951`. This address was checked against documentation, not independently runtime-verified in this task. Resolve and pin the complete chain-specific deployment set before implementation; never assume Ethereum addresses apply.

[PoolManager architecture](https://developers.uniswap.org/docs/protocols/v4/concepts/poolmanager) identifies pools within a singleton. Store chain ID, PoolManager, full PoolKey and bytes32 PoolId. A PoolId is not a 20-byte pair-contract address.

[Uniswap Labs hook-routing policy](https://support.uniswap.org/hc/en-us/articles/48291859140621-Routing-for-hooked-pools) requires manual allowlisting for certain hook flags, including beforeSwap/afterSwap and dynamic fees. Protocol-valid pool execution is not a guarantee of app/aggregator routing. Initial recommendation: standard hookless v4, unless a demonstrated requirement justifies a separately tested hook.

### Immediate availability is not universal listing

[DEX Screener listing documentation](https://docs.dexscreener.com/token-listing) describes automatic listing after a pool exists and has a transaction. Treat this as conditional on chain/venue coverage and actual provider processing, not a universal timing guarantee. Metadata/social display is a separate process. Do not manufacture trading activity to obtain a listing.

## Proposed new-launch design (not deployed)

RMT-owned factory -> standard fixed-supply ERC-20 -> initialize a canonical standard v4 pool -> supply disclosed liquidity -> place the liquidity position in verified custody/lock -> emit a complete launch record -> publish the confirmed token/pool inside RMT -> observe external discovery and route availability separately.

Prefer atomic deployment/initialization/funding/lock so a failed launch cannot be mislabeled live. Standard transferable tokens and hookless pools are the initial compatibility recommendation; no mandatory RMT-only router or special transfer tax. Final supply and allocation rules are design decisions, not inherited from the legacy factory.

A real liquidity design is required. Specify who contributes quote assets, how much inventory is allocated, initial price, ranges, fee tier and lock/custody conditions. Single-sided token inventory is not pre-existing ETH liquidity. Do not promise price floors or painless exits. Fee collection must not permit withdrawing principal contrary to the advertised lock. Do not adopt the historical 70/30 split or terminal 25-bps fee without a separate decision.

Own the launch contracts and product, while interoperating with common DEX infrastructure. This does not depend on Pons to deploy tokens and does not require recreating Uniswap.

## Staged runtime cleanup

### 1. Preserve and map

Create an isolated implementation branch from the reviewed base. Capture the current desktop/mobile visual baseline before changes. Inventory public routes, API handlers, imports, workspace/dependency scripts and scheduled jobs. Pin the legacy contracts, receipts and exact token identities. Identify all consumers of modules used by PR #575; protect its unrelated work.

### 2. Strip the unrelated public product

Reuse the current shell/CSS/logo and components. Remove NFT/project-cross-asset navigation, broad stock/RWA categories, Distribution Center and unrelated Chain Pulse/Capital Flow promotion from the launchpad. Retain required wallet/fee state and transaction recovery. Replace paused-launch copy only when the replacement flow exists; do not expose a nonfunctional Launch button or reopen the legacy factory.

Delete or extract now-unreferenced runtime modules, API handlers and packages with dependency tests. Retire routes with explicit compatibility behavior. Remove unnecessary local schedules/configuration, but do not shut down production workers or delete databases as a side effect. Document any source that remains solely for deployed compatibility or the separate LAMMB consumer.

### 3. Build new launches and discovery

Implement the separately versioned factory/locker and direct v4 launch path. Index its canonical events with chain-qualified identities, bounded live/backfill lanes, restart/reorg safety and deduplication. Show the verified launch receipt immediately in RMT while indexing completes. Do not gate fresh RMT launches on the old eight-market curated-seed registry. External listing/routing status must be observed, not fabricated from pool creation.

### 4. Review before release

Complete the checks below, reconcile open PR overlap, obtain exact-head review and keep production unchanged until an explicit release decision.

## Implementation acceptance

- Existing token/curve addresses, supply, balances, fee rights, liquidity and historical evidence are unchanged; current-token identity is explicitly reconciled.
- Existing UI visual baseline remains recognizable at phone and desktop widths, with no overflow, new scrolling burden or broken deep links.
- Removed features have no accidental route/import/runtime-job dependencies; preserved compatibility and LAMMB embed tests pass.
- No wallet custody, auto-signing, unexpected approval, recipient change or weakened recovery/settlement check.
- New launches produce the expected token, PoolKey/PoolId and funded position, or fail without a falsely live launch. Initialization front-running, reentrancy, dust/refunds, native/ERC-20 settlement, slippage and allowance boundaries are tested.
- Position custody enforces advertised principal locks while allowing only authorized fee handling; no mutable backdoor undermines the launch terms.
- Quotes and buy/sell flows are tested through an independent supported route, not only RMT's own UI. Distinguish local/fork tests from funded live proofs.
- Event indexing survives restart, duplicate logs, reorg and provider failure; newly created launches are discoverable without a manual seed-list edit.
- External-platform status accurately reports pending, supported/observed, unavailable or unsupported. No promise of CEX/CoinGecko/wallet-logo listing or universal immediate visibility.
- Contract unit/fuzz/invariant and relevant integration tests, affected indexer suites, web typecheck/build, dependency/security scans and mobile/desktop visual/regression tests pass without waivers introduced to hide regressions.
- Independently reviewed deployment provenance, source verification, security review status and explicit release approval exist before production token creation is enabled.

## Validation boundaries for this documentation change

Source was inspected through the GitHub connector. A local repository checkout was unavailable because the execution environment could not resolve GitHub; no full build, contract suite, browser run or live funded transaction was executed. This limitation must be retained in the PR description. Inspect the exact Git diff to verify only documentation changed and all archived files retain their original blob identities. Any GitHub CI results must be reported from actual check states, not inferred from a documentation-only diff.
