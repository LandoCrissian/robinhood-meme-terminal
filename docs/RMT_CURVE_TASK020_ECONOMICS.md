# Curve graduation economics and fee collection

Task 020 review inputs. Every threshold, supply and fee split remains unapproved. The shipped fixture keeps 1 ETH of real backing. The 2 and 4.20 ETH variants run only in the offline 4663 review build on loopback Anvil. Existing RMT contracts and balances are outside this comparison.

## Backing, demand and opening execution

Run `node packages/contracts/scripts/simulate-launch-curve-terms.mjs` from the repository root. Pass `--fork-evidence <json>` once per available 4663 result to check the exact funding amounts, square-root price, liquidity, 0.10 ETH opening buy and subsequent sell of half the acquired tokens against router settlement. Amounts are integer base units in JSON. Figures below are rounded for readability.

All variants use a one-million token example, 60% net sold to graduate and 40% paired. The virtual token reserve starts at 180% of supply. Virtual ETH starts at twice the selected backing threshold. The model mirrors ceil-rounded backing, fee inversion, cap refunds, the actual spacing-60 tick endpoints and exact-input swap rounding. Raising the threshold increases initial ETH depth and also raises the ETH price of each token because the token inventory stays fixed.

| Real backing | Virtual ETH | Minimum uninterrupted gross buys | 0.05 ETH buy budgets | Net sold after 1 ETH gross | Net sold after 2 ETH gross | Opening ETH per token |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 ETH | 2 ETH | 1.01010101 ETH | 21 | 595,987 | 600,000 | 0.0000025 |
| 2 ETH | 4 ETH | 2.02020202 ETH | 41 | 357,114 | 595,987 | 0.000005 |
| 4.20 ETH | 8.40 ETH | 4.24242424 ETH | 85 | 189,776 | 343,353 | 0.0000105 |

The thresholds imply opening fully diluted prices of 2.5, 5 and 10.5 ETH per one-million-token supply. These are curve-implied values. The only initial ETH backing is the verified deposit. Under uninterrupted buys, the implied prices match each curve's terminal marginal price before fees, up to integer and tick math. A new token can have no reliable external price.

| Real backing | 0.01 ETH buy shortfall | 0.10 ETH buy shortfall | 0.50 ETH buy shortfall | Tokens out for 0.10 ETH | Post-buy ETH/token spot move for 0.10 ETH |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 ETH | 1.29% | 9.34% | 33.47% | 36,264.44 | +20.93% |
| 2 ETH | 0.80% | 5.04% | 20.20% | 18,993.19 | +10.21% |
| 4.20 ETH | 0.54% | 2.62% | 10.88% | 9,275.07 | +4.80% |

