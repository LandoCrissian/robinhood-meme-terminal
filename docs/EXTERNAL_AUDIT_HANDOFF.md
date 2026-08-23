# RMT V6 external security review handoff

> Historical scope notice: this handoff describes the retired V6 launchpad. Launch 0 is dead and is not the current RMT token, a current Terminal market, or a release acceptance control.

## Engagement objective

Independently assess the historical V6 deployment record, review its remediations, and verify the exact deployed bytecode, source build, receipts, governance history, and immutable configuration.

Automated tests, Slither, fuzzing, fork rehearsals, and internal review are evidence inputs—not substitutes for independent judgment.

## Review target

- Repository: `LandoCrissian/robinhood-meme-terminal`
- Foundation PR: https://github.com/LandoCrissian/robinhood-meme-terminal/pull/112
- Deployed-source mapping: unresolved until the exact source revision, compiler inputs, and generated artifacts reproduce the live bytecode; freeze that proven mapping at engagement start
- Chain: Robinhood Chain mainnet (`4663`)
- Legacy V5 identity factory: `0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD`
- Official legacy RMT token and V6 migration provenance anchor: `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C`
- Canonical V4 PoolManager: `0x8366a39CC670B4001A1121B8F6A443A643e40951`
- V6 governance/treasury: `0x52c43239df8965eb27f26e115cc5ead11b35d5c3`
- V6 registry: `0x27c0269e16209eee149e2738d0819a2633f44246`
- V6 factory: `0x8e75c57079a01ce2094bc4187b78710887547651`
- Retired V6 launchpad launch 0 token (historical evidence only): `0xdBa33be56C89CC9fc014c4459028d7e5c7878671`
- Deployment record: [MAINNET_V6_DEPLOYMENT.md](MAINNET_V6_DEPLOYMENT.md)

The deployment is live but not independently audited. Exact Blockscout source publication is incomplete and must be verified from the canonical compiler settings and deployed bytecode rather than inferred from an explorer label.

## Contracts in scope

### Launch and identity

- `RMTLaunchFactoryV6`
- `OfficialRMTIdentityMigration`
- `CloneFixedSupplyMemeToken`
- `MinimalProxy`
- legacy `isNameUsed` and `isSymbolUsed` traversal through the retained V5 identity factory

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
- `VersionedFactoryRegistry`
- `MainnetReleaseConfigV6`
- phased wallet console, fork-rehearsal-only Foundry script, generated artifacts, and source-verification process

## Deployed configuration to verify

- supply: 1,000,000,000 tokens
- curve fee: 1%
- creator/protocol split: 70% / 30%
- post-graduation Uniswap v4 pool fee: 0.5%
- graduation target: 2 ETH net real reserve
- modeled graduation valuation: approximately 17.33 ETH curve FDV and 17.36 ETH seeded-pool FDV (about 16.4 bps apart) under the immutable reserve parameters; this is not a fixed USD market-cap promise
- final-buy behavior: accepted gross is clamped to the exact net target; excess is immediately refunded or credited to the payer without blocking graduation
- virtual reserves: 0.3 ETH and 1,017,500,000 tokens
- Fair Start: one-block delay, ten blocks, 1% per buy, 3% per wallet, one buy per wallet per block
- V6 governance/treasury: deployed at `0x52c43239df8965eb27f26e115cc5ead11b35d5c3`; RMTMain is the sole initial signer with threshold 1, immutable 24-hour delay, immutable seven-day execution window, signer cancellation, proposal expiry and public getter, expiring proof-of-control acceptance bound to the current epoch, exact add-or-replace action, affected signer, and threshold required from every prospective added/replacement signer, candidate-controlled revocation of unconsumed consent before execution, atomic signer/threshold add-remove-replace operations, no multi-signer 1-of-N configuration, and configuration-epoch invalidation of every older pending proposal/confirmation/unused acceptance; adding the first extra wallet is 2-of-2 quorum, not a backup key. The same contract holds the protocol's 30% fee share. Loss of the sole signer freezes protocol/treasury control and compromise can authorize calls after the delay; in 2-of-2 mode, loss of either signer freezes governance.
- V6 registry: deployed at `0x27c0269e16209eee149e2738d0819a2633f44246`, governed only by V6 governance, initialized to the legacy V5 factory/version, and now reporting the active V6 factory; legacy governance and the old registry are not V6 dependencies
- creator-payout authority: the new V6 governance shared by the gate and policy registry
- creator-payout destinations: immutable original creator or immutable V6 governance treasury only; creators cannot authorize, propose, choose, or directly change the recipient; the RMT signer proposes an evidence-linked, replay-protected call and any account may relay the exact approved call after the delay; stale-nonce invalidation itself requires governance approval
- payout timing boundary: recipient at collection time receives the creator share, including position fees accrued but not yet collected
- fee provenance: native accounting requires explicit deposits from the permanently bound market/adapter; token accounting accepts only the bound adapter; empty-calldata transfers and arbitrary/forced gifts remain uncounted
- factory activity boundary: every launch requires this V6 factory to be active in the version registry
- official-before-public boundary: every ordinary launch reverts until the exact official migration has been consumed, even if the gate is opened prematurely
- paused official exception: exact legacy token `0xaB374D24aFBD943a134AdB381D9646e71C6f6C0C` with expected creator/name/ticker, exact `Robinhood Meme Terminal` / `RMT`, both legacy reservations present, immutable operator, Fair policy, active V6 factory, one use, explicit old-to-new event provenance, and no gate unpause. It creates a new token address and new one-billion-token supply and does not copy, swap, credit, or migrate old-holder balances.
- V4 liquidity: one permanently locked adapter-owned full-range position; outside liquidity additions and all V4 donations rejected
- policy delay: 24 hours
- V6 launch-gate reopening delay: 24 hours after governance scheduling
- fresh V6 factory-registry activation delay: 48 hours

