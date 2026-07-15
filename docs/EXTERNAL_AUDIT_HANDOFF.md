# RMT V6 external security review handoff

## Engagement objective

Independently assess the V6 release candidate before deployment, review remediations, and verify the exact deployed bytecode and immutable configuration before public V6 launches reopen.

Automated tests, Slither, fuzzing, fork rehearsals, and internal review are evidence inputs—not substitutes for independent judgment.

## Review target

- Repository: `LandoCrissian/robinhood-meme-terminal`
- Candidate PR: https://github.com/LandoCrissian/robinhood-meme-terminal/pull/112
- Frozen candidate commit: record at engagement start
- Chain: Robinhood Chain mainnet (`4663`)
- Existing V5 registry governance: `0x13C0A930516FB6bF0d467B38605d9D2a9c4C6953` (factory activation only)
- Existing V5 factory: `0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD`
- Official legacy RMT token and V6 migration provenance anchor: `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C`
- Existing version registry: `0x4b8b222B5CAa7066c02A54E51eC1a674ADf5b3A1`
- Canonical V4 PoolManager: `0x8366a39CC670B4001A1121B8F6A443A643e40951`

V6 addresses do not exist yet. Add them only after deployment receipts and bytecode are independently verified.

## Contracts in scope

### Launch and identity

- `RMTLaunchFactoryV6`
- `OfficialRMTIdentityMigration`
- `CloneFixedSupplyMemeToken`
- `MinimalProxy`
- legacy `isNameUsed` and `isSymbolUsed` traversal through the active V5 factory

### Policy, market, and fees

- `RMTLaunchPolicyRegistry`
- `CloneBondingCurveMarketV6`
- `DirectLaunchFeeSplitter`
- Fair and Open policy construction
- immutable registry locks binding every V6 policy to the same reviewed market implementation and graduation adapter

### Graduation

- `V5GraduationHook`
- `V4GraduationAdapter`
- `IV6GraduationAdapter`
- pinned Uniswap V4 core/periphery assumptions

### Control and deployment

- `RMTLaunchGate`
- `RMTV6Governance`
- `ExpandableGovernance`
- `VersionedFactoryRegistry`
- `MainnetReleaseConfigV6`
- phased wallet console, fork-rehearsal-only Foundry script, generated artifacts, and source-verification process

## Immutable candidate configuration

