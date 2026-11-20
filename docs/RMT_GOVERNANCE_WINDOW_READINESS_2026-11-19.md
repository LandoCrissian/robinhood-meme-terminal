# RMT Launch governance window — owner decision

**BLOCKED_NO_BROADCAST. Read-only verification; no signature, transaction, deployment, token creation or production change.**

The original factory-publication action was **pending, unexecuted, uncanceled and time-eligible** on both official Robinhood and Pocket RPCs at the final handoff block **118789967**, hash `0xd4130c3e261c7140a9bfe586d1901da8d7fc8bbe058082efd654ffbd4e18a14a`, timestamp **2026-11-20 04:48:24 UTC / November 19 9:48:24 PM MST**. Collection completed at 04:48:37Z. Its remaining window at that block was **572,502 seconds: 6 days 15 hours 1 minute 42 seconds**. Earlier 04:06, 04:19 and 04:28 observations remain separately retained. This snapshot is not later signing authorization.

**Important decision:** execution publishes a factory that anyone can use directly while the Directory is unsuspended. The website's disabled buttons/routes do not prevent on-chain creation. The pending action is permissionlessly executable; an offchain hold does not stop another funded caller. Recommend keeping financial activation held, resolving the frontend data handoff and recording the exact core-risk decision before preparing owner execution. If canonical creation must remain blocked meanwhile, separately review quorum cancellation of this pending action rather than relying on the website flag or waiting for expiry. A cancellation/suspension transaction can race permissionless execution: require canonical successful confirmation and fresh resulting state before claiming an on-chain hold. It cannot undo earlier publication or created projects. No cancellation is authorized or prepared here.

## Exact operation and window

This is **custom DirectoryV2 EIP-712 Action governance**, not an OpenZeppelin TimelockController. The operation ID is the Action digest, not the schedule transaction hash.

