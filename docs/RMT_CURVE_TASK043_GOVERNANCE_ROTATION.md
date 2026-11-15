# RMT Launch governance key rotation

[Task 043 for #611](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/611) is based on [#614](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/614) at f03d1b41f7b24f1e91b2dbe0f8e739689d6153e5. The distinct 4663 candidate is **rmt-curve-v1-4663-governance-rotation-v2**. Its initial deployment uses Directory V2 and Registry V2. Subsequent rotations update one signer slot and advance the epoch in place. **BLOCKED_NO_BROADCAST** applies throughout this package.

## Signer continuity

| Action | Authority and result |
| --- | --- |
| Propose rotation | Two different current signers sign an exact EIP-712 rotation, and the incoming signer signs separate acceptance of its digest. Any relayer can schedule it. The departing signer need not participate. |
| Execute rotation | Anyone may execute the exact action from two days after scheduling through its declared deadline or seven-day execution window, whichever expires first. The incoming address must still be eligible. Rotation emits its execution event, advances the signer epoch, consumes the rotation nonce and invalidates pending directory actions. |
| Cancel or expire | Two current signers can cancel by signing the exact pending digest, epoch, nonce and deadline. After the window anyone can clear it. Both emit events and consume the separate rotation nonce. The signer epoch advances only after successful execution. |
| Suspend and resume | Rotation can proceed during suspension and keeps suspension in force. A pending resume is cleared at rotation execution. Resumption needs a fresh authorization and its own two-day notice. |
| Refresh a migration | Rotation invalidates existing quorum approvals. Anyone can clear a stale migration approval and consume that migration nonce while preserving the creator's exact destination, runtime hash and deadline. Scheduling in the new epoch restarts the full two-day notice. If the deadline cannot accommodate it, the creator can cancel and re-propose. Anyone can clear expired consent. |

The signer set has three code-empty EOA identities with two distinct approvals. The directory exposes neither a deployer power nor a threshold setter. A replacement rejects zero, reserved, already-enrolled or code-bearing addresses, including delegated accounts while they have code. Membership and account eligibility are checked when signatures are accepted. A code change at the proposed incoming address before execution invalidates execution. A scheduled rotation can complete without new signatures if its existing authorization remains valid. Losing two signers before a valid rotation is available prevents new quorum actions. The operating plan is to rotate while the other two keys remain available.

Directory actions and migration signatures bind the chain, contract, current signer epoch, applicable nonce and expiry. A returning signer enters a new epoch, so archived signatures stay invalid. Directory and migration notices remain separate. The directory has a separate pending rotation slot. Ordinary actions may still execute under the current epoch during the notice period. At execution, rotation clears any still-pending directory action. The registry checks epoch and suspension before and after factory settlement, so a mid-settlement rotation attempt cannot commit a migration.

The original token and fixed supply, creator consent, immutable treasury and payout addresses, 90/5/5 split, reserves, credits and original locked LP principal retain their existing contract behavior. The new bytecode templates are limited to the governance pair. The other twelve compiled templates match #614. Constructor-dependent factory and bootstrap runtime identities still depend on real deployment inputs, including the new registry binding.

## Exact unsigned package

- [Compiler profile](evidence/rmt-task043/4663-rotation-profile.json) pins 66 input files, both new sources, original chain and economics transformations, all fourteen template hashes, external runtime pins and the five EIP-712 schemas.
- [Owner inputs](evidence/rmt-task043/deploy-rotation-inputs.json) leaves the operating treasury, reserve, deployer, deployer nonce, three public signer identities, quorum and proposed terms unassigned.
- [Deployment verifier and typed data tool](evidence/rmt-task043/deploy-rotation.mjs) emits unsigned payloads. It separates fixture replay from owner-input validation and refuses to write a plan with unassigned values. Production approvals, public key control, nonce and address vacancy still require direct verification.

The compiler input SHA-256 is 90122536b22c847aebc0182d75290b9ba281399481d90daffc8b0f66ed92f65b. The verifier derives CREATE, CREATE2 and constructor-dependent runtime identities for the directory, registry, successor helpers, bootstrap, guard, graduation engine and factory. The five CREATE transactions and four directory publication transactions remain the initial sequence. The guard uses permission bits 0x2000.

| Component | Exact bytes in this profile |
| --- | --- |
| Directory V2 | 11,833 encoded initcode and 10,290 runtime |
| Registry V2 | 15,693 encoded initcode and 14,275 runtime |
| Bootstrap | 48,894 encoded initcode and **258 bytes of EIP-3860 headroom** |
| Factory | 23,980 runtime and 596 bytes of EIP-170 headroom |

The nine-step 4663 rehearsal used **22,617,176 gas units**. Directory V2 used 2,376,060 and Registry V2 used 3,185,463. Bootstrap used 9,951,309, matching #614's bootstrap measurement. These are fork receipt values. Actual ETH cost, constructor input bytes and L1 data charges depend on the approved inputs and execution conditions.

    node docs/evidence/rmt-task043/compile-rotation-profile.mjs --checkout "$PINNED_594" --solc "$PINNED_SOLC" --verify-manifest
    node docs/evidence/rmt-task043/deploy-rotation.mjs
    node docs/evidence/rmt-task043/deploy-rotation.mjs --checkout "$PINNED_594" --typed-data "$REQUEST_JSON"
    node docs/evidence/rmt-task043/deploy-rotation.mjs --checkout "$PINNED_594" --solc "$PINNED_SOLC" --input "$OWNER_INPUTS" --output "$NEW_UNSIGNED_PLAN"

The typed-data request contains exactly schema, verifyingContract and message. Its domain chain ID is 4663. Before signing in a separately authorized process, compare the returned digest and epoch with the pinned on-chain directory or registry, independently verify the exact target, and use only the intended action schema and key. The input sheet accepts public addresses and excludes keys and signatures.

## Verification

The targeted Foundry suite passed **17 tests** with genuine test-key signatures. It covered missing and compromised signers, quorum loss, incoming acceptance, account type, timers, cancel and expiry, cross-chain and cross-contract signatures, stale publication and resume, stale migration clearing, creator cancellation and deadline, signer removal and re-addition, and atomic rollback for rotation during settlement.

The broad Windows Foundry run returned **505 passed, 1 failed, 1 skipped**. The failure was the same legacy V3 creation-bytecode metadata hash reproduced in #614, and the V3 executor is outside this compiler closure. [Legacy hash evidence](evidence/rmt-task041/legacy-v3-bytecode.json)

    forge test --offline --use "$PINNED_SOLC" --match-contract '^(RMTLaunchCurveDirectoryV2Test|RMTLaunchProjectRegistryV2Test)$' -vv
    node docs/evidence/rmt-task043/run-rotation-fork.mjs --checkout "$PINNED_594" --solc "$PINNED_SOLC" --anvil "$PINNED_ANVIL" --archive pinax
    node docs/evidence/rmt-task043/run-rotation-fork.mjs --checkout "$PINNED_594" --solc "$PINNED_SOLC" --anvil "$PINNED_ANVIL" --archive pinax --safe-only

The fork harness uses the named 4663 compiler profile, original Router 2.1.2 and Safe pins, a loopback Anvil instance and a method-allowlisted upstream archive proxy that returns HTTP 403 for the write probe. The [governance receipt observer](evidence/rmt-task043/observe-governance.mjs) verifies canonical log identity, registered runtime hashes, registry-to-directory binding, monotone epochs, the restarted execution window and unchanged creator proposal. It checks fixture blocks with one transaction per block. Production indexing and database state remain unchanged. The existing registry project and registration ABI is preserved, and any future migration event index must read the new schedule event and invalidation epoch.

## Static analysis

Slither 0.11.5 and Crytic Compile 0.3.11 analyzed all 66 inputs with all 101 detectors. The [complete compressed 4663 report](evidence/rmt-task043/slither-4663-full.json.gz) contains 233 findings, including **22 high, 60 medium, 38 low, 111 informational and 2 optimization**. All 22 high finding IDs matched the prior exact-closure report. The gate exits 1 for highs. The 18 active balance-reentrancy findings and four dependency findings remain open.

The new governance sources have seven medium findings. Six flag exact digest and empty-pending comparisons in the directory. One flags the registry transition at the factory call. The registry consumes its authorization before the call, holds its reentrancy guard, and verifies the epoch after return. The callback test verifies rollback of both transitions. A low finding covers the post-call history write. The other low and informational findings remain in the report. These observations remain part of release review.

The report's uncompressed SHA-256 is fc88c2a7844772e0f30ceeed299e686474286c32140982300067bd0718243c3b. [Analysis runner](evidence/rmt-task043/analyze-rotation.py) starts with the profile input and requests AST, documentation and source maps for analysis. The analysis-input SHA-256 is 08d0b9b34d619ff056a3a78dfd9d3da3d76f254735bd1acdc9270aa149393700. Compiler settings and source bytes stay fixed. The repository's existing Slither workflow keeps its configured scope and high-severity gate.

    node docs/evidence/rmt-task043/compile-rotation-profile.mjs --checkout "$PINNED_594" --solc "$PINNED_SOLC" --standard-json "$INPUT"
    python docs/evidence/rmt-task043/analyze-rotation.py "$INPUT" "$PINNED_SOLC_AS_SOLC" "$FRESH_ANALYSIS_SOURCES" "$FULL_REPORT"

## Owner inputs and release boundaries

Confirm the operating and reserve addresses, deployer and reservable nonce, three independent governance EOA records and 2-of-3 continuity procedures. Confirm economics and approve the exact unsigned plan after recalculating addresses and live input-specific gas estimates. Contract deployment, funded acceptance and release activation each require separate decisions in #611. Existing production archive and trace evidence, independently established L1 finality, hosted routing, physical wallet acceptance and contract release review remain separate gates. The original #614 package remains available as reference.
