# Task 084 exact Seaport V2 security disposition

**BLOCKED_NO_BROADCAST. All23 High observations remain in the unchanged strict gate. No independent clearance is claimed.**

The reviewed production closure is unchanged from Task083: solc0.8.26/Cancun/viaIR/optimizer200, input SHA256 `3fbc55312a027e5f69b16fb927c8549efcc6674bab509c792efdc0104083c5f5`. Its complete original report, source/AST offsets and preliminary/finalID mapping remain in [Task083](../../rmt-task083/security/REVIEW.md). No production Solidity modification was justified merely to hide an intentional settlement baseline. New code consists of targeted synthetic adversarial tests and a strict reproducible per-ID review generator.

## Dispositions

No reachable loss is confirmed by this internal pinned-path assessment. This does not prove absence of a vulnerability. The22 balance observations are assessed as guarded exact-delta warnings **conditional on independently admitted token/NFT semantics**. The native-value observation is assessed as a pinned typed-destination warning **conditional on exact Seaport source/runtime admission**. These are internal dispositions, not detector suppression, severity changes, professional audit results or release approvals.

| Exact retained ID | Function | Specific boundary |
| --- | --- | --- |
| `07edf44350c3a0a755311989d6727e216eebdcd21e0cc57c0c1ca6eb56c62c13` | `purchase` | Pinned typed Seaport native-value fulfillment; High remains retained |
| `0a8d5bd7b8b1179e8a5b55f7208076608f010a23869e57e098276ff773123f5a` | `purchase` | Vault NFT holding baseline across exact ERC20 allowance grant; High remains retained |
| `0bb5cbecacf0c8cd75bb89b49c84ffe38d1a1cee034d3dd7b36d33dabf1a68e8` | `purchase` | Vault currency baseline across allowance revocation; High remains retained |
| `2f19f97eed8645e44876353ac526fbb66051da3ecdff43669bab67678fdf7a72` | `purchase` | Vault currency baseline across native fulfillment; High remains retained |
| `447916a95ca1582a4afbdcc69cf9ffe0f5c7f49ac5df8e26678a4b43d0fabf6b` | `purchase` | Seller NFT baseline across allowance grant; High remains retained |
| `529f3c73bab84c7bcad4348d925bb1a29f91c8ccba772f514bb9a03a216c6676` | `executeWithdrawal` | ERC1155 recipient baseline across safe delivery; High remains retained |
| `567283d05be34a1eaf02dbf9bb9297e91ac7a3a6472db3cd7a18701cc20031c7` | `purchase` | Seller NFT baseline across ERC20 fulfillment; High remains retained |
| `65f195c414f077bd63b1b21ee0a04066c189418e6cee0adfe34e89c2ae2c2d74` | `purchase` | Vault currency baseline across ERC20 fulfillment; High remains retained |
| `671c9e8b540f0c16a4c2e8de7c1544160a2b849c600e1001a7c9529ecf365f5d` | `executeWithdrawal` | Native recipient baseline across noticed payout; High remains retained |
| `757ad417fbdec03c1e419667790676a75c22e940d85e039f05e79788681f5edf` | `executeWithdrawal` | ERC721 recipient baseline across safe delivery; High remains retained |
| `7bcfc8baa28b11ff913b716fbced190220e44a8330f389db5dfcaae52f0c0769` | `purchase` | Seller NFT baseline across allowance revocation; High remains retained |
| `7d8c21dc22137cca504fb5eb0bfa8fbd9cf5def18e39d075c876125f4a7a0045` | `executeWithdrawal` | Vault ERC20 baseline across noticed payout; High remains retained |
| `86d7656b4478624eec044185a3ff2e43ece547c0290cffe7ba899ded6e149d40` | `executeWithdrawal` | Vault ERC721 baseline across safe delivery; High remains retained |
| `9a342596553439e237a6c9706aa8241e472bb5e456c736f7636048cb5b37275a` | `fundToken` | Controller ERC20 baseline across funding transferFrom; High remains retained |
| `b515ec8226d3e35dfe3804eff46ac886aebc6a5bfd08dcba556751f201a09ed9` | `fundToken` | Vault ERC20 baseline across funding transferFrom; High remains retained |
| `bc6d9865997a46c59149abada13091be3040a22783758d76dbe3e99b6373e922` | `purchase` | Vault NFT baseline across ERC20 fulfillment; High remains retained |
| `cb39a1da1ad0227dc00f783816a25128b87b07c3a7357fa3866dbdcc35512526` | `executeWithdrawal` | ERC20 recipient baseline across noticed payout; High remains retained |
| `d65a6b82d27ae20e38c3e892b8dfe4eb2b59f1f34fc7264f706534f6d3f5dcc4` | `purchase` | Vault NFT baseline across native fulfillment; High remains retained |
| `de741e2523a760c9315914acd83c92b7c64f156c7fbb6418861b260060e54a80` | `executeWithdrawal` | Vault ERC1155 baseline across safe delivery; High remains retained |
| `e249d693ca7023323b7289ab68422f6d58fbe28e88266aafd062be53977cb809` | `purchase` | Vault NFT baseline across allowance revocation; High remains retained |
| `e467b3a4d48d713a50cd4666703ec284e4512bc8d7eef3754bf821b8a3e78b6d` | `purchase` | Seller NFT baseline across native fulfillment; High remains retained |
| `e84f44ab0fd51302a53370633ae6e01e0f8a283175d70fcd26b2381d587e1f31` | `purchase` | Vault currency baseline across allowance grant; High remains retained |
| `f24427c15372dd25ad827d1a832ab0630c893c42d5c9aa18cacce416c826ef43` | `executeWithdrawal` | Vault native baseline across noticed payout; High remains retained |

