# Account-first trading polish

**Status:** PR decision record; not production acceptance or release authority
**Authorized base:** `b38a3f526a74b836ebdb4a4e7c5a06b2b5d71421`

## Product decision

RMT keeps public market browsing, search, token identity, and charts available before login. The consumer path is:

> Browse -> Sign in -> activate the selected RMT account -> Deposit when needed -> choose Buy/Sell and amount -> obtain a fresh verified quote -> explicit wallet review -> result and recovery

Privy provides authentication and self-custodial wallet provisioning. A new email, Google, or passkey user with no EVM wallet gets one embedded RMT wallet idempotently; a returning user reuses the existing wallet. Existing external-wallet users are not migrated and do not receive an extra embedded wallet merely because they signed in. External wallets remain available through account management and require an explicit selection.

The implementation is pinned to the installed `@privy-io/react-auth` `3.36.1` and `@privy-io/wagmi` `4.0.15` contracts and does not upgrade either SDK. Privy's `createOnLogin: "users-without-wallets"` configuration is the single embedded-wallet creation owner; RMT observes the connected records from `useWallets` and never races that flow with a second `createWallet` call. RMT enumerates only wallets with one exact Privy/Wagmi connector identity and never selects from array order. Embedded activation proves the exact connector UID, account, and chain after an awaited Wagmi activation; external activation additionally proves the stable Privy provider matches that connector. The resulting connector identity, account, chain, and wallet client are signer authority; completion of login or wallet creation is not.

Provisioning, connector readiness, balances, executable quote authority, and settlement are separate states. Neither successful login nor a provider funding response makes a trade ready.

## State ownership

| State | Owner | Boundary |
| --- | --- | --- |
| Session and linked accounts | Privy authentication | Establishes the authenticated user. It does not select a signer or authorize a transaction. |
| Embedded wallet creation/reuse | Privy wallet SDK | Creates only when the authenticated user has no EVM wallet. Creation is idempotent and requires no onchain transaction. |
| Active address, chain, and connector | Wagmi | Runtime source for the connected account. RMT waits for the observed Wagmi connection; SDK activation callback completion is not signer authority. |
| Selected trading account | RMT identity and wallet gateway | Binds wallet kind, source-wallet provenance, exact connector UID, address, and a Privy-user-scoped durable preference. Same-address providers are not interchangeable. A missing or ambiguous saved wallet is forgotten and returns to an explicit choice; it never silently selects another signer. |
| Trade draft and quote generation | `TradeIntentComposer` | Owns token, side, amount, quote generation, cancellation, expiry, fresh explicit-Trade preparation, and post-approval refresh. A bounded, one-shot session snapshot preserves only token, side, amount, and asset choices across sign-in or funding remount; it carries no quote, signer, authorization, or submission authority. |
| Wallet review and recovery | VNext wallet review/recovery | Binds the verified plan to the selected connector, records the request before handoff, prevents duplicates, and treats pending or unknown responses as recovery states. Only the wallet can approve or sign. |
| Funding attempt | Local funding session | Persists exact destination, chain, asset, initial balance, and bounded status. Provider acceptance is `SUBMITTED_PENDING`; delivery requires both a provider-terminal completion result and an exact-asset destination balance increase. An unrelated balance increase remains observable but unresolved. |
| Withdrawal attempt | Local native-transfer session plus exact Wagmi wallet client | Binds sender, recipient, amount, chain, raw wallet provenance, connector UID, and reviewed signer fingerprint before the wallet opens. A successful receipt is not enough for confirmation: RMT independently reloads the mined transaction and matches hash, chain context, sender, recipient, value, and empty calldata. Missing or mismatched evidence stays `UNKNOWN` and duplicate-blocking. |
| Spendable balance and settlement | Robinhood Chain reads | Onchain balance/receipt evidence remains authoritative. A USDG balance without native ETH is not gas-ready. |

## Interface hierarchy

