# Curve migration and revenue review

Task 019 starts at [draft #586](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/586) commit `453ba728f0620c60adfa2209f62aa03ad4274221`. The original RMT contracts and historical direct-launch deployments retain their own code and economic rules. The curve web profile and checked-in contract gates remain isolated. The 4663 harness compiles a separate offline review profile and sends transactions only to loopback Anvil.

## Migration and custody

The permanent registry keys projects by token address and tracks the original and active curve independently. The factory can prepare a single deterministic V2 successor while V1 is active. The separately deployed successor helper has a factory-pinned runtime. Its V2 constructor copies the predecessor's immutable project terms. Proposal and execution bind the exact candidate, its runtime hash, source address, token, nonce, original version and deadline. Creator authorization, two distinct signer approvals, a two-day notice and a bounded execution window are required. The creator can cancel, and two signers can suspend migration without freezing trades or claims.

The predecessor seals its trading paths, transfers exact tracked ETH and unsold inventory and hands accrual authority to V2. The successor verifies the source, amount and canonical reserve formula before opening. The factory and registry advance their pointers and publish evidence within the same transaction. Holder balances, total supply, original ledger credits and economic rules are unchanged by the transfer. An interrupted transaction leaves V1 live. Only the reviewed V1-to-V2 path is implemented. Already-graduated positions and previous deployments are outside it. Direct donations are excluded from the tracked reserve and have no administrative recovery. Existing approvals are address-scoped. A new sell on V2 requires approval for V2.

The original v4 NFT has no transfer or approval entrypoint. The collection command uses zero liquidity and zero maximum inputs with `INCREASE_LIQUIDITY`, followed by `TAKE_PAIR` to the immutable per-launch ledger. It uses the exact original position's fee-growth checkpoint, checks the full PoolKey, ticks, owner, approval, liquidity and Permit2 allowance, and verifies the ledger's actual ETH and token receipts before crediting immutable recipients. Core fee growth may include a pool-level donation. Direct donations to the ledger are excluded from entitlement accounting. Integer fee-growth rounding can leave residual dust. Each recipient claims its own credits and pays claim gas. [Pinned PositionManager semantics](https://github.com/Uniswap/v4-periphery/blob/main/src/PositionManager.sol) · [Official v4 deployment addresses](https://developers.uniswap.org/docs/protocols/v4/deployments#robinhood-chain-4663)

## Economics

Run `node packages/contracts/scripts/simulate-launch-curve-terms.mjs`. The model holds the sold fraction at 60% and the paired inventory at 40% of one million tokens. It scales virtual ETH with each backing threshold to preserve the same end-of-curve price continuity. The actual shipped review profile remains at 1 ETH. The model uses Uniswap's full-range tick bounds and integer opening-quote math. Shortfall is relative to the opening spot value and includes the 0.30% v4 LP fee.

| Actual backing | Paired inventory | Uninterrupted gross buys at draft 1% | 0.05 ETH buy budgets needed | 0.01 ETH shortfall | 0.10 ETH shortfall | 0.50 ETH shortfall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 ETH | ~400,000 | 1.0101 ETH | 21 | 1.29% | 9.34% | 33.47% |
| 2 ETH | ~400,000 | 2.0202 ETH | 41 | 0.80% | 5.04% | 20.20% |
| 4.20 ETH | ~400,000 | 4.2424 ETH | 85 | 0.54% | 2.62% | 10.88% |

With 2 ETH of gross buying and no sells, the 1 ETH model graduates. The 2 ETH model sells about 595,987 of 600,000 required tokens. The 4.20 ETH model sells about 343,353. A single fully funded trader can reach any of the three thresholds, and the buyer counts express budgets rather than unique holders. Reversals increase needed turnover and can keep any project below graduation indefinitely.

Retain 1 ETH for engineering verification. Use 2 ETH as the first economic alternative for independent review if demand can support about 2.02 ETH of gross buying. It roughly halves the shortfall on a 0.10 ETH opening trade relative to 1 ETH. The 4.20 ETH alternative suits a deeper opening only if materially higher launch demand can be demonstrated. The draft 1% curve fee, 90% project share, 5% operations and 5% reserve remain unapproved.

The previous 4663 simulation used about 700,000 gas for standalone graduation and 916,000 gas for atomic graduation. The new deployment includes an LP fee ledger, so its exact measurements belong to the new fork artifact. The script reports execution-cost sensitivity at 1, 10 and 30 gwei, excluding L2 data fees. Deeper reserves do not automatically change the number of contract operations. Costs can exceed small fee collections or claims. There is no automated collection schedule or return promise.

At 100 ETH of native-side input in the canonical pool, the 0.30% LP fee is 0.30 ETH before any protocol fee. With 100%, 25% or 5% of active liquidity, the original position would earn approximately 0.30, 0.075 or 0.015 ETH under constant-share assumptions. At a 25% share, the draft sends approximately 0.00375 ETH each to operating and reserve recipients. Token-side fees stay denominated in the launch token. Actual in-range competition, protocol fees, routing and trading volume determine earnings. Routes through other pools contribute zero.

A shallow opening is more susceptible to price impact and capital-efficient ordering around graduation. Slippage bounds and deadlines constrain individual fills. They cannot prevent market moves, concentration, creator-funded threshold crossing or private ordering. The initialization-only guard protects the intended key. An unaffiliated position may join after initialization and compete for fees. The review must consider repeated reversible trades, fee cost, gas and the ability to delay graduation by selling.

## Security evidence

The historical high findings are in [#586's exact Slither job](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/43469702116/job/132038043675). The underlying detector tracks a pre-call `balanceOf` through later guard nodes. It does not by itself establish a reachable reentrant mutation. Keep the unchanged full gate and exact runtime balance checks. The draft PR records the exact-head locations and test results. [Detector source](https://github.com/crytic/slither/blob/0.11.5/slither/detectors/reentrancy/reentrancy_balance.py)

| Surface | Evidence to reproduce |
| --- | --- |
| Curve graduation | The engine cannot reopen trades after V1 or V2 seals the backing state. Require matching token and native settlement and roll back if the dependency reports inconsistent payment. |
| Position funding and collection | The authorized engine uses a locked entrypoint and runtime-pinned dependencies. Test hostile callback attempts, residual approvals, malformed NFT evidence, failed funding and independent outside liquidity. A zero-liquidity command and post-call position check protect principal. |
| Asset migration | The factory pins the helper and candidate. Test unauthorized calls, insufficient signatures, early execution, interrupted transition and a false-success ERC-20 transfer. Check the same ledger and compare both exact asset deltas. |
| Holder replacement | The separate 31337-only escrow guards redemption. Test callback reentry, underpayment, false and malformed return values, and rollback of both token balances and approval. |

The inherited direct-launch V1 and V2 funding parser gaps remain separate. V1 `_fundPosition` failed SlithIR generation and V2's inherited funding helper had a scoped failure around the Permit2 deadline conversion. The original rollback tests and manual audit inputs still apply. [Legacy analysis coverage](RMT_LAUNCH_RELEASE_CANDIDATE.md#independent-review-coverage)

## Release decisions

Approve economics, recipient addresses and custody disclosures, independent signer operation and emergency procedures, and exact chain-specific deployment inputs. Commission independent review separately. A failing high-severity gate blocks release. Provider finality, trace policy, hosted routing and indexing, and physical-wallet acceptance need their own evidence.
