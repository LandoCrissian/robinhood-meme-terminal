# RMT Instant Execution

## Live preparation layer

RMT Speed Mode reduces the time between choosing an amount and opening the wallet without weakening transaction verification:

- quote requests begin after a 60 ms input-settle window rather than 350–400 ms;
- Sushi, Uniswap v3, and Uniswap v4 requests remain concurrent;
- identical executable-quote requests are shared for 1.5 seconds so the route comparison and active trade ticket do not ask the server to simulate the same transaction twice;
- quote sharing is scoped to one verified Privy user and never crosses RMT account boundaries;
- active quotes refresh every eight seconds;
- recipient, token, pool, router, amount, deadline, minimum output, price impact, Passport, allowance, and sellability validation remain mandatory;
- the user still signs the final wallet transaction.

Before the server returns executable calldata, it verifies the current Privy identity token, rejects guest identities, and proves the requested recipient is a verified Ethereum wallet linked to that identity. The response carries an `identity-wallet-bound` marker that the browser rechecks before approval or swap controls can advance. This is provider-neutral: it works with Privy-created wallets and verified external Ethereum wallets discovered directly or connected through supported wallet connectors. MetaMask, Coinbase Wallet, WalletConnect, and other detected wallets do not receive special trust; the exact address must be linked to the signed-in Privy account. Neither Privy nor RMT receives signing authority over an external wallet.

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

RMT's optional Speed Wallet is implemented behind `NEXT_PUBLIC_PRIVY_APP_ID`. When the variable is absent or does not match Privy's 25-character app-ID requirement, RMT fails closed to the existing wallet experience instead of initializing the provider or crashing the application.

When configured, the provider layer:

- uses Privy's official Wagmi adapter so the existing trade hooks can operate with an embedded wallet;
- lets Privy own external-wallet connection state instead of duplicating it through Wagmi;
- defers RMT's legacy MetaMask, Coinbase and WalletConnect connectors entirely while Privy is active, preventing duplicate WalletConnect sessions and conflicting origin checks;
- creates a user-owned wallet after a user chooses to sign in, including users who also bring an external wallet;
- keeps that wallet user-owned and exportable;
- supports email, Google, passkey, and external-wallet authentication;
- restricts supported networks to Robinhood Chain mainnet and testnet; and
- exposes user-controlled MFA, recovery, key export and active-wallet selection; and
- binds profile sync to the verified Privy user rather than the currently selected wallet, so changing between an RMT Wallet and any linked external wallet cannot overwrite a profile;
- presents Deposit, Receive, Send and Trade as separate actions for the exact active wallet; and
- does not provision an RMT signer or allow unattended execution.

## Funding layer

Privy's unified funding interface is implemented behind both `NEXT_PUBLIC_PRIVY_FUNDING_ENABLED` and `NEXT_PUBLIC_PRIVY_FUNDING_PROVIDER_VERIFIED`. Privy's documentation supports custom EVM wallet networks and CAIP-2 funding destinations, but does not publicly establish that a configured provider currently serves Robinhood Chain mainnet (`eip155:4663`). Funding is therefore separately gated from wallet login because wallet-chain support does not prove provider route, asset, region or user eligibility.

The RMT Privy development app's funding dashboard was checked on 2026-08-09. Its available EVM funding networks did not include Robinhood Chain. Provider funding therefore remains disabled, and insufficient-gas recovery opens the exact active-wallet Robinhood receive sheet directly instead of advertising an unavailable provider route.

The funding request binds all provider quotes to:

- the wallet address selected by the user;
- an explicit CAIP-2 destination chain (Robinhood Chain is `eip155:4663`);
- one exact destination token address (the zero address represents native ETH);
- an explicit sandbox or production environment; and
- a bounded default fiat amount.

The provider owns payment credentials, KYC, method eligibility, quotes and delivery. RMT never receives card, bank, Apple Pay, Google Pay or identity-document data. The interface describes fiat methods as conditional rather than promising them. If no provider returns a compatible route, the flow fails without moving funds. The provider-verification flag must remain false until the Privy dashboard is configured and an exact Robinhood Chain quote is observed in that deployment environment. Production funding must remain disabled until a separate small-value live quote is tested end to end.

The wallet control center also supports:

- copying the exact active wallet address for a direct Robinhood Chain deposit;
- opening a network-bound receive sheet with the full address, chain ID and matching Blockscout account;
- sending native ETH only after the user reviews the full destination, amount and network and confirms in the active wallet; and
- returning to RMT's independently decoded route comparison rather than silently using a different swap provider.

Deposits, receiving and ordinary transfers do not carry an RMT execution fee. Provider charges and network fees, when applicable, must be shown by the provider or wallet before confirmation.

## VNext production activation boundary

VNext now serves production `/`, and `/vnext` redirects to the public root. `RMT_VNEXT_SHELL_ENABLED=true` remains the server-only shell rollback gate. It does not enable wallet review, wallet prompts, transaction submission, provider funding, execution fees or Position Guard.

`GET /api/vnext/readiness` returns only non-secret release evidence and classifies the deployment as `disabled`, `observation`, `wallet-review`, `interactive` or `misconfigured`. Production must enter `observation` first. Any mismatch between the public and server authorization gates, between the Sushi quote gates, or any wallet-submission gate enabled without both authorization gates causes the terminal route to fail closed with a 404.

The completed production sequence was:

1. enable only `RMT_VNEXT_SHELL_ENABLED` for the unlisted observation rehearsal;
2. verify readiness, real directory data, wallet balances and quotes;
3. enable both authorization gates for wallet review;
4. enable wallet submission after connected-wallet buy and sell rehearsal;
5. cut `/` to the same reviewed VNext shell; and
6. retain the server-only shell switch as the immediate rollback control.

## Revenue boundary

Privy's wallet-action swap economics do not define RMT revenue policy. RMT must not replace its independently admitted same-chain routes merely to add monetization.

Current owner product policy is `RMT_FEE = 0`, and no fee activation is authorized. The earlier generic fee-path description in this document is superseded by the historical provider-specific [`RMT_EXECUTION_V1` record](RMT_EXECUTION_REVENUE.md). Its approved 25-bps release, disclosures, settlement proof and boundary remain immutable historical evidence; they do not authorize current fee collection or fee inheritance by Privy, transfers, funding or other providers.

Current policy and the preserved executor, exact fee math, release boundary, reconciliation rules and evidence-monitoring procedure are distinguished in [`RMT_EXECUTION_REVENUE.md`](RMT_EXECUTION_REVENUE.md) and [`PRODUCTION_MONITORING.md`](PRODUCTION_MONITORING.md#historical-uniswap-v3-fee-settlement-monitoring).

Any future scoped-session execution would require a registered authorization-key quorum and a non-empty policy ID. RMT must never attach a signer with an empty policy list. This is not current roadmap authority and does not supersede the current Token Terminal integration priority.
