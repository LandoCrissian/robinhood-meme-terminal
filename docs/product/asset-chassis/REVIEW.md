# RMT asset chassis

Authorized base: `2504da857f7fa237bf647ad655e5cf54c67fdb5a`.

This change keeps the existing terminal, controllers, wallet selection and provider-native swap flow. It changes screen-space composition and progressive information disclosure. Production, PR553 and infrastructure are untouched.

## Before visual defect inventory

The `before/` screenshots are LIVE PUBLIC SIGNED-OUT evidence from the authorized production release. They cover 375×812, 390×844, 430×932 and 1440×900. The JSON records viewport, page errors and overflow. The original `*-markets.png` filenames contain the workspace Markets tab; `*-markets-directory.png` captures primary discovery separately. No authenticated wallet or private data was captured.

| Severity | Observed defect | Correction |
|---|---|---|
| MAJOR | Mobile SVG used desktop coordinate space; candles and axis occupied too little of the card, with footer collision | Measure the actual plot frame. Compose price and volume domains inside it with explicit padding. Six ranges remain visible; chart style becomes a compact mobile disclosure. |
| MAJOR | Technical market provenance and large Copy/Explorer controls dominated the workspace | Compact contract actions, More → Market details, and Evidence & Sources disclosures. |
| MAJOR | Activity stacked time windows above a large unknown exact-pool panel | Three concise activity windows. No exact-pool section without actual tape evidence; distinguish an observed empty tape from unavailable tape. |
| MAJOR | Safety suggested an overall judgment and showed unknown summary grids | Holders shows available distribution evidence. Liquidity/contract observations remain accessible under Evidence & Sources. No safety verdict. |
| MAJOR | Stock Tokens resembled unavailable meme-token tickets | A distinct Stock Token identity and desktop reference panel, with View only and no active composer. Ordinary swaps still use the same composer. |
| MAJOR | Unfocused skip link could overlap primary content | Hide its geometry until keyboard focus; preserve the working skip action. |
| POLISH | Inconsistent text arrows/social treatments and oversized contract actions | One stroke icon component; labelled, focusable 44px controls. |
| POLISH | Missing project identity/description became explanatory regions | “Project not linked yet”; omit absent descriptions. |
| POLISH | Unknown balances looked like no holdings; copied relationship provenance was too broad | Distinguish unknown balance from zero; show each recorded relationship authority. |
| POLISH | Activity counts were ellipsized and null metrics said Unknown/Unavailable | Counts wrap; absent metrics use an em dash without inventing zero. |
| POLISH | The external-wallet selector exposed “injected signer” and protocol terminology beside Buy/Sell | “Trading wallet” labels and actionable browser guidance; exact provider selection and binding remain unchanged. |

No overflow or fatal page errors were observed in the initial public audit. These defects concern hierarchy, proportions and craft, not merely overflow.

## Information architecture

Mobile: exact identity → price/essential metrics → chart → contract actions → Activity / Holders / Project / Position / More. Buy/Sell keeps its existing persistent dock and sheet. Technical observations sit behind labelled disclosures. Desktop retains the navigator, larger plot and persistent trade surface; information panels remain independently scrollable.

The chart uses the observed low/high domain plus deliberate padding, with volume in a separate band. It does not alter observations or create candles. One SVG instance remains mounted. ResizeObserver updates its coordinate space without changing range, style, hover state or execution state. Successful responses with identical candles can still update their observation timestamp/stale label. Stale data says “Market data delayed”; original timestamps and pool attribution are in Evidence & Sources. Empty/loading/unavailable plotting surfaces keep the same chart geometry.

PR558 server/cache freshness boundaries, provider budgets, cooldowns, revalidation and deadlines are unchanged. No chart read supplies trading authority.

Activity shows provider aggregates by window and keeps exact-pool observations separately attributed. Holders retains concentration, known contract/wallet classification and observed relationships. Additional holder rows and technical liquidity/contract evidence remain accessible. This is a presentation home for future holder graphs; no Bubblemaps API or economic authority was added.

Position uses confirmed holdings where supplied and labels valuations as estimates. Missing balance evidence is unavailable, not zero. No cost basis, P&L or portfolio reconstruction was added.

## Presentation taxonomy and extension boundaries

