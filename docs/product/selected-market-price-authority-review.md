# Selected market price authority — owner review

Authorized base: `08f6a2c231a5b15eb96a0a80d7c6d2b989bcc7f0`. This change is not deployed.

## Established defect

SHRINU is the same chain-4663 token on both surfaces: `0x214F50E2f3bDE5B83a13344BF6221Bf0E0159925`, **Shareholder Inu / SHRINU**, 18 decimals. The previous workspace preferred the first GeckoTerminal token-pool observation (ordered by reported liquidity) over the selected scanner observation. It could therefore display a different pool's price without changing the visible token identity. Bytes32 V4 PoolIds also did not survive all workspace market-read boundaries. Neither a provider's pool listing nor reported liquidity proves a canonical pool or executable depth.

The exact-contract resolver found no V2/V3 pool for this token; the rebuilding persistent inventory returned zero SHRINU pools. Independent V4 verification established 26 distinct relevant PoolIds from the union of the two providers. All 26 have an official PoolManager Initialize event, a recomputed matching PoolId, the exact token relationship, and StateView state at block **80,055,900**. Fourteen have zero active liquidity at that block. Full identities, creation blocks, pool keys and comparable prices are in [the market table](selected-market-price-evidence/shrinu-markets.csv).

Official deployment authority: [Uniswap chain-4663 deployments](https://github.com/Uniswap/contracts/blob/main/deployments/json/4663.json). PoolManager: `0x8366a39cc670b4001a1121b8f6a443a643e40951`; StateView: `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b`. A V4 PoolId is not an individual pool contract; Initialize + pool-key hash is the applicable relationship proof. [StateView](https://github.com/Uniswap/v4-periphery/blob/main/src/lens/StateView.sol) supplies price state and active liquidity. The analysis uses decimal-aware Q96 price conversion and the active-liquidity formulas in [SqrtPriceMath](https://github.com/Uniswap/v4-core/blob/main/src/libraries/SqrtPriceMath.sol).

## Main observed markets

| Field | WETH market | USDG market |
|---|---|---|
| PoolId | `0x144b63eb5cf32f8c3aa1acd364e3cf7195188eb40eefefe5a403606f8a62ef51` | `0xa45cc007913122568c6216ac1a1e65dca96a26adbfd3b97bb6fcb0cc2760df58` |
| Creation block | 79,357,294 | 79,486,753 |
| Currency order | WETH / SHRINU | SHRINU / USDG |
| Fee / tick spacing | 0.3% / 60 | 20% / 2,000 |
| Hooks | `0xF983F7CAC7Eb345eebf7c8B2886c1E4ef55b0A80` | none |
| Onchain SHRINU / conditional USDG | 0.000006881645674 | 0.00000003612139746 |
| DexScreener USD observation | 0.000006882 | 0.00000003612 |
| Difference from normalized state | 0.00515% | 0.00387% |
| GeckoTerminal USD observation | 0.000008413321545 | 0.0000000361380558 |
| Difference from normalized state | 22.2574% | 0.04612% |
| Dex reported liquidity | $276,549.80 | $424.73 |
| Gecko reported liquidity | $129,186.25 | $725,644.06 |
| Virtual quote amount for ~1% move | ~$774–778 | ~$2.66–2.67 |

Prices and liquidity state are pinned to the same block. Provider captures are approximately concurrent, not guaranteed block-aligned. The WETH conversion is independently verified through the canonical Uniswap V3 WETH/USDG pool `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca`: 2,699.453083 USDG/WETH, fee 100. The other three canonical WETH/USDG fee tiers were also checked. USDG's [issuer contract documentation](https://docs.paxos.com/guides/stablecoin/usdg/mainnet) and [parity/redemption description](https://globaldollar.com/about-usdg) support the unit interpretation; **USDG=$1 is conditional here, not a live USD oracle**. No production oracle or conversion algorithm is introduced.

Depth numbers are fee/hook-free virtual amounts inside independently checked tick-bitmap bounds, clipped to a 1% price move. They are not executable quotes, full-range liquidity, or a guarantee of fills. The WETH hook has deployed code but its behavior is not inferred. A bounded 20,000-block Swap window through the pinned observation found zero swaps in the WETH pool and one in the USDG pool (block 80,054,443). This supports disclosing stale/thin observations; it does not establish manipulation. The pool-state price ratio is approximately **190.5×**. This is genuine cross-pool dispersion combined with unsafe silent selection, rather than a different SHRINU contract or a token-decimal error. The same-pool Gecko WETH discrepancy and its inconsistent quote-price fields remain provider-observation discrepancies; a provider implementation bug is not independently proved.

## Price concepts and selection policy

**SELECTED_MARKET_PRICE** is an informational observation for the exact token + chain + pool + provider perspective the user selected. Its refresh must retain that pool and perspective. A provider observation is labeled as such; canonical admission remains separate.

**TOKEN_REFERENCE_PRICE** would be an optional token-wide reference with a justified, separately disclosed methodology. This PR does not create one, average pools, or present a provider's highest reported liquidity as a fair token-wide price.

**EXECUTION_QUOTE** is the independently verified current 0x Swap API v2 AllowanceHolder quote on chain 4663 with the existing 25-bps fee. It may use another route. This PR does not route execution through the displayed pool or modify execution authority.

Initial scanner candidate selection retains the existing eligible-token-perspective/quote filters and deterministic primary-observation policy (reported liquidity, then volume, then pool identity). That policy chooses a displayed observation; it is explicitly not a depth comparison, best-price claim, or token reference methodology. The correction binds that selected pool to its metrics, venue and provider link together. Metrics from another pool are not transferred to the selected pool. No new browse admission, Active promotion, whitelist, indexer write or price ranking is added.

Tapping a rendered row passes the rendered market snapshot, including V4 PoolId. The workspace preserves its exact market context. External enrichment and Gecko market reads receive the exact pool hint; a wrong-pool/token response cannot replace the selected snapshot. Same-pool provider differences are separately labeled rather than silently interchanged. If the selected observation is unavailable, its own last-known snapshot remains available under the existing delayed/stale model. A poolless workspace pins its first established observation for subsequent bounded reads. Canonical evidence only labels the selected pool canonical when identities match.

Alternate observed prices are under More → Markets, with pool/quote/provider identity and the retrieval timestamp. At **>20% max/min dispersion**, a compact disclosure appears by the selected price. This threshold is a presentation trigger justified by material divergence beyond ordinary source rounding; it is not a manipulation alarm, precision claim, trading gate or admission rule. Observations are not averaged. The list is bounded to 20 rows with internal scrolling. The chart cannot silently present another pool's candles under the selected price; existing bounded provider recovery remains intact, and different-pool responses are not rendered as selected history.

## Production regression sample and limitations

31 unique actual scanner tokens were sampled read-only. Five had comparable positive workspace observations, including the separately captured genuine SHRINU observation; 26 returned unavailable optional presentation data and are not counted as matches. A slower bounded follow-up used 10-second spacing and stopped after two unavailable responses; it did not expand the unique comparable set. These reads were not block-aligned: timestamps/providers may account for the smaller same-pool differences.

Using `100 × abs(scanner − workspace) / min(scanner, workspace)`:

| Threshold | Comparable tokens |
|---|---:|
| >1% | 5 |
| >5% | 3 |
| >20% | 2 |
| >100% | 1 |

Comparable tokens: SI 2.25%, HI 25.96%, CRADLE 11.02%, SHRINU 18,943.64%, tek 1.43%. Four had the same pool with different provider/time observations. SHRINU had a different pool. Using scanner price as denominator instead, SHRINU is 99.475% lower in the old workspace; the ratio is approximately 190.44×. The architecture defect is general and independently reproduced by the controlled token/pool tests; this limited sample does not estimate chain-wide prevalence.

## Verification boundary

Corrected acceptance runs on a local production build, with genuine read-only production data and existing RPC access. No corrected public deployment is claimed. Separate deterministic browser tests replay the captured genuine SHRINU snapshot and deliberately deliver the former other-pool response; refresh order and the 1% metric update are explicitly controlled. The replay is test-only and not imported by production.

Acceptance covers 375, 390, 430 and 1440. The exact selected WETH PoolId and initial price match the scanner; compact source and dispersion disclosure remain legible. Existing live scanner and chart/identity/security suites remain required on the final exact head. Markets 60s / Launches 30s visibility, focus/reconnect/backoff and ranked interaction holds are preserved. No Explore redesign, launch worker change, database change, execution change, merge or deployment is included. PR553 remains untouched.
