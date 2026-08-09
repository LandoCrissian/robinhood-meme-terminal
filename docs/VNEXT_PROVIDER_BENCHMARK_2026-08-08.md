# VNext Provider Benchmark Evidence — 2026-08-08

Status: read-only foundation run; no provider admitted for production

## Safety boundary

This run used public registry, RPC bytecode/read calls, source-discovery, and indicative-price endpoints only. It made no wallet request, signature, approval, executable transaction request, order submission, transaction, deployment, bridge, fee, or treasury action. Raw encoded orders, calldata, typed data, and credentials are not logged.

Run the sanitized live probe from `apps/web` with:

```sh
pnpm benchmark:vnext-providers
```

The optional `RMT_ZEROX_API_KEY` is server-only. When absent, every 0x row is reported as `blocked_missing_key`; it is not counted as provider failure.

## Evidence snapshot

### Live production baseline

Every run now requests real indicative quotes for both existing RMT provider families across USDG→WETH, WETH→USDG, and a live-discovered liquid token in both directions. RMT is retained separately as a pre-graduation control case. Sushi is restricted by the harness to `GET /quote/v7/4663`; Uniswap uses the existing bytecode-pinned V3 quoter through read-only RPC calls. Results include atomic expected/protected output and latency, but never executable calldata.

The liquid-token sample is not hardcoded or mocked. The harness reads current Robinhood pairs from Dexscreener, selects the highest-liquidity non-USDG/non-WETH/non-RMT base asset with verified onchain ERC-20 identity, and derives an approximately $1 sell amount from its observed price and verified decimals. The selected symbol, address, liquidity, and price are included in sanitized output so every run remains auditable.

These rows establish the comparison baseline for future providers. They do not request wallet balances, approvals, simulations against a user account, signatures, or transactions.

Initial live snapshot at 2026-08-08 21:20 MDT:

| Direction and input | Sushi protected output | Uniswap V3 protected output | Coverage result |
| --- | ---: | ---: | --- |
| 1 USDG → RMT | — | — | Expected pre-graduation control result; RMT has not graduated into real liquidity. |
| 1 RMT → USDG | — | — | Expected pre-graduation control result; RMT has not graduated into real liquidity. |
| 1 USDG → WETH | `0.000517582299197998` WETH | `0.000517610631032090` WETH | Both available; Uniswap V3 was slightly higher in this sample. |
| 0.001 WETH → USDG | `1.892710` USDG | `1.893129` USDG | Both available; Uniswap V3 was slightly higher in this sample. |

These values are time-specific and indicative. The RMT result is not an adapter defect or evidence that the official RMT market is offline. It is the expected result for a token that has not graduated and does not yet have real liquidity; it must not be used to justify unnecessary route work.

Live-discovery validation at 2026-08-08 21:37 MDT selected `PIPEDOG` (`0x5Cb6F181081301b44905F3ae15419112ecaBd8A6`) from approximately $8.89 million of observed liquidity. Both providers returned complete indicative routes in both directions:

| Direction and input | Sushi protected output | Uniswap V3 protected output | Coverage result |
| --- | ---: | ---: | --- |
| 1 USDG → PIPEDOG | `372.478356632269351157` PIPEDOG | `372.493965925674468048` PIPEDOG | Both available. |
| ~1 USDG of PIPEDOG → USDG | `0.986057` USDG | `0.979599` USDG | Both available. |

The selected asset will change with live liquidity. This snapshot proves the discovery and bidirectional benchmark path; it does not permanently promote or endorse PIPEDOG.

### Pancake and PancakeSwapX contracts

The official Robinhood RPC returned nonempty runtime bytecode for all 11 published Pancake/PCSX addresses. The harness pins both byte length and keccak256 runtime hash and exits unsuccessfully if a future run differs.

