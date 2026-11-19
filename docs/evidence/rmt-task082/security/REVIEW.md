# Task 082 NFT acquisition review

**BLOCKED_NO_BROADCAST. Internal review, not an independent audit.**

The baseline is PR #675, `4892d2af5ac09ae00975c2b799b66bec0d172779`. Every original high ID is retained in [the 23-row machine register](findings.json), including its original function, source lines, external call, balance snapshot, preconditions, possible callback path, state transitions, applicable adversarial tests and unresolved assumptions. Original Task 081 reports are unchanged.

## Narrow source hardening

`SyntheticNftListingVenueV1._pay` previously took a private `from` argument. Its sole caller passed `order.vault`, and `fill` already required `msg.sender == order.vault`. The baseline therefore did not expose a reachable third-party payer selection under that path. The revised helper derives the payer directly from `msg.sender` and removes the redundant private argument. This narrows a capability that a later callsite could otherwise misuse; it is not a demonstrated baseline loss exploit.

The actual unfiltered 101-detector Windows run reports **47 observations: 22 High, one Medium, 15 Low and nine Informational**, strict exit **1**. The arbitrary-send-ERC20 row is absent after hardening. Twenty original high IDs are identical; the two venue balance rows have new IDs because their private function signature/source lines changed. Those two are mapped explicitly, not counted as eliminated. All 21 balance observations and the fixed-venue native call observation remain uncleared.

Only the synthetic venue's production source changed. Its runtime is **4,639 bytes** (previously 4,688), and creation template is 4,896 bytes (previously 4,945). The Vault and Factory bytecode templates are identical to Task 081: Vault runtime 21,935 bytes / encoded initcode 26,024; Factory runtime 2,310 / encoded initcode 31,832. The ABI, signed order, exact payout/custody assertions, fees, budgets and authorization policy are unchanged. This is a separately identified predeployment source revision; no existing contract or original record is rewritten.

Exact after input SHA-256: `147be8aec26e3d2577b8b2812f2d779d3fc6b39024fd05b7c40397ffddefe6e1`.

## Why the balance snapshots remain

The flagged variables intentionally describe assets **before** a guarded external settlement. The subsequent comparisons require exact debit, credit and ownership changes. Removing those baselines or substituting an event/callback flag would weaken settlement. Solidity interface `balanceOf`, `ownerOf`, `allowance`, order-state and identity queries are `view`; the compiler's AST identifies these static-call boundaries. They cannot mutate RMT storage through a callback under EVM static context.

All 13 mutable financial/policy/notice entry points on the Vault use `guarded`. The guard checks `entered` before dependency reads, sets it before external effects and clears it only on successful completion. Venue fill/cancel/counter mutation has its separate lock. The receive hooks are intentionally not general financial entry points: they accept only the active expected collection/operator/seller/ID/quantity, once, during an in-progress purchase. A receive hook alone is insufficient: actual NFT seller/vault balances, ownerOf, currency debit, order state and code hashes must also match.

Withdrawal execution is permissionless only after the controller's exact recipient/asset/quantity/epoch notice matures. Notice consumption and reservation updates occur under the guard; callback failure or mismatched final delivery reverses the entire transaction. Expired or invalidated notices may be cleared without redirecting their assets. Controller rotation disables purchasing and invalidates old-epoch notices without resetting lifetime or period spend.

## Standing purchase authority

The contract's `purchase` is **permissionlessly triggerable** under the creator's enabled standing policy and a valid seller order. The present dashboard prepares transactions only for its reviewed controller profile; that UI restriction is not the on-chain authorization model. A cap is spending authority, not a guarantee of fair NFT valuation. Any holder of a valid permitted listing may trigger a fill within the standing caps. An already pending purchase loses its eligibility when a prior mined disable changes `policyEpoch`; an unmined disable is not protection against transaction ordering. No background keeper is activated by this candidate.

## Added local adversarial cases

The new `NftAcquisitionSecurityReview.t.sol` adds 11 tests to the existing 30-test scope:

- Native royalty callback attempts an otherwise mature second asset withdrawal; the active guard rejects it, preserving the second notice for later execution.
- Royalty callback attempts venue counter mutation; the venue lock rejects it.
- A native recipient forwards its payment; exact endpoint settlement rejects and rolls back all prior payouts and delivery.
- Native withdrawal callback attempts another mature notice; it cannot consume that notice or its reservation.
- ERC-721 and ERC-1155 recipients immediately forward a noticed transfer; exact final custody fails and restores ownership, inventory, notice and reservation.
- ERC-20 `transferFrom`, `approve` and `transfer` attempt vault mutation during funding, purchase approval and withdrawal; the guard rejects their callbacks while exact successful settlement remains possible.
- A test-only pinned route claims filled status without delivery, or interrupts after changing order state; it cannot invent custody or retain funds on rollback.
- A hostile route pulls `allIn + 1`; exact finite allowance prevents it and the outer transaction restores allowance/accounting.
- A permissionless trigger cannot fill after a mined disable; re-enabling under a fresh epoch deliberately restores only standing-policy authority.

Pinned solc 0.8.26 ABI/AST typechecking passed for all nine source/test files, zero errors or warnings. That is **not EVM execution**. Linux Foundry/Anvil/browser results must be recorded separately; the local report does not predeclare the 41 tests passed.

Subsequent actual Linux execution at `597f708cf6b3c7f729e8c786418ea05e89153b05` passed **41 tests, zero failures/skips**, including the existing 256-case fuzz tests and stateful invariant. The fresh Linux full-closure scan again reported **101 detectors / 47 observations / 22 High**, strict exit **1**, with the same high IDs as Windows. [Actual job](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/44557203180/job/135676370562) · [Retained raw Linux report and integrity checks](../acceptance/). This later execution evidence does not rewrite the original local-only boundary or clear any remaining finding.

## Residual assumptions and release holds

No reachable asset-loss path was confirmed in the reviewed baseline under its pinned local dependencies. This is an internal assessment with finite coverage, not a proof of absence. Runtime hashing establishes identity, not semantics. A deliberately malicious admitted venue can lie about consideration; a malicious NFT/token can lie about its own balances. A proxy runtime alone does not bind its implementation or admin policy. Actual source, implementation and supported behavior therefore remain independent admission requirements for any new route or collection.

Exact native balances deliberately reject receivers that forward/spend during the callback; exact NFT custody deliberately rejects immediate forwarding recipients. These are recipient/liveness limitations. They do not authorize removal of the checks or a rescue sweep. Forced unaccounted gifts may remain stranded and confer no withdrawal entitlement.

The existing immutable Treasury V1 beneficiary credits, 90/5/5 entitlements, fixed 1B token supply, 600M/400M allocation and locked original LP principal are untouched. NFT capital is separately and deliberately funded from settled assets. Safe admission still requires the pinned 1.4.1 profile, three distinct EOA owners and two approvals; EIP-7702 admission still requires its exact delegate/runtime pin. No generic arbitrary-call, proxy upgrade, blanket marketplace approval, fallback signer, RMT custody or new withdrawal authority was added.

The synthetic venue and Vault remain hard-disabled on 4663. Source correspondence and exact order acceptance for Seaport are separate work; this review does not authorize a Seaport execution candidate. Existing 22 core/dependency, six Treasury V1, seven active Reclaim V2 and four historical Reclaim V1 highs remain separate. Original high-severity and history-scanner failures remain visible. No independent review, funded transaction, production service or production configuration change occurred.
