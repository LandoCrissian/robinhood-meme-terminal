# Trading economics, quote lifecycle and navigation

Owner authority: `RMT_FINAL_TRADING_ECONOMICS_QUOTE_AND_SPEED_PASS_V1`.
Implementation base: `970fa61fd1d790e4c12033afd4b27f942121d1dc`.
Existing real owner buy/sell acceptance and PR538 trust-boundary evidence remain
unchanged. This patch is not a new funded acceptance proof.

## Fee policy

`zeroXFeeAsset(sell,buy)` is the single selection authority:

| Pair | Fee token |
| --- | --- |
| USDG / ordinary project, either direction | USDG |
| Native ETH / ordinary project, either direction | Native ETH |
| USDG / native ETH (base/base) | Existing sell-token fallback |
| Other token/token | Existing sell-token fallback |

WETH remains an ERC20, not native ETH. The 25-bps rate, treasury and provider do
not change. 0x documents `swapFeeToken` as either the buy or sell token:
[AllowanceHolder reference](https://docs.0x.org/api-reference/evm-ap-is/swap/allowanceholder-getprice),
[0x fee guide](https://docs.0x.org/evm/0x-swap-api/guides/monetize-your-app-using-swap).

Output fees use provider-returned atomic amounts in output units. They are never
calculated from input units or compared with input atom counts. The gross input,
AllowanceHolder approval and native transaction value still bind the sell asset.
The serialized `PROVIDER_NATIVE_INPUT_FEE` name is retained for compatibility;
it is not a sell-token-only rule. Existing journal records retain their original
economics, while new preparation uses the current policy.

The known BASIC fee transfer binds expected token, treasury, rate, canonical
encoding and exactly one recognized treasury fee. Output fees are found after
input acquisition and before the outer reviewed post-action minimum/transfer.
Additional user withdrawal authority and early CHECK_SLIPPAGE remain rejected.
Unknown internal routing still yields nonblocking introspection diagnostics.
No runtime, provider, wallet, fee-rate or treasury change is included.

Trade review and recovered quoted-fee disclosure use the actual fee token's
symbol/decimals. Quoted fee, encoded percentage and receipt success are not
settled revenue. Existing transaction-specific reconciliation remains necessary.

## Quote lifecycle

Before: 120-ms typing debounce, 4-second indicative loop and firm preparation
scheduled at quote expiry minus 5 seconds. The latter can become immediate when
server work consumes the quote lifetime. The owner's approximately one-second
observation was not reproduced as a universal timer; the local baseline observed
about five seconds between firm preparations.

After: 400-ms typing debounce, a single 9-second start-to-start automatic firm
cadence, and 9-second indicative cadence when no firm preparation is active.
Visibility, online status and mobile sheet-open state gate automatic work.
Resume schedules one immediate read; it does not replay missed intervals.
No new polling is introduced. Pending transaction recovery remains mounted.

The coordinator retains same-intent single-flight behavior and latest-generation
publication authority. Shared request deduplication now lasts through the whole
in-flight request, rather than expiring after the 1.5-second resolved-cache TTL.
Explicit Trade and post-approval paths still clear old authority and obtain fresh
firm verification; no public cache contains executable quotes or commitments.
Stale comparison values can remain visible, labelled non-executable.

## Navigation and data dependencies

Before, selecting a known provider-discovered/search token still awaited exact
search, identity and external-market reads together unless it carried canonical
pool evidence. The workspace separately awaited both core and optional data.

After, an exact selectable, non-quarantined search/directory result publishes
immediately. It is presentation data, never server execution-admission authority.
Core workspace, optional intelligence and external market results publish
independently. Existing exact address, pair and generation checks remain.
A bounded browser-memory public cache shares only workspace/external-market
reads (24 keys, 60-second reuse); failed revalidation retains a stale snapshot.
Core and enrichment use views of the existing endpoint, not a new service.
Public response caches remain bounded; wallet/authorization data are excluded.
No speculative whole-directory prefetch is added: immediate reuse is sufficient
for the measured bottleneck, without paying for markets never opened.

## Evidence and limits

READ_ONLY_PRODUCTION single samples before changes:
- CANNACAT asset workspace: 747 ms, HTTP 200, cache MISS.
- External market read: 6875 ms, HTTP 200, cache MISS.
- Asset identity: 201 ms, HTTP 200, cache MISS.
These are endpoint wall times, not production click-to-render or CPU metrics.
No quote, wallet action or production mutation was made for these measurements.

MOCKED_LOCAL_BROWSER uses the real React/API implementation with synthetic
provider/RPC/wallet boundaries and a 5000-ms optional external response delay.
Baseline exact-contract search submission to shell: desktop 5454 ms, mobile
5471 ms; controls: 5481/5483 ms. Search itself returned in 104/66 ms. Price was
truthfully UNAVAILABLE in this fixture, so no price latency is asserted.
Optional-source completion is not a prerequisite for the shell or controls.

Baseline visible 21-second windows each contained four price/firm/authorization
cycles; hidden 11-second windows contained zero; offline and closed-mobile
11-second windows each contained two cycles. These are request counts, not
measured Vercel CPU. After-change local measurements:

| Metric | Desktop before / after | Mobile before / after |
| --- | --- | --- |
| Search submission to token shell | 5454 / 134 ms | 5471 / 128 ms |
| Search submission to identity + trade controls | 5481 / 154 ms | 5483 / 141 ms |
| Price | Unavailable / unavailable | Unavailable / unavailable |
| Visible price/firm/authorization cycles, 21 seconds | 4 / 2 | 4 / 2 |
| Hidden quote requests, 11 seconds | 0 / 0 | 0 / 0 |
| Offline cycles, 11 seconds | 2 / 0 | 2 / 0 |
| Closed sheet cycles, 11 seconds | Not applicable | 2 / 0 |
| Last keystroke to quote request | 120-ms configured / 415-ms observed | 120-ms configured / 414-ms observed |

Steady configured cadence is approximately 6.67 firm requests/minute instead of
approximately 12 in this baseline. The finite visible samples contain 50% fewer
cycles; this is not a claim of 50% CPU/dollar savings. Resumption and typing cause
bounded additional immediate work. Each automatic firm cycle currently includes
one indicative, one firm-verification and one authorization request.

Price and optional-enrichment completion are deliberately **not claimed** from
this unavailable-provider fixture. "Core" here means known identity and usable
trade controls, not a fabricated price or preauthorized trade. Warm production
latency and actual phone responsiveness require post-release owner acceptance.
The browser suite emits per-viewport JSON artifacts and CI records exact head.

Local tests cover all four base/project directions, old fallback economics,
output atomic units, malformed/wrong/duplicate encoded fees, independent provider
fees, exact input/approval/commitment and recovery. The existing hard-invariant,
unknown-route, simulation, post-approval and duplicate/recovery suites remain.
No synthetic test is represented as a live provider or real wallet acceptance.

## Release boundary

Independent review and explicit owner merge/release authorization are required.
After an authorized release, verify the exact source SHA and normal domain health.
The owner uses the ordinary phone terminal for a small buy and reverse sell,
checks the displayed fee asset, idle stability, navigation and fresh wallet review.
Only the owner initiates/approves the wallet action. Reconcile resulting normal
records and transaction hash; do not infer settled revenue from a quote.

Vercel/Railway budgets, pause controls, credentials and production are unchanged.
Request reduction is expected; exact metered CPU/dollar savings are not measured.
