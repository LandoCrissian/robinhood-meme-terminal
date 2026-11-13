# Curve security remediation

## Exact baseline and reproduction

The base is draft [#591](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/591) at `f2cf29ac69554cdb68f8654c0ba5ae56ec542269`. The existing [full-tree Slither workflow](../.github/workflows/security-analysis.yml) remains unchanged. It compiles the full Foundry tree and applies the existing reporting filter. Slither 0.11.5 reported 28 high `reentrancy-balance` rows at the baseline. The original full output remains in the [baseline run](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43505327472/attempts/1).

Reproduce on an isolated checkout with Foundry 1.7.1, checksum-verified Solidity 0.8.26, the existing pinned v4 dependencies and Slither 0.11.5. Use a checkout location that does not itself match the workflow's source-path filter. Slither applies the filter to absolute paths as well as relative paths.

```sh
cd packages/contracts
bash scripts/install-v4-deps.sh
forge build
slither . --fail-high --filter-paths '(lib/|test/|script/|broadcast/|src/BondingCurveMarket.sol|src/LaunchRewardVault.sol|src/MemeLaunchFactory.sol|src/LowCostMemeLaunchFactory.sol|src/LowCostMemeLaunchFactoryV2.sol|src/LowCostMemeLaunchFactoryV3.sol|src/clone/CloneBondingCurveMarket.sol)'
```

## Settlement and authorization changes

- **Position funding.** Both engine allowances start at zero. Grant and verify the exact finite ERC-20 allowance and Permit2 amount and deadline before calling the pinned PositionManager. Both allowances must be consumed by the actual funding transfer. This rejects residual approval even if a malformed token or Permit2 reports a successful transfer. It removes two calls after minting while preserving engine and manager balance deltas, position identity, range and permanent custody. Fault injection covers a false grant, incorrect Permit2 expiry and residual allowance under either dependency.
- **Curve graduation.** The curve accepts one positive native dust refund from its bound graduation engine only while that engine call is open. The amount must agree with the return value and the independent exact balance delta. A forced balance credit cannot substitute for the authenticated refund, and a duplicate callback reverts. Verify the precise ERC-20 grant and complete clearance, including the rounding remainder. Failure restores backing and graduation eligibility.
- **Asset-bearing migration.** Close the predecessor and transfer inventory while the successor remains inactive. Move accrual authority in the original ledger before the successor accepts backing and activates. Both the successor and the predecessor check the ledger writer, and the predecessor verifies the successor's exact sold and backing fields as well as both ETH and token deltas. A nested trade during a ledger callback is rejected before it can change either curve. The failed handoff reverts the ledger change and all transfers.
- **Factory and registry ordering.** Revalidate source eligibility and the exact published template after the external constructor path. Consume the scheduled proposal and nonce before settlement while keeping both published pointers on the predecessor until settlement passes. Recheck directory suspension before publishing the registry transition. A failed or callback-interrupted transition restores the proposal and nonce. The ordering findings still have a legitimate interaction followed by publication of verified state.
- **LP fees.** Collection retains the original position, zero-liquidity change, fixed ledger recipient, earned-fee math and exact asset deltas. The remaining balance-observation warning covers precisely that cross-contract check. The exit path still has no principal withdrawal.

## Scope and remaining analysis limits

The separate replacement-token escrow is a chain-31337 prototype. The bootstrap, factory, curve, migration templates, registry and graduation engine have no import or deployment edge to it. It was an unused artifact in the explicit review compiler input list. The 4663 review harness now compiles the launch graph without the escrow. Its source, dedicated Foundry tests and all six findings remain in the full-tree gate. Any future replacement-token release requires its own reviewed token and redemption scope. Same-token migrations use the factory and reviewed successors.

The remaining reports span before/after balances that intentionally cross a transfer, mint, harvest or migration boundary. Slither checks whether a conditional expression depends on a prior `balanceOf(address)` read across a call it considers capable of reentry. The exact token transfer proofs and the checked runtime identities are required even under the existing locks. Splitting the checks into unanalyzed helpers or hiding the balance reads would remove useful detector visibility. [Slither 0.11.5 balance detector](https://github.com/crytic/slither/blob/0.11.5/slither/detectors/reentrancy/reentrancy_balance.py)

The historical direct-launch V1 funding IR failure and scoped V2 funding deadline-cast gap remain separate review limitations. Neither path is in the curve deployment graph. [Historical coverage](RMT_LAUNCH_PRODUCTION_DATA_READINESS.md#exact-contract-scope-for-independent-review)

The build remains isolated. Creation fee, the 60/40 supply split, the 1 ETH regression and 2 ETH review profiles, the provisional 1% fee and 90/5/5 allocation, fixed supply, same-token migration commitments and permanent original-position custody retain their terms. Compiler output and runtime hashes change. This candidate requires fresh independent review before any release.

### Exact #591 balance-check rows

These identifiers follow the order of the unchanged Slither 0.11.5 report at `f2cf29ac69554cdb68f8654c0ba5ae56ec542269`. Line numbers and expressions refer to that commit. Each row pairs one external call with one prior balance read. The same source assertion can appear more than once. [Baseline full-tree Slither job](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43505327472/job/132161366865).

**Active launch engine (22 high rows)**

| Row | Source and function | External call | Prior balance | Assertion |
| ---: | --- | --- | --- | --- |
| 1 | Graduation engine `_fundPosition` | Pull curve tokens (356) | Engine token (353) | F1, F2 |
| 2 | Graduation engine `_fundPosition` | Pull curve tokens (356) | PoolManager token (354) | F2 |
| 3 | Graduation engine `_fundPosition` | Grant ERC-20 approval (359) | Engine token (353) | F2 |
| 4 | Graduation engine `_fundPosition` | Grant ERC-20 approval (359) | PoolManager token (354) | F2 |
| 5 | Graduation engine `_fundPosition` | Grant Permit2 approval (360) | PoolManager token (354) | F2 |
| 6 | Graduation engine `_fundPosition` | Grant Permit2 approval (360) | Engine token (353) | F2 |
| 7 | Graduation engine `_fundPosition` | Mint and settle position (374) | Engine token (353) | F2 |
| 8 | Graduation engine `_fundPosition` | Mint and settle position (374) | PoolManager token (354) | F2 |
| 9 | Graduation engine `_fundPosition` | Revoke Permit2 approval (375) | PoolManager token (354) | F2 |
| 10 | Graduation engine `_fundPosition` | Revoke Permit2 approval (375) | Engine token (353) | F2 |
| 11 | Graduation engine `_fundPosition` | Clear ERC-20 approval (376) | Engine token (353) | F2 |
| 12 | Graduation engine `_fundPosition` | Clear ERC-20 approval (376) | PoolManager token (354) | F2 |
| 13 | Curve `_graduate` | Grant graduation approval (323) | Curve token (317) | G |
| 14 | Curve `_graduate` | Graduate with backing (324–328) | Curve token (317) | G |
| 15 | Curve `_graduate` | Clear graduation approval (329) | Curve token (317) | G |
| 16 | Graduation engine `collectLpFees` | Poke position and take pair (317) | Ledger token (311) | H |
| 17 | Curve `migrateAssets` | Transfer unsold inventory (192) | Successor token (184) | M |
| 18 | Curve `migrateAssets` | Transfer unsold inventory (192) | Predecessor token (183) | M |
| 19 | Curve `migrateAssets` | Accept migration with backing (193) | Successor token (184) | M |
| 20 | Curve `migrateAssets` | Accept migration with backing (193) | Predecessor token (183) | M |
| 21 | Curve `migrateAssets` | Switch fee accrual writer (194) | Successor token (184) | M |
| 22 | Curve `migrateAssets` | Switch fee accrual writer (194) | Predecessor token (183) | M |

The **graduation engine** is [`src/RMTV4CurveGraduationV1.sol`](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/f2cf29ac69554cdb68f8654c0ba5ae56ec542269/packages/contracts/src/RMTV4CurveGraduationV1.sol#L294). In `_fundPosition` (345–384), reads are `engineBefore = asset.balanceOf(address(this))` and `poolBefore = asset.balanceOf(address(poolManager))`. The calls in report order are `asset.safeTransferFrom(msg.sender, address(this), funding.tokenUsed)`, `asset.forceApprove(address(permit2), funding.tokenUsed)`, `permit2.approve(token, address(positionManager), funding.tokenUsed, uint48(deadline))`, `positionManager.modifyLiquidities{value: funding.nativeUsed}(abi.encode(actions, params), deadline)`, `permit2.approve(token, address(positionManager), 0, 0)`, and `asset.forceApprove(address(permit2), 0)`. The guard protects the exact engine and PoolManager deltas across the fixed ERC-20, pinned Permit2 and pinned PositionManager call sequence.

- **F1** (357) requires `asset.balanceOf(address(this)) == engineBefore + funding.tokenUsed`.
- **F2** (378–380) requires `asset.balanceOf(address(this)) == engineBefore`, `asset.balanceOf(address(poolManager)) == poolBefore + funding.tokenUsed` and `address(poolManager).balance == nativeBefore + funding.nativeUsed`. Separate assertions check cleared allowances and exact custody.
- **H** (324–326) requires original position liquidity, both measured fee-growth values, `address(ledger).balance == ledgerNative + fees.nativeAmount` and `IERC20(token).balanceOf(address(ledger)) == ledgerToken + fees.tokenAmount`. The prior read is `ledgerToken = IERC20(token).balanceOf(address(ledger))`. The only flagged call is `positionManager.modifyLiquidities(abi.encode(actions, params), deadline)`, using zero liquidity delta, zero input maxima and the fixed ledger recipient. Position identity and allowance checks are separate.

The **curve** is [`src/RMTLaunchBondingCurveV1.sol`](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/f2cf29ac69554cdb68f8654c0ba5ae56ec542269/packages/contracts/src/RMTLaunchBondingCurveV1.sol#L163). In `_graduate` (310–341), the read is `tokenBefore = token.balanceOf(address(this))`. The calls are `token.forceApprove(address(graduationEngine), inventory)`, `graduationEngine.graduate{value: backing}(address(token), backing, inventory, virtualToken - sold, VIRTUAL_ETH + backing, deadline)` and `token.forceApprove(address(graduationEngine), 0)`. The guard spans the fixed ERC-20 and linked graduation engine after closure and reserve clearing.

- **G** (332–334) requires nonzero pool ID and position ID, nonzero and bounded `nativeUsed` and `tokenUsed`, `address(this).balance == nativeBefore - nativeUsed` and `token.balanceOf(address(this)) == tokenBefore - tokenUsed`.
- **M** (196–199) requires `address(this).balance == sourceNative - backing`, `nextCurve.balance == destinationNative + backing`, `token.balanceOf(address(this)) == sourceTokens - inventory`, `token.balanceOf(nextCurve) == destinationTokens + inventory` and `revenueLedger.activeCurve() == nextCurve`. `migrateAssets` (163–201) records `sourceTokens = token.balanceOf(address(this))` and `destinationTokens = token.balanceOf(nextCurve)` before `token.safeTransfer(nextCurve, inventory)`, `next.acceptMigration{value: backing}(soldAmount, backing, inventory)` and `revenueLedger.moveAccrual(nextCurve)`. The exact deltas span the fixed token, runtime-reviewed successor and unchanged fee ledger. Factory and registry publish the successor only after settlement.

**Standalone replacement-token escrow (six high rows)**

| Row | Source and function | External call | Prior balance | Assertion |
| ---: | --- | --- | --- | --- |
| 23 | Holder escrow `redeem` | Pull original tokens (125) | Original escrow token (119) | E1 |
| 24 | Holder escrow `redeem` | Pull original tokens (125) | Original holder token (118) | E1 |
| 25 | Holder escrow `redeem` | Pull original tokens (125) | Replacement holder token (120) | E2 |
| 26 | Holder escrow `redeem` | Pull original tokens (125) | Replacement escrow token (121) | E2 |
| 27 | Holder escrow `redeem` | Send replacement tokens (131) | Replacement escrow token (121) | E2 |
| 28 | Holder escrow `redeem` | Send replacement tokens (131) | Replacement holder token (120) | E2 |

The **holder escrow** is [`src/RMTLaunchHolderMigrationV1.sol`](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/f2cf29ac69554cdb68f8654c0ba5ae56ec542269/packages/contracts/src/RMTLaunchHolderMigrationV1.sol#L108). `redeem` (108–137) calls `originalToken.safeTransferFrom(msg.sender, address(this), amount)` and `replacementToken.transfer(msg.sender, amount)`. Prior reads are the original and replacement token's `balanceOf(msg.sender)` and `balanceOf(address(this))`, assigned respectively to `originalHolderBefore`, `originalEscrowBefore`, `replacementHolderBefore` and `replacementEscrowBefore`. The original-token trust boundary and one-for-one payout are separate from the same-token engine migration.

- **E1** (127–129) requires `originalToken.balanceOf(msg.sender) == originalHolderBefore - amount`, `originalToken.balanceOf(address(this)) == originalEscrowBefore + amount`, zero residual allowance and unchanged original supply.
- **E2** (133–134) requires `replacementToken.balanceOf(msg.sender) == replacementHolderBefore + amount` and `replacementToken.balanceOf(address(this)) == replacementEscrowBefore - amount`.
