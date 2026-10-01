# Trading and navigation continuity

Authorized base: `74bc30df70dd3bdb131c3b3e27596a93480718f9`.
This is a client presentation/navigation correction. No release or financial
action is authorized. PR553 and the Project Graph's admitted relationships are
unchanged.

## Evidence boundaries

- **Observed public production:** a normal 390px Project → CANNACAT Token Market
  click exposed 169 generic Markets frames before the selected workspace.
  Correct shell/identity/trade entry appeared after 2,137ms. This is an emulated
  viewport, not physical iPhone evidence. The first-visit introduction was present;
  the observation records the destination DOM underneath that introduction.
- **Controlled baseline:** the actual authorized-base application, real public
  components and real RMT handlers, with external SDK/RPC/0x boundaries controlled.
  Each mobile/desktop observation runs for 90 seconds using application timers.
  In its initial 42-second renewal window, both viewports had 18 observed card-node
  replacements and six receive-label changes despite 0px action/chart/scroll
  movement. Opacity flashes and input instability were zero. There were four
  requests each to quotes, verify and authorize in that window.
- **Production quote parity remains unresolved:** a bounded read-only route-log
  sample contained 100 quote successes, 18 successful verifications, one 409
  verification, and 18 successful authorizations. It is truncated and cannot bind
  equivalent owner desktop/mobile intents. The unmatched 409 is not diagnosed as
  the reported failure. No owner-authenticated comparison was performed.
- **Controlled parity:** the mounted public composer, not direct fixture POSTs,
  exercises identical native-ETH input through real quote/verify/authorize routes
  at 375, 390, 430 and 1440px. This can detect viewport regressions; it cannot
  establish the original production auth/provider cause.

## Changes and authority

The existing retained same-context firm response now supplies receive, minimum,
fee, provider and transaction-evidence presentation throughout renewal. Their
DOM sections remain mounted. Fresh terms publish together through the existing
coordinator. A separate small status describes updating, expired terms, outage
or recovery. A retained display never grants execution authority;
`currentTradeEvidence`, expiry and the wallet handoff still require current
matching evidence.

Display phases are `NO_QUOTE`, `FETCHING_INITIAL`, `VERIFIED_FRESH`,
`RENEWING_WITH_PRIOR_TERMS`, `EXPIRED`, `PROVIDER_UNAVAILABLE`, and `RECOVERED`.
Expiry, request cadence, retry limits, polling ownership and financial payloads
are unchanged. The existing refresh margin is reflected truthfully in the display.

**Trade Details** contains the trader's provider, payment, output/minimum, fee,
network estimate, wallet/network, allowance requirement and freshness. Nested
**Execution Evidence** retains exact atomic values, fee settlement, targets,
spender, gas, payload, commitment and diagnostics. Unknown output decimals produce
the compact primary label “Exact output available in base units”; exact values
remain in Execution Evidence. Later unit enrichment changes formatting only.

Confirmed historical swaps no longer render premium-workspace settlement banners.
Portfolio has a compact “Last completed trade” disclosure, timestamp, explorer
link and explicit dismissal. Dismissal is scoped to sender/transaction and browser
session, separately from the durable execution journal. Pending/unresolved
recovery and fresh receipts are unchanged. No history restoration creates trade
intent, quotes or wallet calls. The existing execution journal remains the durable
history interface; this does not build a new Activity product.

Project → Token links seed the destination from the server's existing verified
Project Graph and exact chain-qualified ERC20 contract. URL metadata is never
trusted. The root page starts in the correct asset context; directory, chart and
market enrichment remain progressive. Trusted input units are seeded only when
the existing verified project evidence includes onchain verification. Wrong
project/address and ordinary unbound URL claims cannot provide this seed.

Transport diagnostics now distinguish a client timeout/network failure with no
HTTP response from an actual server response or shared response reuse. Timing is
bounded, and only existing stage/request/generation identifiers are retained.
Raw errors, headers, credentials and provider bodies are not exported. Request
retry, cache and cancellation behavior is unchanged. This is diagnostic support,
not a speculative quote-parity fix.

The loopback-only browser identity fixture now activates after its first hydration
render. Its previous direct `window` host check produced a different initial
server/client identity snapshot when the destination ticket was server-rendered.
The acceptance error assertion remains enforced. The production Privy bridge and
wallet authority implementation are unchanged.

## Reproducible acceptance and review artifacts

The `0x browser acceptance` workflow checks out the exact PR head. Its additional
`renewal-baseline` job builds the exact PR base in an isolated worktree and runs
the same controlled 90-second mobile/desktop task. This makes before recordings
reviewable without adding review-only binary media to Git. The main acceptance
job checks the after state and all existing transaction-control scenarios.

Download artifacts from that exact-head workflow run:

- `renewal-baseline-evidence`: before mobile/desktop PNGs, WebMs, samples and
  `source-profile.json` with base SHA/tree/profile.
- `zerox-browser-acceptance-evidence`: after recordings/screenshots, renewal
  measurements, response/request bindings, native Buy, ERC20 Sell/approval,
  fresh post-approval refresh, expiry, rejection, signer changes, recovery,
  restored history and unknown-unit scenarios. `source-profile.json` labels the
  tested SHA/tree and controlled profile.
- `terminal-visual-v2`: four-width Project search/navigation measurements,
  destination screenshots, enrichment/chart failure and recovery isolation.
- Existing account-first and real production-Privy-bridge workflow artifacts
  exercise their respective external SDK boundaries and actual RMT identity path.

The renewal regression observes actual card/input/action node identity,
disappearance, opacity and receive-label replacements, plus bounding boxes,
amount, payment, focus, nonterminal caret, scroll, chart range and request counts.
Its delayed response crosses expiry, then tests a real-handler recovery around a
controlled provider outage. A deliberately rejected **mocked** wallet request
occurs only after an explicit test click; passive windows require zero requests.
No test signature, transfer or broadcast reaches a real provider.

Project navigation records tap → shell, identity and persistent trade entry;
generic intermediate frames and selected-asset losses must be zero. The entry
metric measures the visible Buy/Sell dock or desktop ticket, not a firm executable
quote or a signed-out user's authenticated readiness. Keyboard resizing is
emulation and is not claimed as an actual iPhone keyboard observation.

## Remaining owner-controlled evidence

To diagnose live desktop/mobile quote divergence, correlate the same selected
public wallet, pair, atomic amount, recipient, chain, slippage and fee policy with
sanitized request IDs and attempt time/timezone. Owner authentication remains
private. Do not request session tokens, OTPs, cookies or keys. No additional deposit
is needed. A first divergent auth/client/server/provider boundary has **not** been
established, so this PR does not claim that production quote incident is resolved.

Physical-iPhone repaint/keyboard confirmation remains owner-controlled. Controlled
browser parity and reduced node/label replacements are separate evidence.

Initial-check qualification: the first PR revision exposed a nested-summary
selector ambiguity in visual capture, a missing disclosure-helper copy in the
isolated Preview/acceptance harness, and an account-first test that waited for the
generic Markets intermediate screen. These checks are updated to exercise their
intended public destinations/disclosures rather than requiring that obsolete
intermediate state. Local capture also exposed the fixture hydration mismatch
above and an extra open click racing deliberate Buy-side restoration. Assertions
on errors, identity, input, financial boundaries and recovery remain enforced.

Production mutated: **NO**. Real financial actions: **0**. No merge/deployment,
provider switch, fee/treasury change, Privy change, Project Graph population or
chart-cache change.
