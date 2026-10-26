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

Task117C separates automatic read-only pricing from explicit executable review.
Connect uses Privy's wallet login UI so SDK authentication completion advances
the session without a second manual verification click. Connected addresses,
authenticated identities, verified linked wallets and matching live providers
remain separate checks; the server still verifies the identity token.

Valid input starts debounced indicative pricing. Foreground estimates refresh
at 15-second intervals, serialize requests, retain the last estimate on failure,
back off up to 120 seconds and honor a longer bounded Retry-After. Hidden pages
and wallet prompts pause observation. A 30-second request deadline prevents a
read from owning the interface indefinitely. Authentication errors stop retries
until the session changes. Insufficient funds and unresolved history do not
prevent observation. No background path calls verify, authorize or a wallet
signature method. Review trade fetches fresh terms using actual spendable funds,
then the separate confirmation retains every existing execution guard. Background
prices never change a reviewed firm quote. Changed executable terms require a
new displayed review and explicit confirmation.

Authenticated restoration and visible-page resume retry journal reconciliation
at most every 30 seconds. Only exact canonical receipt/plan/output proof can
resolve a saved execution. Journal events synchronize the UI and cross-tab state;
the history is never deleted. Recovery reads use a separate cancellable lifecycle
and cannot lock Disconnect or amount editing. A receipt/indexing delay is not
treated as execution failure and never triggers automatic resubmission.

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

### Single signing wallet policy — Task115 owner correction

Authentication, a connected SDK wallet, the selected signing provider and its
active chain are independent. A stored login address never proves a live signer.
The embedded panel selects exactly one external Ethereum binding automatically,
including a restored session. Multiple bindings, even for the same address, still
require an explicit connector choice; duplicate bindings fail closed. A departed
selected binding is not silently replaced by another account.

RMT's canonical Privy/Wagmi bridge also activates a sole already-authenticated,
linked external wallet through its existing awaited connector activation. It
does not replace an explicit preference, an embedded signer, another live Wagmi
connection or multiple connected wallets. Automatic activation cannot log in,
request a signature, change networks, approve tokens or submit a transaction.
Global connect callbacks remain discovery notifications rather than authority.

The panel now reads `eth_accounts` and `eth_chainId` from the exact provider.
The exact SDK-selected address must be exposed by that provider. Do not infer
selection from array order: EIP-1193 describes available accounts, not a selected
account ordering. Multiple SDK connectors still require a choice. Chain identifiers are normalized and then checked
against 4663. Privy's cached CAIP chain label does not gate a live quote.
Wrong network exposes the explicit **Switch to Robinhood Chain** action.
After it completes, reacquire and inspect the provider instead of trusting the
old instance. Provider reads are bounded and never call `eth_requestAccounts`.

Account/chain/disconnect events, mobile focus, pageshow and visibility changes
invalidate prepared authority and recheck the selected provider. Page suspension
removes a stale confirmation. An unavailable provider, changed account, wrong
chain and expired authentication have separate recovery states. Before and after
quote preparation, fresh read evidence must still match; final signing remains
an explicit gesture over the saved exact transaction.

Regression fixtures independently control SDK metadata and provider state to
reproduce stale chain labels, restored MetaMask/Rabby sessions, multiple
connectors, disconnects, account changes and mobile return. Browser fixtures are
not native iPhone wallet proof. Request owner confirmation on the updated preview
without signing a trade before describing a real-device issue as resolved.

