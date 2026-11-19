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

Verified implementation commit: **`14440d3bb06fe309e4d281f83c34308ac09c834a`**. [The completed Linux run](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44451612234) passed both Chromium and WebKit against actual isolated **PostgreSQL 18.6 / UTF8**, Anvil 1.7.1 and synthetic chain31337. Actions checked out merge `f93a037a66c8bb2f9ba469dac9ccb028acec199f`; its tree `2e461a2bf224376e5e20e8f5a3381e330fa27504` exactly equals the PR head tree. Raw identity is preserved, not relabeled. [Machine-readable acceptance](evidence/rmt-task079/browser-acceptance-manifest.json) binds the source, compiler, artifacts and all17 CI results. The final evidence-only commit has its own checks on PR#673.

Each engine exercised all four retirement profiles through the existing website, EOA/pinned EIP-7702 and a genuine SafeL2 1.4.1 2-of-3 account. Nine observed retirement transactions include one deliberately orphaned Safe transaction: final SQL contains **eight canonical acceptances,16 NFT units,86 synthetic RMT**,45 canonical campaign events and two campaigns. It does not count orphaned activity as paid rewards. Eleven observed Safe outer executions reduce to ten canonical executions after rollback. The Safe evidence includes two actual test-owner typed signatures, exact inner call, CALL-only outer calldata, gas-payer nonce, maximum network fee, ExecutionSuccess and unchanged owners/threshold. One-owner and rejected-wallet attempts did not execute.

Application/indexer restart retained22 existing main-campaign events. Duplicate replay did not create duplicates; reorg removed orphaned rows and restored NFT, supply and reserve state. Missing receipt and interrupted reads stayed pending/unavailable without another signature or transaction. A discovered manual-hash poisoning defect was fixed: direct and Safe tests enter a real unrelated hash, prove it remains unbound, then reconcile the one original transaction by its preserved request identity. No journal is deleted and no automatic resubmission occurs.

The public build passed desktop/portrait/landscape checks in both engines,111 existing blocked route/method combinations per engine, and11 Reclaim action denials including the obsolete return actions. Wallet, external and financial requests were zero. No live token, campaign, reserve or USD price was assigned. Physical iPhone, wallet-extension and production-chain acceptance are **not established** by these browser fixtures.

All12 functional CI checks passed at the recorded implementation head; **five strict security checks failed**: core full-tree, fixed-supply4663, TreasuryV1, historical ReclaimV1 and permanent ReclaimV2. These are unresolved release holds, not waived tests. Both complete older browser lifecycle/profile/treasury regression groups, Firebase emulators, repository/dependency checks, indexer, core Foundry, Operations Safe, Linux build and Railway image checks passed. Existing source/data and production configuration were not changed.

The archived [viewport screenshots and receipt/SQL inputs](evidence/rmt-task079/README.md) show permanent consent, actual retirement mode/destination, exact reward and network-cost review before wallet confirmation. They are ordinary viewport captures preserving touch/coarse emulation, not cropped element screenshots or physical-device evidence. Costs are synthetic local gas estimates, **not4663 production quotes**. Default Safe signatures have no general contract-level expiry; an expired app review does not revoke a still-unused Safe nonce. Native Reclaim redemption separately enforces its contract deadline.

Settlement evidence remains deliberately bounded: exact single-transaction-per-block local attribution, finite log/receipt windows, canonical receipts and local confirmations. No multi-transaction block balance proof, production trace/archive readiness, independent L1 finality or real collection admission is claimed. Unsupported or unavailable evidence fails closed. The initial Windows ENOSPC run and subsequent nonce/revert-transport failures are retained under [failed-before](evidence/rmt-task079/failed-before/); the passing Linux evidence does not rewrite them.

Reproduce with the pinned tools from the workflow:

```sh
pnpm install --frozen-lockfile
pnpm --filter @rmt/launch-website build
pnpm --filter indexer build
forge test --root packages/contracts/reclaim-v2 --use /path/to/solc-0.8.26 -vvv
node scripts/visual-qa/rmt-creator-integration.mjs --reclaim-only \
  --anvil /path/to/anvil-1.7.1 --solc /path/to/solc-0.8.26 \
  --pg-bin /path/to/postgresql-18.6/bin --browser chromium --output /tmp/rmt-reclaim
# Repeat the same command with --browser webkit and a distinct output directory.
pnpm test:release-evidence
```

Use isolated loopback databases/assets only. The workflow also runs the existing creator lifecycle, claims/profile and treasury regressions separately. No hosted deployment, production schema change, wallet signing or activation is part of these commands.

Final local archive verification: **131/131 release-evidence tests passed**, zero failures/skips, including nine new browser/public acceptance cases and the complete tracked-artifact inventory. Deliberate mutations of NFT destination, SQL reward and Safe signature are rejected. The raw selected artifacts were secret-scanned before compression; retained public address/hash findings are individually classified rather than hidden by archiving.

## Consolidated release decisions

No new owner input is required to review this isolated implementation. Before any separate live release, approve the actual future RMT token/runtime, a source-reviewed irreversible collection/ID policy, exact fixed-token rewards and caps, campaign controller and manually funded reserve. Real collection admissions are currently empty. Resolve applicable material security observations and establish production receipt/trace/indexing/finality plus physical-wallet acceptance. Deployment and activation require separate authorization. Do not fund a campaign or infer a USD reward from the illustrative budget sheet.
