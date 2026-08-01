# RMT Instant Execution

## Live preparation layer

RMT Speed Mode reduces the time between choosing an amount and opening the wallet without weakening transaction verification:

- quote requests begin after a 60 ms input-settle window rather than 350–400 ms;
- Sushi, Uniswap v3, and Uniswap v4 requests remain concurrent;
- identical executable-quote requests are shared for 1.5 seconds so the route comparison and active trade ticket do not ask the server to simulate the same transaction twice;
- active quotes refresh every eight seconds;
- recipient, token, pool, router, amount, deadline, minimum output, price impact, Passport, allowance, and sellability validation remain mandatory;
- the user still signs the final wallet transaction.

Standard Mode preserves the original 350 ms preparation window and 15-second refresh interval.

## Scoped session execution

Removing repeated wallet popups requires a separate, explicit authorization layer. RMT must not store raw private keys or silently receive unrestricted signing authority.

A production Speed Wallet must provide:

1. a user-owned, exportable or recoverable embedded wallet;
2. one-time consent for a short-lived session signer;
3. allowlisted Robinhood Chain routers and exact permitted functions;
4. per-trade and rolling daily value limits;
5. no arbitrary token transfers or unknown recipients;
6. expiration, immediate revocation, and an immutable audit trail;
7. MFA for withdrawals, recovery, and policy changes;
8. simulation, current Passport evidence, slippage bounds, and minimum output before every execution;
9. an emergency global pause that cannot move user funds;
10. a clearly separate Standard Wallet path.

Until these controls and the selected wallet provider are production-tested, RMT must keep one explicit wallet confirmation per trade.
