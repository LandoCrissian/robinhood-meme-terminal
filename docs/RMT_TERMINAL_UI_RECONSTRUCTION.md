# RMT terminal UI reconstruction

Status: CURRENT implementation note for the presentation-only reconstruction.

## Problem and regression

VNext correctly became the canonical production terminal, but `VNextTerminalShell` currently owns both terminal state and one visual tree. Desktop receives a large card-oriented dashboard, while the `<=760px` rules hide the sidebar, reorder the same market/workspace/trade elements, and place the full desktop trade rail above mobile market content.

Before the VNext cutover, `responsive-external-market-feed.tsx` selected a dedicated mobile presentation at 760px. The mobile workspace provided concise market rows, persistent Buy/Sell actions, and an accessible execution sheet with a backdrop, focus containment, scroll locking, and explicit close behavior. The cutover replaced acceptance coverage for those behaviors with checks that the shared `vnMarketRow` and reordered `vnTradePanel` fit the viewport. That test change allowed the mobile regression.

The market presentation also hides valid directory results: the API currently discovers a bounded USDG/WETH/RMT-anchored set, while the shell further truncates that response to eight rows. This reconstruction removes the UI truncation and provides exact-address selection without claiming that the current API is a complete chain index.

## Architecture

One shared terminal controller owns:

- market directory, search and selected asset;
- connected-wallet assets, native gas balance and Spend Balance inputs;
- execution recovery;
- trade side requests and continue-trading behavior;
- device presentation selection at the established 760px boundary.

It renders exactly one presentation composition:

- `DesktopTerminal`: compact navigation and market directory, dominant asset/chart workspace, persistent execution rail, and progressively disclosed intelligence.
- `MobileTerminal`: focused asset workspace, compact discovery, persistent Buy/Sell dock, and a dialog execution sheet.

The presentations consume the same VNext hooks and services. They do not create separate quote, routing, verification, authorization, submission, or recovery systems. `TradeIntentComposer` remains the shared execution surface; desktop places it in the rail and mobile places it in the dedicated sheet.

## Composition and ownership

- The terminal shell/controller owns device selection and shared state.
- Desktop and mobile presentation components own only layout, navigation and interaction composition.
- Market directory rows have distinct desktop and mobile markup fed by the same filtered results.
- The asset workspace fetches evidence once for the rendered presentation and uses presentation-specific composition for chart, key statistics and secondary intelligence.
- Mobile execution-sheet behavior owns dialog semantics, backdrop, safe-area layout, focus return/trapping, Escape handling and page scroll locking.

## Execution invariants

This work does not change quote calculation, provider ranking, strict verification, contract/runtime allowlists, approvals, calldata construction, slippage protection, wallet authorization, fee policy, settlement, recovery, funding, or Robinhood Chain configuration. Wallet signing remains explicit. If presentation work requires changing any of those boundaries, implementation stops for a separate security review.

## Responsive boundary

- Mobile composition: viewport width `<=760px`.
- Desktop composition: viewport width `>=761px`, with workstation proportions tuned at 1024×768, 1280×800 and 1440×900.

The selector uses a subscription-backed media query so server rendering is deterministic and the client renders one device composition, rather than rendering both and hiding one with CSS.

## Migration and testing

1. Formalize the shared terminal controller without changing its services.
2. Introduce the desktop workstation composition.
3. Introduce the mobile composition and execution sheet.
4. Replace acceptance assertions that encode CSS reordering with behavioral desktop/mobile assertions.
5. Capture deterministic visual evidence at 1440×900, 1280×800, 1024×768, 430×932, 390×844 and 360×800.
6. Run focused VNext checks, terminal release checks, typecheck and production build.

Rollback is a single presentation commit/PR reversal. The VNext service and execution layers remain unchanged, so rollback does not require contract, provider, data or environment changes.

## Known directory boundary

This PR can display all markets returned by the current directory and resolve an exact contract lookup. It will not turn the web shell into a chain-wide indexer. Complete Robinhood Chain token coverage must ultimately come from the authoritative market-intelligence service, with truthful coverage/staleness metadata, in a separately scoped integration.
