# External Uniswap trading inside RMT

RMT can prepare non-custodial swaps for qualified external Robinhood Chain markets without sending the user away from Terminal. This path is separate from the canonical RMT V6 Uniswap V4 graduation path.

## Supported production scope

RMT supports exact-input Uniswap V3 buys and sells when all of the following are true:

- DEX Screener identifies the requested token and exact pair as a Robinhood Chain Uniswap market;
- the market meets RMT's minimum display-liquidity threshold;
- the pair has deployed bytecode;
- the pair reports the official Uniswap V3 factory;
- the official factory maps the pair's token0, token1 and fee back to that exact pair address;
- the pair contains exactly the requested token and canonical Robinhood WETH;
- its fee is a valid Uniswap V3 fee value;
- its live `slot0` price is initialized and readable;
- the official QuoterV2 and SwapRouter02 both have deployed bytecode;
- the user receives a fresh quote for the exact amount, token, side, pair and wallet.

No arbitrary tokens, pairs, routers, recipients or calldata are accepted from the browser.

### Passport-gated Uniswap V4

Uniswap V4 is a separate route, never a renamed V3 quote. RMT discovers a V4
pool only when DEX Screener supplies a 32-byte pool ID and RMT independently
reconstructs the exact canonical `PoolKey` from the PoolManager initialization
event. StateView must confirm initialized pool state and the official
PoolManager, StateView, Quoter and Universal Router must have live code.

An independently verified V4 market is not automatically executable. The RMT
V4 Passport is a hard transaction gate:

1. decode every hook permission from the hook address;
2. inspect published source, proxy state, bytecode status and custom write
   functions when a hook is present;
3. use a real holder in a no-broadcast sequence that approves the token,
   grants a short Permit2 allowance and completes a sell;
4. require the Passport result to be `eligible`, not `review` or `blocked`;
5. quote the user's exact buy or sell;
6. build the deadline- and minimum-output-bounded Universal Router transaction;
7. rehearse that exact wallet transaction without broadcasting; and
8. return calldata only when every preceding check passes.

Hook-controlled pools remain visible with their evidence, but they do not
silently become executable. A pool that passes the generic exit rehearsal can
still fail the user's exact amount and remain blocked.

## Canonical Robinhood Chain dependencies

Verified against the official Uniswap deployment registry for chain ID `4663`:

| Contract | Address |
| --- | --- |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| Uniswap V3 factory | `0x1f7d7550B1b028f7571e69a784071F0205FD2EfA` |
| Uniswap V3 NonfungiblePositionManager | `0x73991a25c818bf1f1128deaab1492d45638de0d3` |
| QuoterV2 | `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` |
| SwapRouter02 | `0xcaf681a66d020601342297493863e78c959e5cb2` |
| V4 PoolManager | `0x8366a39cc670b4001a1121b8f6a443a643e40951` |
| V4 StateView | `0xf3334192d15450cdd385c8b70e03f9a6bd9e673b` |
| V4 Quoter | `0x8dc178efb8111bb0973dd9d722ebeff267c98f94` |
| Universal Router | `0x06afba43fd06227fa663b0daecf536f6eaa6bf99` |
| Permit2 | `0x000000000022d473030f116ddee9f6b43ac78ba3` |

Primary source:

- <https://github.com/Uniswap/contracts/blob/main/deployments/json/4663.json>

## Transaction guarantees

- Exact-input only.
- Minimum received is fixed at 99% of the fresh onchain quote.
- Price impact is calculated from the executable output versus the pool's live pre-trade spot price in the correct token direction, including the pool fee.
- RMT refuses to return executable calldata when calculated price impact exceeds 5%.
- SwapRouter02 `multicall(uint256,bytes[])` enforces a ten-minute deadline.
- Buys send only the entered ETH amount.
- Sells request an ERC-20 approval for only the entered token amount.
- Sell output is received as WETH by SwapRouter02 and unwrapped directly to the connected wallet.
- The API response is rejected by the browser if token, pair, recipient, side, amount, router, chain or deadline differs.
- Every approval and swap is submitted and confirmed by the user's wallet.
- RMT never receives or holds the user's input or output assets.

For V4 sells, the token approval is limited to the entered amount. The
subsequent Universal Router allowance is granted through canonical Permit2 for
the entered amount and expires after 20 minutes. V4 buys attach only the entered
ETH value. Both directions enforce a ten-minute route deadline and 1% maximum
slippage.

## Automatic route comparison

RMT treats Sushi, Uniswap V3 and Uniswap V4 as independent execution routes. It
requests each quote for the same wallet, side and input amount, compares minimum
received rather than optimistic output, applies the user's price-impact limit,
and changes routes automatically only when protected output improves by at
least 0.25%.

Native ETH sentinel addresses are normalized only inside the comparison
calculation so V3, V4 and Sushi sell outputs can be compared. The original
router, token addresses, recipient and calldata remain untouched. A V4 quote
cannot enter the comparison set unless its Passport and exact-wallet rehearsal
both pass.

## Release control

The server-only environment variable below is the production kill switch:

```text
RMT_EXTERNAL_UNISWAP_EXECUTION_ENABLED=true
```

When it is absent or not exactly `true`, the transaction endpoint returns `503` and no executable calldata is supplied.

## Tests

```bash
pnpm --filter web test:external-uniswap
pnpm --filter web test:external-v4-evidence
pnpm --filter web test:external-venues
pnpm --filter web test:trade-ticket
```

The tests prove that spoofed pair data, wrong chains, wrong venues, non-DEX URLs, substituted tokens, thin liquidity, wrong factories, non-WETH pools, invalid fees, uninitialized prices and missing pool code all fail closed. They verify price-impact arithmetic for both token directions and decode the complete buy and sell calldata to check the router recipient, amount, minimum received, WETH unwrap recipient and route deadline.

Before an external buy is enabled, RMT performs the same read-only holder-to-pool transfer
probe used by its Sushi path. A deterministic transfer failure blocks the buy; an unavailable
probe is shown as unknown and still requires the user to review the evidence.

For factory-verified Pons tokens, RMT interprets the documented factory-only initial-buy
control only after comparing its expiry against Robinhood Chain's L1 block counter. This
prevents the Arbitrum L2 RPC height from making an expired two-block window appear active.
Unknown origins and additional write controls are not exempted.

## Limitations

- Only direct canonical Uniswap V3 token/WETH pools are supported.
- V4 execution currently supports direct native-ETH pools only.
- A V4 hook that can affect swaps, return deltas, expose custom write controls,
  lacks verified source, or cannot be proven non-upgradeable remains
  review-only even when a simulated sell succeeds.
- Multi-hop routing and UniswapX are not part of this release.
- Tokens with transfer taxes, rebases, hooks or other nonstandard transfer behavior may fail at wallet simulation and are not specially supported.
- Price impact is a point-in-time comparison against the pool's current spot price. It cannot prevent the market from moving before confirmation.
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
