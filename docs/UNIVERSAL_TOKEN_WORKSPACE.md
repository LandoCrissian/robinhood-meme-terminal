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
- exact-contract Robinhood Stock Token identity and verified Stock Token pool-pair relationships from Robinhood's live asset registry;
- activity, safety, and origin views;
- non-custodial Sushi, canonical Uniswap V3, and Passport-gated Uniswap V4
  execution panels; and
- a persistent mobile buy/sell dock designed for one-handed use.

Sushi Launch is also a first-party discovery input. RMT reads the documented
Sushi Data API through three bounded lenses (newest, 24-hour volume, and current
TVL), then attaches launch identity only when the API token and exact launch pool
match the independently discovered DEX pair. See
[`SUSHI_LAUNCH_DISCOVERY.md`](./SUSHI_LAUNCH_DISCOVERY.md) for the trust and
failure boundaries.

Opening a workspace does not make a token safe. Execution remains unavailable
unless the existing venue-specific verification and fresh-quote checks pass.

## Order ticket

The Sushi, Uniswap V3, and Passport-eligible Uniswap V4 paths share one
order-entry language while
retaining separate venue verification and transaction construction:

- 25%, 50%, and maximum wallet-balance shortcuts;
- a network-fee reserve that prevents a native-token maximum from consuming the
  entire ETH balance;
- exact wallet and token balance validation;
- expected and minimum received values;
- the enforced 1% maximum slippage boundary;
- a live quote-expiry countdown;
- price-impact severity that never weakens the existing 10% execution block;
- an Account → Quote → Evidence → Wallet progress path; and
- explicit approval, submission, confirmation, and explorer states.

When more than one venue is verified, RMT compares protected minimum output
across Sushi, Uniswap V3 and Uniswap V4. Automatic mode respects the user's
price-impact rule and moves only for at least 0.25% more protected output. A V4
route participates only after its holder sell rehearsal and exact-wallet
transaction both pass without broadcasting.

### Pre-sign fee transparency

Executable Sushi and Uniswap tickets estimate the next wallet transaction against
Robinhood Chain before submission. The ticket shows the network-fee estimate in
ETH and USD, states the RMT platform fee as zero, and includes the estimated
network fee in the displayed buy total. When a sell needs approval, the estimate
describes that exact approval first; after approval, the refreshed quote describes
the swap.

The estimate is read-only and never authorizes a transaction. Gas price, route
conditions, and wallet behavior can change before confirmation, so the connected
wallet remains the final fee authority. RMT uses twice the current estimate—or
the existing fixed fallback when estimation is unavailable—as the buy-sizing
reserve. A missing estimate does not weaken route validation or bypass the
wallet's own fee review.

The interface does not expose a cosmetic slippage setting. The displayed
protection is the value enforced in the server-verified transaction.

## Robinhood Stock Token provenance

RMT reads `https://api.robinhood.com/rhj/assets` as a cached, read-only identity registry. A stock label is attached only when the contract address exactly matches a Robinhood Chain deployment in that response. Matching a name or ticker is never sufficient.

The data model intentionally supports more than one relationship per project and distinguishes:

- `canonical-stock-token`: the displayed token contract is itself the canonical Robinhood Stock Token; and
- `paired-market-asset`: an independently discovered pool pairs the displayed token with a canonical Robinhood Stock Token.

A paired market does not mean the displayed project token is backed by, redeemable for, or economically entitled to the paired stock. RMT states that limitation in the optional Passport panel. Registry failure removes the relationship label without interrupting ordinary market discovery. Canonical Robinhood Stock Tokens remain view-only in RMT until enforceable jurisdiction controls exist; the server does not return execution venues or prepare a trade for those contracts. Stock Token availability and eligibility remain jurisdiction-dependent.

### Persistent trade presets

Buy tickets expose three fixed ETH quick-buy amounts shared by Sushi and
canonical Uniswap markets. Users can edit the values inline; RMT validates three
different positive decimal amounts and stores them only in that browser. The
buttons fill the order ticket but never submit, approve, sign, or bypass a
fresh quote and evidence review.

Sell tickets retain 25%, 50%, and maximum shortcuts calculated from the current
token balance. Native-token maximum calculations continue to reserve ETH for
network fees. Saved presets do not change the enforced 1% slippage limit.

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

### Recent actor intelligence

RMT groups the latest confirmed pool swaps by visible sending wallet so users
can distinguish one-off activity from repeat participation. The compact view
shows:

- unique and repeat wallets in the displayed sample;
- each wallet's observed buy and sell count;
- gross activity ranked by visible dollar volume;
- signed net buy or sell flow inside the sample; and
- direct Blockscout address links for independent review.

This is deliberately not called smart money, wallet identity, copy trading, or
profit. The public feed supplies only the latest pool swaps, a router or bot can
appear as a trader, and a wallet's activity elsewhere is not included. RMT
labels the result as visible flow and keeps the underlying transaction tape
available for verification.

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
pnpm --filter web test:external-v4-evidence
pnpm --filter web test:external-venues
pnpm --filter web test:token-risk
pnpm --filter web typecheck
pnpm --filter web build
```

The OHLCV smoke test covers URL construction, token/pair validation, inverted
quote-token candles, malformed candle rejection, sorting, deduplication, and
response-size limits.
