# Frozen 4663 release security triage

Task 047 starts from `e1c833547aef7235247cf5b76eb9e1e38fd12e77`. The release gate still applies to frozen candidate `d4d81d1153a11728d98e694c1f3976ceb3408915` and exact 4663 compiler input SHA-256 `90122536b22c847aebc0182d75290b9ba281399481d90daffc8b0f66ed92f65b`. The manifest SHA-256 is `9273ba1c41b3891153e4f3810ddaacff62cd152fc4072b9636976c0db3d2e689`. [Release manifest](../rmt-task041-closeout/release-manifest.json) · [Compiler profile and source pins](../rmt-task043/4663-rotation-profile.json) · [Full Slither archive](../rmt-task043/slither-4663-full.json.gz)

**FAIL_HIGH · BLOCKED_NO_BROADCAST.** Fresh Slither 0.11.5 and Crytic Compile 0.3.11 produced 233 findings across 66 inputs and 101 detectors. The run exited 1 with 22 highs. The normalized IDs, detector codes, impact, confidence, descriptions and source locations of all 233 rows matched the archive. Raw JSON formatting, report order and the scratch path can affect file bytes. The fresh report SHA-256 was `1b8870243288da53bdb18afd948f81bb2b381847a67990f33948cd0aa997baf8`. The pinned uncompressed archive SHA-256 remains `fc88c2a7844772e0f30ceeed299e686474286c32140982300067bd0718243c3b`.

This internal review establishes zero confirmed defects in the 29 rows below. The 18 engine highs remain open for dependency and callback composition. The four dependency highs and six directory mediums are internally assessed detector false positives at the exact pins. The registry medium remains a concrete in-flight-state observation with unresolved exploitability. All 29 original findings remain recorded. Neither this inspection nor passing tests provides independent disposition. The full report retains the other 53 medium, 38 low, 111 informational and two optimization findings. [Earlier engine inspection](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK039_FINDINGS.md) · [Bounded adversarial review](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK040_REVIEW.md) · [Governance disposition and four focused test fixtures](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK041_GOVERNANCE_FINDINGS.md)

## First-party high findings

All 18 rows use `reentrancy-balance`, High impact and Medium confidence. Locations refer to the exact compiler input. The historical source links preserve the same line numbers for these functions. The 4663 build transformations recorded in the profile affect chain gates and economics literals.

### V4 position funding

`RMTV4CurveGraduationV1._fundPosition` at lines 345–392 reads the engine and shared manager balances, funds the exact native/token PoolKey and verifies the resulting deposit and NFT. F1 at line 358 checks the engine received the exact amount. F2 at lines 387–389 checks the engine's original balance and exact manager credits. The fixed-supply token type, bound curve, guard, scoped allowances and position custody limit the reachable call graph. A bad balance delta reverts the transaction, including pool initialization. Unsolicited balance movement during a callback can make an exact delta fail, so liveness and unauthorized movement need separate analysis. [Exact funding source](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/src/RMTV4CurveGraduationV1.sol#L345) · [Pinned funding tests](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/test/RMTV4CurveGraduationV1.t.sol#L375)