1. Markets remains the public starting surface with compact search and lifecycle views.
2. The token workspace shows compact identity and market metrics, then the chart and stable trade ticket. Contract, route, and admission detail live in expandable disclosure.
3. Mobile keeps the token, chart, Buy/Sell entry, amount, balance, quote summary, and primary action in the useful viewport; the sheet responds to `visualViewport` and safe-area constraints.
4. The primary action reflects the next real state: **Sign in**, **Deposit**, **Buy/Sell**, **Retry quote**, or pending/recovery status.
5. Account settings retain external-wallet selection, security/recovery controls, receive, and withdrawal. These controls do not compete with first-use onboarding.

The first-visit guide is optional (`?guide=1`) and no longer interrupts ordinary browsing.

## Funding capability matrix

| Capability | State | Evidence and limits |
| --- | --- | --- |
| Direct receive on Robinhood Chain | **IMPLEMENTED_AND_TESTED** | The Deposit sheet shows the exact active account, chain `4663`, copyable address, and local QR. A trade-ticket Deposit action also carries the exact selected native asset or ERC-20 contract into this review; another asset is never presented as funding that ticket. It initiates no payment or wallet request. |
| Exact destination continuity | **IMPLEMENTED_AND_TESTED** | Deposit uses the same active Wagmi account that supplies trade taker/signer authority. Funding code does not activate or substitute another wallet. |
| Funding reconciliation | **IMPLEMENTED_AND_TESTED** | Session storage is bound to exact destination, chain, and asset. Delivery requires provider-terminal completion plus an exact-asset balance increase. A balance increase without matching provider completion stays unresolved and cannot release another checkout. |
| Privy provider checkout | **OWNER_ACTION_REQUIRED / NOT TESTED LIVE** | The route is exposed only when the app, enablement, provider-verification, chain, exact requested asset, and environment configuration all validate. If the ticket asset differs from the configured provider asset, checkout remains hidden and exact direct receive stays available. The owner must establish real production availability, permissions, fees, minimums, refund behavior, and settlement for Robinhood Chain. |
| Card or Apple Pay | **NOT SUPPORTED AS A PRODUCT CLAIM** | RMT displays only methods returned by an enabled provider for the current device/region. This branch does not prove either method is available. |
| Cross-chain funding | **NOT SUPPORTED AS AN IN-APP CLAIM** | The official Robinhood Chain bridge is an informational external link. RMT does not present Ethereum-mainnet funds as spendable on chain `4663`, and it does not reconcile an external bridge lifecycle. |
| Automatic gas funding | **NOT SUPPORTED** | RMT discloses the native ETH requirement and offers the exact receive address. It does not silently convert USDG or another selected asset. |
| Withdrawal/send | **IMPLEMENTED_AND_TESTED WITH FIXTURES; NOT TESTED LIVE** | The user reviews exact network, sender, recipient, and amount. Dispatch uses the selected connector's exact wallet client. A durable pre-handoff record, Web Lock, connector fingerprint, nonzero transaction hash, receipt tracking, exact mined-transaction rebinding, and unknown-state recovery prevent silent wallet substitution, receipt-only success claims, and blind duplicate sends. |

Funding statuses are deliberately distinct: `NOT_SUBMITTED`, `SUBMITTED_PENDING`, `DELIVERED` (provider completion and exact-asset balance increase both observed), `FAILED`, `CANCELLED`, and `UNKNOWN`. A balance-only increase, `CANCELLED`, or `UNKNOWN` requires reconciliation before another provider attempt; none proves that the provider moved no funds.

## Click and prompt model

These counts describe the implemented interaction model and deterministic fixtures. Provider-, authentication-, and wallet-owned screens can add prompts; they are not claimed as live production counts.

