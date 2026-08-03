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

Privy's unified funding interface is implemented behind `NEXT_PUBLIC_PRIVY_FUNDING_ENABLED`. Privy's documentation now lists Robinhood Chain mainnet (`eip155:4663`) for swaps and transfers and Robinhood Testnet (`eip155:46630`) for testnet wallet actions. Funding is still separately gated from wallet login because chain support does not prove that every fiat method, asset, region or user is eligible for a live provider quote.

The funding request binds all provider quotes to:

- the wallet address selected by the user;
- an explicit CAIP-2 destination chain (Robinhood Chain is `eip155:4663`);
- one exact destination token address (the zero address represents native ETH);
- an explicit sandbox or production environment; and
- a bounded default fiat amount.

The provider owns payment credentials, KYC, method eligibility, quotes and delivery. RMT never receives card, bank, Apple Pay, Google Pay or identity-document data. The interface describes fiat methods as conditional rather than promising them. If no provider returns a compatible route, the flow fails without moving funds. Production funding must remain disabled until the Privy dashboard is configured and one live Robinhood Chain quote is tested end to end.

The wallet control center also supports:

- copying the exact active wallet address for a direct Robinhood Chain deposit;
- opening a network-bound receive sheet with the full address, chain ID and matching Blockscout account;
- sending native ETH only after the user reviews the full destination, amount and network and confirms in the active wallet; and
- returning to RMT's independently decoded route comparison rather than silently using a different swap provider.

Deposits, receiving and ordinary transfers do not carry an RMT execution fee. Provider charges and network fees, when applicable, must be shown by the provider or wallet before confirmation.

## Revenue boundary

Privy's wallet-action swap fee does not automatically accrue to RMT. Privy documents a fee of up to 0.25% for its swap action, requires application gas sponsorship, and offers custom developer revenue arrangements only for negotiated cross-chain swap or transfer flows. Therefore RMT must not replace its same-chain routes with Privy swaps merely to add monetization.

RMT now has a disabled-by-default execution-fee path for independently built Uniswap v3 and v4 trades. When enabled, the router atomically pays the configured treasury from successful swap output and sends the remainder to the trader. On buys the treasury receives the purchased token; on sells it receives ETH. RMT does not custody the order input, and a reverted or failed trade pays no RMT fee.

The implementation:

- is visible before wallet confirmation as its own line item;
- is encoded into and independently decoded from the exact transaction;
- has a server-only treasury destination and a hard 100-basis-point software ceiling;
- cannot be changed by a browser environment variable;
- is included when calculating minimum received and price impact; and
- fails closed when the treasury or rate is invalid; and
- remains disabled until the final treasury controls, staged route simulations and public disclosures are complete.

The browser receives net quoted output, net protected minimum, the gross values, the rate, estimated fee and treasury. Before wallet review, RMT independently decodes the v3 fee payout function or v4 `PAY_PORTION` command and rejects any mismatch. Route comparison therefore ranks what the user keeps after the RMT fee rather than advertising a higher gross value.

The working product target is 25 basis points (0.25%), which is materially below GMGN's published 1% handling fee. This is implemented behind a release gate but is not a live charge. It must not be enabled until RMT updates any earlier public “no fee” messaging and the terms shown to users.

The next phase requires a registered authorization-key quorum and a non-empty policy ID. RMT must never attach a signer with an empty policy list.
