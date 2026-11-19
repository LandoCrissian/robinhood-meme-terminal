# Reclaim V1 security boundary

**Local development only. BLOCKED_NO_BROADCAST.** This internal assessment is not an independent audit. It does not clear the existing 22 core/dependency highs, six V1 treasury highs, or any earlier release gate. No approved core/treasury source, economics, production NFT royalty setting or deployment changed.

## Custody and authority matrix

| Asset/action | Implemented authority and evidence | Limitation |
| --- | --- | --- |
| Reward funding | Campaign controller explicitly approves and transfers the fixed, runtime-pinned 18-decimal token. Exact sender/vault deltas are required. | No mint, automatic top-up, protocol fee pull, native/USD conversion or external treasury integration. |
| ERC-721 surrender | Actual claimant owns each ID; exact reviewed collection/runtime, finite Merkle eligibility and caps; expected safe-receiver callback and final owner must match. | Admission is not proof that arbitrary collection behavior is trustworthy. |
| ERC-1155 surrender | Bounded, sorted unique IDs; quantities and lifetime maxima; exact sender/vault balance changes and batch callback context. | A unit earns one fixed-unit reward; a token ID is not an unlimited quantity entitlement. |
| Accepted NFT | Per-campaign escrow with immutable claimant, asset, IDs, quantities, original reward and runtime evidence. | **Not a burn, sink, permanent retirement proof or marketplace.** |
| NFT return | Only original claimant repays the exact original reward, then receives their own complete receipt's NFTs. Atomic failure restores tokens, NFT custody and receipt state. | Eligibility/quantity and lifetime caps stay consumed. No reward recycling within the campaign. Return needs the original reward tokens and functioning NFT contract. |
| Owner closeout | Two-day notice, bounded execution window/current controller epoch, closed campaign, exact uncommitted reward amount to the same controller. | No accepted-NFT withdrawal, arbitrary call, alternate payee, hidden rescue or unpaid reward liability. |
| Controller replacement | Current controller proposes; incoming controller accepts after actual notice. New epoch invalidates old notices and pauses redemptions. | Lost EOA key or Safe quorum has no RMT/deployer bypass. External wallet configuration remains its owners' authority. |

ERC-165/runtime checks cannot universally detect proxy implementation changes, NFT issuer seizure/burn/blacklist powers, counterfeit minting or lying interfaces. Production collection admission must establish the actual asset/standard/administration history and exact finite eligible IDs/quantities. A malicious collection admitted by its controller can misrepresent its own state; do not advertise generic NFT safety or scarcity detection. Codehash binding also cannot protect against an unchanged proxy's mutable implementation. The local positive fixtures have no upgrade/configuration entry point; hostile variants are explicitly separate counterfactual tests.

Only expected safe receipts are accepted: collection, operator, claimant, standard, exact ID/quantity set and receipt data must match the active transfer. Unsolicited safe receipts reject. Unsafe ERC-721 transfer, foreign ERC-20 or forced ETH transfer cannot always be prevented and has **no general rescue path**; such assets may be stranded and never generate a reward or claimant receipt. Disabling eligibility, changing a root, pausing or closing does not alter the original return record. A changed/hostile NFT contract can still prevent a return externally; the campaign has no authority to repair that foreign contract.

## Reward and eligibility boundaries

V1 implements **fixed token units**, not a live USD oracle. `quoteUsd` always rejects, including stale/future purported price inputs. The illustrative local assumption 1 synthetic RMT = $0.01 gives a 2,000-token budget and five tokens per accepted NFT unit: 400 funded units model $20/$0.05. Neither that price nor token is a live RMT valuation. A future $0.50-equivalent reward requires a separately approved, funded schedule/conversion policy. Production has no assigned reward token, accepted campaign, funded reserve or live eligibility policy.

Each finite leaf is `keccak256(abi.encode(chainId, campaign, collection, runtimeHash, uint8 standard, tokenId, maximumLifetimeQuantity))`. Sorted-pair proofs have at most 32 siblings. Redemptions have at most eight sorted unique IDs and twenty total units. ERC-721 quantities/maxima are one. Wallet, per-wallet/collection, collection and token-ID limits are lifetime counters and do not reset on return. A wallet cap alone is not Sybil resistance; finite, owner-reviewed asset eligibility is essential. Another campaign's proof is invalid. Cross-campaign custody is not simultaneous: another campaign cannot accept an NFT still held here; a later return reimburses the original campaign first. V1 does not claim a global permanent-retirement registry.

No receipt exists without complete atomic NFT receipt and reward settlement. The accounting invariant is:

`funded + repaid + unsolicited = reserve + paid + recovered`.

`paid` is gross rewards issued; `repaid` is exact original rewards returned. No accepted NFT has an unpaid credit or IOU: `outstandingLiability` is zero. Actual reward-token balance can exceed accounted reserve after an unsolicited transfer, but cannot be below it; explicit reconciliation records the delta as unsolicited, not manual funding or protocol earnings. Gas is paid separately by the transaction sender, never from locked LP principal or Reclaim reward reserves.

A reviewed redemption binds current policy epoch, claimant nonce, exact reward and a maximum five-minute deadline. Rate/admission/pause/resume/controller/close changes invalidate old unsigned reviews; a transaction reverting after a policy change leaves NFT ownership and campaign counters unchanged. There is no retroactive change to a mined receipt. The external account's transaction nonce and canonical recovery remain additional client/indexer checks, not an on-chain exactly-once execution guarantee.

## Fresh static analysis: complete scope, no suppressions

The complete new production closure is the three files under `packages/contracts/reclaim/src/`, with no external Solidity imports. Compiler: checksum-pinned solc 0.8.26/Cancun/viaIR/200 optimizer runs/IPFS metadata. All 101 Slither 0.11.5 detectors ran through Crytic Compile 0.3.11, with no source-path filter, severity downgrade or detector exclusions.