| Exact report ID | External call and snapshot | Existing evidence and next narrow regression |
| --- | --- | --- |
| `6e56005d266c4a8c0585c6256c43259ac2a3067695b32500be2c856d986bc5db` | ERC-20 pull L357 crosses engine token L354, F1 and F2. | `testCanonicalTokenHasNoCallbackAndFundingStillRejectsInjectedTokenFaults` covers a short transfer and callback rejection. Audit every launch and migration admission edge to the fixed token class. Exercise a token that reports an exact pull while trying to drain a sibling balance. |
| `1e179df9a2b61d35bf108283a1433bf4e2e9a218fc9a7c8403a8ad369cd94608` | ERC-20 pull L357 crosses manager token L355, F2. | The canonical token fault and `testPositionManagerCorruptFundingRollsBackEveryBalanceAndCanRetry` cover callbacks and wrong manager credit separately. Add a pull-time manager perturbation that preserves the engine pull delta and assert complete rollback. |
| `096666f0be36ac0ff3aa789012f4f2a57e4f492e550c7d29355adb415b4b4e32` | ERC-20 approval L360 crosses engine token L354, F2. | The canonical token fault test rejects an injected false approval and callback. Inspect inherited approval on the exact token pin and test a successful-looking approval that perturbs engine inventory. |
| `cbb7601e1d47b36023a61dc771411d08d802e547da425ee330f9a610486257a0` | ERC-20 approval L360 crosses manager token L355, F2. | The token approval and manager-credit fault tests isolate both checks. Combine them by perturbing manager credit during approval with the engine balance and granted allowance still exact. |
| `f02be6651ef27afaa0ea6c8c69a5b596575818c75d397e27b9bae568443a3aea` | Permit2 approval L361 crosses engine token L354, F2. | `testHostilePermit2CannotReenterAndRetainedAllowanceRollsBack` covers callbacks, exact expiry and retained permission. Check the exact approved spender and expiry and assert full allowance rollback on a grant-time balance fault. |
| `aed981db86d8898210985ae2ef6677507e125e0801d50fae7531dde65e6af4c8` | Permit2 approval L361 crosses manager token L355, F2. | The hostile Permit2 and corrupt manager-credit tests isolate the effects. Review whether the real grant path can move manager balances and add a grant-time manager perturbation with the correct spender state. |
| `1dd97f6a638a2d49ef2776e94dbe4ca63a74e016c58d0412fd656f51548a6ab0` | PositionManager settlement L382 crosses engine token L354, F2. | `testPositionManagerFundingCallbackCannotReenterOrReadTransientFees` covers nested access. Trace the pinned `MINT_POSITION → SETTLE_PAIR` path and assert the engine balance and both allowances across nested attempts. |
| `090ec24d83d9e6ad807b554f60ae3f0da246d90f832ea7c7554ac361e893feed` | PositionManager settlement L382 crosses manager token L355, F2. | The corrupt-funding test rejects wrong manager deposits, owner and range. Independently reconcile the exact PoolKey and position state with the global delta during shared-manager activity. A future design change would need a reproducing liveness case and an equally strict position-specific postcondition. |

### Curve graduation and LP fee harvest

