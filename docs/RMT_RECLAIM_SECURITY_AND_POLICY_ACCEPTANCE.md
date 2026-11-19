# RMT Reclaim V2 security and policy acceptance

**Permanent surrender only. BLOCKED_NO_BROADCAST.** [Task079 owner correction](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/672#issuecomment-6996801185) supersedes every earlier reversible-escrow/repayment statement. Task078 V1 and its four high findings are rejected historical evidence, not approved product behavior.

The active immutable V2 candidate burns an admitted NFT through its reviewed native burn method, or transfers it to the exact non-executing contract sink only where the collection's source semantics establish permanent non-recoverability. An unknown collection is unsupported. Retirement and exact funded RMT payment are atomic: failure restores both assets and all accounting. There is no NFT return, claimant buyback, repayment, rescue or admin withdrawal.

## Source and security acceptance

- Implementation source commit: `2b4985ff`; six-source compiler closure SHA-256 **`fece6e205ff52f8369c732cbddaa663a0d19530062b7539dc4b4467099a08cdc`**. Solc 0.8.26, Cancun, viaIR, 200 runs, existing pinned metadata/dependencies.
- All 53 existing tracked Solidity files remain byte-for-byte unchanged. Supply 1B, allocation 600M/400M, 90/5/5 fees, existing token/curve/LP custody, treasury and governance are preserved.
- Actual contract verification: **37 Foundry tests passed**, including two 512-run fuzz tests and one 4,096-call stateful invariant. No failures/skips. [Raw test evidence](evidence/rmt-task079/security/foundry-final.txt).
- Six compiler-AST, ABI, source-preservation and raw-report integrity checks passed: `node --test scripts/reclaim-v2/security-boundaries.test.mjs`. They assert the absence of NFT return/repayment/rescue selectors, the sink's pure receiver-only authority and constructor-only collection profiles; they do not establish universal exploit absence.
- Fresh complete-closure Slither 0.11.5/Crytic 0.3.11, all 101 detectors: initial V2 **44 findings/8 high**; current V2 **45 findings/7 high**. Current severities:7 high, 1 medium, 29 low, 7 informational, 1 optimization. The gate **fails**. Typed standard-token checks and separately visible burn/sink settlement retain every exact balance assertion; none is suppressed.
- Original V1 four highs, 22 core/dependency highs and 6 Treasury V1 highs remain unresolved and separate. No independent audit or security clearance is claimed. [Individual findings, assumptions, scope gaps and before/after reports](RMT_RECLAIM_V2_SECURITY.md); [machine-readable disposition](evidence/rmt-task079/security/disposition.json).

## Actual-burn versus irreversible-sink matrix

| Profile | Executed local fixture | Required irreversible evidence | Production status |
| --- | --- | --- | --- |
| ERC-721 native burn | `ReclaimBurn721Fixture` | Owner/approved campaign authority; Transfer to zero; ownerOf reverts; exists=false; exact actor balance and supply decrease; immutable mint-once ID/no restore, seizure or upgrade. | **No real collection approved.** Collections lacking reviewed supply/existence or non-remint evidence reject. |
| ERC-1155 native burn | `ReclaimBurn1155Fixture` | Actor/operator authority; exact quantity removed from actor and supply(id); TransferSingle/Batch to zero; no remint or issuer restoration. | **No real collection approved.** Unknown operator/admin/supply semantics reject. |
| ERC-721 immutable sink | `ReclaimSink721Fixture` + exact `RMTReclaimSinkV2` | Exact actor-to-sink ownership/balance transfer; supply unchanged; sink has no executing escape path; NFT source cannot seize, recover, upgrade or approve on sink's behalf. | **No real collection approved.** A common dead address or source hash alone is insufficient. Not labeled a burn. |
| ERC-1155 immutable sink | `ReclaimSink1155Fixture` + exact sink | Exact actor/sink quantities, unchanged supply(id), safe receiver callback, no issuer/operator override or recovery; immutable sink code. | **No real collection approved.** Unknown powers reject. Not labeled a burn. |
| Proxy, privileged recovery/remint, fake burn, unsupported callback/supply | Counterfactual negative fixtures | No unsupported mechanism may issue a reward; failed retirement/payment leaves NFT with owner. | **Unsupported.** No fallback to escrow or assumed burn address. |

Profiles are committed once in the factory constructor by runtime/standard/mode/policy hash. Campaign controllers may notice finite ID/quantity admission only within those profiles. They cannot install an arbitrary runtime, reward token, sink or later upgrade. New reviewed collection implementations require a new factory version, never migration of retired NFTs.

## Size, custody and replacement

V2 factory runtime is 2,132 bytes, with 22,444 bytes EIP-170 headroom. Four-profile encoded initcode is 32,538 bytes, below 49,152. Campaign runtime 22,077 bytes; encoded initcode 23,932 bytes. Two immutable STOP-prefixed data parts are 11,839 bytes each, validated against the complete creation-code hash. These are not arbitrary call or upgrade modules. [Exact sizes and hashes](evidence/rmt-task079/security/compiler-manifest.json).

The previous 567-byte factory headroom is historical V1 evidence; it is not carried onto changed V2 bytecode. Failed retirement or payment rolls back; an accepted canonical retirement is intentionally irreversible under the admitted collection/sink semantics. Chain reorg/finality is a separate evidence issue. Existing LP principal remains permanently locked and unrelated to Reclaim rewards.

## Economics and owner decisions

The initial $20 reserve and $0.05 reward, possibly later $0.50, are nominal intentions, not actual balances or an RMT/USD price. No live RMT token or NFT allowlist is inferred. Local fixtures use explicitly labeled integer token-unit assumptions. Live USD quoting is blocked; a fixed-unit campaign requires explicit owner approval of actual token identity, units, manually funded amount, controller, finite eligibility/caps and irreversible-loss policy. No creator earnings, royalties, project treasury, Operations/Reserve or LP principal are automatically diverted. Gas is paid separately by the transaction signer; no return/refund of the surrendered NFT is promised.

Required before release: disposition material security observations; actual independently reviewed collection/source/runtime policies; accepted RMT identity and fixed-unit/pricing policy; manual funding authorization; production settlement/indexing/finality and supported wallet evidence; separate deployment and activation approvals. No paid service, mainnet signature/broadcast, production DDL/configuration or token issuance is authorized by this candidate.

## Integrated acceptance

Browser/Safe outer execution, PostgreSQL restart/reorg, public-build negative tests and exact-head CI are **pending actual parent-harness results** at the time of this contract handoff. The parent task will append verified receipts, hashes, screenshots, costs, supported/unsupported wallet scope and remaining operational limits. The 37 contract tests do not substitute for those results.
