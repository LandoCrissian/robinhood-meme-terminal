# RMT Live Signals

RMT Live Signals is a read-only attention layer over the Universal Market Index. It does not predict profit, trade automatically, label wallets as “smart money,” or decide whether a user should buy or sell.

## Current signal inputs

The first release uses the same bounded public market snapshot already shown in RMT:

- five-minute and one-hour buy/sell counts;
- five-minute and one-hour volume;
- five-minute price movement;
- current liquidity;
- qualified market age and RMT momentum score;
- change from the previous successful RMT snapshot.

The engine emits no signal when minimum activity or liquidity thresholds are not met. When several conditions are present, it shows the highest-priority observation for that market so the terminal remains compact.

## Current signal types

- runner acceleration;
- buy-side activity;
- sell-side pressure;
- liquidity expansion or contraction;
- momentum-score advance;
- active new market.

Every displayed signal includes the measured evidence that caused it. A trader can open the market workspace to inspect the pool, live swap tape, wallet-flow summary, Passport, route, and execution evidence before making a decision.

## Execution boundary

Signals never create executable calldata and never bypass the protected-trade identity gate. Trade preparation separately requires:

1. a non-guest Privy account;
2. the exact selected wallet to be verified and linked to that account;
3. a fresh route and quote;
4. recipient, token, pool, router, amount, deadline, minimum-output, allowance, price-impact, Passport, and sellability validation;
5. the user’s wallet signature.

The wallet rule is provider-neutral. Privy embedded wallets and verified external Ethereum wallets can qualify; a wallet brand alone never grants access.

## Watchlist alert progression

The first user-controlled alert increment adds price, liquidity, volume, runner-pace, snapshot liquidity-drop, exact-pool largest-sell, and five-minute net-sell rules. Exact-pool sell monitoring is loaded only for watched markets with an active sell rule. Browser notifications are opt-in, transition-only, and require an open RMT session. Signed-in rules can sync through the private Privy-bound Firebase profile; Position Guard remains device- and wallet-address-scoped.

The same alert rules are available from a token's Protection Desk. One-click presets save the market to the watchlist and arm a disclosed threshold; users can inspect or remove every rule. The live trade tape can trigger only a rule the user created, and a trigger remains informational until the user requests a fresh quote and signs with the selected wallet.

The Protection Inbox preserves the latest 100 triggered rule transitions on the current device with the token, condition, observed value, and time. It is populated only while an RMT session is open, does not sync to the account, and does not claim that a transaction executed.

The next safe increments are first-party indexed wallet-flow evidence and optional external read-only intelligence adapters when those providers support Robinhood Chain. External agents must never become signing authorities or silently execute a trade.
