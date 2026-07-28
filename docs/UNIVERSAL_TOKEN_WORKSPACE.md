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
pnpm --filter web test:external-uniswap
pnpm --filter web test:token-risk
pnpm --filter web typecheck
pnpm --filter web build
```

The OHLCV smoke test covers URL construction, token/pair validation, inverted
quote-token candles, malformed candle rejection, sorting, deduplication, and
response-size limits.