| Revision | Input SHA-256 | Findings | High | Medium | Low | Info | Optimization | Strict result |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Initial | `a969c3e4b6331b458c4b5853be72144beb64a6e113faec2d7d64f060f16cccae` | 32 | 4 | 3 | 20 | 4 | 1 | FAILED |
| Current | `d3596a541f62f25e579e7f8186e017f678a297f454423a4fa9984c898e720471` | 28 | 4 | 1 | 18 | 4 | 1 | FAILED |

The source change applies checks/effects/interactions to manual funding and reward repayment: reserve/cumulative bookkeeping precedes the token pull, with complete rollback if it fails. Exact incoming/outgoing balances, runtime checks, guard and custody assertions are retained. This removes two medium and two low post-call-bookkeeping observations. It does **not** clear or hide the four high balance-check rows; their IDs remain identical before/after. All raw reports and both complete compiler inputs are retained in [the machine disposition](evidence/rmt-task078/security/disposition.json).

### Four unresolved high findings

| ID prefix / exact detector | Source/dataflow | Threat and tested boundary | Disposition |
| --- | --- | --- | --- |
| `11cb4e56` / `reentrancy-balance` | `_pull`, sender balance `b` at line 98; `transferFrom` through `rewardToken.call` at lines 99/108; exact sender debit assertion line 100. | Tax/extra sender debit, hostile callback or dishonest return could corrupt funding/repayment. The immutable admitted token has no callbacks/tax; all mutating paths are guarded. Hostile funding/repayment tests preserve allowance, balances and receipts by rollback. | Internally disputed under exact pins; **unresolved, gate failed**. |
| `2d21f375` / same | `_pull`, vault balance `a`; same call; exact recipient credit assertion line 100. | Short credit, malformed/false return or callback. Exact vault delta and guard prevent a funded reserve being advertised after an interrupted pull. | Same unresolved status. |
| `8d40ee02` / same | `_pay`, recipient balance `b` at line 103; `transfer` through `_call` at lines 104/108; exact recipient credit assertion line 105. | Recipient short credit or malicious reward token. Payout mismatch rolls back NFT custody, consumed eligibility, claimant nonce and gross-paid/reserve state. | Same unresolved status. |
| `acc31aef` / same | `_pay`, vault balance `a`; same call; exact vault debit assertion line 105. | Extra debit/drain or callback during reward/recovery. Exact delta, fixed token and guard remain mandatory; there is no variable token/callee/spender. | Same unresolved status. |

The hostile tests deliberately admit a **counterfactual mock runtime** so callback/return/delta failures are reachable. They are not an exploit of the actual fixed-supply Token V2. Constructor codehash/supply/decimals alone do not establish the live RMT identity; deployment and API admission must bind the separately accepted real token/runtime. A malicious approved token, changed future dependency or unsafe external composition requires fresh assessment. Passing these tests is finite internal evidence, not proof that each warning is harmless. Removing balance reads or hiding them in a library solely to quiet Slither would weaken the evidence and is rejected.

### Remaining medium and lower observations

The remaining medium `aa7c4992` concerns the receiver context around ERC-721 safe transfers in a bounded loop. This context intentionally permits exactly one expected callback, verifies collection/operator/from/id/data, checks final ownership and clears before the next ID. All other state-mutating entry points are guarded. Wrong/missing/repeated/cross-standard callbacks or wrong custody revert atomically. A malicious admitted collection remains a dependency risk; this observation is retained rather than waived.

All other findings are individually retained by ID/description in the machine report: twelve `calls-loop` lows (at most eight items; exact ownership/balance checks stay), one `reentrancy-benign` context-clear low, five intentional timestamp notice/deadline lows, one allowlisted-token low-level-call info, one ERC-165 explicit-inheritance info, two compiled creation-template literal infos, and one immutable-storage optimization. These do not justify removing notices, callbacks, interface checks or settlement assertions. Timestamp semantics rely on the chain's canonical block policy; L2 observations do not establish Ethereum L1 finality.

## Test and deployment limits

The new Foundry suite uses only synthetic assets on chain 31337. It covers 721/1155 receipt and return, fixed-unit quotes, no budget/no oracle, finite/cross-domain proofs, per-wallet/collection/token quantity caps, duplicate nonce/receipt, expired/stale review, notice cancellation/controller changes, overbudget atomicity, unsolicited assets, exact reward deltas, rejected NFT returns and hostile callbacks. Fuzzing runs 512 cases per fuzz test. A 128×32 stateful handler exercises funding, gifts, pause/resume, redemptions and returns, checking actual external balances, NFT ownership and the independent accounting equation. Node/Chromium/WebKit/PostgreSQL and actual Safe/EIP-7702 integration evidence are reported by the parent acceptance package, not claimed from unit mocks.

The fixed campaign runtime/initcode are 21,278/22,318 bytes; factory runtime/initcode are 24,009/46,986 bytes. Factory constructor adds 64 bytes (47,050 total initcode). This leaves **567 runtime bytes** under EIP-170 and **2,102 encoded-initcode bytes** under EIP-3860. Do not assume later source/parameters preserve this headroom. The factory template hash, source closure, creation calldata and all materialized immutables must match before trusting an address.

No paid review was commissioned, no production authority was exercised and no findings were suppressed. Live activation still requires accepted actual RMT identity, a fixed-unit campaign approval or defensible USD reference policy, explicit manual funding, finite NFT eligibility/custody/foreign-authority review, supported wallet execution, security disposition, canonical indexing/finality and separate owner deployment/activation authorization.
