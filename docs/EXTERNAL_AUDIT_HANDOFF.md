# External audit handoff

## Engagement objective

Independently assess the deployed RMT V4 contracts, their immutable economic parameters, and the one-time graduation path before RMT is promoted beyond mainnet beta.

This handoff is provider-neutral. Automated tests, Slither, fuzzing, fork tests, source verification, and RMT's internal review are evidence inputs—not substitutes for independent judgment.

Use [EXTERNAL_AUDIT_INQUIRY.md](EXTERNAL_AUDIT_INQUIRY.md) as the ready-to-send scope and quote request.

## Exact review target

- Repository: `LandoCrissian/robinhood-meme-terminal`
- Deployed release source: `ce7573b36c924c6933907e7f214d74a215b796f8`
- Chain: Robinhood Chain mainnet (`4663`)
- Factory: `0x88b86F10D874C2e3C8CfE63161ffa969f3273Cd4`
- Registry: `0xfff3f69f473780EA5eA7f5525526986Bb491E00e`
- Full address and transaction inventory: [MAINNET_CONTRACTS.md](MAINNET_CONTRACTS.md)
- Detailed threat model and deliverables: [SECURITY_REVIEW_SCOPE.md](SECURITY_REVIEW_SCOPE.md)

The reviewer must confirm that the source under review reproduces the deployed runtime bytecode and constructor configuration. Any current-main test or documentation improvements should be reviewed separately from the immutable deployed bytecode.

## Contracts in scope

### Per-launch implementations and clones

- `LowCostMemeLaunchFactoryV4`
- `CloneFixedSupplyMemeToken`
- `CloneBondingCurveMarketV2`
- `CloneLaunchRewardVault`
- `ClonePurposeRewardVault`
- `MinimalProxy`

### Graduation and settlement

- `V4GraduationHook`
- `V4GraduationAdapter`
- `IGraduationAdapter`
- pinned Uniswap V4 integration assumptions

### Protocol rewards and control

- `ProtocolRevenueRouter`
- `PurposeRewardsController`
- `ProtocolPurposeVault`
- `TwoOfThreeTimelock`
- `VersionedFactoryRegistry`

### Deployment and configuration

- `MainnetReleaseConfig`
- deployment scripts and generated artifacts
- constructor values, permanent bindings, signer set, delays, fee splits, Fair Start rules, virtual reserves, and 1 ETH graduation target

## Highest-priority questions

1. Can any caller mint, seize, redirect, or strand launch inventory, curve ETH, reward ETH, or graduation liquidity?
2. Can initialization, clone deployment, or identity reservation be front-run, replayed, or partially completed?
3. Do buy/sell rounding, repeated cycles, callbacks, or reentrancy create extractable value or insolvency?
4. Can Fair Start limits be bypassed through contracts, recipients, same-block ordering, multiple wallets, or reorgs?
5. Can a malicious token receiver, ETH receiver, hook callback, PoolManager interaction, or market state cause partial graduation or stuck assets?
6. Are Uniswap V4 pool initialization, tick selection, liquidity arithmetic, settlement, donation, hook permissions, and pool-opening order correct?
7. Can governance proposals, signer replacement, cancellation, replay, or version activation bypass the intended 2-of-3 and delay controls?
8. Does every documented immutable value match deployed state?
9. What MEV, sandwich, sybil, griefing, and denial-of-service risks remain even if the contracts are correct?
10. Does the live system need a factory replacement before broad launch?

## Required reviewer output

- severity-rated findings with affected contract/function and reproducible proof
- explicit deployed-bytecode/source match result
- independent tests or proof-of-concept code for every critical/high finding
- economic and MEV assessment, including non-contract mitigations
- list of assumptions, exclusions, and unresolved risks
- remediation review after fixes
- final report identifying the exact reviewed commit and deployed addresses

## Acceptance rules

- Any unresolved critical or high finding blocks broad public promotion.
- Every critical/high remediation requires independent fix review.
- A finding that requires a new factory version must include migration and compatibility analysis; existing launches cannot be rewritten.
- Medium findings require a written disposition and must not be silently accepted.
- The final report may say that no critical/high issues were found, but must never describe any smart-contract system as guaranteed safe.
- Contract changes after the review require a scoped follow-up review before activation.

## Evidence already available

- complete Foundry unit, fuzz, invariant, and fork suite
- high-severity Slither gate
- exact mainnet-fork deployment and graduation exercise
- disposable mainnet launch, buy, sell, fee accrual, and creator-claim evidence
- all-contract Blockscout source publication workflow
- public health checks and five-minute monitoring
- incident-response and launch-readiness records

## Suggested engagement structure

1. **Scoping call:** confirm bytecode, contracts, exclusions, and reviewer familiarity with Uniswap V4 hooks.
2. **Private senior review:** at least two independent Solidity reviewers, including one with concentrated-liquidity or V4 settlement experience.
3. **Adversarial review:** contest or additional independent researcher pass focused on economic edge cases and MEV.
4. **Remediation:** patch future-version code, extend tests, and document anything immutable in the deployed V4 factory.
5. **Fix review:** reviewer verifies every critical/high fix and the exact activation candidate.
6. **Publication:** publish the final report and reviewed commit before removing the unaudited-beta label.
