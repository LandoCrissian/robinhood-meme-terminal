# Task 086 collection-policy security delta

**BLOCKED_NO_BROADCAST. All 23 Seaport V2 High observations remain unresolved.** This package prioritizes the existing warnings for the Task 086 native-ETH/ERC721 collection path; it neither changes their severity nor supplies a fresh static-analysis clearance or independent audit.

The exact base is `91e7c1914d2fd87287b3b4b0f243c982c1faf36f`. The original four-source production compiler input remains `3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5` (solc 0.8.26, Cancun, viaIR, optimizer 200). No production Solidity is modified. The retained Task 084 baseline ran all 101 detectors and reported 48 observations, including 23 Highs, with strict exit 1. Its original IDs, source locations/hashes, external calls, balance baselines, postconditions and dispositions are copied without alteration into [priority-delta.json](priority-delta.json); [review.test.mjs](review.test.mjs) checks their correspondence.

## Priority matrix

| Task 086 review priority | Retained Highs | Boundary and remaining assumption |
| --- | ---: | --- |
| `P1_NATIVE_ERC721_PURCHASE` | 4 | Exact native consideration, pinned genuine Seaport fulfillment, seller debit and vault custody. Mutable collection policy can still change during fulfillment. |
| `P1_NATIVE_NOTICE_ACCOUNTING` | 2 | Vault debit and fixed recipient credit for a noticed native payout; exact-delta and atomic rollback checks remain necessary. |
| `P1_ERC721_EXIT_LIVENESS` | 2 | Vault/recipient ERC721 custody across safe delivery. Admission must address mutable issuer/validator control; successful acquisition does not guarantee future withdrawal. |
| `P2_OTHER_REACHABLE_VAULT_PATH_STILL_UNRESOLVED` | 15 | ERC20 funding, approval/revocation, ERC20 purchases and ERC20/ERC1155 withdrawals remain reachable in the generic vault and retain their original holds. |

Every exact ID and its specific call/baseline remains in the machine-readable matrix. This prioritization does not exclude the other paths or admit a payment asset. Keep separate the acquisition V1 22, core/dependencies 22, Treasury V1 six, active Reclaim V2 seven and rejected historical Reclaim V1 four High observations.

## New adversarial tests

[Task086CollectionPolicy.t.sol](../../../../packages/contracts/seaport-acquisition/test/Task086CollectionPolicy.t.sol) adds three tests over genuine Seaport and an explicitly synthetic, honest-balance ERC721 with mutable external transfer policy:

1. Missing direct seller approval and an approved-but-vetoed transfer produce distinct direct errors. Both failed Seaport purchases atomically preserve seller/vault custody, balances, spend accounting, unconsumed order and reservation state. Removing the veto permits retry of the same order with exact seller/fee/royalty payouts.
2. An issuer policy changed after purchase can block the noticed withdrawal while NFT and validator runtime hashes remain identical. Failure preserves held custody, the pending notice and reservation; cancellation releases only the reservation.
3. A legitimate fee recipient controlled by the synthetic issuer changes policy during the native consideration callback. The purchase has exact custody and all native payment/accounting deltas, yet the resulting held NFT cannot exit under that policy. Its failed noticed withdrawal rolls back atomically.

This confirms a collection-admission and exit-liveness limitation under the stated synthetic authority, **not a demonstrated protocol reserve-extraction defect** and not evidence that the real candidate collection has this behavior. No production-contract correction is claimed. The production collection catalog remains empty and unapproved. Offchain runtime/owner/policy fingerprints describe an observation; they do not add an onchain guard or guarantee future withdrawal when storage, external validators or issuer authority can change without a runtime change.

## Executed validation

The retained [original local Foundry log](local-foundry.log.gz) and [local-foundry.json](local-foundry.json) record the actual full-suite result, exact command, tool/compiler identities, source hashes and fixture provenance. Gzip preserves the original Windows CRLF bytes and recorded raw hash across Git checkouts; the uncompressed evidence was scanned with unchanged Gitleaks8.30.1 (zero findings) before archival. Inspect status and exit code; named tests in the matrix alone are not passes. The suite uses local synthetic actors and genuine Seaport bytecode from the existing verified fixture, with no real seller signature, upstream broadcast, production funding or production-chain execution.

The actual Windows run completed with **57 passed, zero failed, zero skipped across seven suites**, including all three Task 086 tests, two 512-run fuzz tests and the 128-run invariant (4,096 handler calls, zero reverts). Forge 1.7.1 used checksum-verified solc `0.8.26+commit.8a97fa7a.Windows.msvc`; the one-thread four-file compile took 131.30 seconds. Four existing relative-import source-display diagnostics appeared after successful compilation, and optional invariant-selector queries emitted warnings. Both remain in the raw log; the configured handler and all tests executed successfully with exit zero.

The review check is `node --test docs/evidence/rmt-task086/security/review.test.mjs`; **all three checks actually passed**. It verifies all 23 original identities and holds, priority counts, separate scopes, the full-suite log hash, test source, all four unchanged production-source hashes, retained compiler input and compiler binding. A passing evidence-integrity check does not clear the failed strict static gate. Production purchasing, current-order/collection/payment admission and release authorization remain blocked.
