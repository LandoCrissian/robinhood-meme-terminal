# Universal Token Workspace

RMT gives qualified external Robinhood Chain markets a dedicated workspace at
`/market/{tokenAddress}`. It is the trading and discovery surface for tokens that
were not launched by RMT. RMT-native projects continue to use their project-first
pages.

## First production increment

Each external workspace combines:

- the exact indexed token, pool, venue, and origin evidence;
- live price, liquidity, valuation, volume, age, and trade-pressure metrics;
- candlestick history for 1 hour, 6 hours, 24 hours, and 7 days;
- project metadata and token imagery when a verified source supplies them;
- activity, safety, and origin views;
- RMT's existing non-custodial Sushi or canonical Uniswap execution panel; and
- a persistent mobile buy/sell dock designed for one-handed use.

Opening a workspace does not make a token safe. Execution remains unavailable
unless the existing venue-specific verification and fresh-quote checks pass.

## Order ticket

The Sushi and canonical Uniswap paths share one order-entry language while
retaining separate venue verification and transaction construction:

- 25%, 50%, and maximum wallet-balance shortcuts;
- a network-fee reserve that prevents a native-token maximum from consuming the
  entire ETH balance;
- exact wallet and token balance validation;
- expected and minimum received values;
- the enforced 1% maximum slippage boundary;
- a live quote-expiry countdown;
- price-impact severity that never weakens the existing 10% execution block;
- a Quote → Evidence → Wallet progress path; and
- explicit approval, submission, confirmation, and explorer states.

The interface does not expose a cosmetic slippage setting. The displayed
protection is the value enforced in the server-verified transaction.

## One-time trading terms

The trading surfaces require acceptance of the current version of RMT's trading
terms before interaction. Acceptance is stored in the user's browser and shared
across Terminal, Explore, external markets, and project pages. It appears again
only when the version changes or browser site data is cleared.

This removes repeated token-by-token consent checkboxes. It does not hide
token-specific evidence or weaken automatic execution blocks. A failed
sell-direction simulation, invalid route, stale quote, insufficient balance, or
excessive price impact still prevents transaction preparation or submission.

## Live activity and wallet positions

External market workspaces use GeckoTerminal's public pool-trades endpoint for a
read-only, server-validated live tape:

```text
https://api.geckoterminal.com/api/v2/networks/robinhood/pools/{pool}/trades
```

RMT fixes the upstream host and network, validates the token and pool addresses,
rejects malformed trades, and refreshes the visible tape every ten seconds.
Each row links to the corresponding Robinhood Chain transaction.

Connected-wallet position cards read the token balance directly onchain and
estimate current value using the displayed market price. RMT intentionally
withholds cost basis and unrealized P&L until complete wallet history can be
proven; current value is not presented as profit.

## Holder intelligence

The Safety tab converts the same server-validated Blockscout evidence used by
the order ticket into a readable holder view. It shows:

- the reported holder count;
- the combined share of the ten largest visible non-pool holders;
- the largest visible non-pool wallet;
- the reported creator balance when origin evidence supplies a creator;
- wallet-versus-contract labels; and
- direct Blockscout links for independent review.

The displayed pool, zero address, and standard dead address are excluded from
the concentration list. The list is a snapshot of Blockscout's visible top
holder page, not a complete identity map: one person can control multiple
wallets and contract ownership may be indirect. Missing data is shown as
unknown, never safe.

External markets can also be saved directly from their workspace. RMT-native
watchlist entries continue to open project pages; external entries return to
their qualified `/market/{tokenAddress}` workspace.

## Market-history dependency

RMT uses CoinGecko's public GeckoTerminal API for read-only OHLCV history:

```text
https://api.geckoterminal.com/api/v2/networks/robinhood/pools/{pool}/ohlcv/{timeframe}
```

No paid plan or API key is required for this release. The server route validates
the requested token and pair, confirms whether the requested token is the base
or quote asset returned for the pool, normalizes candle direction, rejects
malformed data, and caches successful responses. The browser never selects an
arbitrary upstream host.

Primary documentation:

- <https://docs.coingecko.com/docs/keyless-public-api>
- <https://docs.coingecko.com/reference/pool-ohlcv-contract-address>

The public API is rate limited and has no RMT-specific availability guarantee.
When history cannot be verified, the chart fails closed while the rest of the
workspace remains usable. Transaction preparation does not depend on this chart
data.

## Execution boundaries

- RMT does not custody user funds.
- Every approval and swap is reviewed, signed, and confirmed by the user's wallet.
- Chart candles never authorize a transaction or substitute for an onchain quote.
- External execution retains the server-side kill switches documented in
  `SUSHI_INTEGRATION.md` and `EXTERNAL_UNISWAP_TRADING.md`.
- Tokens outside the qualified external index do not receive an executable
  workspace.

## Verification

```bash
pnpm --filter web test:external-ohlcv
pnpm --filter web test:trade-ticket
pnpm --filter web test:trading-terms
pnpm --filter web test:external-trades
pnpm --filter web test:external-uniswap
pnpm --filter web test:token-risk
pnpm --filter web typecheck
pnpm --filter web build
```

The OHLCV smoke test covers URL construction, token/pair validation, inverted
quote-token candles, malformed candle rejection, sorting, deduplication, and
response-size limits.