Shortfall compares average output with opening spot and includes the 0.30% LP fee. The final spot move uses the square of the Q96 square-root price ratio. Token-denominated sells of 4,000, 40,000 and 200,000 have about 1.29%, 9.34% and 33.47% shortfall across these variants because each sell consumes the same fraction of paired token inventory. A 40,000-token sell moves ETH/token spot down about 17.31% from the opening in each case. This one-position comparison excludes protocol fees, extra liquidity, route fragmentation and order competition. [Uniswap v4 fee model](https://developers.uniswap.org/docs/get-started/concepts/fees)

All three pinned 4663 loopback runs matched the model's exact funding and swap output with the official router and quoter. The first buy spent 0.10 ETH and the following sell used half of its token output. Standalone graduation used 1,523,044, 1,522,935 and 1,523,009 gas. Atomic buy-and-graduate used 1,739,882, 1,739,864 and 1,739,846 gas. These are local receipt units. The first two swaps yielded about 0.0003 ETH plus 54.39665, 28.48978 or 13.91260 launch tokens in fees for the original position. After outside liquidity joined in the same range, the original position earned 0.00012 ETH of the next swap's 0.00015 ETH of fees in each test. Outside fees stayed separate.

Zero trading leaves zero backing and no graduation. Fifty cycles of buying with a 0.05 ETH budget and fully selling each fill generate approximately 0.04975 ETH of fees plus trader gas while returning backing and net sold to zero. A single trader can fill any threshold, and buy-budget counts cannot establish unique holders or organic demand. Before graduation a sole buyer can unwind a complete fill at a direct cost of about 0.02010, 0.04020 or 0.08442 ETH plus gas. If 10,000 tokens sell first at the exact cap, the next eligible fill needs about 0.02504, 0.05009 or 0.10518 ETH of fresh gross buying. A failed separate graduation leaves sells open. A failed atomic buy-and-graduate rolls back the triggering trade and graduation. Elapsed time alone cannot complete the transition.

## External fair value and ordering

The simulation uses hypothetical external ETH/token prices on both sides of the opening and calculates a fee-adjusted marginal stop using the same integer opening model. It assumes the other venue can absorb the full trade at the stated price. It excludes that venue's fee and price impact, bridge or inventory cost, funding costs, gas competition, protocol fees and concurrent trades. Profit below is before those costs.

| External fair price versus opening | Direction on the canonical pool | Gross profit at 1 ETH depth | At 2 ETH | At 4.20 ETH |
| --- | --- | ---: | ---: | ---: |
| 20% lower | Sell token | 0.01086 ETH | 0.02173 ETH | 0.04563 ETH |
| 1% lower | Sell token | 0.0000124 ETH | 0.0000247 ETH | 0.0000519 ETH |
| Within ±0.20% | No modeled trade | 0 | 0 | 0 |
| 1% higher | Buy token | 0.0000121 ETH | 0.0000243 ETH | 0.0000510 ETH |
| 20% higher | Buy token | 0.00883 ETH | 0.01765 ETH | 0.03707 ETH |

The 1% divergence examples all lose money when a hypothetical two-leg execution consumes 300,000 gas at 10 gwei, before poster fees. At a 20% divergence, the potential gross amount grows with ETH depth because the same relative move trades more capital. Deeper backing reduces the impact of a fixed ETH order. It does not validate price, remove ordering exposure, prevent independent LPs from joining, or establish a route to an external venue. The initialization-only guard is for pool identity. The two transaction paths and per-trade slippage bounds still leave first-trade sequencing, sharp market moves and liquidity concentration as review risks.

With the same hypothetical external price of 0.000005 ETH per token in all three variants, the 1 ETH pool is initially underpriced, the 2 ETH pool is within the fee band, and the 4.20 ETH pool is initially overpriced. Modeled gross opportunities are approximately 0.17033 ETH for buying into the 1 ETH pool, zero at 2 ETH and 0.40075 ETH for selling into the 4.20 ETH pool. This isolates the change in implied opening price caused by the backing parameter. A market capable of supporting those trades has not been observed.

Keep 1 ETH as the fixture control. Of the alternatives, 2 ETH is the first candidate for economic review if eligible demand supports roughly 2.02 ETH net-directional gross buying and the expected typical opening ETH order is near 0.10 ETH. The 4.20 ETH option lowers that order's modeled shortfall further and requires 4.24 ETH of gross buying. Real market demand and fair value remain unknown before release.

## Separate revenue streams

Curve trading applies a draft 1% fee to gross ETH, rounded up. That ETH goes to the curve ledger. Actual backing remains isolated from fees. At the 1, 2 and 4.20 ETH thresholds, a direct fill accrues about 0.01010, 0.02020 and 0.04242 ETH in fees. The operating recipient's draft 5% of those collected fees is about 0.000505, 0.001010 and 0.002121 ETH respectively. The distinct future RMT reserve receives its own 5%. The project receives 90%, divided between creator and the optional treasury by the committed policy. Illustrative 20% treasury allocation gives 70% creator, 20% treasury, 5% operations and 5% reserve. Each split uses cumulative floors on actual amounts. The token side accrues zero curve fee.

After graduation, the split applies only to fees earned by the original permanent NFT, separately in ETH and token. Independent LPs retain earnings on their active liquidity. A compatible independent router contributes when it uses the same full canonical PoolKey. Routes through another pool contribute zero. Protocol fees, if configured, change the pool's actual fee split. The synthetic income levels use no protocol fee, constant original active-liquidity share and constant 30-day input, with no projection of actual demand.

| 30-day example | Native and token gross input into the same pool | Original position earns at 25% active share | Operating and reserve each receive |
| --- | --- | --- | --- |
| Low | 1 ETH and 100,000 tokens | 0.00075 ETH and 75 tokens | 0.0000375 ETH and 3.75 tokens |
| Medium | 10 ETH and 1,000,000 tokens | 0.0075 ETH and 750 tokens | 0.000375 ETH and 37.5 tokens |
| High | 100 ETH and 10,000,000 tokens | 0.075 ETH and 7,500 tokens | 0.00375 ETH and 375 tokens |

With 100%, 50%, 25%, 5% or zero of active liquidity, the original position receives the corresponding portion of pool LP fees. The remaining active share is payable to other LPs. Token turnover can exceed circulating supply over a month by repeatedly trading the same inventory. Token earnings have no assumed ETH liquidation value. Pool fee growth can also include a pool donation. Keep actual fee evidence separate from analytical volume estimates. [Uniswap active-liquidity accrual and fee growth](https://developers.uniswap.org/docs/protocols/v4/guides/managing-liquidity/calculate-fees)

## Collection and claims

Fee collection pays the immutable per-project ledger. The permissionless caller pays gas and receives no built-in bounty or gas reimbursement. Each beneficiary pays its own claim gas. Claims can be deferred, and the contract also supports independent asset claims to the same committed recipient. Keep earned, collected and claimed amounts separate. Collection has no liquidity withdrawal, auto-swap, buyback, burn or reinvestment effect.

The historical 560,153-gas collection at an illustrative 10 gwei costs 0.00560153 ETH before poster fees. At 25% original active share, approximate native-side volume of 7.47 ETH covers that expense at the original position level. The operating recipient's 5% alone needs about 149.37 ETH of eligible volume before its own claim gas. At 5% active share, those figures are about 37.34 ETH and 746.87 ETH. At zero active share, there is no modeled native-only break-even. The executable analysis reports per-threshold loopback gas when fork results are supplied, plus 1, 10 and 30 gwei execution scenarios and illustrative poster charges. Nitro's parent-chain posting charge is separate from simulated EVM gas and changes with compression and the parent data price. [Arbitrum gas and fees](https://docs.arbitrum.io/how-arbitrum-works/deep-dives/gas-and-fees)

Run `node packages/contracts/scripts/measure-curve-fee-gas-4663.mjs --fork-evidence <json>` to sample the official 4663 RPC for the exact loopback collection, combined claim, native-only claim and token-only claim calldata. Repeat the option for other thresholds. The script pins and rechecks the observation block, reads the node's L2 base fee and uses Nitro's read-only parent data estimate. The operation addresses are local simulations. Combining observed unit prices with fork execution units produces an estimate. It is separate from both a live execution receipt and the fixed-gwei sensitivity cases. A zero poster response is a point observation. Feed the output into the economic script with `--gas-evidence <json>` and the matching `--fork-evidence` inputs to calculate native-only break-even from those observed rates. [Robinhood Chain gas and fees](https://docs.robinhood.com/chain/gas-and-fees/) · [Robinhood Chain protocol addresses](https://docs.robinhood.com/chain/protocol-contracts/)

The three-profile sample used Robinhood block 113559704 with a pinned base fee of 20,102,000 wei per gas. NodeInterface returned zero poster gas for all twelve exact calls. Each profile used 560,153 gas for collection, 110,605 for a combined claim, 42,932 for a native claim and 68,957 for a token claim. Collection at the pinned rate is approximately 0.00001126 ETH. At 25% active share, about 0.01501 ETH of eligible native-side volume covers collection at the position level. About 0.32329 ETH is needed to cover collection plus the operating recipient's separate native claim from its own 5% credit. The historical 10 gwei stress case remains materially higher.

For operator review, use a manual, measured-value trigger instead of a daily or weekly commitment. First confirm the exact original position and preview ETH and token fees at a recent canonical block. Reprice the transaction using chain-specific execution and poster costs. A proposed 2× margin gives a simple review criterion. A sponsor covering public collection should compare the aggregate beneficiaries' safely valued receipts to full costs. An operator paying from its own budget should compare only its own spendable receipts to collection plus its own claim. Use native-only evidence when the token has no defensible independent executable price. Defer zero fees, dust, stale estimates or poor economics. A sponsored exception needs a disclosed payer and separate budget. A recipient may still claim at its own expense.

At the illustrative historical cost, 25% active share and 2× native-only aggregate margin, the low and medium examples fail a 30-day trigger. The medium example reaches it by 90 days under constant input. The high example reaches it by 7 days, while the operating recipient still fails at 30 days even before its own claim gas. Actual cadence should follow observed value and costs. These examples do not establish a collector service, an operating subsidy, a guaranteed yield or automatic execution.

Applying the official 4663 price sample instead, the low example reaches the same margin within the first modeled 1-day interval for collection alone, the 7-day interval when including four combined claims, and the 30-day interval for the operating recipient to cover collection plus its own native claim. For the medium example the corresponding intervals are 1, 1 and 7 days. The high example reaches all three within the 1-day interval. These are comparisons under constant synthetic inputs, so even a favorable observation should not set a recurring schedule.