| Field | Verified value |
| --- | --- |
| Chain | Robinhood 4663 (`0x1237`) |
| Directory / transaction target | `0xE677A69A8124714DD0d88b73BDf1B89cc791ca9C` |
| Schedule transaction | [`0x96bd234e49d766c73c66f9787f26736040b4fc64d91ed2ae888eca3f4c8afb65`](https://robinhoodchain.blockscout.com/tx/0x96bd234e49d766c73c66f9787f26736040b4fc64d91ed2ae888eca3f4c8afb65) |
| Canonical schedule block | 116966133 / `0xba98e1e82b736a50c46dfae095f1f3fd3cc4932921938c7b2aa8d30f23ec9106` |
| **Operation ID** | `0xad499113950f3410a60c6fe9fe40b4d1d98cf055eeafeb2b1736a5a38c5fea1e` |
| Action | Publish kind 0, action nonce 0, engine version 1, signer epoch 1 |
| Factory to publish | `0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3` |
| Committed factory runtime | `0x519d55e694263866896e05023834b124829173f13f42c5aea7e3ca2200c5a091` |
| Transaction value / method | 0 ETH / `execute(Action)`; selector `0x9f2fe998` |
| Execute calldata Keccak256 | `0xf13b66ca989dd1034c95e9a9095dcb85e034b7a3a78f2a602698194cae1a542d` |
| Generic predecessor / salt |Not present in this contract. The helper's `governancePredecessor` is canonical schedule provenance, not an on-chain predecessor hash. |
| Authority |Two distinct current eligible governance EOAs authorize scheduling/cancellation. Mature execution is permissionless; Operations Safe is a treasury, not the Directory's authority. |

| Boundary | UTC | America/Denver |
| --- | --- | --- |
| Notice starts |November 17 23:32:28 |November 17 4:32:28 PM MST |
| First eligible |November 19 23:32:28 |November 19 4:32:28 PM MST |
| Last eligible second |November 26 19:50:06 |November 26 12:50:06 PM MST |

All dates are 2026. Source and live getters establish a 172,800-second delay and 604,800-second maximum execution window. The stored expiry is **contract-enforced**, `min(eligibleAt + 604800, Action.deadline) = 1795722606`; it is not merely an operator reminder. Execution is valid at `timestamp == expiry` and invalid afterward. Block timing is not guaranteed; do not plan a last-second transaction.

Both witnesses revalidated the canonical receipt, original two signatures and exact pending digest. Current and pending state agreed: Directory nonce 0, epoch 1, latestVersion 0, suspended=false, no pending rotation, factory mapping 1 empty, migration-template mapping 3 empty. This original operation therefore has not been consumed by execution, cancellation, suspension or rotation. Rerunning Schedule or collecting the same publication signatures is unnecessary.

## Effects, permissions and recovery

Successful execution writes `factories[1] = (factory, runtimeHash)`, sets latestVersion 1, clears pending and advances action nonce to 1, with public publication/execution events. It creates no token itself. RegistryV3 registration then admits this exact factory/runtime; FactoryV2's payable `create` is available to any caller meeting the committed fee, intent, deadline, metadata and beneficiary checks. There is no website release flag or creator allowlist in this on-chain path. Failed registration currently rolls the whole creation back.

Publication is append-only. The contract has no individual unpublish/revoke path; merely publishing a newer factory does not revoke older published mappings. A separately authorized suspension can block new registrations and migration operations, but does not stop existing curve buys/sells, graduation or fee claims. It does not withdraw reserves or locked LP principal. No dashboard rollback reverses an on-chain publication. Publication does not reserve the first project or the RMT name/ticker; identity is chain and token address.

While this digest remains pending, cancellation requires a **fresh** two-current-signer authorization for kind 3, current nonce/epoch, zero version/factory and the pending digest in `runtimeHash`, plus a separately owner-approved cancellation transaction. The existing Publish signatures do not authorize Cancel. After expiry, anyone may call `clearExpired()` strictly after the last eligible second; it clears pending and advances nonce. A later publication needs fresh quorum signatures, a new schedule and another real two-day notice. Rotation also has its own notice and invalidates superseded authority. No emergency single-signer or deployer override exists.

The original queue comprises four transactions, of which the factory Schedule is already complete. Fresh state confirms **three remain** on that approved path: execute this factory action; separately authorize/schedule the V3 migration template; execute that template after its own two-day notice. The one ordinary pending slot prevents another schedule while this action remains pending. The factory-before-template order is the approved queue's dependency, not an OZ predecessor or a general contract requirement after cancellation/expiry clears the slot. There is no extra V2-template or Registry-admission transaction in that queue. Future project migrations still require creator consent and their own authorization/notices.

Source boundaries: [DirectoryV2](../packages/contracts/src/RMTLaunchCurveDirectoryV2.sol), [FactoryV2](../packages/contracts/src/RMTLaunchCurveFactoryV2.sol), [RegistryV3](../packages/contracts/src/RMTLaunchProjectRegistryV3.sol), [approved queue](evidence/mobile-signing/protocol-owner-plan.json). Raw source retains 31337 development guards; the approved named 4663 compiler transformation, not those raw guards, identifies deployed code.

## Wallet and indicative cost

The separate cost capture completed **November20 04:19:08 UTC** at block 118773149. Both providers returned successful **ephemeral `eth_call`** for the exact zero-value execution, identical governance state, matching personal-wallet delegation and equal latest/pending personal nonce **493**. No state change persists from `eth_call`; no signing request was created. The later 04:48 handoff recheck still found the original action pending.

| Read-only cost field | Observation |
| --- | --- |
| Proposed future payer |Existing personal MetaMask `0x7E8E7D3Af28584a8b9eEDDbE16CD3308Bd1e76cA` |
| Estimated Nitro total gas |115207, including 780 L1-posting gas units |
| Estimated total network fee |**0.00000235483108 ETH**, including 0.0000000159432 ETH posting component |
| Indicative buffered gas limit |144009; 25% rounded-up buffer over maximum observed estimate |
| Indicative maximum fee per gas |40880000 wei; priority0 |
| **Indicative buffered ceiling** |**0.00000588708792 ETH** |

The L1 component is already included in total; it is not added twice. This is not a quote reservation, spending approval, or a replacement for live MetaMask costs. Account, delegation, nonce, current pending action and costs must be checked again immediately before any separately approved wallet transaction. Governance nonce 0, Safe nonce 0 and personal nonce 493 are different counters. The old Operations Safe fee ceiling is not silently applied to this different action.

Executing the queued action needs **one future transaction signature from its gas payer**, not another pair of publication signatures. No new wallet, delegation change, token approval, liquidity payment or automatic RMT creation is required. Personal EIP-7702 delegation matched the existing StatelessDeleGator 1.3.0 policy. The existing three governance wallets remain admitted plain EOAs. Physical device acceptance of the complete creator/trading/claims/recovery flow remains separate from the earlier phone connection and actual infrastructure receipts.

The initial cost capture failed on a collector number/string normalization mismatch for Viem's uint48 results. The original producer/result remain under `chain/initial-cost-attempt/`; partial concurrent counts do not establish a provider failure. The correction preserves exact comparisons, uses lossless decimal normalization, drains both witnesses and passes targeted tests. Cost evidence retains decoded observations rather than complete raw RPC envelopes; this limitation and the absence of a post-cost pending-state reread are explicit. It is never a signing packet.

## Verified infrastructure and remaining holds

All five completed constructors and their three children still match the reviewed runtime hashes. A separate common-anchor capture at block 118770977 corroborated **19 runtime pins and 32 getter bindings**, including current/pending state. Operations `0xAF9F10258b091719618c19D057F9cDAB72eFFd8b` and Reserve `0x8D44078642ce938Fd799b23087BcdD6114A302e5` are separate SafeL2 1.4.1 proxies: the approved three owners, threshold 2, nonce 0, empty modules, zero guard and pinned singleton/handler. Do not redeploy them.

Factory recipients match those two Safes. Exposed getters confirm creation fee 400000000000000 wei, supply 1000000000000000000000000000 base units, chain 4663, v4 fee 3000/tick 60 and immutable dependency links. Fixed 1B/18 decimals, 600M curve/400M locked original liquidity, 2 ETH graduation, 1% curve fee and 90/5/5 eligible revenue policy remain the approved profile. Where no project instance/getter exists, the reserve allocation and ledger split are source/runtime-profile evidence, not invented live project balances. LP revenue concerns earnings of the original position, not a guaranteed share of every external swap.

| Impact | Current evidence and remaining requirement |
| --- | --- |
| **Publication is a financial-surface decision** |Unsuspended publication enables direct canonical creation, fees and later curve activity independently of website flags. The owner must deliberately choose this timing; technical maturity is not automatic public activation approval. |
| **Core security gate remains failed** |Exact4663 input retains 22 core/dependency Highs and seven governance Medium observations. The Task 063 internal register labels pinned paths false positives under stated assumptions; this read-only task neither clears scanner results nor establishes an independent audit. Confirmed loss defects or unresolved plausible material loss paths block affected release stages. Record any exact stage-specific owner risk decision; no paid audit is mandatory. |
| **Production discovery handoff is degraded** |Production Netlify deploy `6afd4265956a469adeb55747` is ready/Personal, but two samples serve the explicitly stale historical snapshot at113899119 (November14). Meanwhile original Railway worker/PG are online and new-engine checkpoints advance 118764056→118764393. The fallback's exact server-side cause and successful authenticated new-engine delivery are unverified. Repair/verify this handoff before financial website activation; do not infer that the worker is down. |
| **Current-state finality and provider operations remain separate** |The schedule's own batch 399324 posting is corroborated against finalized Ethereum evidence. Current governance/checkpoints and rollup challenge validity are not thereby finalized. A free witness blocks log discovery; exact receipt reads worked. Production finality/trace/archive continuity and failure policy need operational acceptance, not a declaration that all providers are fully supported. |
| **Recovery and operating continuity need acceptance** |Historical November 17 encrypted backup and isolated restore succeeded; off-device copy and current recoverability remain unverified. Original PG/volume remain intact. One replica is not proof of the writer lease. Current Railway credit/plan allowance is unavailable through the connected read tools; old Free credit estimates cannot guarantee future uptime. No upgrade or paid resource was requested. |
| **Wallet, explorer and routing evidence have limits** |Both Safes/current EOA authority and read-only personal simulation pass. Full physical-iPhone creator/trading/claims/recovery acceptance is not proved by emulation or infrastructure receipts. All eight current Blockscout metadata GETs returned 403; historical publication and independently reproduced bytecode correspondence remain separate. No explorer write or bypass was attempted. Hosted routing/indexing for a future exact token/full PoolKey remains unobserved. |

Original owner-backed-up keys remain on one phone. Distinct on-chain identities do not establish device independence. Keep the owner's existing backup/key-continuity and incident responsibilities explicit; no additional wallet or hardware purchase is required by this report. Loss of quorum still has no unauthorized recovery bypass.

## Ethereum evidence boundary

The targeted lane used the actual schedule block/hash, NodeInterface batch 399324 and origin 26438074; it did not reuse an unrelated historical batch. The first lane is preserved **UNVERIFIED** because Publicnode returned 403 for its single bounded log query. Flashbots identified L1 transaction `0x82a3521f2fc1e758097b859df2e1809c5b3f064f13683b92d2415754953d6f3a`, Inbox event/log 277 at block 26438078.

A separate eight-read lane, with no new provider, log retry or widened search, obtained the exact successful receipt/event from **both Publicnode and Flashbots**, posting headers before/after and canonical rechecks of the previously corroborated finalized block 26453807. Its result is **CORROBORATED_FINALIZED_L1_POSTING**. Total across both lanes: 39 read requests. This is the schedule batch's historical data posting under `L2_RPC_BATCH_MEMBERSHIP_AND_TWO_ETHEREUM_RPC_POSTING_READS`; it is not independent batch-membership/challenge validation or finality of today's state. The original 403 observation remains unchanged.

## Evidence, checks and one owner decision sheet

Base PR #680 exact `1f7160f5db5d67de348e041a84ccc2889786217e`: **21 completed checks, 15 passed, six unwaived strict failures**. Its repository evidence suite passed 215 tests. The earlier shallow-history and preservation-guard failures remain recorded; the final portable replay passed without modifying the historical validator or CI commands. [Exact source-bound CI records](evidence/rmt-task087/ci/README.md).

Task 087's final local runs passed **32 evidence/scope tests and 13 existing governance tests**. [Commands, actual failures/recovery, privacy and local environment limits](evidence/rmt-task087/README.md) remain explicit. No contract, fork or browser campaign was repeated. This report PR's CI is separate from the completed base and must not be inferred to pass before it completes.

Live evidence and reproducible read-only producers: [governance/cost](evidence/rmt-task087/chain/), [Safes/protocol/v4/source availability](evidence/rmt-task087/bindings/README.md), [operations/privacy/recovery limits](evidence/rmt-task087/operations/README.md), [targeted finality](evidence/rmt-task087/finality/). Source/compiler input is `66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10`; original plan SHA256 is `c333d4f60e4815fb86a719a5678da91b5331635213f8026bd7d6bc3fdfdd43d8`. New checks exercise decoding, expiry boundaries, fixed read-only RPC scope, captured witness consistency and byte integrity; they do not certify contracts audited.

| Owner decision | Concrete scope; no action taken here |
| --- | --- |
| **Publish now or maintain an on-chain hold** |Choose knowingly whether to prepare the exact permissionless factory-publication execution with its core risk disclosures. If canonical creation must remain blocked during repairs, separately authorize review of quorum cancellation/suspension. Doing nothing preserves a publicly executable queue until expiry. |
| **Approve specific operating/website follow-up** |Authorize a narrowly scoped repair/acceptance of server-only authenticated discovery, recovery/finality/provider continuity and the current Free allowance. Existing production settings and funds remain untouched by this task. No plan upgrade is assumed. |
| **Approve financial website activation later** |After its own evidence and owner approval, activate creation/trading/claims. Firebase profiles and optional treasury/NFT modules keep their own gates; they are not silently made core prerequisites. |
| **Create RMT later through the normal website** |The owner, not deployment tooling, reviews and creates the new 1B RMT. No token is created or pre-reserved here. V3-template scheduling/execution has its own authorization and actual two-day notice. |

All 23 active Seaport Highs, other optional/historical findings, frozen Reclaim and separate buyback restrictions remain preserved. No NFT purchasing investigation, royalty change, production migration, source deployment, signing or expenditure occurred. **BLOCKED_NO_BROADCAST remains.**