| Contract | Address | Bytes | Runtime hash |
| --- | --- | ---: | --- |
| Pancake V2 Factory | `0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E` | 14,075 | `0xf57fbed9d08762f47eeac1fb2f25ee0cb166ee4043eed41baa8ff0d13206d76c` |
| Pancake V2 Router | `0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb` | 21,937 | `0x47b5456ea3c71255d2d7cac5f32979001162ab889319d32d11cc689572e9bb43` |
| Pancake V3 Factory | `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865` | 3,859 | `0xf6105f5817b3f67dd0f060fa27c1e23a14d9fca13c6ebd695545ca4d5c0fbe06` |
| Pancake V3 Pool Deployer | `0x41ff9AA7e16B8B1a8a8dc4f0eFacd93D02d071c9` | 24,556 | `0xedd527f11646c1912dfc51b57ffa0ee27972f8798bcaf7bc68ae6ad054b6022b` |
| Pancake Quoter V2 | `0x8553AA1615549A86882151784b329B017aA7c832` | 8,331 | `0xd13c8db0741380e13fca4e7dcc4840dde19f6103dd8ee2a99af0ae058d1ab1e6` |
| Pancake Mixed Route Quoter | `0x2b792b99ae08483D45d79833408439674C6Daf1B` | 9,002 | `0x3cf4d2a66c8ee21005eb7faf7fd20737f9eb1fa2581afe5ce5f8e22158274c03` |
| Pancake Smart Router | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` | 24,275 | `0x7b7d21a7f218720a2439e4b5383f1cdcbfff6c4dde354731626dd618d9df8ad8` |
| Pancake Universal Router | `0xE28c0e44F4016b073db20cF28971CAc6ce3664D3` | 22,314 | `0xefe4d5b1302b8ed9e6344b151b0b5eb18405f794e1d18c668b409d8f128b8e11` |
| PCSX MultiReactor Router | `0x3dbca663C889A80ECf476741fDb094ea0c205aE8` | 1,529 | `0xf875ab8eadcfbcf6204ab7888a4b10e33720144b7700e600f8991bd956d1578c` |
| PCSX Order Quoter | `0x87CB6Bef25861b310E68B200Cc7cBd24110d262d` | 4,449 | `0xf2479011676f039e56ed0225f554c543c6a34f72f551decaba672e5c96c09959` |
| PCSX Permit2 | `0x31c2F6fcFf4F8759b3Bd5Bf0e1084A055615c768` | 7,020 | `0xb484a796df5e76f7210becfef1660f35acfaac6c9b5e365bef3425f6621c6a5d` |

Runtime presence is not proof that a provider API is available, an address is safe to authorize, or a route is executable. Proxy implementation resolution and provider-specific verification remain production gates.

### PancakeSwapX distributor

Two read-only `POST /order-price/get-price` probes were made against production:

| Direction | Result | Meaning |
| --- | --- | --- |
| USDG → WETH on chain 4663 | HTTP 400: an RWA is required on one side | The distributor recognized Robinhood but is not currently a general crypto/meme route through this interface. |
| USDG → first active chain-4663 RWA from Robinhood's live registry (`P` during this run) | HTTP 400: no order book found | The request passed chain/RWA validation and reached order-book selection, but no route was available at the tested $1 notional and time. |

This establishes `API_4663_ACCEPTED`, not `ROUTE_COVERAGE_VERIFIED`. Any successful future response remains `quote_returned_unverified` until RMT decodes the order type and independently verifies the PCSX Permit2, MultiReactor Router, EIP-712 domain, exact economics, recipient, deadline, and order hash.

### 0x

Official 0x documentation currently lists Robinhood chain 4663 for Swap API and Gasless API. The official `/sources`, `/swap/allowance-holder/price`, and `/gasless/price` endpoints require an API key. No server-only 0x key was configured for this run, so source composition, standard indicative routing, and gasless coverage remain **unmeasured**, not failed.

## Current decision

- Preserve Sushi and Uniswap direct as the live baseline.
- Keep UniswapX on its separate verification/release track.
- Do not add Pancake direct merely because bytecode exists.
- Treat PCSX as an RWA-specialized research candidate until repeated quotes prove useful coverage and its signed-order verifier is complete.
- Obtain a dedicated server-only 0x benchmark key, then measure sources, Swap indicative prices, and Gasless indicative prices across the representative matrix in `RMT_EXECUTION_PROVIDER_BENCHMARK.md`.
- Do not add any provider to terminal startup. Quote fanout remains request-time only.

## Primary sources

- PancakeSwapX addresses: <https://developer.pancakeswap.finance/contracts/pcsx/addresses>
- PancakeSwapX swap integration: <https://developer.pancakeswap.finance/contracts/pcsx/swap-integration>
- 0x supported chains: <https://docs.0x.org/docs/introduction/supported-chains>
- 0x liquidity sources API: <https://docs.0x.org/api-reference/evm-ap-is/sources/getsources>
- 0x Allowance Holder indicative price: <https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getprice>
- 0x Gasless overview: <https://docs.0x.org/evm/gasless-api/introduction>
- Robinhood contracts: <https://docs.robinhood.com/chain/contracts/>
- Robinhood Stock Token API: <https://docs.robinhood.com/chain/stock-token-apis/>
