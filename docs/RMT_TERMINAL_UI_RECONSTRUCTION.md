# RMT terminal presentation freeze

Status: CURRENT implementation note for the final presentation architecture.

## Baseline defect report

The VNext brain is correct, but the current shell opens directly into a selected-asset workstation and keeps the Spend Balance/portfolio banner above every surface. Market discovery is therefore secondary on desktop and hidden inside a disclosure above the asset on mobile. The 761px breakpoint also forces the three-column workstation into 768–1023px viewports: at 1023px the market navigator, chart and trade rail are cramped, and at 820px the document overflows horizontally.

The current mobile composition is not a first-class scanner. It starts in Asset mode, requires expanding Markets, retains the large balance/funding block, and places discovery above the selected asset. Portfolio is a reveal state rather than a dedicated terminal context. The execution sheet itself retains the correct modal, backdrop, focus, scroll-lock and safe-area foundations and should be preserved.

Baseline screenshots were opened and inspected at desktop, constrained-workstation and phone sizes. The defects are structural rather than spacing-only, so this work replaces the presentation composition instead of adding a CSS patch layer.

## Final product architecture

One shared `VNextTerminalShell` controller continues to own directory data, selected market, wallet state, confirmed balances, recovery and execution requests. It exposes three presentation contexts:

- `markets`: the default scanner and RWA discovery preset;
- `asset`: the selected-market intelligence workspace and contextual trade entry;
- `portfolio`: wallet balances and holdings.

The controller renders exactly one device composition:

```text
shared VNext state, services and execution infrastructure
├── DesktopTerminal (>= 1024px)
│   ├── Markets
│   ├── Asset workstation
│   └── Portfolio
└── MobileTerminal (< 1024px)
    ├── Markets
    ├── Asset
    ├── Portfolio
    └── verified trade sheet
```

Desktop Markets is a dense scanner. Desktop Asset uses a compact navigator, dominant chart/intelligence workspace and persistent execution rail. Mobile Markets is a first-class screen; selecting a row enters Mobile Asset, whose fixed Buy/Sell dock opens the existing verified execution sheet. Portfolio replaces the current body rather than occupying permanent space above it.

The canonical path remains `/`. Query parameters preserve compatible deep links: `market` enters Asset, `side` opens or focuses execution for that asset, and `panel=portfolio` enters Portfolio. Browser history restores contexts without recreating terminal state. Returning to Markets preserves the active category, local pagination and scroll where practical.

## Ownership and migration

Presentation components own layout, navigation, formatting and interaction composition only. Existing VNext hooks, `VNextAssetWorkspace`, `TradeIntentComposer`, `SpendBalance`, wallet controls and execution recovery remain shared. Mobile and desktop never create independent trading engines.

The final responsive boundary is 1024px because the evidence shows the workstation cannot preserve readable navigator, chart and trade-rail geometry below that width. The seam is validated at 1025, 1024, 1023, 1000 and 960 pixels.

`vnext-terminal.css` becomes the single authoritative terminal stylesheet. Intentional current rules are consolidated into it, superseded presentation DOM and reconstruction overrides are removed, and no additional terminal stylesheet is introduced.

## Execution invariants

This work does not change quote math, route ranking, provider admission, strict verification, runtime pins, calldata validation, approvals, slippage, wallet authorization, transaction construction, submission, fee policy, treasury, settlement, reconciliation, recovery, funding or Robinhood Chain configuration. Wallet review and signing remain explicit. Any requirement to change those boundaries stops this UI phase for separate review.

## Validation and rollback

Acceptance must prove Markets is the default on desktop and mobile, Asset is entered by selection or deep link, Portfolio is separate, RWA remains an in-terminal preset, mobile never renders the workstation, the Buy/Sell dock exists only in Asset, and the trade sheet preserves accessibility and verification visibility.

The exploratory visual matrix covers 1920, 1440, 1280, 1025, 1024, 1023, 1000, 960, 900, 820, 768, 430, 414, 390, 375 and 360 pixel widths across Markets, Asset, Portfolio, RWA, Buy and Sell states. Permanent CI keeps a smaller stable matrix. Every primary screenshot is opened and inspected; P1/P2 defects block completion.

Rollback is one focused presentation PR reversal. No contract, provider, database or environment rollback is required because functional VNext infrastructure remains unchanged.