`RMTLaunchBondingCurveV1._graduate` at L318–350 marks graduation and consumes recorded backing before the engine call while a guarded exact refund is allowed. L340–343 validates the two deltas and authenticated refund before the curve can report completion. `RMTV4CurveGraduationV1.collectLpFees` at L294–331 fixes the original position and recipient, uses zero-liquidity increase plus `TAKE_PAIR`, checks growth, exact beneficiary deposits, position owner and principal, then lets the ledger record credits. Caller control of either the position ID or recipient would change the risk boundary. [Curve source](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/src/RMTLaunchBondingCurveV1.sol#L314) · [Harvest source](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/src/RMTV4CurveGraduationV1.sol#L294) · [Official-runtime loopback deposit and claims](../rmt-task046/4663-shared-owner-safe-rehearsal.json)

| Exact report ID | External call and snapshot | Existing evidence and next narrow regression |
| --- | --- | --- |
| `c5eb2dc2c64f9b10dcfb06aabe27573df147b3f3af342ba7fd853845dcd605d2` | Approval grant L330 → L355 crosses token inventory L325. | `testGraduationRejectsFakeApprovalGrantOrRevocation` covers success with an incorrect allowance. Verify that the exact allowance belongs only to the one engine and combine an injected exact grant with a wrong token balance. |
| `b6e906687ef0650075ca6d11a3c7b2ba2b51f7bb37ae9b29a4842f4f9d0bcb06` | ETH-bearing `graduationEngine.graduate` L332–336 crosses token inventory L325. | `testGraduationRejectsForcedRefundEvenWhenNativeBalanceMatches` and rollback/retry tests cover authenticated refund and retry. On a local fork, assert original inventory, backing and route visibility throughout an injected funding interruption and retry. |
| `2336918b7699285aa3102fb6839d5f199a8d4c12003f32f5a7412a784a380a53` | Approval clearance L338 → L355 crosses token inventory L325. | The grant/revoke test covers residual authority and rollback. Preserve exact zero allowance and token debit. Check an injected revoke that writes the correct allowance while changing the settled inventory. |
| `c7bf2ac4fa4faa7416ab573d612269b829e795cf388551b323659cd99e12d48d` | `modifyLiquidities` L317 crosses the LP ledger token L311 before conditions L324–326. | `testPositionManagerHarvestRejectsReentryFeeDiversionAndPrincipalChange` rejects nesting, diverted fees and changed principal. `testOutsideLpKeepsItsFeesAndDoesNotShareOriginalCustody` covers a second position. Trace the actual hook/PoolManager fee-growth path and independently reconcile growth, rounding, both assets and original LP principal during same-transaction composition. |

### Same-token migration

`RMTLaunchBondingCurveV1.migrateAssets` at L168–208 runs only from the authorized factory. It closes the predecessor, moves the recorded inventory, changes the original ledger's writer, and hands exactly the recorded ETH backing to the inactive, pinned successor. L202–206 verifies both native and token deltas, writer, activity, sold amount and backing before publication. Runtime identity validates the admitted implementation against its hash, which leaves the behavior of every newly admitted successor in independent review scope. [Curve handoff source](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/src/RMTLaunchBondingCurveV1.sol#L168) · [Original ledger writer](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/src/RMTLaunchCurveRevenueLedgerV1.sol#L60) · [Migration callback tests](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/5fe80e04713cd0d72dedc087ede3a54ba2d6920d/packages/contracts/test/RMTLaunchMigrationReadiness.t.sol#L456)

| Exact report ID | External call and snapshot | Existing evidence and next narrow regression |
| --- | --- | --- |
| `bc7caad8ffa091b640b4d8eed9ae29b5e71ae4a99e79fa99b43d1c2fd9039394` | Inventory transfer L197 crosses predecessor tokens L188. | `testTokenCallbackCannotReenterEitherCurveFactoryOrRegistry` and `testUnexpectedTransferSettlementRevertsBothCurvesAndPreservesLedger` cover reentry and wrong amount. Exercise a prior surplus on the predecessor and assert the exact tracked debit with both runtime pins. |
| `e6749ba3b2993078af654829cfc6f4ada750321b203645bafcc6137e80e69b5a` | Inventory transfer L197 crosses successor tokens L189. | Wrong destination credit and untracked inventory are covered in the settlement tests. Combine a prefunded inactive successor with a short credit and assert full original-state rollback. |
| `829e666b8aa21df26b9b2fedcc9603849e0de9e615ff34424de475b1bdb65d60` | `moveAccrual` L199 crosses predecessor tokens L188. | The pinned ledger moves its writer without an outgoing call. `testLedgerCallbackCannotReenterPredecessorFactoryOrRegistry` injects one and exercises the locked predecessor. Preserve the exact ledger pin and require equivalent tests for any future callback-bearing ledger. |
| `5f8958586bc5ebe252ac7491fd063c4dc069c817f4cc486b5b54f22e4be69537` | `moveAccrual` L199 crosses successor tokens L189. | `testLedgerCallbackCannotTradeAfterWriterHandoffAndCanRetry` injects a nested trade before successor activation. Enforce that invariant for every successor and test that an invalid attempt preserves existing fee credits. |
| `7fb93fec00b6b8048ce6ecffdf0b0b286f219ed72dc72d8ecc7d50e309dfd1d8` | ETH-bearing successor acceptance L200 crosses predecessor tokens L188. | `testDestinationCodePinRejectsRuntimeSubstitution` and `testDestinationAcceptanceCallbackCannotReenterPredecessorFactoryOrRegistry` cover substitution and nesting. Review each admitted successor and assert its composed call graph cannot alter predecessor balances or re-open its execution. |
| `7b769d27a9b3f432d150f193735c7d675ee432fd1704717c50efb03c75a2d830` | ETH-bearing successor acceptance L200 crosses successor tokens L189. | `testIncorrectAcceptedAccountingRollsBackLedgerAndAssetHandoff` covers bad successor state. Independently check token/backing conservation, full receipt and final registry/ledger pointers across failure and retry of both adjacent versions. |

## Imported dependency highs

All four are internally assessed detector false positives on exact, hash-checked dependencies. The two inverse seeds are intentionally bitwise XOR. For the odd denominator left after factoring powers of two, the eight low-nibble classes all satisfy `d * ((3 * d) XOR 2) = 1 mod 16`. Newton iteration doubles the precision from that seed. In Yul, the shift count is the first argument. The bit scans use deliberate table lookups and the valid domain is nonzero input. Preserve source and runtime pins. Independent reviewers should compare quotient, rounding, reverts and bit indices against simple oracles and the deployed callback paths. A dependency change needs a fresh closure and tests. [Pinned dependency hashes](../rmt-task043/4663-rotation-profile.json) · [Upstream arithmetic test provenance](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/9829e0ad40c4716f86e7c7246fa5eb90175f0367/docs/RMT_CURVE_TASK025_VERIFICATION.md)

| Exact report ID | Detector and exact source | Evidence and reviewer regression |
| --- | --- | --- |
| `a6cd96c3ca39b7148d16fe1c70438ca96db2774a15ac6dba9e108caa550777a7` | `incorrect-exp`, Medium confidence, `lib/v4-core/src/libraries/FullMath.sol` L82. | The inverse-seed XOR is intentional. `FullMathTest` covers the 512-bit product path and reverts. Check rounding-up at quotient boundaries and both zero and overflow against an independent big-integer oracle. |
| `ae18440210b5bf82eeaef4a128724c083df85fe9236bec5a98bfaffeb5c25e4f` | `incorrect-exp`, Medium confidence, `lib/v4-core/lib/openzeppelin-contracts/contracts/utils/math/Math.sol` L184. | Same odd modular inverse rationale. `MathTest.testMulDiv` and `testMulDivDomain` cover quotient and domain. Cross-check at high-limb carry, exact divisibility and fee-floor transitions. |
| `51cdba984170e6874af6770c211071a1f5e80c6351be45e94a5fcf3f0067b304` | `incorrect-shift`, High confidence, `lib/v4-core/src/libraries/BitMath.sol` L22–23. | The MSB path reduces the input before a final 8-bit lookup. `TestBitMath` covers powers and fuzz cases. Check all 256 one-hot inputs, their adjacent values and zero reverting against a simple scanning loop. |
| `f8a4b705f57b6a14f785936a43d432b85f0f4cd1aa41906037d3c24a24a2e983` | `incorrect-shift`, High confidence, `lib/v4-core/src/libraries/BitMath.sol` L40–42. | The LSB path isolates `x & -x` then shifts lookup tables. `TestBitMath` covers the targeted scan. Verify all one-hot values and multi-bit words with identical least-significant set bits, plus the zero revert. |

## Governance medium findings

The first six rows are `incorrect-equality` with High confidence. Equality against a stored signed digest, nonce, epoch or empty-slot sentinel is intentional. The remaining row is `reentrancy-no-eth` with Medium confidence. Earlier closeout exercised four extra signed test snippets on a disposable copy. The repository's exact focused run includes 17 Directory V2 and Registry V2 tests. [Directory V2](../../../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol) · [Registry V2](../../../packages/contracts/src/RMTLaunchProjectRegistryV2.sol) · [Prior signed test snippets](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK041_GOVERNANCE_FINDINGS.md#evidence-and-gate)

| Exact report ID | Site and disposition | Existing evidence and narrow next check |
| --- | --- | --- |
| `3cd51805fd1434fbebe83c5d8ccea7221aa34f6a344f02c5e05d0f116deb762e` | Directory `cancel` L197–198. Internally assessed false positive. The cancel action targets the exact live digest before verifying current 2-of-3 authorization. | `testCloseoutOrdinaryCancellationRequiresExactDigestAndQuorum` rejects wrong digest and duplicate signer. Preserve the binding and test both inclusion orders when a scheduled action and its signed cancellation are simultaneously executable. |
| `482a490313e8d48b48c19d58b0081dc965f2f40c25196cde75c93b6d0fa786fe` | Directory `clearExpiredRotation` L305. Internally assessed false positive. Empty slots are distinguished from expiry and clearing is permitted strictly after expiry. | `testCancellationAndExpiryConsumeRotationNonceWithoutEpochChange` covers exact expiry, permissionless cleanup and nonce/epoch state. Keep the exact boundary test in future candidate reviews. |
| `6b197e5f0cda483c73a57c88133a65b6b09ce7aca23e68695d186143eb1f223f` | Directory `cancelSignerRotation` L294–296. Internally assessed false positive. Pending digest, epoch, rotation nonce and deadline bind cancellation to one rotation and current quorum. | `testCloseoutRotationRequiresExactPendingAndCancellationDigests` and the cancellation/expiry test cover wrong digest and duplicate signers. Test a delayed old cancellation after the same signer is removed and later re-added. |
| `8842e601802f78aadd94d70c0377a6faefece97a1c6a415cd0ff177215826787` | Directory `clearExpired` L205. Internally assessed false positive. Empty sentinel and inclusive expiry retain the scheduled action through its last valid second. | `testCloseoutOrdinaryExpiryOpensStrictlyAfterExpiry` exercises empty state, exact expiry and public clearing. Keep separate ordinary and rotation nonce assertions across expiry boundaries. |
| `a3c49d47c8df04d59e47a5e0988a80b9ba5469cf2a58fbaabd2bdded6e55276e` | Directory `execute` L164–166. Internally assessed false positive. Exact signed payload, nonce, epoch and notice window gate publication or resume. | `testCloseoutOrdinaryExecutionRequiresExactPendingDigest` rejects a mutated signed deadline. Current tests cover stale authorization and renewed notice. Recheck runtime admission and digest round-tripping for any newly proposed action kind. |
| `bdc7359b9bc3e2006ce9ba0a98584a7fa503daacb6784159255ec183e4813962` | Directory `executeSignerRotation` L274–275. Internally assessed false positive. The stored digest and window gate rotation, then membership, code eligibility, deadline, epoch and nonce are revalidated. | `testCloseoutRotationRequiresExactPendingAndCancellationDigests`, `testIncomingAccountTypeIsRecheckedAtExecution` and `testOtherTwoSignersReplaceUnavailableMemberAfterNotice` cover signature binding, eligibility, time and replay. Retain the gates and test expiry ordering if the authorized relay changes. |
| `5793500c59f4c62b9749c976e52e0c4a1768c3db465138aed73a0840ad2cd1b3` | Registry `executeMigration` invokes the factory at L199 and publishes `item.version`, `item.engine` and `item.curve` at L219–221. **Unresolved composition risk.** The public getter, migration digest and next-version view can see pre-commit state while the scheduled proposal has already been consumed. | `testSettlementCannotCommitIfFixtureExecutesMatureRotationInCallback` verifies rollback when the epoch changes through a callback. Guards and post-return verification constrain writes. Add a callback-capable admitted fixture that reads the registry and factory getters and attempts to make an external consumer act on a stale version, then assert either rejection or a committed canonical settlement. Keep final pointer publication after successful verification. An explicit in-flight status for composable on-chain readers warrants a separate candidate only if a reachable unsafe use is established. |

### Observed migration boundary

One new scratch test reproduced the flagged in-flight visibility. The test factory completed the local activity handoff and recorded the getters before returning to the registry. In its callback, the registry showed version 1 and its inactive predecessor, the factory already showed the successor, and the registry's migration nonce had increased with the proposal cleared. After completion, the registry and factory agreed on the active version 2 successor. This deliberately observable synthetic callback establishes the intermediate state, while production reachability and a consumer relying on a single stale getter remain open. A consumer can avoid publishing a route from that view by requiring a canonically committed migration receipt and reconciling both pointers, version, and successor activity at the same block. [Frozen registry settlement ordering](../../../packages/contracts/src/RMTLaunchProjectRegistryV2.sol#L179)

<details>
<summary>Reproduce the single added scratch test</summary>

Copy the frozen Directory V2 and Registry V2 sources and `test/RMTLaunchProjectRegistryV2.t.sol` into a disposable Foundry project with the pinned dependencies and original config. Add the following to `RegistryEpochFactory`.

```solidity
    bool public observeSettlement;
    address public observedRegistryCurve;
    address public observedFactoryCurve;
    uint32 public observedVersion;
    uint64 public observedNonce;
    address public observedProposal;
    bool public observedRegistryCurveActive;

    function enableObservation() external {
        observeSettlement = true;
    }
```

In the fixture factory's `executeMigration`, insert this block immediately before `if (settlementCallback.length != 0)`.

```solidity
        if (observeSettlement) {
            (, observedRegistryCurve, observedVersion,,) = registry.project(token);
            observedFactoryCurve = curveForToken[token];
            observedNonce = registry.migrationNonce(token);
            (observedProposal,,,,,) = registry.proposal(token);
            observedRegistryCurveActive = RegistryEpochCurve(observedRegistryCurve).active();
        }
```

Add this test to `RMTLaunchProjectRegistryV2Test`.

```solidity
    function testTask047CallbackCanSeeOnlyPrecommitRegistryPointer() external {
        _propose(12 days);
        _schedule(SIGNER_B_KEY, SIGNER_C_KEY);
        factory.enableObservation();
        vm.warp(vm.getBlockTimestamp() + registry.migrationDelay());

        registry.executeMigration(token);

        assertEq(factory.observedRegistryCurve(), origin);
        assertEq(factory.observedFactoryCurve(), nextEngine);
        assertEq(factory.observedVersion(), 1);
        assertEq(factory.observedNonce(), 1);
        assertEq(factory.observedProposal(), address(0));
        assertFalse(factory.observedRegistryCurveActive());

        (, address curve, uint32 version, address engine, uint64 migrations) = registry.project(token);
        assertEq(curve, nextEngine);
        assertEq(engine, nextEngine);
        assertEq(version, 2);
        assertEq(migrations, 1);
        assertTrue(RegistryEpochCurve(curve).active());
    }
```

Run `forge test --offline --use "$PINNED_SOLC" --match-contract '^RMTLaunchProjectRegistryV2Test$' --match-test '^testTask047' -vv` inside the scratch directory.

</details>

## Reproduction and release treatment

| Task 047 local run | Result |
| --- | --- |
| Exact 4663 Slither 0.11.5 closure | 233 findings, 22 high, exit 1. All 233 normalized rows and compile metadata matched the archive. |
| Existing release closeout with `RMT_DEPLOYMENT_TEST_CHECKOUT` set to the pinned #594 checkout | 4 passed, zero failed or skipped. |
| Triage checks with the fresh report | 2 passed, zero failed or skipped. |
| Frozen Directory V2 and Registry V2, Forge 1.7.1 and pinned native Solidity 0.8.26 | 17 passed, zero failed or skipped. |
| Scratch in-flight registry observation using identical frozen deployable sources | 1 passed, zero failed or skipped. |
| Historical #594 31337 funding, curve and migration suites with the pinned compiler | 44 passed, zero failed or skipped, with 512 quote/solvency fuzz cases. |
| Hash-verified upstream `FullMathTest`, `TestBitMath` and OpenZeppelin `MathTest` | 37 Uniswap and 2 OpenZeppelin passed, zero failed or skipped, with 1,024 inputs per fuzz case. |

- Run `node docs/evidence/rmt-task041-closeout/verify-release.mjs` and `node --test docs/evidence/rmt-task047/security-triage.test.mjs` at the repository root. The test binds all 29 unique review IDs to the archive, source scope and failed gate. Set `RMT_FRESH_SLITHER_REPORT` to a report produced by the replay command below to also verify all normalized rows.
- From the pinned #594 build checkout, generate the exact input with `node docs/evidence/rmt-task043/compile-rotation-profile.mjs --checkout "$PINNED_594" --solc "$PINNED_SOLC" --standard-json "$INPUT"` using the reviewed script from this branch. Run `python docs/evidence/rmt-task043/analyze-rotation.py "$INPUT" "$PINNED_SOLC_AS_SOLC" "$FRESH_ANALYSIS_SOURCES" "$RAW_REPORT"` with Slither 0.11.5 and Crytic Compile 0.3.11. Exit 1 remains the expected failed security gate. Replay verifies the input and native compiler hashes and preserves the live gate configuration. [Exact commands and analysis profile](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK043_GOVERNANCE_ROTATION.md#static-analysis)
- From the #594 pinned dependency checkout's `packages/contracts`, run `forge test --offline --use "$PINNED_SOLC" --match-contract '^(RMTV4CurveGraduationV1|RMTLaunchBondingCurveV1|RMTLaunchMigrationReadiness)Test$' -vv`. Use the existing upstream dependency commands with `--offline`, with outputs and cache paths in isolated scratch directories. Run Forge from the frozen governance checkout's `packages/contracts` with `--match-contract '^(RMTLaunchCurveDirectoryV2Test|RMTLaunchProjectRegistryV2Test)$'`. The existing 31337 engine fixtures, pinned 4663 loopback receipts, exact pinned arithmetic tests and focused governance tests establish distinct behavior. Coverage of same-transaction consumer composition, signer operational availability and independent disposition remains open. [First-party adversarial evidence](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK040_REVIEW.md#reproduce-the-local-checks) · [Upstream math commands](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/9829e0ad40c4716f86e7c7246fa5eb90175f0367/docs/RMT_CURVE_TASK025_VERIFICATION.md) · [Production closeout scope](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK041_RELEASE_CLOSEOUT.md)

Retain exact deltas, approvals, runtime bindings and original position custody. Review proof of a reachable issue before changing deployable code. If one is established, apply the smallest correction on a separate candidate branch, reproduce the failure first, and regenerate source, constructor, bytecode, runtime and static-analysis evidence. The archived factory migration-ordering warnings, registry history-write warning, historical V1/V2 funding parser gaps and standalone escrow findings continue in their existing scopes. [Other ordering observations](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK039_FINDINGS.md#migration-ordering-warnings) · [Deployment exclusions and historical analysis gaps](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/ec7296ea5b52eeaa74e2dbadd12e647f9dbf2482/docs/RMT_CURVE_TASK039_FINDINGS.md#exclusions-and-dependency-findings)
