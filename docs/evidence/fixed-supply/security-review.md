# Fixed-supply 4663 security review

**FAIL_HIGH · BLOCKED_NO_BROADCAST.** The Task 049 candidate uses the rmt-curve-fixed-supply-v2 profile, based on the #628 cleanup at ffa0eb4bce05543a11362b92536c83ea4282c1b9. The exact 4663 standard-JSON input digest is fb5a94b32fe4b919f4a72bf0049c37e8088bee381033d57372b1c3845d138600. The manifest pins the complete source set, dependencies, transformations and solc 0.8.26+commit.8a97fa7a. The new Registry V3 source digest is 8c92270751788af7acdbd6b4c18a4d0d5fbb399a876d974d55807489516e388c. [4663 compiler manifest](4663-profile.json) · [Exact Slither report](slither-4663.json.gz)

Slither 0.11.5 and Crytic Compile 0.3.11 analyzed 66 source units using all 101 detectors. The uncompressed report digest is 5d3b25d309a7113369b66afd80cc2cc36ba32e79b50919e962ab9dd37c65b8bd. The strict run exited 1 with 231 findings, including **18 engine highs and four dependency highs**. All 22 match the frozen high findings by detector and description after removing source locations. Thirteen IDs are identical. The other nine IDs changed with a one-line offset in the curve source. The two fewer informational findings come from three prior literal-format warnings no longer emitted for the equal 4663 economic values and one new token-runtime constant warning. The medium, low and optimization totals are unchanged. [Frozen closure and original 29 dispositions](../rmt-task047/security-triage.md)

## High findings