| Journey | RMT actions | External prompts |
| --- | ---: | ---: |
| Public browse -> token/chart | 1 token selection | 0 |
| Signed-out user -> account | 1 **Sign in** action | Privy auth varies by email, Google, passkey, or wallet. Embedded wallet creation/activation adds no transaction prompt. |
| Direct receive | 1 **Deposit** + 1 **Show address & QR** | 0 |
| Native or already-approved trade | 1 explicit **Buy/Sell** after account readiness | 1 wallet transaction review/confirmation |
| ERC-20 trade requiring approval | 1 explicit **Buy/Sell** | 1 exact-amount approval review, then after confirmation and a fresh quote, 1 swap review. No second RMT trade click is required. |
| Trade selected while signed out | First Buy/Sell opens sign-in; after authentication the draft is retained but no wallet request opens | A second explicit Buy/Sell action is required before any wallet prompt. |
| Provider funding | 1 **See available provider methods** after exact-balance preflight | Provider prompts vary; RMT does not claim a fixed count or settlement from provider UI completion. |

No path automatically trades after login, embedded wallet creation, deposit, balance observation, quote arrival, or approval recovery.

## Security and execution boundaries

- Canonical execution remains the existing 0x Swap API v2 / AllowanceHolder path on Robinhood Chain `4663`; legacy executors are unchanged and remain inactive.
- The existing fee, recipient, asset, amount, minimum-output, runtime, simulation, and immutable-transaction commitments remain authoritative. This polish does not change execution economics.
- Embedded authority requires the exact provider-bound Privy/Wagmi connector, Robinhood Chain, and address. External authority retains a durable exact wallet choice. Privy-managed injected and WalletConnect sources dispatch through their provider-equality-checked Wagmi client; only a direct injected connector uses the separate EIP-6963 chooser. An address match alone is insufficient.
- Account or connector change invalidates quote/authorization authority. Fresh explicit-Trade and post-approval verification remain required.
- Provider-internal route introspection remains diagnostic; hard user-intent and wallet-authority checks remain blocking.
- Funding never changes the selected trading account. RMT does not receive a seed phrase or private key, sign server-side, or auto-submit.
- A wallet request is durably recorded before handoff. Rejection, timeout, pending, unknown broadcast, reload, and duplicate submission use the existing recovery state machine.

## Evidence labels

- **LIVE:** public RMT baseline observed before implementation. It does not prove the new branch or authenticated flows.
- **PUBLISHED SCREENSHOT / FIRST-PARTY ARTICLE:** product-reference material used for interaction comparison. It is not RMT acceptance.
- **WATCHED VIDEO:** none claimed unless the media itself was played and inspected.
- **TRANSCRIPT:** text evidence only; never represented as watched video.
- **FIXTURE:** deterministic local browser or source-level acceptance with test accounts/data and no real funds.
- **INFERENCE:** behavior concluded from source/API contracts and identified as such.
- **IMPLEMENTED_AND_TESTED:** source plus deterministic validation on this branch; not production proof.
- **OWNER_ACTION_REQUIRED:** live account, environment, provider, or funds are required and were not bypassed.
- **NOT SUPPORTED / NOT TESTED:** no completion claim is made.

## Owner dependencies and remaining live acceptance

The owner must validate the production Privy application configuration, permitted login methods, embedded-wallet creation, Robinhood Chain connector activation, and account recovery/MFA policy. Real email OTP, Google, passkey, and external-wallet behavior require normal owner-controlled authentication; no CAPTCHA, OTP, or access control is bypassed.

Optional provider funding needs a legitimate, verified Robinhood Chain route before production enablement. The owner must review the actual source/destination assets, fees, minimum, refund/recovery terms, regional availability, and gas outcome. Disabled configuration is an honest unsupported state, not a blocker for direct receive or trading with an already funded account.

This task does not exercise a live login, deposit, funding purchase, withdrawal, approval, signature, or trade. It does not prove production rendering or provider latency. Production acceptance must separately confirm exact destination/signer continuity, account switching, mobile keyboard/action visibility, funding reconciliation, fresh quote and approval recovery, and recovery after wallet rejection or unknown submission.
