# RMT terminal UX research — July 2026

## Products reviewed

The review covered the leading web and hybrid onchain terminals most relevant to RMT's discovery-to-execution loop: Axiom, GMGN, BullX Neo, Photon, Jupiter, DexScreener, DEXTools, GeckoTerminal, Trojan, and Banana Pro. It combined current product documentation and comparative reviews with user discussions about fees, failed orders, mobile behavior, chart quality, and copy-trading reliability.

## What traders repeatedly value

1. **Signal and execution in one place.** Axiom's strongest pattern is a continuous workflow from discovery through wallet intelligence to trade execution. Users do not want to lose context by opening several tools.
2. **Fast, trustworthy charts.** Photon and BullX are repeatedly praised for fast charts, even by users who criticize their bugs or fees.
3. **Persistent presets and automation.** Quick-buy amounts, limit orders, DCA, take-profit/stop-loss, and retry behavior reduce repetitive setup and missed orders.
4. **Wallet intelligence with context.** GMGN and Axiom win attention with wallet labels, realized PnL, holding time, insider/sniper indicators, and alerts. Raw wallet lists without behavior context create noise.
5. **Risk visible before the click.** Holder concentration, developer holdings, insiders, snipers, bundles, liquidity, and origin need to be adjacent to the trade action—not buried in a secondary page.
6. **A profile that follows the trader.** Users expect watchlists, tracked wallets, notifications, layout density, and trade presets to persist across desktop and mobile.
7. **Mobile parity.** Mobile users want the same core watch, quote, and execution loop, with fewer simultaneous columns and no loss of critical safety context.

## What users repeatedly reject

1. **Fees they cannot predict.** Complaints often combine platform fees, priority fees, tips, slippage, and failed transactions into one feeling: the displayed trade outcome was not the real cost.
2. **Ambiguous or failed execution.** "Processing" without a clear state, failed sells, dropped limit orders, and unexplained copy-trade pauses destroy trust quickly.
3. **Feature density without hierarchy.** BullX is praised for capability but criticized for clutter. More controls do not help when every control has equal visual weight.
4. **Lag and stale personal data.** Users notice when charts, balances, and profile PnL disagree. Every data surface needs a visible freshness state.
5. **Blind copy trading.** High win-rate wallets can be bots, manipulated rankings, or wallets that never realize losing positions. RMT should provide intelligence and warnings before it considers automation.
6. **Custody confusion.** Users are wary of generated wallets, imported private keys, and unclear account boundaries. RMT should keep profile identity, public wallet reading, and transaction approval visibly separate.

## Product principles adopted for RMT

- **Calm speed:** fast paths with fewer surprises, not more flashing information.
- **Progressive density:** focused readability by default, with compact mode as an explicit profile preference.
- **Explain every state:** quote freshness, fees, risk acknowledgement, wallet confirmation, submission, and confirmation remain distinct.
- **One personal desk:** profile, watchlist, portfolio, runner mode, and future presets share one durable identity layer.
- **No custody shortcuts:** profile sign-in never substitutes for wallet confirmation or controls user funds.
- **Origin before hype:** RMT's verified factory origin remains its strongest differentiation from generic market scanners.
- **Evidence, not safety theater:** show each check and unknown in plain language instead of a generic score that could be mistaken for a guarantee.
- **Deliberate risky buys:** when origin, age, liquidity, or activity is uncertain, a buy requires an explicit warning acknowledgement; sells are never obstructed by that acknowledgement.
- **Hard execution limits:** malformed routes, changed recipients, excessive Sushi price impact, stale client quotes, insufficient balances, and unverifiable execution contracts fail closed.

## July 27 implementation decision

RMT now places a Trade Confidence review directly between the quote and the wallet action.
It identifies the matched token and pool, verified or unknown origin, observed two-sided
activity, liquidity/age anomalies, and quote price impact where the venue supplies it. The
panel never says a token is “safe.” Material warnings require an explicit acknowledgement
before a buy button becomes available.