## Highest-priority questions

1. Can any caller mint, seize, redirect, strand, or double-account token inventory, curve reserves, fees, or graduation assets?
2. Can clone initialization, identity reservation, or the official one-time migration be front-run, replayed, bypassed, or consumed incorrectly?
3. Do buy/sell rounding, target crossing, repeated cycles, callbacks, or reentrancy create insolvency or extractable value?
4. Can Fair Start limits be bypassed through recipients, contracts, same-block ordering, multiple wallets, reorgs, or transaction composition?
5. Does graduation land on the exact net target, isolate pending refunds and forced assets, initialize and settle the correct Uniswap v4 pool at a continuous price, and keep unavoidable seed dust outside collectible fees?
6. Is locked liquidity principal truly unreachable through every public, governance, hook, PoolManager, and callback path?
7. Can permissionless fee collection change liquidity, redirect either fee currency, over-account deposits, accept seller/refund principal or arbitrary gifts as fees, reenter the adapter/splitter, or pay any collector?
8. Can a policy substitute its market implementation or graduation adapter, or can policy economics, treasury, or existing-launch bindings be changed?
9. Can a creator authorize, propose, choose, or directly change a payout recipient? Can the RMT signer select any destination other than the original creator or immutable V6 governance treasury? Can a permissionless relayer alter an approved call or receive funds? Can evidence-hash recording, nonce consumption, governance-approved treasury invalidation, or execution ordering be front-run, hijacked, replayed, reentered, mistyped, or used to take previously paid/deferred rewards?
10. Does the release record prove every proposal ID—including fresh-registry activation—in the single V6 governance contract from exact receipts, and prove through its public getter that every pending proposal is current-epoch, fully approved, uncancelled, and unexpired?
11. Can guardian authority, prospective-signer acceptance/revocation, signer add/remove/replace, atomic threshold changes, epoch transitions, cancellation, expiry, generic target/value calls from the fee-holding governance treasury, permissionless execution, cancellation/execution ordering, or fresh-registry activation bypass the intended controls? Can acceptance be spoofed, replayed across epochs or deployments, reused after consumption, executed after candidate revocation or expiration, consumed for a different action/signer/threshold, or executed without the prospective wallet's exact current-epoch consent, and are sole-key custody risk, the post-maturity transaction-ordering race, and 1-of-1 to 2-of-2 liveness cost accurately disclosed?
12. Can the wallet console deploy or bind a different bytecode/configuration than the reviewed Foundry release?
13. Can an outside LP add a position, donate assets into fee growth, dilute or spoof the published 70/30 trading-fee flow, or make fee collection alter the permanently locked principal?
14. Can an inactive V6 factory launch, can ordinary creation succeed before official migration, or can the paused official-migration exception launch any other identity, wallet, policy, or second token, copy/credit old-holder balances, or reopen the public gate?

## Required reviewer output

- severity-rated findings with exact contract/function and reproduction
- independent tests or proof of concept for critical/high findings
- explicit statement on locked-principal and fee-routing claims
- economic and MEV assessment
- assumptions, exclusions, and unresolved risks
- remediation verification against the final commit
- source/bytecode, constructor, binding, policy-hash, governance, current launch-gate/public-opening state, and historical activation/opening receipt confirmation
- final publishable report

## Acceptance rules

- An unresolved critical/high finding requires immediate incident assessment, pausing affected functionality when technically available and warranted, and independently reviewed remediation before that functionality reopens.
- Critical/high fixes require independent fix review.
- Medium findings require a written disposition.
- Any contract change after sign-off requires scoped follow-up review.
- No report or RMT copy may claim guaranteed safety.
- Public creation is currently open. The reviewer must treat the live system as an active deployment and document any functionality that should be paused during review or remediation.

## Evidence package

- complete Foundry unit, fuzz, invariant, and Robinhood mainnet-fork suite
- high-severity Slither gate
- generated wallet artifact reproducibility check
- V6 capability-driven web build and indexer schema/ingestion checks
- [V6 release checklist](V6_RELEASE_CHECKLIST.md)
- [V6 mainnet release sequence](V6_MAINNET_RELEASE.md)
- [Incident response](INCIDENT_RESPONSE.md)

## Engagement sequence

1. Reconstruct the exact source revision, compiler inputs, and generated artifacts that reproduce the deployed bytecode, then freeze that proven mapping; treat the mapping as unresolved until it reproduces exactly.
2. Reconstruct the complete deployed inventory, receipts, constructor inputs, bindings, governance history, and exact bytecode build.
3. Complete independent source, bytecode, and economic review against the live deployment.
4. Triage findings and pause affected functionality when severity and available controls warrant it.
5. Remediate, add reproductions/regression tests, and obtain independent fix review.
6. Reviewer verifies the final source, deployed bytecode, bindings, policy hashes, governance, and delays.
7. Publish the report, reviewed commits, deployed inventory, assumptions, and unresolved risks.
8. Reopen any paused functionality only after the corresponding critical/high remediation is independently accepted.
