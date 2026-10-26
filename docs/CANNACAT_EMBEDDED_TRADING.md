# CannaCat trading inside LAMMB

Status: isolated implementation for review; **not released or enabled**.
Task115 owner direction requires users to remain on `lammb.fun`. There is no
terminal redirect, iframe, new contract, alternate provider or copied server key.
Base: `6d0b8103bdad95367445a38e5f5327458baa9ab2`, independently matched to
Vercel production deploy `dpl_7rP2LkseUDeBxE5JKVguHVJKWYE6`.

## One execution authority

`POST /api/embed/cannacat/{quotes,verify,authorize,native-settlement-trace}`
is a narrow admission boundary over the canonical VNext handlers. It accepts
only native ETH ↔ CannaCat `0x1139d423C1706BDeaD91f03507F521635591eD92`, chain
4663. It forwards the user's existing RMT-app Privy identity token, never an
administrator identity. Each canonical handler still verifies the exact linked
recipient, source identity, provider release, runtime, fee, simulation and firm
commitment. CORS is not authentication.

The client SDK is built from RMT's canonical browser validators, exact wallet
envelope, connector-qualified selection, execution journal and settlement code.
`apps/web/scripts/build-cannacat-client.mjs` emits a browser-only ESM artifact and
SHA-256/source-member manifest. LAMMB pins that artifact; it does not fork a swap
engine. A change to RMT requires a new reviewed SDK digest and LAMMB test run.
The owner separately approved a draft-only dependency security update after CI
reported advisories in the existing baseline: Next 15.5.28, source-map-js 1.2.2,
sharp 0.35.5, follow-redirects 1.16.1 and a reviewed Zod 4.6.6 migration. The
candidate lock is resolved in disposable cloud CI, then committed and verified
by the unchanged frozen-lock and security gates. Compatibility failure is a
release blocker; no advisory is suppressed. Fee policy is unchanged.

## Buy and sell behavior

Buy accepts a **minimum CannaCat target**. A bounded search (at most five
indicative calls) finds an exact ETH input whose protected output covers it.
An oversized seed quote is refined downward; the indicative protected minimum
must stay within 0.5% above the target. Small targets cannot silently inherit
the seed's larger ETH purchase. This precision bound does not change the
canonical 1% maximum swap slippage or promise exact-output execution.
The firm verifier must still cover that target; otherwise preparation stops.
The user sees exact ETH input, expected output, protected minimum, gas estimate,
RMT fee, provider fees and maximum 1% slippage before opening their wallet.
This is not an exact-output API mode and does not promise exact token receipt.
The search margin is part of the displayed input, not extra slippage or a fee.

Sell uses an exact CannaCat input. An insufficient allowance requires a narrowly
scoped approval, then receipt confirmation and a **new** quote/verification before
the swap. The user explicitly opens and confirms each wallet request. Approval
never means a completed sale.

The current canonical `zeroXFeeAsset` selects native ETH as fee asset in both
ETH/CannaCat directions. Retain the 25-bps request and existing treasury exactly.
On a sale, use provider-returned output-fee units; never calculate an ETH fee
from the token input. Gas, provider charges, integrator fee and price impact are
different concepts. Estimates are not settled revenue.

## Client and origin setup before an owner-authorized preview

1. Reuse the existing RMT Privy application. The authenticated dashboard currently
   uses exact allowed origins with per-client configuration disabled. Enroll only
   the reviewed preview origin after owner approval; a client ID is optional.
   Do not toggle app-wide client configuration or invent a client ID. Production
   `https://lammb.fun` requires its own release approval.
   Public app/client IDs are configuration, never secrets. Do not copy sessions
   or use LAMMB's unrelated NFT-registration signature as RMT identity.
2. In the isolated RMT preview only, set `RMT_CANNACAT_EMBED_ENABLED=true` and
   `RMT_CANNACAT_EMBED_ORIGINS=<exact HTTPS preview origin>`. No wildcards,
   suffix matching, localhost exception or credentialed CORS. Send
   `x-rmt-client: rmt-cannacat-embed-v1` and `privy-id-token` without cookies.
3. All current 0x release gates, configured server credentials, runtime authority
   and native settlement-trace provider remain mandatory. Do not add secrets to
   LAMMB. A route available in source is not a provider-release authorization.
4. Apply a provider-supported distributed route rate limit before public release.
   The new bounded in-process limiter is an additional backstop only (60/minute
   per identity/origin, 2,048 live buckets); replicas do not share it.
5. LAMMB enables only its reviewed purchase profile, with exact API/Privy/RPC/
   WalletConnect CSP destinations. Preserve the existing closed informational
   release profile and NFT registration/admin/mint switches. Do not set wildcard
   connect/frame sources or weaken the production publishing hold.

Privy documents app clients at https://docs.privy.io/basics/react/setup and the
linked app-client guide. Confirm current dashboard capabilities before enrolling
origins; this runbook does not claim they have been configured.

The current Privy app is in development mode with a 150-user limit. Public
release requires a separate owner decision about that provider limit. This task
does not upgrade billing or create another application.