The second safety layer adds live Robinhood Chain evidence beside that same buy action:
published-source status, proxy or changed-bytecode signals, total holder count, pool-held
supply, largest non-pool holder, reported creator balance, and observed sells. RMT excludes
the displayed liquidity pool and burn addresses from whale concentration, verifies creator
balances directly against the token contract, and treats unavailable evidence as unknown.
Published source means transparent code—not an audit, endorsement, or proof that the code is
safe. External buys wait for this check to finish; sells remain unobstructed.

The third layer inspects the published ABI for common mint, transfer restriction, tax,
upgrade, access-control, and launch-control write surfaces. It also reads active launch
restriction blocks and percentage limits when a published contract exposes them. The UI
uses “not found in the published ABI,” never “impossible,” because unpublished or
misleading code cannot receive a clean control assessment. Pool-held token supply is
reported separately from LP-position custody; RMT does not label liquidity locked until
the controlling V2 LP tokens or V3 position NFT can be proven.

Robinhood Chain's Arbitrum block response includes separate L2 `number` and L1
`l1BlockNumber` counters. Solidity `block.number`-based launch restrictions are compared
against the L1 counter, not the RPC's L2 counter. When an exact Pons factory record and
position match the displayed pool, the published ABI exposes only
`setInitialBuyRecipient`, and its documented two-block window has expired, RMT labels the
surface `Known Pons protection · expired`. Active restrictions, additional custom writes,
or unverified factory claims remain review-required.

The fourth layer now verifies exact Pons and Noxa V3 position NFTs when their pinned
launch factory publishes a position ID. RMT matches the NFT's tokens and fee through the
manager's live factory to the displayed pool, then distinguishes creator-controlled,
other-wallet, contract-held, burn-address, and unavailable custody evidence. Lemon and
unregistered markets remain explicitly unproven because pool balances alone cannot
establish LP ownership or locking.

The fifth layer performs a read-only sell-direction probe before enabling an external buy.
RMT selects an observed non-contract holder, simulates a deliberately small ERC-20 transfer
from that holder into the exact verified pool, and blocks the buy when the call reverts,
returns `false`, or produces router-incompatible return data. RPC uncertainty and the absence
of an eligible holder remain explicitly unknown. A passing transfer is current evidence only:
it does not prove future sellability, the amount ultimately received, transfer tax, router
compatibility beyond the transfer, or that privileged token behavior will remain unchanged.

This specifically addresses the recurring terminal complaints behind the research: users
could not predict the real outcome, risk context was separated from the action, generated
wallet and custody boundaries were unclear, or interfaces moved too quickly for a beginner
to understand what they were signing.

## Representative sources

- [Axiom product workflow](https://trade-on-axiom.com/product)
- [Axiom Pulse filters](https://docs.axiom.trade/axiom/finding-tokens/pulse)
- [Axiom portfolio](https://docs.axiom.trade/axiom/portfolio)
- [BullX trading and automation](https://bullx.gitbook.io/bullx-neo-docs/trading-terminal/trading)
- [BullX analytics](https://bullx.gitbook.io/bullx-neo-docs/trading-terminal/analytics)
- [GMGN wallet detail and risk signals](https://docs.gmgn.ai/index/wallet-detail-page)
- [GMGN copy-trade states and failure explanations](https://docs.gmgn.ai/index/gmgn-app-tutorial/copy-trade)
- [GMGN wallet radar](https://docs.gmgn.ai/index/wallet-radar)
- [2026 terminal comparison](https://coinbrain.com/blog/which-web-trading-terminal-is-the-best)
- [Axiom user fee and UI discussion](https://www.reddit.com/r/solana/comments/1m23qa7/are_you_happy_with_axiom/)
- [BullX and Photon chart discussion](https://www.reddit.com/r/solana/comments/1fidwtq/love_hate_for_bullx_and_photon/)
- [GMGN copy-trading user discussion](https://www.reddit.com/r/solana/comments/1h07gy1/copy_trading_on_gmgnai_doesnt_actually_work/)
- [BullX Neo reliability discussion](https://www.reddit.com/r/solana/comments/1gdy4ri/bullx_neo_new_bullx_trading_bot_features/)
- [Robinhood Chain Blockscout API](https://robinhoodchain.blockscout.com/api-docs)
