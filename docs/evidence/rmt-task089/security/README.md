# Task 089: stage-specific core security disposition

**Zero confirmed exploits established; four reported arithmetic expressions independently disproven at the exact source pins; 18 stateful findings unresolved. All 22 raw High observations and strict exit 1 remain. BLOCKED_NO_BROADCAST.**

The starting commit is `78a76feb592ac136dbf74d4823c21db64a6d0313` (#683), stacked on website repair #682 `be44e7e`. This is source/local evidence only. No deployed code, economics, assertion, detector, severity or security policy changed. No live exploit testing or third-party account interaction occurred.

[stage-dispositions.json](stage-dispositions.json) records every full finding ID, detector, exact function/path/call/line, first enabled stage, source digests, existing guards/test bindings, new proof or unresolved reason, and required closure. Historical `PINNED_FALSE_POSITIVE` labels remain historical metadata; Task 088's uncleared disposition remains visible. An unresolved row describes a limitation of this new review, not a claim that a viable exploit was demonstrated.

| Finding (unique prefix) | Check / exact call | First affected stage | Task 089 disposition |
| --- | --- | --- | --- |
| `090ec24d83d9` | `reentrancy-balance`: PositionManager.modifyLiquidities; shared PoolManager token/native baseline | graduation | Unresolved |
| `096666f0be36` | `reentrancy-balance`: asset.approve(Permit2); engine token baseline | graduation | Unresolved |
| `1dd97f6a638a` | `reentrancy-balance`: PositionManager.modifyLiquidities; engine token baseline | graduation | Unresolved |
| `1e179df9a2b6` | `reentrancy-balance`: asset.safeTransferFrom; shared PoolManager token baseline | graduation | Unresolved |
| `6e56005d266c` | `reentrancy-balance`: asset.safeTransferFrom; engine token baseline | graduation | Unresolved |
| `aed981db86d8` | `reentrancy-balance`: Permit2.approve; shared PoolManager token baseline | graduation | Unresolved |
| `cbb7601e1d47` | `reentrancy-balance`: asset.approve(Permit2); shared PoolManager token baseline | graduation | Unresolved |
| `f02be6651ef2` | `reentrancy-balance`: Permit2.approve; engine token baseline | graduation | Unresolved |
| `c161ac1c6b54` | `reentrancy-balance`: _approveGraduation(0); curve token baseline | graduation | Unresolved |
| `fae53a948b42` | `reentrancy-balance`: _approveGraduation(inventory); curve token baseline | graduation | Unresolved |
| `fe593a6c4b17` | `reentrancy-balance`: graduationEngine.graduate{value:backing}; curve token/native baseline | graduation | Unresolved |
| `c7bf2ac4fa4f` | `reentrancy-balance`: PositionManager.modifyLiquidities; immutable ledger token/native baseline | lp harvest | Unresolved |
| `04dd86035f4e` | `reentrancy-balance`: revenueLedger.moveAccrual(nextCurve); successor token baseline | asset bearing migration | Unresolved |
| `1fdf2b7ea9c9` | `reentrancy-balance`: token.safeTransfer(nextCurve,inventory); predecessor token baseline | asset bearing migration | Unresolved |
| `7f0d82532758` | `reentrancy-balance`: next.acceptMigration{value:backing}; successor token baseline | asset bearing migration | Unresolved |
| `be7b3e4ab448` | `reentrancy-balance`: next.acceptMigration{value:backing}; predecessor token baseline | asset bearing migration | Unresolved |
| `c87c792deb6a` | `reentrancy-balance`: token.safeTransfer(nextCurve,inventory); successor token baseline | asset bearing migration | Unresolved |
| `d7b62a52dbdc` | `reentrancy-balance`: revenueLedger.moveAccrual(nextCurve); predecessor token baseline | asset bearing migration | Unresolved |
| `a6cd96c3ca39` | `incorrect-exp`: No external call: deliberate XOR inverse seed; full-width division | graduation | Reported expression independently disproven |
| `ae18440210b5` | `incorrect-exp`: No external call: deliberate XOR inverse seed; full-width division | curve trading and curve fee accrual | Reported expression independently disproven |
| `51cdba984170` | `incorrect-shift`: No external call: Yul packed shift lookup; most significant bit index | external v4 pool initialization or trading | Reported expression independently disproven |
| `f8a4b705f57b` | `incorrect-shift`: No external call: Yul packed shift lookup; least significant bit index | external v4 trading | Reported expression independently disproven |

## What the new independent expression evidence establishes

The exact 66-source 4663 compiler input remains SHA-256 `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`. All three dependency source byte strings are bound to their retained SHA-256 values before proof. The proof parses the actual pinned Yul expressions; it does not substitute a rewritten BitMath implementation.

- **Most-significant bit:** 32 contiguous integer intervals partition every nonzero uint256. Interval evaluation of the actual five prefix assignments proves one constant multiple-of-eight prefix on each entire interval. Every normalized residual is in [1,255]. The parsed final expression depends only on that prefix and residual; all 255 values per interval (8,160 evaluations) match Python integer bit length. This is a complete input-domain quotient proof, not a fuzz/sample extrapolation.
- **Least-significant bit:** a 256-bit SMT query proves that the exact `x & -x` source operation yields a nonzero one-hot bit contained in x, with no lower set bit, for every nonzero uint256. The negation is UNSAT. The remaining parsed source expressions are exhaustively checked on all 256 possible isolated inputs against the independent bit index.
- **Both deliberate XOR inverse seeds:** each exact source requires an odd denominator after power-of-two extraction. An all-residue four-bit SMT query proves the seed inverse congruence modulo 16; the negation is UNSAT. The exact integer polynomial identity `1-d*(i*(2-d*i))=(1-d*i)^2` proves precision doubles on each update in modular arithmetic. Six exact pinned refinements lift four correct bits through 256. Replacing XOR with exponentiation would invalidate this argument and is rejected by a negative test.

These are independent arithmetic arguments/oracles, **not an independent external audit**. The result disproves the four *reported operator/shift mistakes* under exact immutable source and compiler/EVM semantics. It does not prove the rest of mulDiv, all dependency behavior, compiler correctness, current source-to-deployed correspondence, router settlement or the entire protocol. `leastSignificantBit` has no internal caller in the local 66-source closure; the separate official pinned external PoolManager bitmap path is relevant only when that external runtime correspondence is established.

The unchanged Task 088 verifier was rerun on the unchanged immutable starting checkout 78a76feb and passed: all 233 retained finding IDs, 22 Highs, source digests, strict exit 1 and the retained 112-pass test bindings agree. That is **verification of retained evidence**, not a newly rerun Foundry suite or a new raw Slither execution. Fresh end-to-end/contract execution is reported separately by the Task 089 creator/recovery workstream.

## Unresolved stateful paths

Eight position-funding rows and three curve-graduation rows affect graduation and the explicit atomic `buyAndGraduate` branch. They compare engine/shared-manager/curve asset baselines across token grants/pulls, Permit2 grants and PositionManager settlement. Guarded entry, finite completely consumed allowances, exact increments/decrements, refund authentication and original-position custody checks remain required. They support the candidate but are not a new independent proof of the complete admitted dependency graph.

One LP-harvest row affects creation of new LP fee credits, with a fixed zero-liquidity action sequence, original NFT/PoolKey/liquidity, immutable ledger destination and exact fee growth/credits checked. Existing beneficiary claims are separate operations that debit entitlement before payment; no blanket asset freeze or changed recipient right is proposed.

Six asset-bearing migration rows affect source/destination inventory, backing and original ledger writer/credits. The predecessor closes first, successor stays inactive during the call-free writer switch, canonical factory/registry routes are hidden, and exact balances/accounting reconcile before return. Each actual adjacent successor admission requires its own full source/callback/runtime proof. A runtime pin proves identity, not the correctness of an arbitrary future template; raw registry proposal/migrationNonce composition remains a separate Medium observation.

No new confirmed defect or necessary versioned Solidity correction was established in these exact paths. No patch is proposed merely to silence analysis. Every unresolved row gives the specific proof/callback/settlement and source-to-runtime evidence needed to resolve it; repeating the same passing test count is insufficient.

## Stages and the owner decision

[core-stage-bindings.json](core-stage-bindings.json) binds the exact first-party source and retained 4663 terms. The proposed disposition is:

| Stage | Current decision and relationship to these findings |
| --- | --- |
| Read-only website freshness repair | A separate nonfinancial rollout may be considered after authenticated handoff and operational evidence are accepted. These contract findings do not require weakening the website auth or exposing an internal endpoint. No deployment is authorized here. |
| Directory factory publication | **NO-GO for owner execution in this task.** The Publish branch validates the exact pending digest/epoch/nonce/window and factory runtime/version, writes the factory pin and clears pending. It moves no assets, mints no token and calls no graduation/migration. Nevertheless, publication admits direct third-party creation through registry registration and enables access to later financial paths. Website OFF flags cannot prevent this. Current pending permissionless execution risk must be treated separately. |
| Token creation | **NO-GO for enabling production.** None of the 22 flags directly marks the factory create function, but creation produces an active curve and exposes future permissionless operations; absence of a direct flag is not whole-stage clearance. Registry admission and separate owner/wallet/operational approvals are required. |
| Ordinary curve buy/sell | **NO-GO for enabling production.** The exact Math.mulDiv XOR mistake is disproven, but that is not proof of whole trading behavior or an authorization. Ordinary buy/sell are separate from explicit buyAndGraduate. |
| Graduation / buyAndGraduate | **HOLD: 11 unresolved stateful rows**, including fixed external dependency and original-position conservation/custody assumptions. Graduation is permissionless at threshold once a curve exists. |
| LP harvest / new LP fee credits | **HOLD: one unresolved stateful row.** Original LP principal remains locked. Existing legitimate ledger claims and current rights are preserved. |
| Asset-bearing migration | **HOLD: six unresolved stateful rows**, plus separate governance/registry Medium composition, current authority and each future template-admission review. |
| External v4 trading | The four source-expression disproofs are narrow evidence, not a complete manager/router/runtime/provider release. All applicable separate holds and explicit owner approvals remain. |

The owner can choose a separately scoped diagnostic/read-only website deployment after reviewing its minimum action plan, while leaving every financial route OFF. Publication/financial launch cannot be inferred from that approval. The seven governance Medium observations, physical iPhone acceptance, provider/dependency identity and L1 finality are distinct remaining questions. An external audit remains optional under existing owner policy; this package invents no audit mandate and grants no policy exception.

## Reproduce offline

Tool installation uses only the pinned official Python package release (no paid service required):

```sh
python3 -m venv /tmp/task089-proof
/tmp/task089-proof/bin/pip install --only-binary=:all: --require-hashes -r docs/evidence/rmt-task089/security/proof-requirements.txt
/tmp/task089-proof/bin/python docs/evidence/rmt-task089/security/prove-arithmetic.py
/tmp/task089-proof/bin/python docs/evidence/rmt-task089/security/proof_test.py
/tmp/task089-proof/bin/python docs/evidence/rmt-task089/security/verify-stage-dispositions.py
```

To rerun the original Task 088 verifier, use an isolated immutable checkout of 78a76feb. Its original helper-hash assertion must remain unchanged. Task 089 intentionally adds a separately reviewed pinned-compiler portability helper; the old verifier is expected to reject that changed helper at the new head. The new stage verifier binds the unchanged Solidity source and exact retained compiler input without rewriting the old evidence or its assertions.

The proof, tests and verifiers perform **no network operations**. Z3's exact wheel identity and official release metadata source are retained in `proof-tool-manifest.json`; platform-specific official wheel digests are pinned in `proof-requirements.txt`. The original ARM setup lacked Python ensurepip; installing the Debian python3.11-venv package resolved that environment-only limitation, without changing any repository assertion.

**Results:** all four source-expression proofs PASS; **27 proof/negative tests PASS**; fresh stage verifier PASS; retained Task 088 evidence verifier PASS on the unchanged starting checkout (not claimed against the changed Task 089 helper). The negative checks reject changed input bytes, incorrect prefix/lookup/isolation, replacing XOR with exponentiation, missing Newton refinement and unknown Yul operations. The SMT inputs, deterministic proof result and command output remain alongside the verifier. No strict raw scanner result is represented as clean.

The separate unchanged-rule Gitleaks 8.30.1 scan of these new security evidence files returned raw exit 0/no matches. This scoped source-document scan is not a clean full-history/raw scanner claim. Its redacted report and output are retained.

## Capture and verification Python provenance

The retained arithmetic proof result was captured on CPython 3.11.2 and remains unchanged. CI may verify it on CPython 3.12.x; the verifier also supports CPython 3.11.x. The captured version must match the retained tool manifest, and the fresh version must match the actual current interpreter. The verifier records both values and any difference explicitly.

Only the top-level `pythonVersion` result field may differ. Every other field, including JSON types, complete input and source digests, solver version, exact script identity, proof coverage/results and SMT query digests, must compare exactly. The installed solver package remains pinned to 4.13.4.0; its solver-version provenance must also match. Unknown fields, malformed or unsupported Python versions, forged capture/runtime versions and any semantic/source/tool tampering are rejected. The negative suite exercises those distinctions, including an environment-only 3.11.2-to-3.12.12 comparison and combined environment/source changes. This permits a documented interpreter difference; it does not discard proof or tool identity.