`asset-presentation.ts` defines TOKEN, PROJECT, LAUNCH, STABLECOIN, RWA, STOCK_TOKEN and NFT_COLLECTION. Actual classification uses existing positive address-qualified evidence: canonical stock relationships, the existing USDG contract, validated launch evidence and existing Project Graph membership. Names and symbols never create classification. An ordinary token paired with a stock/RWA market remains a token.

Primary discovery retains Active first and its existing ranking/search semantics. Explore houses secondary RWA/Held/All views and nonempty loaded-market categories. It does not add admission rules. Taxonomy counts describe loaded evidence, not a chain-wide census.

Project renders existing confirmed graph assets, public links and their individual provenance. CANNACAT/CannaCats, HOPIUM/Hopium Machines and PEEPS/Founding Feathers have not been populated. Reference, issuer and launch relationship types are presentation contracts for future independently verified evidence, not newly inferred data. Existing validated launch lifecycle information remains under More → Origin & launch. No empty Pons/StonkBrokers controls or backend integrations were added.

Stock Token presentation uses existing positive classification and registry data; it never invents underlying-company rights or tradability. RWA relationship detail remains visible only with existing evidence. No new RWA assets were admitted.

## Execution and account boundaries

Quote/verify/authorize, HMAC commitments, 0x responses, AllowanceHolder approvals, fee selector/treasury, wallet handoff and recovery code are unchanged. Native ETH, ERC20 approval/refresh, unknown output base units, identity/generation isolation and Stock Token exclusion retain their existing behavioral suites. Gasless is not dispatched. Presentation categories are never imported by execution eligibility.

The actual fee policy remains 25bps: base/base → input; otherwise USDG if either leg is USDG; otherwise native ETH if either leg is native ETH; otherwise sell asset. Token→ETH/USDG may collect the fee in output units.

## Reproducible evidence

- `asset-chassis-smoke.ts`: positive-evidence taxonomy; OHLC bounds for synthetic edge cases and retained real-provider candle replays; first/last candle padding; truthful timestamps; unchanged refresh cadence.
- `asset-chassis-acceptance.mjs`: real public components at all four viewports, six ranges, Activity/Holders/Project/Position/More, sources, stale and unavailable charts, partial holders, ordinary trade sheet and Stock Token. External HTTP responses are CONTROLLED fixtures. Financial calls are prohibited. Reports include measured plot bounds, axis font sizes, overflow, request paths and videos.
- `chart-refresh-stability.mjs`: actual application timers over 135 seconds, FRESH → RETAINED_STALE → DELAYED_REFRESH → PROVIDER_FAILURE → RECOVERY. Measures amount, payment, input identity, focus/caret, scroll, range, details, chart/action/dock boxes and financial requests.
- Existing terminal/visual/0x/account-first/production-Privy suites remain enabled. Presentation selectors follow More/Explore/Holders; exact identity, classification, provider binding and recovery assertions remain. Unavailable exact-pool tape is asserted compactly rather than requiring an unavailable dashboard.

CI uploads before images and after screenshots/videos/JSON in `terminal-visual-v2`, labelled with reviewed head and checkout tree. Existing account-first and 0x workflow artifacts supply authenticated controlled UI evidence. Signed-out controlled screenshots do not establish live authenticated trading.

Physical iPhone keyboard behavior, owner-authenticated production acceptance and financial settlement are NOT TESTED by this implementation. Chromium mobile viewports/resize behavior are emulated. No owner action or deposit is required for review. Final screenshots must be visually inspected alongside behavioral results; a CI pass alone is not the marketing-quality decision.


## Review qualifications

Short mobile/desktop before recordings in `before/videos/` are LIVE PUBLIC SIGNED-OUT browser captures, with viewport/scope manifests. They record chart range changes, the previous Market Details and a passive interval. Named after recordings and the 135-second passive interval are controlled external-boundary CI artifacts. These are emulated viewports, not physical iPhones.

Initial CI exposed old selectors for the former technical disclosure, primary chart-source copy and idle skip-link geometry. The corrected tests follow More and Sources, still assert exact contracts, safe link targets/provenance, pool identity and unchanged transaction behavior. Keyboard-focused skip-link size is checked explicitly. A visible 26px Sources control found during visual review was enlarged to 44px; desktop and mobile chart geometry remains bounded.

Available chart, retained stale chart and later outage keep one reserved geometry to avoid moving the ticket or user's scroll. Their empty messages are compact; evidence does not become a large error panel. Holders, Project, Position and Activity omit or compact unavailable sections. No chart timestamp/freshness boundary was relaxed.