Privy's [network documentation](https://docs.privy.io/basics/react/advanced/configuring-evm-networks)
distinguishes default/supported chains from an external wallet's actual network.
The [EIP-1193 account-change definition](https://eips.ethereum.org/EIPS/eip-1193#accountschanged)
describes the provider's available accounts.

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

### Task117 responsive controls and acceptance

Wallet identity, connector choice and verification/network/disconnect actions
occupy separate responsive rows. A single shortened address stays on one line;
long wallet names wrap within their own area. Controls retain at least 44px touch
targets, visible keyboard focus and the existing execution handlers. Connection
readiness is shown once; operational and recovery messages stay separate.

Trade-review input, output, fee and gas amounts retain all available 18-decimal
precision, trimming only trailing zeroes. Small nonzero fees are not rounded to
zero or hidden behind an eight-decimal display threshold. The balance overview
may remain shortened; transaction amounts and the 25-bps fee policy are unchanged.

The active server path is the provider-native implementation merged in
[PR #554](https://github.com/LandoCrissian/robinhood-meme-terminal/pull/554),
included in the reviewed Task115 base. It binds the authenticated official 0x
response, exact wallet/chain/assets/input, returned minimum, allowance, fee
request, immutable transaction and expiring HMAC commitment. Its regression
suite explicitly preserves this boundary. Retained legacy runtime/route decoder
tables are not an additional gate in that current path. Task117 does not add a
runtime, change a provider or relax any existing execution check. Historical
receipt/trace analysis is evidence review, never a new execution admission.

The disposable Chrome/Edge harness covers 320, 375, 390, 430 and desktop widths,
including an unauthenticated connected wallet, multiple connectors, long wallet
names, buy review and sell approval. Before screenshots compile the exact pinned
Task115 panel source at `af597d2d8ccf0c4db05e993ac5dd4bbf32171399`; both before
and candidate fixtures are synthetic and must never be delivered to a public
site. The real SDK retains the unchanged non-fixture manifest gate. Native
iPhone acceptance and funded settlement are separate from those simulations.

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

## Task117B funds and input modes

The isolated panel supports CannaCat output targets, exact native ETH inputs and
indicative USD targets. `quoteEth` delegates to the same authenticated canonical
VNext quotes/verify/authorize endpoints; no provider, server permission, fee or
execution contract changes. USD converts with integer arithmetic and is never
an asset or settlement instruction. Firm terms remain hash-bound and wallet
confirmation remains an explicit user gesture.

`cannacat-funds.ts` reads the public Coinbase Exchange ETH-USD ticker with no
cookies, identity token or wallet address. Official API documentation:
https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker
The last-trade timestamp and local check timestamp must be valid within 120s;
responses are bounded to 16KiB, 8s, no redirects. USD is display/intent estimation
only. The enabled LAMMB preview CSP admits this single additional HTTPS origin
for connections only; closed-site policy, frames and production remain unchanged.

Native ETH and token reads are bound to connector-qualified wallet identity,
chain 4663, a fresh block/hash and observation time. Displayed spendable amounts
are the minimum of confirmed and pending balances, so pending credits cannot
fund a trade. Reads run sequentially per panel at 15s visible-page intervals and
on restoration/verified settlement, with at most one refresh in flight. Balance
age above 20s, RPC failure, wrong account/chain and missing provider block wallet
confirmation. The exact transaction still goes through canonical gas readiness.
Prequote headroom is 1,000,000 gas units at three times observed gas price; this
is a conservative quote budget, not a gas charge or actual network estimate.
The actual verified plan may need a larger reserve and is checked again before
the explicit wallet request.

Background funds/price reads never change amount, mode, or the exact quote.
Wallet suspension/return invalidates executable authority while retaining a
clearly marked saved review. A new verified quote is required to confirm.
Input amounts, direction and mode are retained in a bounded, versioned tab-session
form record across refresh. This optional record contains no wallet, identity,
quote, signature or executable authority; restored intent always needs fresh
wallet/balance evidence and a newly verified quote.

Acceptance must distinguish disposable browser RPC/wallet fixtures from native
iPhone Safari/MetaMask/Rabby and funded settlement. No test signs a real wallet.

## Post-transaction recovery and cancellation

An unresolved durable transaction blocks another authorization, not navigation,
amount editing or Disconnect. Indicative quote reads remain available but cannot
produce a wallet confirmation until the journal is reconciled. Disconnect never
clears either canonical journal. Refresh and reconnect restore outstanding hashes.

Each foreground action owns an identifier, wallet key, abort controller and a 45s
watchdog. Cancel, account/chain change, page suspension and timeout release only
that action's transient loading state and invalidate prepared authority. A late
response cannot finish a newer action or replace newer input. A late wallet hash
is still recorded against the original exact plan, even after cancellation or
disconnect. Stopping a wait never cancels a blockchain transaction; do not resend.

For native ETH output, the authenticated server can read the fixed official
Robinhood Chain Blockscout full call trace when the configured tracing RPC is
unavailable. It independently anchors indexed block and exact transaction bytes
before and after reading, applies existing response/node/depth/duplicate-key
bounds, and rechecks the canonical successful receipt. The browser still requires
its saved exact plan, payload, calldata hash, wallet, block and protected minimum.
Receipt-only success, ERC-20 wrapped-native logs and balance-delta guesses remain
insufficient. No generic RPC proxy, caller URL, credential or trade provider is
introduced. A missing, delayed, mismatched or reverted trace stays unverified.

Official read-only trace specification:
https://github.com/blockscout/blockscout-api-v2-swagger/blob/main/swagger.yaml

Insufficient ETH is a specific amount/gas error rather than a disabled panel.
The explicit **Max ETH · leave gas** action uses fresh matching confirmed/pending
minimum funds minus the conservative prequote reserve. It cannot guarantee that
every later plan fits; canonical firm gas checks remain mandatory before signing.
### Historical full-trace recovery

An unavailable live trace is different from a failed sale. The owner-reported
Task117C historical sale retains a complete original Task117B trace in the
server-only settlement-trace archive, with original SHA-256 and provenance.
This is evidence recovery, not an accepted-status table: no output amount or
wallet permission is supplied by the archive index. The fixed server reader
checks its byte digest, exact transaction, block, height, sender, target, value
and calldata. The protected route still authenticates the same wallet and checks
a fresh canonical mined envelope before, and receipt after, reading this trace.
The existing browser verifier computes native output from the full call tree,
binds the saved plan/payload/calldata/recipient/minimum and atomically persists
the proof. Unknown transactions, reorgs, archive changes or incompatible saved
minimums remain unresolved. An old quote is not needed to reconcile a mined
transaction, and no quote/authorization is recreated or resent.

The historical regression uses the exact public receipt, transaction and trace,
with explicitly representative journal authority; it does not claim access to
the owner's Safari storage. Chrome/Edge and WebKit tests reproduce the warnings
with trace unavailable, then restore proof across refresh/reconnect. WebKit is
an engine test, not physical iPhone acceptance. The issue remains unconfirmed
until the owner verifies their existing phone history.

Recovery support details provides an explicit local clipboard action for the
displayed wallet/transaction only. It exports a fixed allowlist of saved public
recovery fields and a categorical last-result code, including the exact saved
minimum needed to diagnose a mismatch. It never spreads journal/request objects
or exports login tokens, signatures, authorization bundles or recovery calldata.
Copying neither changes history nor signs/submits anything. The owner decides
whether to share those details privately; nothing is uploaded automatically.
