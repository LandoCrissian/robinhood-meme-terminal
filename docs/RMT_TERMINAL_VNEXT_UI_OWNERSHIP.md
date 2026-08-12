# RMT Terminal VNext UI Ownership

Status: **CURRENT — canonical UI migration contract; production-root compatibility remains**

## Problem

The current responsive terminal is not one product adapting to screen size. At 761 pixels it swaps between two independent React feed implementations:

- `ExternalMarketFeed` on mobile;
- `ExternalMarketFeedV10` on desktop.

The root layout also imports terminal stylesheet generations from V7 through V12 plus professional, desktop, mobile, workspace, and interface-polish layers. Later files can override earlier ownership without changing the component that introduced the original rule.

This explains the current inconsistency: mobile received a focused card-and-action experience while desktop accumulated workstation density, older visual assumptions, and cascade patches.

VNext will not add another stylesheet generation or a third terminal component.

## Decision

One semantic component tree owns mobile and desktop. Layout changes through explicit component variants, container/media queries, and design tokens. Business state, accessibility names, route states, and execution state remain identical across breakpoints.

```text
TerminalShell
├── AccountSummary
│   ├── AvailableBalance
│   ├── PendingBalance
│   └── DepositAction
├── DiscoveryWorkspace
│   ├── MarketSearch
│   ├── DiscoveryFilters
│   └── MarketCollection
│       └── MarketItem (card or row presentation)
├── AssetWorkspace
│   ├── AssetIdentity
│   ├── Chart
│   ├── PositionSummary
│   └── EvidenceSummary
└── TradeComposer
    ├── AssetInput
    ├── AmountPresets
    ├── QuoteProgress
    ├── CandidateComparison
    ├── AuthorizationReview
    └── SettlementStatus
```

Mobile and desktop may arrange these modules differently. They may not implement their state logic separately.

## Visual product principles

RMT should feel like a modern financial workstation, not a theme layered over a data table.

1. Capital and action lead. Available balance, position, price, and buy/sell controls receive the strongest hierarchy.
2. Evidence is progressive. Route, provider, spender, source, and risk detail remain accessible without dominating discovery.
3. Density is deliberate. Desktop can show more simultaneous information, but never by shrinking primary labels into unreadability.
4. Shape has meaning. Cards, surfaces, fields, and buttons use a restrained radius scale instead of mixing square legacy rows with unrelated rounded controls.
5. Color communicates state. Green and red do not substitute for labels; venue brands do not determine route ranking.
6. Motion explains change. Quote refresh, pending settlement, and balance confirmation may animate subtly and respect reduced-motion settings.
7. Empty and delayed states are designed states. Zero, unknown, syncing, stale, unavailable, and no-route are never visually conflated.

## Design-token ownership

VNext introduces one token layer scoped to the VNext root. Required categories:

- canvas, surface, elevated surface, border, and overlay colors;
- primary, secondary, muted, positive, warning, negative, and information text;
- four spacing steps plus page and section gaps;
- compact and comfortable row heights;
- three radius levels;
- focus ring;
- shadow/elevation levels;
- numeric and text typography roles;
- motion durations and easing;
- mobile, tablet, workstation, and wide-workstation layout thresholds.

Tokens express intent, not component history. Names such as `--terminal-v10-green` or `--desktop-polish-gap` are prohibited.

## CSS ownership rules

1. VNext styles are imported once from the VNext route/shell, not globally beside legacy generations.
2. A component owns its root class and descendants. Another stylesheet cannot reach inside it by selector coincidence.
3. `!important` is prohibited except documented third-party integration boundaries.
4. Selector specificity stays shallow. No page-level selector chains to repair component state.
5. Breakpoint rules live with the component whose layout changes.
6. State is expressed through data attributes or explicit variants, not source-order overrides.
7. Removing a legacy stylesheet requires a before/after visual inventory and reference search.
8. VNext does not reuse ambiguous legacy classes such as generic `panel`, `row`, `card`, `action`, or `status`.

## Responsive behavior

### Mobile: 360–760 pixels

- available and pending balance at the top;
- market discovery as concise cards;
- bottom or sheet-based trade composition;
- at least 44-pixel primary interaction targets;
- no document-level horizontal scrolling;
- execution evidence scrolls inside its sheet, never behind a fixed action;
- one primary action per visible region.

### Tablet: 761–1099 pixels

- one component tree in a two-zone layout;
- discovery remains readable without desktop-density columns;
- trade composer can become a side sheet when width permits;
- no abrupt replacement with a separate terminal implementation.

### Desktop: 1100–1599 pixels

- discovery, workspace, and execution rail can coexist;
- the execution rail remains viewport-bound and independently scrollable;
- primary market labels remain at normal reading size;
- secondary evidence uses disclosure and tooltips rather than additional tiny columns.

### Wide desktop: 1600 pixels and above

- additional width increases useful context and whitespace;
- it does not stretch tables indefinitely or add fields solely because space exists.

## Required state parity

Every breakpoint must render and test the same state vocabulary:

- directory loading, ready, delayed, stale, empty, and failed;
- asset detected, route checking, tradeable, no route, temporarily unavailable, policy restricted, and unknown/review;
- quote editing, quoting, reviewing, verifying, ready, authorizing, pending settlement, settled, failed, expired, and cancelled;
- settled, pending incoming, pending outgoing, and reserved balance;
- market warning and transaction-integrity blocker.

