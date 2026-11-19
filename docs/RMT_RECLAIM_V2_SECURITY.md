# Reclaim V2: permanent-surrender security boundary

The [owner correction](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/672#issuecomment-6996801185) rejects Task078's reversible escrow as an assistant-introduced deviation. V1 source and raw reports are retained only as historical, unapproved evidence. The active candidate is separately versioned **RMTReclaimCampaignV2 / FactoryV2**, with **no NFT return, repayment or NFT withdrawal path**. It remains **BLOCKED_NO_BROADCAST**. This internal testing and static analysis is not an independent audit.

## Exact closure and preservation

The six-source production closure is `fece6e205ff52f8369c732cbddaa663a0d19530062b7539dc4b4467099a08cdc`, solc 0.8.26/Cancun/viaIR/200 optimizer runs/IPFS metadata. [Manifest and exact inputs](evidence/rmt-task079/security/). All **53** previously tracked Solidity files, including rejected Reclaim V1, match base `da5ba64636c4da67a6a2b0447d1c2849bf01fa97`. No existing token, curve, 1B supply, 600M/400M allocation, 90/5/5 entitlement, LP custody, treasury or governance source changed.

Every production root and reachable import is analyzed by Slither 0.11.5/Crytic Compile 0.3.11 with **all 101 detectors** and no detector, source or severity exclusions. AST/source-map output selection is added by the existing analyzer; production source and compiler optimization settings are not rewritten.

| Snapshot | Exact input SHA-256 | Total / High / Medium / Low / Info / Optimization | Strict gate |
| --- | --- | --- | --- |
| V1 historical | `d3596a541f62f25e579e7f8186e017f678a297f454423a4fa9984c898e720471` | 28 / 4 / 1 / 18 / 4 / 1 | Failed, retained |
| Initial permanent V2 | `2b017850a7ae4d7be06fe05fdfc77fa896c3ff8756a52c939c2b695767b3c922` | 44 / 8 / 1 / 26 / 8 / 1 | Failed |
| Typed standard-token calls | `e5cc12ac9a5a836661e6921a505633a3599b3ced3e2ffc52ae8873e29d7ca8cc` | 43 / 8 / 1 / 26 / 7 / 1 | Failed |
| Current V2, separate burn/sink settlement | `fece6e205ff52f8369c732cbddaa663a0d19530062b7539dc4b4467099a08cdc` | **45 / 7 / 1 / 29 / 7 / 1** | **Failed** |

Typed `transfer/transferFrom` now require `true`; permissive empty-return tokens are unsupported. Both sender and recipient exact before/after balance assertions remain, as does the reentrancy guard. This narrows behavior to the reviewed standard RMT TokenV2; it does **not** clear the four token-balance warnings. Separating `_burn721` and `_sink721` makes their mutually exclusive retirement conditions reviewable and removes an initial impossible burn-to-else-branch `sinkBalance` dataflow. Other observations increased; no improvement to overall safety is inferred from the lower high count alone.

## Four retained V1 findings: individual disposition

All four are `reentrancy-balance`. A baseline intentionally compared with the exact expected transfer delta is not automatically a vulnerability, but finite tests alone do not establish universal non-exploitability. None of these original findings is waived or marked cleared. Full IDs, external calls, dataflow, source locations, uncertainty and applicable tests are in [the machine-readable disposition](evidence/rmt-task079/security/disposition.json).

| Original finding ID | Source and boundary | Safeguard and evidence | Remaining uncertainty |
| --- | --- | --- | --- |
| `11cb4e56d2d851b14c372a3ff8e1360e03988e781ca81fc9e632f2725e9fdf7e` | V1 `_pull`, lines97–101: sender `b` before token low-level `transferFrom`, compared after. | Guarded funding/old repayment, exact sender debit; V2 `testHostileFundingCannotInventReserveAndCallbackCannotReenter`. Old repayment is removed from active V2. | No concrete exploit established for reviewed TokenV2; malicious balance-reporting tokens remain outside the accepted profile. Historical V1 remains unapproved. |
| `2d21f375eb597358c720041270c79165d716c9ff9d60cde0b6a212b7bb80a34b` | V1 `_pull`, lines97–101: campaign `a` before token `transferFrom`, compared after. | Funding effects roll back on false/malformed/taxed/extra-debit token behavior; exact campaign credit remains mandatory. | A code hash alone does not make an arbitrary configurable token honest. Actual RMT source/runtime and inputs must be verified before release. |
| `8d40ee02cb52f19dae4e477414d2fb75929c8b27f5ea2381b7b26610c6fd5901` | V1 `_pay`, lines102–106: recipient `b` before token `transfer`, compared after. | Reward beneficiary is the claimant; closed-reserve recovery beneficiary is the controller. No caller redirect; guard and exact recipient credit remain. V2 reward false/malformed/tax/callback tests exercise rollback. | Passing callback models is not proof for every token or future runtime; no independent clearance. |
| `acc31aefac80caa64663fbfc0a8ee9f998df1ea934d96c3221ab803152052255` | V1 `_pay`, lines102–106: campaign `a` before token `transfer`, compared after. | Reserve debit/paid or recovery counters precede the guarded transfer, with exact debit required. Failed rewards restore the NFT and every counter atomically. | Original V1 warning retained; permanent V2 has its own corresponding unresolved observations. |

## Seven current V2 high observations

Four rows remain in `_pull`/`_pay`, analogous to the original token deltas. Three arise from exact ERC-721 retirement balance comparisons: one `_burn721` and two `_sink721`. All seven remain **unresolved static-analysis observations**; there is no confirmed exploit in the executed reviewed-source profile, and no claim that all external contracts are safe.

The budget, nonce, lifetime eligibility, immutable receipt and reward debit are recorded before external retirement/payment. Every state-changing campaign entry is guarded. Native burn verifies owner absence, `exists=false`, exact claimant balance decrement and supply decrement. Sink verifies exact claimant/sink balances, sink ownership and unchanged supply. A successful NFT retirement followed by failed RMT payment reverts the entire transaction, restoring the NFT and supply as well as all accounting. The pure sink receiver never calls back or approves/transfers assets.

Deployment assumptions matter: the actual reward must be the independently verified fixed-supply TokenV2; the collection runtime must match a constructor-committed, independently reviewed retirement profile. ERC-165 or a common dead address is not proof of irreversibility. Proxy, issuer seizure, privileged restore/remint, mutable approval or unknown burn semantics remain unsupported. The four honest local fixture types enforce mint-once token IDs and have no admin, upgrade, recovery or remint route. Counterfactual hostile fixtures are deliberately not production admission proposals.

The analyzer parses the full closure, but absence of warnings for array-held ERC-1155 balance/supply baselines is **not** proof of precise coverage. Stateful tests independently cover those deltas. Constructor assembly/CREATE2 and immutable data-part identity also need source/runtime verification beyond detector output. Historical V1/V2 funding-parser gaps, **22 core/dependency highs**, **six Treasury V1 highs**, and the purchasing prototype's NO-GO remain separate.

## Deployment-size and code-identity boundary

The initial typed deployer failed the EIP-170 compile assertion; its [original rejection](evidence/rmt-task079/security/initial-size-rejection.txt) is preserved. The exact rejected byte count was not captured, so none is invented. V2 stores the exact campaign creation code in two immutable **STOP-prefixed** data contracts, then reconstructs and hashes it before CREATE2. The canonical factory supplies those slices from `type(RMTReclaimCampaignV2).creationCode`; no deployed controller can change the parts, code hash, constructor schema, sink, factory or deployer. The deployer is callable only by its immutable factory and receives typed creator/intent/controller/rate/cap fields, not arbitrary initcode or external-call data.

| Component | Creation / runtime bytes | Actual constructor/runtime qualification |
| --- | --- | --- |
| Factory V2 | 31,898 / 2,132 | Four retirement profiles add 640 bytes; **32,538 encoded initcode**, below 49,152. Runtime headroom 22,444 bytes. |
| Campaign V2 | 23,676 / 22,077 | Eight static constructor words add 256 bytes; **23,932 encoded initcode**. Runtime headroom 2,499 bytes. |
| Bound deployer | 2,900 / 2,201 | Immutable factory, asset, sink and part/hash bindings; full creation hash checked before deployment. |
| Permanent sink | 731 / 705 | No owner/storage authority, external asset calls, fallback, upgrades or destruction. |
| Each code part | Data constructor 301 bytes | Actual deployed code is **11,839bytes**: STOP plus 11,838 bytes of creation code. The compiler's unreachable 57-byte runtime template is not the deployed data identity. |

Part contents/hash concatenation and non-executing entry behavior are tested. Mutating a part or sink in a counterfactual VM test fails closed. A future version may replace the factory for **new campaigns only**; it cannot migrate or recover permanently retired NFTs. No general proxy, admin escape hatch or custody power was added. Actual gas and materialized runtime hashes are recorded by the parent isolated deployment harness, not inferred as a production fee quote.

## Executed contract evidence

**37 tests passed, zero failed/skipped** in three suites: 29 ordinary unit/fuzz tests, 7 hostile-dependency tests and one 128 × 32 / 4,096-call stateful invariant. Both fuzz tests use 512 runs. [Raw output](evidence/rmt-task079/security/foundry-final.txt).

Tests cover all four standard/mode combinations, true burn vs unchanged-supply sink, immutable used status, rejected remint/return/rescue, unsupported issuer recovery, strict token return values/deltas, interrupted retirement, reward failure rollback, callbacks, authorization, caps, nonce/epoch/deadline/repricing, funding/dust, pausing/controller continuity, close/recovery and fixed supply. These are local synthetic contracts/assets. Browser, PostgreSQL and Safe outer evidence must be added from their actual runs; these contract results do not claim those paths, physical-phone acceptance, mainnet suitability or independent audit.