- supply: 1,000,000,000 tokens
- curve fee: 1%
- creator/protocol split: 70% / 30%
- post-graduation V4 pool fee: 0.5%
- graduation target: 2 ETH net real reserve
- final-buy behavior: accepted gross is clamped to the exact net target; excess is immediately refunded or credited to the payer without blocking graduation
- virtual reserves: 0.3 ETH and 1,017,500,000 tokens
- Fair Start: one-block delay, ten blocks, 1% per buy, 3% per wallet, one buy per wallet per block
- V6 governance: newly deployed; RMTMain is the sole initial signer with threshold 1, immutable 24-hour delay, immutable seven-day execution window, signer cancellation, proposal expiry and public getter, expiring proof-of-control acceptance bound to the current epoch, exact add-or-replace action, affected signer, and threshold required from every prospective added/replacement signer, candidate-controlled revocation of unconsumed consent before execution, atomic signer/threshold add-remove-replace operations, no multi-signer 1-of-N configuration, and configuration-epoch invalidation of every older pending proposal/confirmation/unused acceptance; adding the first extra wallet is 2-of-2 quorum, not a backup key
- governance separation: the new governance controls the V6 gate, policy registry, factory payout authority, and splitters; the existing V5 governance remains only the authority of the existing version registry
- creator-payout authority: the new V6 governance shared by the gate and policy registry
- creator-payout destinations: immutable original creator or immutable protocol treasury only; governance-only execution, nonzero evidence hash, replay nonce, and treasury-only stale-nonce invalidation required
- payout timing boundary: recipient at collection time receives the creator share, including position fees accrued but not yet collected
- fee provenance: native accounting requires explicit deposits from the permanently bound market/adapter; token accounting accepts only the bound adapter; empty-calldata transfers and arbitrary/forced gifts remain uncounted
- factory activity boundary: every launch requires this V6 factory to be active in the version registry
- official-before-public boundary: every ordinary launch reverts until the exact official migration has been consumed, even if the gate is opened prematurely
- paused official exception: exact legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` with expected creator/name/ticker, exact `Robinhood Meme Terminal` / `RMT`, both legacy reservations present, immutable operator, Fair policy, active V6 factory, one use, explicit old-to-new event provenance, and no gate unpause
- V4 liquidity: one permanently locked adapter-owned full-range position; outside liquidity additions and all V4 donations rejected
- policy delay: 24 hours
- V6 launch-gate reopening delay: 24 hours after governance scheduling
- existing factory-registry activation delay: 48 hours

## Highest-priority questions

1. Can any caller mint, seize, redirect, strand, or double-account token inventory, curve reserves, fees, or graduation assets?
2. Can clone initialization, identity reservation, or the official one-time migration be front-run, replayed, bypassed, or consumed incorrectly?
3. Do buy/sell rounding, target crossing, repeated cycles, callbacks, or reentrancy create insolvency or extractable value?
4. Can Fair Start limits be bypassed through recipients, contracts, same-block ordering, multiple wallets, reorgs, or transaction composition?
5. Does graduation land on the exact net target, isolate pending refunds and forced assets, initialize and settle the correct V4 pool at a continuous price, and keep unavoidable seed dust outside collectible fees?
6. Is locked liquidity principal truly unreachable through every public, governance, hook, PoolManager, and callback path?
7. Can permissionless fee collection change liquidity, redirect either fee currency, over-account deposits, accept seller/refund principal or arbitrary gifts as fees, reenter the adapter/splitter, or pay any collector?
8. Can a policy substitute its market implementation or graduation adapter, or can policy economics, treasury, or existing-launch bindings be changed?
9. Can a creator or outsider initiate, accept, or execute a payout change? Can delayed governance select any destination other than the original creator or immutable RMT treasury? Can evidence-hash recording, nonce consumption, treasury invalidation, or execution ordering be front-run, hijacked, replayed, reentered, mistyped, or used to take previously paid/deferred rewards?
10. Does the release record prove every proposal ID in both governance contracts from exact receipts, and prove through the V6 public getter that every pending V6 proposal is current-epoch, fully approved, uncancelled, and unexpired?
11. Can guardian authority, prospective-signer acceptance/revocation, signer add/remove/replace, atomic threshold changes, epoch transitions, cancellation, expiry, generic target calls, permissionless execution, cancellation/execution ordering, or the separate legacy registry activation bypass the intended controls? Can acceptance be spoofed, replayed across epochs or deployments, reused after consumption, executed after candidate revocation or expiration, consumed for a different action/signer/threshold, or executed without the prospective wallet's exact current-epoch consent, and are the post-maturity transaction-ordering race and 1-of-1 to 2-of-2 liveness cost accurately disclosed?
12. Can the wallet console deploy or bind a different bytecode/configuration than the reviewed Foundry release?
13. Can an outside LP add a position, donate assets into fee growth, dilute or spoof the published 70/30 trading-fee flow, or make fee collection alter the permanently locked principal?
14. Can an inactive V6 factory launch, can ordinary creation succeed before official migration, or can the paused official-migration exception launch any other identity, wallet, policy, or second token, or reopen the public gate?

## Required reviewer output

- severity-rated findings with exact contract/function and reproduction
- independent tests or proof of concept for critical/high findings
- explicit statement on locked-principal and fee-routing claims
- economic and MEV assessment
- assumptions, exclusions, and unresolved risks
- remediation verification against the final commit
- post-deployment source/bytecode, constructor, binding, policy-hash, governance, and paused-state confirmation
- final publishable report

## Acceptance rules

- Unresolved critical/high findings block deployment or reopening.
- Critical/high fixes require independent fix review.
- Medium findings require a written disposition.
- Any contract change after sign-off requires scoped follow-up review.
- No report or RMT copy may claim guaranteed safety.
- V6 stays paused after activation until deployment verification and production health checks are complete.

## Evidence package

- complete Foundry unit, fuzz, invariant, and Robinhood mainnet-fork suite
- high-severity Slither gate
- generated wallet artifact reproducibility check
- V6 capability-driven web build and indexer schema/ingestion checks
- [V6 release checklist](V6_RELEASE_CHECKLIST.md)
- [V6 mainnet release sequence](V6_MAINNET_RELEASE.md)
- [Incident response](INCIDENT_RESPONSE.md)

## Engagement sequence

1. Freeze candidate commit and compiler/dependency versions.
2. Complete independent source and economic review.
3. Remediate and add reproductions/regression tests.
4. Reviewer signs off on the final commit and generated artifacts.
5. Deploy the foundation in paused state.
6. Reviewer verifies bytecode, bindings, policy hashes, governance, and delays.
7. Publish the report and deployed inventory.
8. Reopen only after the remaining release checklist is explicitly approved.
