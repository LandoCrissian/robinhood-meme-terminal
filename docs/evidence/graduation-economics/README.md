# Graduation decision for RMT

**Recommendation — keep the published 2 ETH curve.** The deployed factory can graduate. Two independent forks completed the entire lifecycle with its actual contracts. It is economically suitable for an early community launch only if the owner accepts a shallow opening pool and the possibility of indefinite non-graduation. There is no measured evidence that buyers will supply the required demand. A lower threshold sacrifices depth for an easier finish. Creation remains a separate decision. [Machine-readable measurements](measurements.json)

## Which contract a creator actually gets

On 22 November 2026 both Robinhood’s mainnet RPC and Pocket returned the same block **120494375**, hash **0x9f67b0fa3ded0dc15c5c583ea8b0df9a0989746c98618595b9e482d7214d3d31**. The directory’s published version 1 points to Factory V2 at **0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3**. Its initcode hash is **0xa9a337271cd3a91f9de691800b98526bd612de1cace33c3f18e41df0c1aabbfa**. Its runtime hash is **0x519d55e694263866896e05023834b124829173f13f42c5aea7e3ca2200c5a091**. [Factory](https://robinhoodchain.blockscout.com/address/0x7281e1F9D8764Ae6533b374DFd08AB2ECbC273c3) · [Publication transaction](https://robinhoodchain.blockscout.com/tx/0x75e212779bb81b988c9fc9ae960b7535ea104e92751458c7b7268f89dc38942f)

The raw development sources use chain 31337, 2 virtual ETH and 1 ETH backing. The fixed-supply build changes the pricing constants to 4 and 2. Its production build also changes the chain guard to 4663. The archived standard compiler input has SHA-256 **66aa27a8f98a395ba76cbf770a890107a56c60af4a5975bfdadd349c84273e10**. Solc **0.8.26+commit.8a97fa7a**, Cancun, via IR, optimizer 200 reproduced the factory runtime byte-for-byte after filling its seven constructor immutables from independent getters. The factory embeds the V1 bonding curve creation image with Keccak-256 **0xe340621b25335e961edecef09b99e1c6e9106533b2f3effb997613017d2f6664**. [Build transformations](../../../packages/contracts/scripts/fixed-supply-profile.mjs) · [Exact compiler input](../rmt-task091/governance/source-publication/solc-standard-input-4663.json.gz)

Each fork created the synthetic ECON project in one discarded call. Reading its 14 immutable getters reconstructed its entire runtime, including factory, token, creator, ledger, treasury allocation, registry, engine, supply and sale threshold. The fresh curve returned execution version 1, zero migration source, 4 virtual ETH, 2 real ETH at graduation and 100 basis points per trade. Its instance hash depends on constructor addresses. V2/V3 successor templates are for separately approved registry migrations. Ordinary factory creation cannot select them. [Fork probe](../../../scripts/economics/GraduationProbe.sol) · [Registry migration rules](../../../packages/contracts/src/RMTLaunchProjectRegistryV3.sol)

A second run fetched fork state independently from each RPC with Anvil storage caching disabled. Both providers agreed at block **120503005**, hash **0xc80925bdb5991db410bedaa19c8a16ebcb0fe99e150f89b7248f884b71d2a615**. Between blocks, only the block context and the position manager’s NFT serial changed. Every quote, fee bucket, reserve, liquidity amount, rounding balance and price stayed identical. The runner also reproduced the rehearsal ERC-20 address by CREATE2 from the public factory, synthetic sender, intent and compiled token constructor. [Second run](measurements.json) · [First run](https://github.com/LandoCrissian/robinhood-meme-terminal/blob/412730e4c8ade1093dda91e0075482ecba97a441/docs/evidence/graduation-economics/measurements.json)

## What buyers actually pay

The fixed supply is one billion 18-decimal tokens. The opening real ETH balance is zero. Let V be 1.8 billion tokens in atomic units, E be 4 ETH in wei, and S be net token units sold. Required backing is **ceil(E × V / (V − S)) − E**. A single buy to an attainable backing increase B needs **ceil(100 × B / 99)** wei gross. Excess is refunded. A sell pays the decrease in backing less a fee rounded up to the next wei. Net sales can move in either direction before graduation.

Each row is an independent quote from zero targeting the named milestone. Gross, fee and backing are exact wei. Price is the marginal fee-exclusive rate in gwei per whole token. With one billion tokens, its numeric value also equals FDV in ETH. The last column values tokens outside the curve or original LP at that marginal price. Neither valuation is available cash.

| Target sold, millions | Gross wei | Fee wei | Backing wei | Spot gwei / FDV ETH | Outside-pool cap ETH |
|---:|---:|---:|---:|---:|---:|
| 0 | 0 | 0 | 0 | 2.222222222 | 0 |
| 100 | 237670825906120025 | 2376708259061201 | 235294117647058824 | 2.491349481 | 0.249134948 |
| 200 | 505050505050505051 | 5050505050505051 | 500000000000000000 | 2.812500000 | 0.562500000 |
| 300 | 808080808080808081 | 8080808080808081 | 800000000000000000 | 3.200000000 | 0.960000000 |
| 400 | 1154401154401154403 | 11544011544011545 | 1142857142857142858 | 3.673469388 | 1.469387755 |
| 500 | 1554001554001554003 | 15540015540015541 | 1538461538461538462 | 4.260355030 | 2.130177515 |
| 599 | 2015155720401349045 | 20151557204013491 | 1995004163197335554 | 4.991677072 | 2.990014566 |
| 600 | 2020202020202020203 | 20202020202020203 | 2000000000000000000 | 5.000000000 | 3.000000000 |

The exact marginal rate is E × V / (V − S)² in wei per token atomic unit. At intermediate milestones, integer inversion can deliver a fraction of a token beyond the target. The measurements retain the exact delivered units and rational price. Multiple trades can add wei of fee rounding. Gas and the separate 0.0004 ETH creation fee are excluded. [Every on-fork quote](measurements.json)

**How a launch can stall.** An ordinary 3 ETH buy from zero reached 600 million sold and refunded **0.979797979797979797 ETH**. The curve was eligible and still open. Selling 100 million before graduation returned **0.456923076923076922 ETH** after fees and brought real backing down to **1.538461538461538462 ETH**. Returning to eligibility cost **0.466200466200466200 ETH** gross. At 100 million sold, only about 0.2353 ETH of real backing exists, however large cumulative trading volume might be. Ordinary buys can leave a separate permissionless graduation call outstanding. The contract also supports an atomic final buy and graduation. A lack of buyers, offsetting sales or an unsubmitted graduation call can leave a project on-curve indefinitely.

**What actually went into v4.** The two executions deposited **1.999999999999998463 ETH** and **399,999,999.999999999999987510 tokens**. The curve retained 1,537 wei and 12,490 atomic token units. The original position used ticks −887220 to 887220, spacing 60 and a 0.30% pool fee. The position manager reported positive liquidity, the graduation engine as NFT owner and zero approved operator for the NFT. The pinned contract permanently holds the principal and separately accounts for fees. Actual curve fee buckets in the zero-treasury fork agreed with the cumulative creator/operations/reserve 90/5/5 split to the wei. The original LP fee share uses the same split. [Graduation and custody](../../../packages/contracts/src/RMTV4CurveGraduationV1.sol) · [LP fee allocation](../../../packages/contracts/src/RMTLaunchCurveLpFeeLedgerV1.sol)

The pool’s observed sqrtPriceX96 was **1120455419495722798374638764549163**. With native ETH as currency zero, the initial price in ETH per token is 2¹⁹² / sqrtPriceX96². It agrees with the terminal 5 gwei per token to better than one part in 10³². Initial pool FDV is approximately **5 ETH**, the outside-pool float approximately **3 ETH**, and two-sided marked liquidity approximately **4 ETH**. Only about **2 ETH** is cash in the pool. Near-full-range constant-product math with a 0.30% fee implies a 0.1 ETH buy costs about **5.30% above** the opening marginal price on average. That is a size illustration before other trades and gas.

## Comparable launchpads

| Model | Graduation and liquidity | Fees and custody |
|---|---|---|
| Pons V1, Robinhood Chain | Opens directly in a locked WETH pool. Default graduation marks 4.2 WETH of paired principal in that same pool. | The pool charges 1%. Trading continues there after the milestone. [Pons V1 documentation](https://docs.ponsfamily.com/) |
| Pons V2, Robinhood Chain | Both RPCs returned one enabled launch config at the comparison block. Native config 0 has 1B supply, 1.68 phantom ETH and a 4.2 ETH threshold in real quote reserves. Its documented allocation formula leaves approximately 285.7M tokens reserved at sell-out. Approved non-native pairs have their own quote-asset units. | The config charges 100 bps on the curve. The zero-fee v4 pool uses the Pons hook for trading charges. Optional creator tax and the short launch tax can change what the buyer pays. A finishing buy attempts graduation and the full-range position goes into the permanent locker. [Pons V2 documentation](https://docs.ponsfamily.com/v2) · [Observed config](measurements.json) |
| Pump.fun / PumpSwap, Solana | The program marks completion when its real sale-token inventory empties. Using the documented example of 1.073B virtual tokens, 30 virtual SOL and 793.1M real sale tokens gives roughly **85.005 SOL** net collected and **410.88 SOL** marginal FDV. These are separate measures and example parameters, not a universal USD trigger. Check each launch’s configuration and mode. | The published fee schedule lists 1.25% on the curve and tiered fees for canonical PumpSwap pools. The migration instruction is permissionless and the received LP tokens are burned. [Program definitions and example](https://github.com/pump-fun/pump-public-docs/blob/bc35796152027d2744ca02066d305438e34b67e7/docs/PUMP_PROGRAM_README.md) · [Fee schedule](https://pump.fun/docs/fees) |

Primary sources checked on 22 November 2026. RMT asks for about 48% of Pons V2 config 0’s native quote target. Neither that ratio nor Pump’s SOL example predicts completion probability. A defensible forecast needs comparable launch cohorts, unique participating buyers and net purchases over time.

## Owner choices

Holding supply, 60/40 allocation, fee and price continuity fixed gives the following design alternatives. Estimates assume a single progression from zero and no selling.

| Real ETH target | Virtual ETH | Gross buys, ETH | Terminal FDV, ETH | Average premium for a 0.1 ETH opening-pool buy | Implementation |
|---:|---:|---:|---:|---:|---|
| **2** | **4** | **2.020202** | **5** | **5.30%** | **Keep published v1.** |
| 1 | 2 | 1.010101 | 2.5 | 10.30% | New immutable release, deployments and acceptance. |
| 4.2 | 8.4 | 4.242424 | 10.5 | 2.68% | New immutable release, deployments and acceptance. |

The 1 ETH alternative makes a 0.1 ETH trade about twice as large relative to liquidity. The 4.2 ETH alternative improves depth but asks buyers for 2.2 ETH more net backing. Keep 2 ETH if that compromise fits RMT’s audience. If execution depth for orders of 0.1 ETH or more is a launch requirement, defer creation and select a deeper design before issuance. No website flag can change the published factory’s constants.

**Creation decision.** The graduation contract passed its economic acceptance test. Creating the token starts the curve with zero real backing. Website trading is disabled, so visitors currently cannot supply the required demand through the launchpad. If a functioning public buy flow is a launch requirement, hold creation until that flow passes its separate acceptance and the owner approves it.

## Website review

The preview serves application commit `412730e4c8ade1093dda91e0075482ecba97a441`. Netlify reports deploy `6b02a871f8039afde8b07443` in preview context. The Linux CI bundle SHA-256 is `9dcd83dd76fdb446648bb7902d0759ad746e58e71afc771b9772e9c7c47e4ef1`. The hosted server function matches the CI function archive SHA-256 `5377939fac6ba94cbc24a8eae02bb00ae07b6b7293638c2cd35bd389245e6a07`. [Creator preview](https://6b02a871f8039afde8b07443--eclectic-valkyrie-16cb92.netlify.app/create-token) · [Risk disclosures](https://6b02a871f8039afde8b07443--eclectic-valkyrie-16cb92.netlify.app/risks) · [CI artifact job](https://github.com/LandoCrissian/robinhood-meme-terminal/actions/runs/45002842897/job/137147919517)

At 08:32 UTC on 22 November 2026, desktop Chromium at 1440 px and mobile WebKit at 390 px both displayed the exact gross requirement, restored the synthetic ECON draft on refresh and returned disabled financial configuration. The 447 website tests passed. Production remained on deploy `6b029787efaaf7bc868d68e4`. The owner’s existing public artwork and metadata still matched their recorded SHA-256 digests. [Desktop screenshot](desktop.png) · [Mobile screenshot](mobile.png)

## Reproduce

From the repository root, use the pinned native solc 0.8.26 and Anvil. Supply a new output path. The runner compiles the exact archived input, compares runtime bytes and getter-derived immutable values, reads both public providers, and executes one discarded call per loopback fork with a synthetic-funded probe. Use the recorded block when both providers retain that state, or omit the block for a fresh common observation.

~~~sh
node scripts/economics/measure-graduation.mjs --solc /path/to/solc --anvil /path/to/anvil --output /tmp/graduation-rerun.json
pnpm --filter @rmt/launch-website test:history
~~~
