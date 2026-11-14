# RMT Launch owner decisions and release gates

**Next decision:** approve the scope and reviewer selection for an independent assessment of the exact 4663 review build. Select a reviewer who did not author the contracts or the static-analysis disposition. Record scope, conflicts of interest and deliverables. Any paid engagement needs its own approval. This decision authorizes review only.

## Proposed economic terms

All values below apply to candidate bonding-curve launches and are provisional. Record approval of the full tuple against the reviewed compiler input, factory bytecode and disclosed terms. The existing RMT token and legacy curve retain their original economics.

| Decision | Candidate for review | Approval needed |
| --- | --- | --- |
| Creation | **0.0004 ETH** once per launch, plus gas. Approximately $1 at the illustrative fixed reference of $2,500/ETH. No oracle. Underpayment reverts; excess must be returned atomically. Creator liquidity and initial buy are optional. | Exact ETH amount, operating treasury and public wording. Repricing would require a future factory version. |
| Supply and inventory | 1M, 10M or 100M tokens at 18 decimals. Entire supply minted once. 60% net curve sales and 40% for initial v4 liquidity. Launch starts with zero real ETH and all units in curve inventory. Virtual token reserve is 180% of total supply. | Supply presets, allocation and economic-rules digest. No initial creator token reservation in this model. |
| Graduation | **2 ETH** real backing and **4 ETH** virtual ETH, at 60% net sold. 1 ETH remains the default regression and 4.20 ETH an economic comparison. Same token graduates atomically with the full canonical PoolKey and initial position locked permanently. | Exact threshold/profile, effective opening depth and permissionless sequencing risk. |
| Curve trade fee | **1%** of gross ETH on buys and sells, with upward whole-wei rounding. Of actual fees, **90%** creator/project, **5%** RMT operations, **5%** future RMT reserve, with cumulative rounding. Creation fees accrue separately. | Rates, rights and immutable operating and reserve addresses. |
| Optional per-project treasury | Creator can commit 0–9,000 bps of total fee proceeds, carved out of the 9,000 bps project portion. The ledger applies the committed numerator over 9,000 to that portion. Treasury must differ from the creator, and nonzero address and positive share are paired. No creator treasury reassignment after launch. | Disclosed allocation rules, recipient custody policy and receipt/claim compatibility. |
| v4 pool and LP fees | Static pool fee **3,000 pips (0.30%)**, tick spacing **60**, full-range ticks **−887,220/+887,220**, exact initialization-only hook. Original position earns only its realized share. Its ledger applies the same 90/5/5 policy separately to ETH and tokens; other LPs earn independently, with live protocol fee policy verified before approval. | Pool fee parameters, review of third-party liquidity and ordering risks, permanent custody disclosure and recipient rights. |
| Collection policy | Manual collection when safely realizable value is at least **2×** the execution and L1 posting cost. Include relevant claims; value token-denominated receipts only with independent executable pricing. Defer stale quotes or dust. Collection is permissionless and pays the bound ledger. | Named payer, operating budget and expense basis. If payer relies on one beneficiary's proceeds, use only that beneficiary's spendable credit in the calculation. Principal is unavailable for costs. |

### Reproduced scenario comparison

Re-running the pinned integer simulation against the three archived #592 fork profiles passed the model's cross-checks for deposits, opening price, first swap and reverse settlement. One-million-token fixture, 0.10 ETH first exact-input buy, no outside liquidity for that trade. Shortfall is relative to opening spot and includes the pool fee.

| Real ETH | Gross buys to fill with no sells | First-buy shortfall | First-buy tokens out | Standalone / atomic graduation gas |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1.01010101 ETH | 9.34% | 36,264.44 | 1,545,194 / 1,762,032 |
| **2** | **2.02020202 ETH** | **5.04%** | **18,993.19** | **1,545,085 / 1,762,014** |
| 4.20 | 4.24242424 ETH | 2.62% | 9,275.07 | 1,545,159 / 1,761,996 |

For 2 ETH the recorded position deposited 1,999,999,999,999,999,952 wei and 399,999,999,999,999,999,999,652 token base units. The gas numbers come from the archived #592 receipts. Market demand, external executable prices, protocol fees and realized revenue on the future pool are unobserved. A round trip can undo curve progress before graduation. One buyer can fill the threshold. A higher threshold buys more opening depth and requires more gross demand. The 2 ETH case remains the proposed review point.

At 2 ETH the historical fixture harvest used 560,271 gas for 299,999,999,999,999 wei plus 28,489,784,254,893,556,222 launch-token base units. Individual combined/native/token claim cases used 110,605/42,932/68,957 gas. At the illustrative 10 gwei execution price and zero posting charge, the 2× threshold for harvest alone is 0.01120542 ETH. At the stored prior 20,102,000 wei/gas observation and zero posting charge it is approximately 0.00002253 ETH. A sponsor comparing all credits and an operating recipient comparing only its own 5% face different thresholds. These are cost sensitivities. Recalculate using the actual chain, transaction and time before any act. [Archived receipts](evidence/rmt-task039/historical-4663-fork-2eth.json) · [Scenario assumptions and posting-cost model](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/9829e0ad40c4716f86e7c7246fa5eb90175f0367/docs/RMT_CURVE_TASK020_ECONOMICS.md)

