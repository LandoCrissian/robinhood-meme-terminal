# Mobile trading and stable refresh

Base: `e7727dce645d6283f3995e9ae53de898d5f3d4f2`, tree
`98da5f05efd48f2fd81bb6ea67b2eb63e4146341`.

## Implementation

The public terminal keeps one responsive asset workspace and one composer.
Changing the breakpoint updates presentation without creating another quote
timer or replacing the trade input. Desktop retains its market navigator,
larger chart, market metrics and investigative tabs. Mobile retains the chart
and market tabs, with a compact trade sheet and a persistent action dock.

The existing controller remains the only execution lifecycle. Its last-ready
verification and plan supply a coherent **display** snapshot during renewal.
Expired figures say “Last quoted · stale” and “Last quoted minimum”; they cannot
execute. Current evidence, expiry checks and fresh explicit-action preparation
still control wallet handoff. Retained display data is scoped to the same
authenticated user, selected wallet, chain, pair and atomic amount. Optional
pool enrichment no longer changes that client presentation context.

Expected receive, minimum, fee and network estimate remain together. Detailed
provider evidence and reconciliation information move into Details; genuine
errors stay next to the action. The primary Buy/Sell control remains mounted
across routine renewals. Owned wallet requests retain their original payload
and status. No server route, provider parser or financial authority is changed.

Fresh mobile openings and deliberate side changes reveal the amount without
opening the keyboard. Passive refresh does not reset scroll or close Details.
Payment preferences use bounded session storage under the selected wallet key
and chain 4663. A deliberate ETH choice carries into Sell and continuation;
balance updates do not recalculate a percentage-selected amount. Confirmed
USDG zero plus confirmed spendable ETH can select ETH for a new unsaved ticket.
Unavailable balances are not treated as zero.

The chart scaffold stays mounted when optional pool/chart evidence arrives.
Loaded candles survive same-context renewal; previous-token/range candles are
never displayed for a new key. Market values and exclusions update immediately,
while row ordering is anchored during pointer/scroll interaction. Canonical
ranking catches up after 1.5 seconds without interaction; no polling is added.

Confirmed receipts put input, actually reconciled output, fee and explorer link
first. Unreconciled output remains explicitly unavailable, and quoted terms
remain quoted in Details. No settlement parser or receipt authority is added.

## Unchanged execution and economics

0x Swap API v2 AllowanceHolder; chain 4663; original provider transaction and
terms; explicit wallet confirmation; exact approvals; fresh post-approval
quote; immutable handoff; cancellation/generation isolation; duplicate
protection and durable originating-sender recovery. Stock Tokens stay view-only.
Gasless dispatch remains zero. No metadata/pool/curation, local simulation,
route decoding, runtime proof or chain-clock gate is restored.

The existing fee remains 25 bps with unchanged treasury: base/base uses input;
otherwise either USDG leg uses USDG; otherwise either native ETH leg uses ETH;
otherwise sell asset. Token-to-USDG/ETH may pay fees in output units. Nonzero
fees are not rounded to a displayed zero; shortened output is marked approximate.

Debounce remains 400 ms, active cadence 9,000 ms, indicative reuse maximum
6,000 ms. Freshness periods and quote expiry are unchanged.

## Evidence and reproduction

All new browser evidence is **MOCKED_LOCAL_BROWSER**, using the actual public
React components and local RMT quote/verify/authorize routes. SDK, wallet,
provider and RPC boundaries are controlled. No production authentication or
financial operation is represented by these tests.

The baseline checkout is PR554 head
`fe0f81510b9879cb7d8481948cc7a21d6ca98913`, whose tree exactly equals the
authorized main tree. Its existing acceptance artifact was exercised without
editing source. [Baseline measurements](evidence/mobile-stable-refresh/before-measurements.json)
record the distinction. The supplied owner recording was not available on disk;
its time observations remain owner-reported, not a video watched by this task.
The prior ROBINPEPE buy/approval/sell evidence is preserved as owner-supplied
successful production comparison, not new execution or universal acceptance.

The new stability test runs desktop 1440×900 and mobile 390×844 for at least
90 seconds each using **real wall-clock application timers**. It delays a firm
response 14 seconds, samples the expired snapshot, causes a temporary outage,
then retries through one explicitly rejected mocked wallet handoff. It records
input DOM identity, focus/caret, amount, Details, range, scroll and action boxes,
request counts and screenshots/videos. Only the explicit retry creates a mocked
wallet request; passive quotation creates none.