The focused cloud workflow builds two explicitly separate artifacts. Only the
real SDK has `fixtureOnly: false`; its exact source commit and member hashes are
required by LAMMB's delivery validator. The disposable browser artifact aliases
Privy at build time, makes no real wallet request, and must never be delivered.
Chrome/Edge mobile-width tests are not native iPhone wallet acceptance.

## Wallet and mobile acceptance

The panel reuses RMT's versioned trading-terms acceptance hook. Before connecting
a wallet, the user explicitly acknowledges the existing risk notice. The original
RMT terms, risks and privacy page components render in expandable on-site panels;
the SDK build substitutes only their navigation shell and records the source
hashes. No legal wording or terms version is changed, and there is no terminal
redirect. Tests acknowledge only the disposable synthetic fixture.

Use the user's explicitly selected **external** Ethereum connector. Matching an
address alone does not choose between two providers. Reject embedded or ambiguous
connectors in this integration. Wait for Privy and wallets to be ready, verify
the linked account and chain, and clear quote authority on account/chain/session
changes. Connect/login may request a user authentication message; it never grants
transaction authority. No private key or seed phrase is requested.

WalletConnect can open the wallet application; its return URL remains LAMMB.
Cache the exact reviewed transaction before the final user gesture so no quote
request or automatic retry causes a surprise mobile wallet prompt. Rejection
allows a fresh review; a lost wallet response is **unknown**, not safe to retry.
Reload recovery uses the canonical durable journal, nonce/block references and
exact saved plan. If storage fails, stop before opening the wallet.

The browser Web Lock coordinates tabs on the same LAMMB origin. It cannot share
storage or locks with an RMT tab on another origin. Do not prepare concurrent
trades for the same wallet on both sites. Each request still requires explicit
wallet review, and uncertain LAMMB requests remain blocked for recovery.

Required acceptance: desktop Chrome/Edge, iPhone Safari with a supported external
wallet/WalletConnect, wrong chain, account change, insufficient ETH/token/gas,
expired quote, rejection, approval then fresh swap, duplicate click, lost response,
reload and output verification. Browser fixtures are not real mobile wallet proof.

## Settlement and support

Show the actual transaction hash immediately when returned, labeled submitted.
Buy confirmation requires matching mined transaction/receipt and net CannaCat
Transfer evidence to the exact recipient above the protected minimum. Sale
confirmation additionally requires the existing normalized native-output trace.
An unavailable trace leaves **receipt confirmed, settlement unverified**; do not
claim ETH receipt or resend. A reverted transaction is a failed trade and may
still cost gas. Reorgs require fresh receipt checks.

Troubleshooting:

| State | Collector action | Operator action |
| --- | --- | --- |
| Origin/service unavailable | Retry later; nothing submitted | Verify exact preview origin, client and unchanged release gates |
| Expired login | Reconnect the selected wallet | Check Privy client configuration; never request a token dump |
| Quote changed/expired | Refresh and review again | Preserve original diagnostic codes without sensitive payloads |
| Insufficient balance/gas | Reduce input or fund ETH gas | Do not change fee policy or substitute a provider |
| Approval confirmed | Request a fresh swap review | Verify narrow allowance and invalidate pre-approval quotes |
| Wallet response unknown | Check wallet/history; do not resend | Reconcile the canonical request journal and exact chain evidence |
| Settlement unavailable | Keep hash; retry read-only verification | Restore the existing trace service; do not infer from receipt alone |

Support needs only chain, public transaction hash, error code, timestamp and
release/SDK digest. Never collect identity tokens, wallet session data, keys or
seed phrases. Journal storage contains public transaction authority and wallet
addresses; disclose local retention and offer safe history clearing only when no
unresolved submission exists.

Buying does not reserve an NFT or guarantee GTD. LAMMB's six-project NFT holdings,
same-wallet 10,000-token final snapshot, Founder exclusion and FCFS policy remain
independent. Selling tokens before the final snapshot can remove eligibility.

## Rollback

Turn off the embedded boundary and LAMMB purchase flag through a separately
authorized release. Keep read-only transaction recovery available for outstanding
hashes. Preserve the previous static website deploy and publishing lock. No
production environment change, deployment, trade or NFT activation is performed
by this documentation or its tests.

## Security-update compatibility

The unchanged-main visual comparison passed while the upgraded branch exposed a
silent NFT client-navigation stall after a successful RSC response. Dynamic,
read-only NFT collection/item links therefore use standard document navigation.
This preserves their exact URLs, server evidence and wallet return destinations
while avoiding the suspended framework client cache. Other domains retain their
existing navigation. The full browser journey still performs real trusted pointer
clicks, exact URL/content assertions, overflow checks and execution-control bans;
it additionally records six trusted anchor activations across document loads.
No timeout was increased and no failed assertion or test was suppressed.

The subsequent Project directory-to-market check reproduced the same stalled
read-only navigation boundary. Project exploration cards and NFT collection
links use the same document fallback. Token Terminal links retain client-side
navigation and exact token intent; Project navigation avoids speculative fetches.
The unchanged Project graph browser checks still require all 15 projects, exact
CannaCat intent, no generic intermediate frame and isolated enrichment.