| Current 4663 scope | Rows | Security boundary and evidence |
| --- | ---: | --- |
| V4 position funding | 8 | `reentrancy-balance` compares the engine and shared PoolManager token balances across the token pull, approval, Permit2 approval and PositionManager funding call. Runtime and allowance binding, the guarded PoolKey and exact deposits remain enforced. Tests cover injected token faults, hostile Permit2, nested funding and corrupt manager credits followed by retry. Independent review must reconcile exact global balances with position-specific settlement during the permitted callback sequence. [Funding checks](../../../packages/contracts/src/RMTV4CurveGraduationV1.sol#L345) · [Funding regressions](../../../packages/contracts/test/RMTV4CurveGraduationV1.t.sol#L426) |
| Curve graduation | 3 | `reentrancy-balance` crosses allowance grant, the ETH-bearing graduation call and allowance revocation against the original token inventory. Forced refunds and fake approvals still revert with original backing intact. Review the pinned callback graph for liveness and balance preservation. [Graduation checks](../../../packages/contracts/src/RMTLaunchBondingCurveV1.sol#L317) · [Refund and approval regressions](../../../packages/contracts/test/RMTLaunchBondingCurveV1.t.sol#L396) |
| Original LP fee collection | 1 | `reentrancy-balance` compares the LP ledger token balance around PositionManager settlement. The harvest test rejects reentry, fee diversion and changes to principal. The separate LP test checks that outside liquidity retains its own earnings. Independent review must reconcile both earned assets, fees and unchanged principal on the pinned fee-growth path. [Harvester checks](../../../packages/contracts/src/RMTV4CurveGraduationV1.sol#L294) · [Harvest regressions](../../../packages/contracts/test/RMTV4CurveGraduationV1.t.sol#L584) |
| Same-token migration | 6 | `reentrancy-balance` compares predecessor and successor stock around the inventory transfer, ledger-writer change and ETH-bearing successor acceptance. Callback, rejected settlement and V2-to-V3 retry tests check that backing, balances and fee rights survive. Runtime pins and the registry read barrier strengthen admission and publication. Each admitted successor's internal call graph still needs independent review. [Asset handoff](../../../packages/contracts/src/RMTLaunchBondingCurveV1.sol#L167) · [Migration regressions](../../../packages/contracts/test/RMTLaunchMigrationReadiness.t.sol#L316) |
| Pinned arithmetic dependencies | 4 | Two `incorrect-exp` rows flag intentional modular-inverse XOR in Uniswap FullMath and OpenZeppelin Math. Two `incorrect-shift` rows flag the Yul bit-scan expressions in Uniswap BitMath. The source pins and IDs are unchanged. Prior upstream tests and arithmetic checks support the internal false-positive assessment. Independent disposition remains open. [Dependency rows and test provenance](../rmt-task047/security-triage.md#imported-dependency-highs) |

## Governance and registry

The six Directory V2 `incorrect-equality` medium IDs are unchanged. The original internal dispositions and test requirements carry forward. [Directory source](../../../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol) · [Signed governance regressions](../../../packages/contracts/test/RMTLaunchCurveDirectoryV2.t.sol) · [Exact frozen IDs and dispositions](../rmt-task047/security-triage.md#governance-medium-findings)

| Directory function | Binding under review |
| --- | --- |
| `execute` | Exact signed action digest, nonce, epoch and notice window. |
| `cancel` | Exact live pending digest and current quorum. |
| `clearExpired` | Empty sentinel and expiry boundary. |
| `executeSignerRotation` | Exact rotation digest with incoming account eligibility, epoch and nonce. |
| `cancelSignerRotation` | Exact pending rotation digest, current quorum and deadline. |
| `clearExpiredRotation` | Empty sentinel, strict expiry and unchanged signer epoch. |

The seventh medium now applies to Registry V3's `executeMigration`. Slither reports `reentrancy-no-eth` at lines 186–233, ID d697a99f19249379c994897b40978cfeb142809ae01586eebb816679f7ad369f. The external factory call still precedes canonical project writes and proposal consumption. The detector continues to flag those writes. [Settlement and checks](../../../packages/contracts/src/RMTLaunchProjectRegistryV3.sol#L186)

The adversarial regression exercised the retained Registry V2 and the new Registry V3 with a directory-admitted callback factory. During the V2 handoff, an external consumer recorded the original, already inactive curve as its route after the factory had activated the successor. It also observed a consumed migration nonce. V3 sets a per-token in-flight flag before crossing the factory boundary. Its canonical `project`, `migrationDigest` and `nextMigrationVersion` reads revert for that token, while unrelated project reads still work. Registry mutators are reentrancy-guarded. Nonce, proposal, history and pointer changes publish only after confirming activity, the signer epoch and factory state. Both pointers agree when execution returns. A failed handoff restores both asset state and the prior visible route. The regression establishes the stale-route defect under that callback composition and the behavior of the new read barrier. Production exploitability of the historical observation remains unestablished. Consumers must use the registry's canonical route and verify completed receipts. [Old-to-new callback regression](../../../packages/contracts/test/RMTLaunchProjectRegistryV3.t.sol#L91) · [Guarded views](../../../packages/contracts/src/RMTLaunchProjectRegistryV3.sol#L290) · [Actual factory callback and rollback tests](../../../packages/contracts/test/RMTLaunchMigrationReadiness.t.sol#L116)

Registry V3 also verifies the exact Token V2 runtime and one-billion-token total supply at registration, including for other directory-admitted factory identities. The cap is constructor-enforced, with 18 decimals and no supply argument; migration retains that token contract. The new test rejects an alternate token runtime and an intentionally wrong supply read even through the authorized fixture factory. The factory test rejects the old supply-selection ABI and token initialization or burn attempts. [Token constructor](../../../packages/contracts/src/RMTLaunchCurveTokenV2.sol#L6) · [Registry admission](../../../packages/contracts/src/RMTLaunchProjectRegistryV3.sol#L103) · [Creation regression](../../../packages/contracts/test/RMTLaunchBondingCurveV1.t.sol#L172) · [Alternate admission tests](../../../packages/contracts/test/RMTLaunchProjectRegistryV3.t.sol#L151)

## Reproduce

Use the repository-pinned dependencies and the checksum-verified native compiler. Name the pinned executable solc or solc.exe for Crytic Compile and use fresh input, source and report paths.

```sh
node packages/contracts/scripts/fixed-supply-profile.mjs --chain 4663 --solc "$PINNED_SOLC" --standard-json "$INPUT"
python docs/evidence/rmt-task043/analyze-rotation.py "$INPUT" "$PINNED_SOLC" "$ANALYSIS_SOURCES" "$REPORT"
(cd packages/contracts && forge test --offline --use "$PINNED_SOLC" --summary)
```

The final native Forge 1.7.1 run passed 80 tests in 11 suites with zero failures or skips. The two fuzz tests each used 512 inputs. The migration/accounting invariant ran 64 sequences and 2,048 calls without reverts. The separate repository-scoped 31337 Slither run retains 18 highs. The 4663 release gate remains failed with 22 highs and the registry medium. Preserve the independent review requirement and the archived V1/V2 funding analysis and experimental scope limitations. [Release security policy](../../SECURITY.md)
