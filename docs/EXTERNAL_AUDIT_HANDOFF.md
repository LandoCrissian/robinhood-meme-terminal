# RMT V6 external security review handoff

## Engagement objective

Independently assess the V6 release candidate before deployment, review remediations, and verify the exact deployed bytecode and immutable configuration before public V6 launches reopen.

Automated tests, Slither, fuzzing, fork rehearsals, and internal review are evidence inputs—not substitutes for independent judgment.

## Review target

- Repository: `LandoCrissian/robinhood-meme-terminal`
- Candidate PR: https://github.com/LandoCrissian/robinhood-meme-terminal/pull/112
- Frozen candidate commit: record at engagement start
- Chain: Robinhood Chain mainnet (`4663`)
- Existing governance: `0x13C0A930516FB6bF0d467B38605d9D2a9c4C6953`
- Existing V5 factory: `0x25A92D8C79c38D07B0d3eFd0ebe929D30e401cdD`
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

### Graduation

- `V5GraduationHook`
- `V4GraduationAdapter`
- `IV6GraduationAdapter`
- pinned Uniswap V4 core/periphery assumptions

### Control and deployment

- `RMTLaunchGate`
- `ExpandableGovernance`
- `VersionedFactoryRegistry`
- `MainnetReleaseConfigV6`
- phased wallet console, Foundry deployment script, generated artifacts, and source-verification process

## Immutable candidate configuration

- supply: 1,000,000,000 tokens
- curve fee: 1%
- creator/protocol split: 70% / 30%
- post-graduation V4 pool fee: 0.5%
- graduation target: 2 ETH net real reserve
- virtual reserves: 0.3 ETH and 1,017,500,000 tokens
- Fair Start: one-block delay, ten blocks, 1% per buy, 3% per wallet, one buy per wallet per block
- policy delay: 24 hours
- V6 launch-gate reopening delay: 24 hours after governance scheduling
- existing factory-registry activation delay: 48 hours

## Highest-priority questions

1. Can any caller mint, seize, redirect, strand, or double-account token inventory, curve reserves, fees, or graduation assets?
2. Can clone initialization, identity reservation, or the official one-time migration be front-run, replayed, bypassed, or consumed incorrectly?
3. Do buy/sell rounding, target crossing, repeated cycles, callbacks, or reentrancy create insolvency or extractable value?
4. Can Fair Start limits be bypassed through recipients, contracts, same-block ordering, multiple wallets, reorgs, or transaction composition?
5. Does graduation initialize and settle the correct V4 pool at a continuous price without retained adapter/market assets?
6. Is locked liquidity principal truly unreachable through every public, governance, hook, PoolManager, and callback path?
7. Can permissionless fee collection change liquidity, redirect either fee currency, over-account deposits, or reenter the adapter/splitter?
8. Can policy economics, market implementation, adapter, treasury, or availability be changed for an existing launch?
9. Can guardian, sole signer, future signer addition, proposal ordering, cancellation, or registry activation bypass the intended delays?
10. Can the wallet console deploy or bind a different bytecode/configuration than the reviewed Foundry release?

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