The content may collapse or move, but no breakpoint may silently omit a blocker, fee, recipient, spender, protected output, or settlement state.

## Migration method

1. Capture current mobile and desktop reference screenshots and component-state fixtures.
2. Introduce a VNext shell behind a development-only route or disabled flag.
3. Build account summary, directory, market item, workspace, and trade composer as isolated components.
4. Feed both card and row presentations from one market view model.
5. Verify parity and accessibility before connecting live quotes.
6. Migrate one production surface at a time.
7. Delete an old component/style layer only after repository references reach zero and visual acceptance passes.
8. Remove `ResponsiveExternalMarketFeed` only after the unified collection owns all supported widths.

## Current dependency inventory

This table is the review boundary for the VNext ownership migration. A dependency listed as shared is intentionally reused; it is not permission to copy or fork the implementation.

| Capability | Current dependency | Classification | Retirement path |
| --- | --- | --- | --- |
| Production root terminal | No VNext component import; both routes still inherit the root provider and public-shell layout | Compatibility runtime | Keep shared providers until production cutover; do not import either legacy feed into VNext. |
| Wallet connection | VNext-owned `VNextWalletConnection` delegates to the mature shared external-wallet button | Shared security runtime | Preserve exact wallet authentication and connector behavior; migrate presentation only when it can remain one implementation. |
| Funding controls | Shared `FundWalletButton` | Shared terminal infrastructure | Keep one funding implementation; do not fork wallet funding into VNext. |
| Trading wallet identity | Shared `useRmtIdentity` | Shared security runtime | This is exact-wallet session binding, not the paused profile product. |
| Wallet holdings | VNext `SpendBalance` and wallet-asset detection | VNext-owned | VNext navigation now reveals these holdings directly. PR 4 completes the authoritative holdings surface; `/portfolio` remains a preserved legacy route but is no longer a VNext navigation dependency. |
| Full asset workspace | VNext `VNextAssetWorkspace`, `VNextMarketChart`, and VNext-owned `.vn*` presentation | VNext-owned with shared evidence infrastructure | Chart, activity, evidence, origin, liquidity, holders, position, verified markets, and RWA relationships stay inside VNext. The legacy public market route remains compatibility-only and is no longer a VNext navigation dependency. |
| Market directory and identity | `/api/vnext/market-directory`, `/api/vnext/asset-identity`, `/api/vnext/asset-workspace`, shared resolver/data contracts | VNext API with shared data infrastructure | Preserve the resolver, exact-pool OHLCV/trade streams, holder/risk evidence, and stock registry as shared services; do not introduce a second resolver or duplicate provider graph. |
| Quote, verification and authorization | `/api/vnext/quotes`, `/api/vnext/verify`, `/api/vnext/authorize` using the shared bounded quote transport | VNext-owned orchestration with shared transport | Keep the transport generic. No legacy terminal route selection is imported into VNext. |
| Styling | `vnext-terminal.css` owns the `.rmtVnext`/`.vn*` namespace; root layout still loads legacy global styles | VNext-owned selectors with inherited global-load debt | Keep legacy styles from reaching into the VNext namespace. Isolate route-specific global imports incrementally after the routes they serve migrate. |

The executable ownership smoke enforces the route, import, and selector boundaries. It rejects direct VNext links to `/portfolio` or `/market/*`, promotion of paused `/profile` or `/launch` routes, unclassified shared imports, extra VNext stylesheets, and legacy global selectors that reach inside the VNext namespace.

## Smallest safe retirement sequence

1. Keep the current VNext shell and execution orchestration unchanged while enforcing the ownership boundary.
2. The selected-asset workspace is now VNext-owned and no longer constructs `/market/*` links. Preserve its real-data and fail-closed evidence boundaries as it is accepted visually.
3. Finish authoritative wallet holdings inside VNext; preserve pending-versus-spendable semantics and remove any remaining reason to visit `/portfolio`.
4. Isolate legacy route CSS from the root load as each compatibility route is retired. Do not remove generations in one mass cascade rewrite.
5. Cut production `/` to VNext only after the terminal completion gate passes; then redirect or retire replaced compatibility routes in separate reviewed changes.

## Acceptance matrix

| Area | Required evidence |
| --- | --- |
| Widths | 360×800, 390×844, 768×1024, 1024×768, 1280×800, 1440×1000, and 1920×1080 |
| Overflow | No document-level horizontal overflow; internal scroll regions identified and keyboard usable |
| Typography | Primary labels and actions readable without zoom; numeric columns use stable alignment |
| Interaction | 44-pixel mobile targets, visible focus, keyboard order, reduced motion, no action layout shift |
| State parity | Every required directory, asset, quote, balance, authorization, and settlement state at mobile and desktop |
| Security | Exact recipient, assets, protected output, fees, spender, provider target, expiry, and blockers visible before authorization |
| Performance | Shell interactive without route fanout; local search/filter immediate after directory load |
| Regression | Screenshot diff reviewed for every supported viewport and critical state fixture |

## Definition of visually complete

VNext is visually complete when mobile and desktop are recognizably the same product, share the same state and component ownership, and differ only where the physical interaction model benefits. A cleaner screenshot is insufficient if the cascade still has multiple owners or desktop and mobile can disagree about execution state.
