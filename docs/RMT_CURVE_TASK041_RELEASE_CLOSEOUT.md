# RMT Launch 4663 release closeout

[Deployment preparation #611](https://github.com/LandoCrissian/robinhood-meme-terminal/issues/611) retains [#615](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/615) at d4d81d1153a11728d98e694c1f3976ceb3408915 as the exact contract candidate. The profile is **rmt-curve-v1-4663-governance-rotation-v2**. The closeout updates the unsigned tooling and handoff. The Solidity, compiler profile and test-key fork evidence retain their original bytes.

**BLOCKED_NO_BROADCAST.** The [release manifest](evidence/rmt-task041-closeout/release-manifest.json) binds the exact [compiler profile](evidence/rmt-task043/4663-rotation-profile.json), the compiler input and both the compressed and uncompressed Slither hashes. Its LF SHA-256 is 9273ba1c41b3891153e4f3810ddaacff62cd152fc4072b9636976c0db3d2e689. The unsigned plan and the read-only preflight carry the manifest hash and failed gate. The default status tools leave addresses, actual nonce, actual cost and exact owner-input rehearsal pending.

| Evidence | Release result |
| --- | --- |
| Exact 4663 Slither closure | Failed at high severity. The 18 active-engine and four dependency findings retain their existing dispositions. The [seven governance dispositions](RMT_CURVE_TASK041_GOVERNANCE_FINDINGS.md) include six internal false-positive assessments, one unresolved registry callback observation and zero confirmed defects. |
| Repository-filtered #615 CI | 14 checks passed for d4d81d1153a11728d98e694c1f3976ceb3408915. The 4663 compiler closure has a different scope and its own failed gate. |
| Legacy Windows V3 hash | 505 passed, one failed and one skipped in the historical Windows tree. The mismatch comes from absolute Windows dependency-junction remappings in Solidity metadata. This executor is outside the launch release closure. [Exact legacy diagnosis](evidence/rmt-task041/legacy-v3-bytecode.json) |
| Retained 4663 fixture | The treasury and Safe runs passed with synthetic funds. A fresh offline compile reproduced eight addresses and eight runtime hashes from the Safe receipts. The nine-step Safe replay used 22,617,164 gas and bootstrap retained 258 bytes of initcode headroom. [Fixture receipt measurements](evidence/rmt-task043/4663-rotation-deployment-measurements.json) |
| Current read-only 4663 evidence | The official endpoint matched the six pinned runtimes at block 114671490. At 20,068,000 wei/gas, the fixture illustrates 0.000453881247152 ETH for L2 execution. Actual calldata, L1 posting, tips and sequential state require input-specific evaluation. Independent Ethereum finality remains unverified. [Read-only evidence and limits](RMT_CURVE_TASK041_PREFLIGHT_EVIDENCE.md) |

## One owner input sheet

The [owner sheet](evidence/rmt-task041-closeout/owner-inputs.json) asks for the operating treasury, distinct reserve, deployer, three public signer EOAs, explicit approval of the exact proposed economics, and key-continuity and incident assignments. Every owner value is unassigned. The proposed terms are carried from the pinned compiler profile. The sheet has no nonce, keys, signatures or production approval switch. The deployer nonce is observed separately. A supplied approval reference must be verified by the operator against the exact intended inputs.

## Input binding and rehearsal

The first two commands are available with the blank sheet. The later commands require a completed copy of the same sheet and explicit approval. Keep the approved copy and unsigned outputs in the operator's release workspace.

    node docs/evidence/rmt-task041-closeout/verify-release.mjs
    node docs/evidence/rmt-task041-closeout/owner-inputs.mjs
    node docs/evidence/rmt-task041-closeout/owner-inputs.mjs --sheet "$OWNER_SHEET" --checkout "$PINNED_594" --output "$MACHINE_INPUTS"
    node docs/evidence/rmt-task041-closeout/preflight.mjs --checkout "$PINNED_594" --inputs "$MACHINE_INPUTS" > "$INPUT_OBSERVATION"
    node docs/evidence/rmt-task043/deploy-rotation.mjs --checkout "$PINNED_594" --solc "$PINNED_SOLC" --preflight "$INPUT_OBSERVATION" --output "$UNSIGNED_PLAN"
    node docs/evidence/rmt-task041-closeout/preflight.mjs --checkout "$PINNED_594" --solc "$PINNED_SOLC" --plan "$UNSIGNED_PLAN"

The direct preflight reads latest, pending and anchored nonce, then rereads latest and pending. The plan records that block, time, role addresses and five agreeing nonce observations. The final preflight before the first submission recompiles the exact profile, rederives the plan and checks all eight predicted accounts for vacancy, the six official dependency runtimes and code-empty deployer and signer eligibility. A changed or pending nonce aborts the preflight. Exclusive deployer use still requires an assigned operator from the first observation through both governance notices. Recheck the exact next nonce immediately before each later, separately authorized submission. A read-only observation cannot reserve a nonce on chain.

The unsigned plan derives constructor calldata, sequence, eight addresses and materialized runtime hashes, hook bits, size limits and expected directory events. The first CREATE may have a direct current gas estimate if the approved public account and RPC state permit it. Later steps require the correct prior state. Rehearse the exact approved constructors on a local 4663 fork with synthetic funds. The exact chain- and address-bound governance actions require real owner signatures, so use the retained test-key replay for that authorization and notice behavior. A constructor-only replay and the signed fixture prove different boundaries. Preserve the actual two-day waits in any separately approved live sequence.

Verify each funded beneficiary's receive path and ability to originate its own claims before binding it. The tested 2-of-3 Safe profile is fixture evidence. Exact wallets and signer control remain unverified until public identities are available. Production archive and trace capacity, exact-pool hosted routing, durable indexing with restore and recovery, physical-device acceptance and independent Ethereum L1 finality remain open. [Detailed preflight and wallet checks](RMT_CURVE_TASK041_PREFLIGHT_EVIDENCE.md)

The closeout passed 18 Node tests. A full offline compile with a synthetic sheet and mocked nonce observation produced five unsigned constructor steps, four governance steps and six expected governance events. It retained the failed release gate. The governance review also passed the 17 pinned Foundry cases and four disposable boundary tests. Exact owner-input fork receipts, named-wallet capability and costs are pending.

## Separate approval points

1. **Deployment** requires resolved release findings, verified role and economic approvals, the observed nonce and exact constructor artifact, cost estimates and local rehearsal.
2. **First funded acceptance** requires a separate budget, wallet and transaction authorization after canonical deployment verification.
3. **Public activation** requires separate approval after funded acceptance, receipt finality, index recovery, routing and wallet verification.
