# Owner-test security review

The starting point is [draft #590](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/590) at `b7ef7d852b02e54a3cb7fb715cd89f78db0de187`. Its `packages/contracts/src` tree remains `7541e6ee5129630111fd0cee61055040add9a924`, matching [draft #589](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/589). The full Slither workflow remains blob `c1f29e7731ddfe671d4ad408f811fd9bc813bda5`. The 2 ETH isolated fixture substitutes the review constants during compilation. Its deployment provenance belongs to that generated build and its loopback chain.

## Disposition

Slither 0.11.5 ran 101 detectors across 244 contracts on #589. The job exited 255 and reported 28 high-severity `reentrancy-balance` rows. There are 22 rows in the active curve, graduation and LP collection path. The other six concern a separately compiled, local-only replacement-token escrow. The table records the preliminary code and test assessment for every row group. Each warning remains in the original report. The review confirmed no contract defect requiring a source change for these groups. Findings still require independent disposition before any live testing. [Exact #589 Slither result](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43490514015/job/132110152632)

| Active entry or settlement call | Rows | Preliminary classification and evidence |
| --- | ---: | --- |
| `RMTV4CurveGraduationV1._fundPosition` line 356, token pull | 2 | Conservative balance-check warning for the fixed factory token. The curve and engine are guarded. The engine and PoolManager token snapshots are used to enforce exact deltas. The fixed-token callback and short-transfer fixture exercises rollback. |
| Same function line 359, ERC-20 approval | 2 | Conservative under the fixed token runtime. The approval is bounded to the funding amount. The callback fixture checks the guarded path and residual token allowance. |
| Same function line 360, Permit2 grant | 2 | Conservative with the pinned Permit2 runtime. The allowance is limited to the exact PositionManager, funding amount and deadline. The local Permit2 fixture checks callback rejection and rollback on residual allowance. |
| Same function line 374, PositionManager mint and settlement | 2 | Conservative with pinned dependencies and the engine lock. The transaction must reconcile exact manager and engine balances, verified NFT owner and position, and cleared allowances. Local tests check callback rejection, corrupt settlement and retry. The pinned fork uses the official dependency contracts. |
| Same function line 375, Permit2 revoke | 2 | Conservative with the same runtime and lock assumptions. The Permit2 fixture checks revoke callbacks and a retained allowance. |
| Same function line 376, token approval clear | 2 | Conservative with the fixed token and engine lock. The token fixture checks approval clearing and rollback on residual allowance. |
| `RMTLaunchBondingCurveV1._graduate` line 323, token approval | 1 | Conservative with the fixed token and curve lock. Trades close and tracked backing clears before the engine interaction. The token callback fixture checks the approval boundary. |
| Same function lines 324–328, graduation engine | 1 | Conservative with the pinned engine and curve lock. Exact native/token consumption and the engine refund must reconcile before the pool and NFT are committed. Failed funding or a failed atomic buyer payout rolls back the transition. |
| Same function line 329, token approval clear | 1 | Conservative with the fixed token and curve lock. The engine call returns before the remaining approval is zeroed and exact balance deltas are checked. |
| `RMTV4CurveGraduationV1.collectLpFees` line 317, zero-delta position update | 1 | Conservative with the pinned manager, fixed ledger and engine lock. Only a zero-liquidity increase and a take to the ledger are encoded. Exact fee growth, balance deltas, NFT owner, liquidity, ticks and approvals are rechecked. The local harvest and official fork tests check unchanged principal. |
| `RMTLaunchBondingCurveV1.migrateAssets` line 192, inventory transfer | 2 | Conservative with the fixed ERC-20 and guarded predecessor, factory and registry. Both token deltas are intentionally checked. Existing local callback and short-transfer evidence checks rollback. |
| Same function line 193, successor acceptance | 2 | Conservative for the reviewed immutable V2/V3 implementations. The approved runtime and economic commitment are checked, and successor acceptance requires the exact predecessor and backing. Interruption and identity mismatch tests check rollback. Future successor callback behavior remains an admission and independent review requirement. |
| Same function line 194, ledger writer handoff | 2 | Conservative with the current fixed ledger implementation. The writer advances inside the transaction, fee balances stay in the same ledger, and any incorrect delta reverts the transaction. Existing local tests cover handoff callbacks and rollback. |
| `RMTLaunchHolderMigrationV1.redeem` line 125, original-token pull | 4 | Outside the owner-test launch graph. The independent local-only replacement escrow reserves capacity, guards redemption and checks exact original and replacement token balances. Its own callback and malformed token tests apply. Admission of other token runtimes remains unresolved for that separate design. |
| Same function line 131, replacement-token payout | 2 | Outside the owner-test launch graph. Payout uses the fixed replacement token and exact balance checks. The standalone escrow remains part of the unchanged full Slither gate. |

The same-token migration used in owner testing never calls the replacement-token escrow. The review compiler may include the escrow template in its manifest. The curve bootstrap creates the guard, graduation engine and factory, and the escrow has no call path from those contracts. [Bootstrap](../packages/contracts/src/RMTLaunchCurveDeploymentV1.sol) · [Call-by-call test evidence](RMT_CURVE_TASK020_AUDIT_HANDOFF.md#security-disposition)

### Migration ordering and admission

| Finding | Preliminary disposition |
| --- | --- |
| Factory `prepareMigration` lines 185–207, candidate mapping written after template call | Conservative for the pinned templates. Preparation is permissionless, moves no assets and has a shared factory lock. Before publication, the candidate must be inactive and match the source, version, token, factory, registry and economic commitment. The candidate mapping is intentionally still unset during the external call. Wrong template, digest and version cases are covered. |
| Factory `executeMigration` lines 209–230, canonical pointer written after asset handoff | Conservative for the pinned contracts. Only the registry can execute. The source closes and moves tracked reserves and inventory to the exact reviewed successor under locks. The factory pointer advances after settlement succeeds. The migration tests observe the old pointer within the callback and require both factory and registry mutation to remain guarded. |

The same report also emits registry ordering warnings for `RMTLaunchProjectRegistryV1.executeMigration`. Registry project fields intentionally advance after the factory call returns and the predecessor and successor bindings are verified. A same-transaction reader can observe transient state. External consumers should use canonical post-transaction evidence. Future template admission must review the actual deployer and successor bytecode, all callback behavior and operator independence. A runtime hash and matching getters establish identity and declared parameters. They cannot prove correct behavior for code that reviewers approve in the future. [Migration authority](RMT_CURVE_TASK021_AUDIT_HANDOFF.md#migration-authority)

The V1 direct-launch helper `RMTV4LaunchFactoryV1._fundPosition` at lines 240–266 failed IR generation in the full job. Earlier scoped analysis identified the V2 direct-launch funding gap at lines 257–283 on the checked Permit2 deadline cast. These are historical coverage gaps outside the bonding-curve owner-test graph. Keep the old evidence and the full detector scope. [Historical coverage boundary](RMT_LAUNCH_PRODUCTION_DATA_READINESS.md#exact-contract-scope-for-independent-review)

## Stateful conservation evidence

`RMTLaunchCurveAccountingInvariantTest` uses a local factory, the real directory and registry, two traders and four distinct fee recipients. It interleaves purchases, partial sales, trade-fee claims, creation-fee claims and governed migrations through V3. It checks fixed supply, holder and inventory conservation, the rounded backing equation, cumulative 90/5/5 fee accounting, remaining liabilities, separate creation credit, predecessor settlement and registry/ledger continuity. The handler uses the source 1 ETH regression profile and a constructor binding stub for graduation. Its state machine ends before graduation. Separate graduation, LP custody and 2 ETH loopback evidence cover that boundary.

Foundry 1.7.1 with Solc 0.8.26 passed 63 tests across the eight suites below, with zero failures and zero skips. The invariant passed all 64 runs at depth 32. It exercised 2,048 handler calls with zero reverts and zero discards. The combined run included 499 buy-handler calls, 521 sell-handler calls, 524 claim-handler calls and 504 migration-handler calls. Calls may return early when no trade, claim or further adjacent version is available. The dedicated migration suite verifies that both hops execute. The curve suite also passed 512 fuzz cases across the supply presets.

```sh
cd packages/contracts
forge test --match-contract '^RMTLaunchCurveAccountingInvariantTest$' -vv
forge test --match-contract '^(RMTLaunchBondingCurveV1Test|RMTLaunchCurveCreationFeeV1Test|RMTLaunchCurveDirectoryV1Test|RMTLaunchProjectRegistryV1Test|RMTLaunchMigrationReadinessTest|RMTLaunchHolderMigrationV1Test|RMTV4CurveGraduationV1Test)$' -vv
```

The historical official Base Sepolia V1, V2 and Growth opt-ins and the separate legacy Terminal V4 setup opt-in remain available on their existing controls. They are outside these eight local suites. [Opt-in names and previous evidence](RMT_LAUNCH_RELEASE_CANDIDATE.md#independent-review-coverage)

The result supports isolated testing with disposable assets and the reviewed runtime bindings. The unchanged Slither failure, independent deployment review, exact production inputs, and operational release gates remain open. [Operations and owner decisions](RMT_CURVE_TASK022_OPERATIONS.md#owner-approval-manifest)
