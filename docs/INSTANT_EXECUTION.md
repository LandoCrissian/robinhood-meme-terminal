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

## Provider foundation

RMT's optional Speed Wallet is implemented behind `NEXT_PUBLIC_PRIVY_APP_ID`. When the variable is absent, the existing wallet experience and production application are unchanged.

When configured, the provider layer:

- uses Privy's official Wagmi adapter so the existing trade hooks can operate with an embedded wallet;
- lets Privy own external-wallet connection state instead of duplicating it through Wagmi;
- creates a user-owned wallet after a user chooses to sign in, including users who also bring an external wallet;
- keeps that wallet user-owned and exportable;
- supports email, Google, passkey, and external-wallet authentication;
- restricts supported networks to Robinhood Chain mainnet and testnet; and
- exposes user-controlled MFA, recovery, key export and active-wallet selection; and
- does not provision an RMT signer or allow unattended execution.

## Funding layer

Privy's unified funding interface is implemented behind `NEXT_PUBLIC_PRIVY_FUNDING_ENABLED`. It is separately gated from the wallet login because a configured wallet does not prove that a fiat or cross-chain provider supports a particular destination.

The funding request binds all provider quotes to:

- the wallet address selected by the user;
- an explicit CAIP-2 destination chain (Robinhood Chain is `eip155:4663`);
- one exact asset symbol or contract address;
- an explicit sandbox or production environment; and
- a bounded default fiat amount.

The provider owns payment credentials, KYC, method eligibility, quotes and delivery. RMT never receives card, bank, Apple Pay, Google Pay or identity-document data. If no provider returns a compatible route, the flow fails without moving funds. Production funding must remain disabled until the Privy dashboard is configured and a provider-confirmed Robinhood Chain route has been tested end to end.

The next phase requires a registered authorization-key quorum and a non-empty policy ID. RMT must never attach a signer with an empty policy list.