To reproduce, download the [pinned #592 fork artifact](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43511947948/artifacts/14079376759). Run from the pinned #594 repository root. The simulation uses local inputs only.

```sh
node packages/contracts/scripts/simulate-launch-curve-terms.mjs \
  --fork-evidence "$EVIDENCE/curve-fork-evidence.json" \
  --fork-evidence "$EVIDENCE/curve-fork-evidence-2000000000000000000.json" \
  --fork-evidence "$EVIDENCE/curve-fork-evidence-4200000000000000000.json"
```

## Production assignments

Values remain **unassigned**. Verify control and receiver behavior using public addresses and approved nonproduction acceptance when the owner supplies them.

- **RMT operating treasury** → public address, accountable operator, custody and receiving policy. The factory binds the same address to creation fees and the operating allocations. Verify native and token receipts and the recipient's fee-claim ability.
- **Future RMT reserve** → distinct public address, operator, custody and use policy. This candidate credits the reserve separately. Existing RMT token economics are outside the decision.
- **Directory signer A, B and C** → three independent operators and public EOA addresses, quorum policy, notice monitors, hardware/key continuity and incident drills. The exact ECDSA verifier needs three distinct EOA identities from which two sign each approval. Smart-contract signature support and key rotation would need a separately versioned review. Specify how to handle lost keys and suspected compromise under immutable addresses.
- **Deployer, release operator and emergency contacts** → public deployer identity, chain and artifacts; designated release and incident owners, verified approvals, rollback contacts and index/website operator. The directory's quorum suspension covers registration and migration admission. Define the separate offchain execution incident control and verify the continued availability of existing claims.
- **Provider, storage and acceptance owners** → approve the archive/trace witness, failover and L1-verification policy, single writer, encrypted off-host backup, restore target, recovery retention and on-call roles. Approve the exact isolation profile and wallet support matrix for the owner device test. Approve expenses separately if required.

## Release order

| Priority | Release blocker | Evidence required to close it |
| --- | --- | --- |
| **1 · Contract security** | All 18 active high findings and migration ordering observations remain open. Imported arithmetic findings need review in the exact dependency closure. | Independent signed disposition for each, exact tested inputs and repeat verification for any remediation. Include external callback paths, fixed fee/custody accounting, migration liveness and signer compromise. [Findings](RMT_CURVE_TASK039_FINDINGS.md) |
| **2 · Immutable release inputs** | Final economics, beneficiaries, operator/signer set, successor code selection and deployment commitments unapproved. | Approve exact manifest, rehearse address derivation with approved inputs offline, re-check live runtime identities and gas limits, document signer rehearsals and withdrawal-free emergency boundary. Prove factory registration provenance from canonical logs before any application release. [Handoff](RMT_CURVE_TASK039_REVIEW_HANDOFF.md) |
| **3 · Canonical data and recovery** | Task 039 is bounded public provider evidence. Production archive/trace SLA, exact Ethereum batch replay, durable new-engine writer capacity and backed-up restore evidence remain open. The Railway V6 history writer covers historical registrations. | Approve provider independence and quotas, production runbook, observed L2 vs verified L1 policy, isolated new-engine data plan and recovery drills. Keep unsettled native transfers pending until canonical proof and preserve snapshot fallback. [4663 evidence](RMT_CURVE_TASK039_4663.md) |
| **4 · Wallet and interoperability** | Physical iPhone acceptance, approved signer/transaction formats and hosted exact-pool routing/indexing remain open. | Accept supported wallet classes and recovery semantics using only an approved isolated profile. After a separately authorized deployment, validate exact 4663 manager, full PoolKey, per-hop and calldata bounds through an independent hosted route and index read. Consider separate, explicit decisions for first funded tests and public execution. |
| **5 · Dependency and release operations** | Historical dependency advisories and candidate release artifact need exact-scope closeout. | Re-run and triage dependency checks for the eventual release lock and artifact, with independently reviewed changes/acceptance. Coordinate approved monitoring, feature flags, release window, rollback gate and ongoing cost limits. The historical nine moderate/two low report is an earlier baseline. [Prior advisory record](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/9829e0ad40c4716f86e7c7246fa5eb90175f0367/docs/RMT_CURVE_TASK020_AUDIT_HANDOFF.md) |

The website remains read-only. Netlify and Railway Free retain their existing operating configuration. Contract deployment, first funded test, public transaction activation and any optional module each require their own authorization.
