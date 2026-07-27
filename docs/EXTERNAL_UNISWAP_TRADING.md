# External Uniswap trading inside RMT

RMT can prepare non-custodial swaps for qualified external Robinhood Chain markets without sending the user away from Terminal. This path is separate from the canonical RMT V6 Uniswap V4 graduation path.

## Supported production scope

The first release supports exact-input buys and sells when all of the following are true:

- DEX Screener identifies the requested token and exact pair as a Robinhood Chain Uniswap market;
- the market meets RMT's minimum display-liquidity threshold;
- the pair has deployed bytecode;
- the pair reports the official Uniswap V3 factory;
- the official factory maps the pair's token0, token1 and fee back to that exact pair address;
- the pair contains exactly the requested token and canonical Robinhood WETH;
- its fee is a valid Uniswap V3 fee value;
- the official QuoterV2 and SwapRouter02 both have deployed bytecode;
- the user receives a fresh quote for the exact amount, token, side, pair and wallet.

No arbitrary tokens, pairs, routers, recipients or calldata are accepted from the browser.

## Canonical Robinhood Chain dependencies

Verified against the official Uniswap deployment registry for chain ID `4663`:

| Contract | Address |
| --- | --- |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Uniswap V3 factory | `0x1f7d7550B1b028f7571e69a784071F0205FD2EfA` |
| Uniswap V3 NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` |

Primary source:

- <https://github.com/Uniswap/contracts/blob/main/deployments/json/4663.json>

## Transaction guarantees

- Exact-input only.
- Minimum received is fixed at 99% of the fresh onchain quote.
- SwapRouter02 `multicall(uint256,bytes[])` enforces a ten-minute deadline.
- Buys send only the entered ETH amount.
- Sells request an ERC-20 approval for only the entered token amount.
- Sell output is received as WETH by SwapRouter02 and unwrapped directly to the connected wallet.
- The API response is rejected by the browser if token, pair, recipient, side, amount, router, chain or deadline differs.
- Every approval and swap is submitted and confirmed by the user's wallet.
- RMT never receives or holds the user's input or output assets.

## Release control

The server-only environment variable below is the production kill switch:

```text
RMT_EXTERNAL_UNISWAP_EXECUTION_ENABLED=true
```

When it is absent or not exactly `true`, the transaction endpoint returns `503` and no executable calldata is supplied.

## Tests

```bash
pnpm --filter web test:external-uniswap
```

The tests prove that spoofed pair data, wrong chains, wrong venues, non-DEX URLs, substituted tokens, thin liquidity, wrong factories, non-WETH pools, invalid fees and missing pool code all fail closed. They also decode the complete buy and sell calldata to verify the router recipient, amount, minimum received, WETH unwrap recipient and route deadline.

Before an external buy is enabled, RMT performs the same read-only holder-to-pool transfer
probe used by its Sushi path. A deterministic transfer failure blocks the buy; an unavailable
probe is shown as unknown and still requires the user to review the evidence.

For factory-verified Pons tokens, RMT interprets the documented factory-only initial-buy
control only after comparing its expiry against Robinhood Chain's L1 block counter. This
prevents the Arbitrum L2 RPC height from making an expired two-block window appear active.
Unknown origins and additional write controls are not exempted.

## Limitations

- Only direct canonical Uniswap V3 token/WETH pools are supported.
- Multi-hop routing and UniswapX are not part of this release.
- Tokens with transfer taxes, rebases, hooks or other nonstandard transfer behavior may fail at wallet simulation and are not specially supported.
- A passing sell-direction transfer is not a full swap guarantee and cannot predict future blacklist, fee, liquidity, or administrator changes.
- RMT does not claim that a verified pool or successful quote makes a token safe.

## Launchpad position evidence

For Pons and Noxa projects, the pinned launch factory publishes an exact position manager
and position ID. RMT accepts that evidence only after the NFT's token pair and fee resolve
through the manager's live factory to the exact displayed pool. RMT then reports the current
owner, direct approval, creator operator status, and nonzero position liquidity. A contract-held
position remains labeled `lock unproven`; custody by a contract is not proof that its withdrawal
paths are disabled.
- The independent external contract review noted elsewhere in RMT documentation remains outstanding.