The generator attaches each exact raw external call, baseline/postcondition, source byte range/lines/SHA, original AST mappings, assets at risk, exploit preconditions, guard/CEI, applicable legacy/new tests and residual assumptions. It rejects changed IDs, descriptions, AST offsets, compiler inputs, severity, missing detectors, unexpected production roots or source changes. Only the temporary analyzer workspace prefix in `filename_relative` is normalized for cross-platform correspondence; reported original paths remain intact. The exact101 detectors/four sources/48 observations/23Highs/strict1 must still be reported. Prior acquisitionV1 22, core/dependencies22, TreasuryV1 six, active ReclaimV2 seven and rejected historical ReclaimV1 four remain separate.

## Assets and trust boundaries

- Funding can credit only deliberate current-controller capital in the constructor-bound payment token; exact payer debit and vault credit remain mandatory. Purchase spends only this vault's funded, unreserved consideration under its ON policy, exact order and caps. Withdrawals spend only the precise current-epoch reservation after notice, to its fixed recipient. No entry calls the core fee ledger, changes beneficiary credits or transfers the original locked LP.
- All14 mutable funding/policy/purchase/notice/controller entries are guarded. Dependency/preflight reads are STATICCALL and cannot mutate state; the lock is active before any mutable external effect. The ERC1155 callback exception only marks one exact expected receipt; its sender/operator/seller/ID/quantity and final balances remain mandatory. Genuine ERC721 uses transferFrom without a callback and still requires exact balances/owner.
- Malicious payment/NFT contracts can lie about their own state. A matching proxy runtime alone cannot establish implementation/admin immutability; source/payment admission must reject unknown upgrade semantics. A controller deliberately admitting a dishonest asset is outside an honest-asset proof, not a reason to delete its checks. Hostile forwarding recipients are a disclosed liveness restriction: exact endpoint failure reverts everything rather than accepting incomplete custody/payment.
- Safe-owner rotation is external-wallet authority and does not itself change the vault's controllerEpoch. Exact owner set, threshold, nonce, implementation/handler and no modules/guard must be bound by the dashboard and receipts; unknown/same-block changes remain unsupported or pending.

## Adversarial execution evidence

`SeaportTask084Security.t.sol` adds six tests over genuine Seaport: all five public guarded routes are probed during token funding, approval, consideration transfers, revocation, native payouts and ERC721/ERC1155 withdrawal callbacks. Every attempted nested mutation must return the exact ReentrantCall selector, while custody, reservations, budget, every payee and allowance are independently asserted. A genuine Safe2-of-3 callback attempts an already signed disable while a purchase holds the lock: zero safeTxGas/baseGas/gasPrice and zero refund fields force GS013, preserving the Safe nonce. The same authorization must subsequently work outside the lock. This is not a hypothetical mock-Safe permission check.

Actual Linux execution is now retained in [the run manifest](run-44614908977/manifest.json), [original job metadata](run-44614908977/strict-job.json), [losslessly compressed original job log](run-44614908977/strict-job.log.gz), and [the generated 23-ID matrix](run-44614908977/dispositions.json).

- Source `908f2a3a0359cafc13e5746ec1c80f838fb5fe0b`, GitHub Actions [run 44614908977 / job 135880860812](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44614908977/job/135880860812): Foundry 1.7.1, checksum-verified native Linux solc `0.8.26+commit.8a97fa7a`; **54 tests passed, zero failed, zero skipped**, across six suites. All six new callback/GS013 tests actually executed. This confirms their tested behavior, not absence of all vulnerabilities.
- The generator and its **six integrity/tamper tests passed** after the unchanged strict analysis step failed. That step ran Slither 0.11.5 / Crytic Compile 0.3.11 with **101 detectors, 48 observations, 23 Highs, strict exit 1**. All 23 remain unresolved release holds; zero Highs were cleared. Original raw analyzer bytes, compiler closure and offsets remain retained. Passing generator tests validate correspondence, not security clearance.
- The same 54 Foundry tests and six review tests also passed at earlier source `dbbfc9960ec81c642026381e157ed1b2833f3aff`, [run 44611722472 / job 135869795658](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44611722472/job/135869795658). The unchanged compiler-input identity binds both runs; retained original evidence here is from the later 908f2a3 run.
- Four existing source-display diagnostics about relative `../../nft-acquisition/...` paths appeared after compilation; compilation and all 54 tests completed successfully. These are not suppressed or represented as failed tests. Fork/browser and other scope results belong to the consolidated acceptance package and are not inferred from this strict job.

The original generated matrix intentionally leaves `executionEvidence` null and warns that named tests are not predeclared passes. Its original bytes are preserved; this separate manifest and actual job log supply the observed execution results. No local build, disk cleanup, owner signature, production transaction or production source change was performed.

## Reproduce

```sh
node --test docs/evidence/rmt-task084/security/review.test.mjs
node docs/evidence/rmt-task084/security/build-dispositions.mjs --report <fresh-all101-slither.json> --output <fresh-isolated-output-directory>
forge test --root packages/contracts/seaport-acquisition --use <checksum-verified-solc0.8.26> -vvv
```

The review generator's successful integrity result does not turn the strict Slither result green. Keep the actual failed analysis step and raw report visible. Without a supplied fresh report it explicitly labels its input RETAINED_BASELINE_NOT_FRESH_ANALYSIS. Do not infer production approval, actual owner signatures, asset funding, Safe deployment, an external audit or mainnet activity from these synthetic checks.