The row-anchor test advances the freshness clock and resumes the existing
visibility scheduler; real timers still settle the interaction. It uses the
real canonical directory reader and controlled optional market/OHLCV responses.
That clock advancement is not used to claim quote cadence or live latency.
375/390/430/768 layouts and a reduced 390×440 keyboard viewport are emulated.
An emulated viewport is not actual iPhone keyboard acceptance.

Reproduce using the existing 0x workflow environment and build, then:

```sh
RMT_STABLE_REFRESH_ONLY=true node .github/scripts/zerox-browser-acceptance.mjs
RMT_ACCEPTANCE_ONLY_ZEROX=true pnpm test:terminal-high-end
```

The complete workflow also retains native Buy/Sell, exact approval, delayed
identity readiness beyond nine seconds, expiry, rejection, pending/reload,
unknown output base units, mutations, account changes and recovery regressions.
CI artifacts include `source-profile.json` with actual HEAD/tree/profile and
dirty status, machine-readable traces, screenshots and videos. The workflow
checks out the exact PR head before building its acceptance artifact.

## Review qualifications

The first PR head (`28b75f6`) did not pass CI. Its checks remain in the
GitHub history. Review found a hidden duplicate Markets navigator, obsolete
chart/copy assertions, a funding test that assumed USDG remained the default,
and an identity-recovery assertion counting two different user intents as
duplicate requests. The navigator is now rendered only in the asset context;
funding coverage explicitly selects USDG; recovery asserts one request per
exact intent. Preview/view-only status remains visible on mobile. A settled
identity error also exposed an incorrect “Finding best route” estimate label;
the ticket now shows its actual failure phase and does not imply active work.
These corrections retain all suites and financial side-effect assertions.

Local iteration caught and corrected a dormant-ticket hydration mismatch,
a fixture selector using button instead of tab, and a side-change measurement
sampled before its scheduled animation frame. Assertions remain behavioral;
no financial protections or suites were disabled. A stronger real-pointer case
also found an empty-order capture during initial row publication; interaction
now captures the actual displayed ordering. Required exact-head results
and any rerun qualifications must be reviewed with the PR's check history.

This implementation does not merge or deploy. Production, PR553, Railway,
NFT services, environment, credentials and financial actions remain untouched.
Actual iPhone keyboard behavior, owner-session swapping and settlement on this
new UI remain live owner acceptance after an independently authorized release.

## Measured before/after (controlled browser)

Each viewport has at least 90 seconds of observation, including a 14-second
delayed verification, outage and recovery. Detailed figures are in
[before](evidence/mobile-stable-refresh/before-measurements.json) and
[after](evidence/mobile-stable-refresh/after-measurements.json).

| Measurement | Before (both viewports) | After (both viewports) |
| --- | --- | --- |
| Passive action / scroll movement | 0 / 0 px | 0 / 0 px |
| Focus/caret/input failures | 0 | 0 |
| Expired minimum | Removed: “Set when you trade” | Retained, explicitly “Last quoted minimum” |
| New Sell scroll | 90 px | 0 px |
| Sell receiving choice after ETH Buy | USDG | Native ETH |
| Quotes / verify / authorize in equal 42-second passive interval | 4 / 4 / 4 | 4 / 4 / 4 |
| Passive wallet requests | 0 | 0 |

The fix does not claim to have removed baseline scroll motion that these tests
did not observe. After testing additionally verifies the same primary button
DOM element throughout passive renewal, a retained chart/range, and ETH
preference after reload. Focused approval testing passed all six scenarios in
each viewport: delayed verification, success, expired failure, failure, one
click during refresh, and healthy exact approval.

Review media (all captioned clips are controlled test data):

- Mobile [before](evidence/mobile-stable-refresh/before-mobile-refresh.mp4) /
  [after](evidence/mobile-stable-refresh/after-mobile-refresh.mp4).
- Desktop [before](evidence/mobile-stable-refresh/before-desktop-refresh.mp4) /
  [after](evidence/mobile-stable-refresh/after-desktop-refresh.mp4).
- Mobile ticket [before](evidence/mobile-stable-refresh/before-mobile-ticket.png) /
  [after](evidence/mobile-stable-refresh/after-mobile-ticket.png),
  [renewal](evidence/mobile-stable-refresh/after-mobile-after-renewal.png),
  [token workspace](evidence/mobile-stable-refresh/after-mobile-token.png).
- Desktop ticket [before](evidence/mobile-stable-refresh/before-desktop-ticket.png) /
  [after](evidence/mobile-stable-refresh/after-desktop-ticket.png).

Exact-head CI artifacts are the authoritative final-source rerun. Curated
local after evidence is labeled a working-tree acceptance build; it is not a
production artifact. The unchanged required workflow uploads complete traces,
videos, screenshots and source/profile labels for independent review.
